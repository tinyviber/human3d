import {afterEach,describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {
 CHECK_IDS,FALLBACK_REASONS,RECEIPT_AUTHORITY,RECEIPT_SCHEMA_VERSION,
 classifyChangedPath,collectVitestTargets,createReceipt,fingerprintSnapshot,
 parseNameStatusZ,parsePorcelainV2Z,selectAffectedChecks,serializeReceipt,
} from '../scripts/lib/affected-checks.mjs';
import {parseArgs} from '../scripts/check-affected.mjs';

const repoRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const nul=(...parts:Buffer[])=>Buffer.concat(parts.flatMap(part=>[part,Buffer.from([0])]));
const text=(value:string)=>Buffer.from(value,'utf8');
const raw=(...bytes:number[])=>Buffer.from(bytes);
const tempDirs:string[]=[];
const tempDir=()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'human3d-affected-checks-'));
 tempDirs.push(dir);
 return dir;
};
const pathBytes=(root:string,relative:Buffer|string)=>Buffer.concat([
 Buffer.from(root+path.sep),Buffer.isBuffer(relative)?relative:Buffer.from(relative,'utf8'),
]);
const git=(root:string,args:string[])=>execFileSync('git',['-C',root,...args],{
 cwd:root,env:{...process.env,GIT_NO_REPLACE_OBJECTS:'1'},
});

afterEach(()=>{
 for(const dir of tempDirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});
});

describe('raw Git name-status parser',()=>{
 it('parses A/M/D records as one raw path each and preserves newlines',()=>{
  const added=text('added.txt');
  const modified=text('line\nbreak.txt');
  const deleted=text('deleted.txt');
  const records=parseNameStatusZ(nul(text('A'),added,text('M'),modified,text('D'),deleted));

  expect(records).toHaveLength(3);
  expect(records.map(record=>record.status)).toEqual(['A','M','D']);
  expect(records[0]?.path).toEqual(added);
  expect(records[1]?.path).toEqual(modified);
  expect(records[2]?.path).toEqual(deleted);
  expect(records.every(record=>record.oldPath===undefined)).toBe(true);
 });

 it('retains both raw paths and score for rename and copy records',()=>{
  const oldName=text('old name.bin');
  const newName=text('renamed name.bin');
  const copySource=text('copy source.bin');
  const copyTarget=text('copy target.bin');
  const records=parseNameStatusZ(nul(text('R100'),oldName,newName,text('C075'),copySource,copyTarget));

  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({status:'R',oldPath:oldName,path:newName});
  expect(records[0]?.score).toBeDefined();
  expect(records[1]).toMatchObject({status:'C',oldPath:copySource,path:copyTarget});
  expect(records[1]?.score).toBeDefined();
 });

 it('preserves invalid UTF-8 bytes without decoding or normalizing them',()=>{
  const invalidPath=raw(0x66,0x80,0x6f,0x2e,0x62,0x69,0x6e);
  const [record]=parseNameStatusZ(nul(text('M'),invalidPath));

  expect(record?.path).toEqual(invalidPath);
  expect(record?.path.includes(0x80)).toBe(true);
 });

 it.each([
  ['unterminated path',Buffer.from([0x41,0,0x66,0x6f,0x6f])],
  ['rename missing its destination',nul(text('R100'),text('old.txt'))],
  ['unsupported status code',nul(text('Q'),text('path'))],
  ['invalid rename score',nul(text('Rbad'),text('old.txt'),text('new.txt'))],
 ])('rejects malformed name-status input: %s',(_label,input)=>{
  expect(()=>parseNameStatusZ(input)).toThrow();
 });
});

describe('committed raw path manifest from Git',()=>{
 it.skipIf(process.platform==='win32')('retains invalid UTF-8, newline, and both rename paths from actual NUL output',({skip})=>{
  const root=tempDir();
  git(root,['init','--quiet']);
  git(root,['config','user.name','Issue 11 test']);
  git(root,['config','user.email','issue-11-tests@example.invalid']);
  git(root,['config','diff.renames','true']);

  const oldName=text('rename-source.bin');
  const newName=text('rename-destination.bin');
  const sharedContents=Buffer.from([0,1,2,255,10]);
  fs.writeFileSync(pathBytes(root,oldName),sharedContents);
  git(root,['add','-A']);
  git(root,['commit','--quiet','-m','base']);
  const base=git(root,['rev-parse','HEAD']).toString('ascii').trim();

  fs.renameSync(pathBytes(root,oldName),pathBytes(root,newName));
  const newlineName=text('line\nbreak.txt');
  fs.writeFileSync(pathBytes(root,newlineName),Buffer.from('newline path contents'));
  const invalidName=raw(0x69,0x6e,0x76,0x61,0x6c,0x69,0x64,0x2d,0xff,0x2e,0x62,0x69,0x6e);
  try{
   fs.writeFileSync(pathBytes(root,invalidName),Buffer.from('invalid byte path contents'));
  }catch(error){
   const code=error&&typeof error==='object'&&'code'in error?error.code:undefined;
   if(code==='EINVAL'||code==='EILSEQ'||code==='ERR_INVALID_ARG_VALUE'||code==='ENOTSUP')skip();
   throw error;
  }
  git(root,['add','-A']);
  git(root,['commit','--quiet','-m','changed paths']);

  const output=git(root,['diff','--name-status','-z',base,'HEAD','--']);
  const records=parseNameStatusZ(output);
  const addedInvalid=records.find(record=>record.path.equals(invalidName));
  const addedNewline=records.find(record=>record.path.equals(newlineName));
  const renamed=records.find(record=>record.status==='R'&&record.path.equals(newName));

  expect(output.includes(0)).toBe(true);
  expect(addedInvalid?.status).toBe('A');
  expect(addedInvalid?.path).toEqual(invalidName);
  expect(addedNewline?.status).toBe('A');
  expect(addedNewline?.path).toEqual(newlineName);
  expect(renamed?.oldPath).toEqual(oldName);
  expect(renamed?.path).toEqual(newName);
 });
});

describe('raw porcelain-v2 parser',()=>{
 it('preserves path bytes for ordinary, rename, untracked, and conflicted records',()=>{
  const ordinary=text('1 MM N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 ');
  const rename=text('2 R. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100 ');
  const conflict=text('u UU N... 100644 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 3333333333333333333333333333333333333333 ');
  const ordinaryPath=text('tracked\nname.bin');
  const renamePath=text('new name.bin');
  const oldPath=text('old name.bin');
  const untrackedPath=text('untracked/a/b/child.bin');
  const conflictPath=text('conflicted.bin');
  const input=Buffer.concat([
   ordinary,ordinaryPath,Buffer.from([0]),
   rename,renamePath,Buffer.from([0]),oldPath,Buffer.from([0]),
   text('? '),untrackedPath,Buffer.from([0]),
   conflict,conflictPath,Buffer.from([0]),
  ]);
  const records=parsePorcelainV2Z(input);

  expect(records).toHaveLength(4);
  expect(records[0]?.path).toEqual(ordinaryPath);
  expect(records[1]?.path).toEqual(renamePath);
  expect(records[1]?.originalPath).toEqual(oldPath);
  expect(records[2]?.path).toEqual(untrackedPath);
  expect(records[3]?.path).toEqual(conflictPath);
 });

 it('preserves invalid UTF-8 bytes in status paths',()=>{
  const invalidPath=raw(0x75,0x6e,0x74,0x72,0x61,0x63,0x6b,0x65,0x64,0x2f,0xff,0x2e,0x62,0x69,0x6e);
  const [record]=parsePorcelainV2Z(Buffer.concat([text('? '),invalidPath,Buffer.from([0])]));

  expect(record?.path).toEqual(invalidPath);
 });

 it('rejects unterminated records instead of silently dropping them',()=>{
  expect(()=>parsePorcelainV2Z(text('? untracked/a/b/child.bin'))).toThrow();
 });
});

const classify=(relativePath:string,status='M')=>classifyChangedPath(relativePath,status);

describe('affected-check selector categories',()=>{
 it.each([
  ['apps/web/src/lab/engine.ts','web',['fast','vitest','build']],
  ['apps/server/src/service.ts','server',['fast','spec','vitest','build']],
  ['packages/motion-core/src/document.ts','motion-core',['fast','spec','vitest','build']],
  ['assets/source/dynamics/myofullbody-complete.xml','dynamics-source',['fast','dynamics-validate','dynamics-test']],
  ['assets/source/dynamics/myofullbody-parameters.json','dynamics-source',['fast','dynamics-validate','dynamics-test']],
 ])('maps %s to %s',(relativePath,category,checkIds)=>{
  const [item]=selectAffectedChecks([{path:relativePath,status:'M'}]).changedPaths;
  expect(item?.category).toBe(category);
  expect(item?.selectedCheckIds).toEqual(checkIds);
 });

 it('always selects fast even with no changed paths',()=>{
  const selection=selectAffectedChecks([]);
  expect(selection.selectedCheckIds).toEqual(['fast']);
  expect(selection.fallbackReasons).toEqual([]);
 });

 it.each([
  'assets/source/dynamics/neighbor.xml',
  'assets/source/dynamics/capture-reference.json',
  'assets/source/124_01.bvh',
  'assets/dynamics/baseball-throw/baseline.json',
  'assets/motions/baseball-throw.json',
  'apps/server/src/contract.ts',
  'packages/motion-core/src/protocol.ts',
  'packages/motion-core/src/solver.ts',
  'packages/motion-core/src/limits.ts',
  'packages/motion-core/src/kinematics.ts',
  'packages/motion-core/src/rig.ts',
  'packages/motion-core/src/package-const.ts',
  'public/index.html',
  'scripts/check-worktree.mjs',
  'tests/architecture.test.ts',
  'spec/openapi.json',
  '.github/workflows/test.yml',
  'package.json',
  'apps/web/package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  '.npmrc',
  '.gitattributes',
  'docs/engineering/review-protocol.md',
 ])('falls back to all six for %s',relativePath=>{
  const selection=selectAffectedChecks([{path:relativePath,status:'M'}]);
  expect(selection.selectedCheckIds).toEqual([...CHECK_IDS]);
  expect(selection.changedPaths[0]?.category).toBe('full-fallback');
  expect(selection.changedPaths[0]?.selectedCheckIds).toEqual([...CHECK_IDS]);
  expect(selection.fallbackReasons.length).toBeGreaterThan(0);
 });

 it('reports docs-only, unclassified, and unrepresentable reasons',()=>{
  expect(classify('docs/ARCHITECTURE.md')).toMatchObject({fallbackReason:'docs-only'});
  expect(classify('README.unknown')).toMatchObject({fallbackReason:'unclassified-path'});
  expect(classify('../outside.ts')).toMatchObject({fallbackReason:'unrepresentable-path'});
 });

 it('forces broad-input for added dynamics allowlist files',()=>{
  const [item]=selectAffectedChecks([{
   path:'assets/source/dynamics/myofullbody-parameters.json',status:'A',
  }]).changedPaths;
  expect(item?.category).toBe('full-fallback');
  expect(item?.fallbackReason).toBe('delete-rename-copy');
 });

 it('unions selective categories in check order',()=>{
  const selection=selectAffectedChecks([
   {path:'apps/web/src/lab/engine.ts',status:'M'},
   {path:'assets/source/dynamics/myofullbody-parameters.json',status:'M'},
  ]);
  expect(selection.selectedCheckIds).toEqual(['fast','vitest','build','dynamics-validate','dynamics-test']);
 });

 it('lets any fallback overwrite every selective row',()=>{
  const selection=selectAffectedChecks([
   {path:'apps/web/src/lab/engine.ts',status:'M'},
   {path:'scripts/check-worktree.mjs',status:'M'},
  ]);
  expect(selection.selectedCheckIds).toEqual([...CHECK_IDS]);
  expect(selection.changedPaths.map(item=>item.category)).toEqual(['full-fallback','full-fallback']);
  expect(selection.fallbackReasons).toEqual(['broad-input']);
 });

 it('orders fallback reasons in the fixed order',()=>{
  const selection=selectAffectedChecks(
   [{path:'docs/ARCHITECTURE.md',status:'M'},{path:'scripts/a.mjs',status:'M'}],
   {dirty:true},
  );
  expect(selection.fallbackReasons).toEqual(['dirty-tree','broad-input','docs-only']);
 });

 it.each(FALLBACK_REASONS)('keeps %s in the exported fallback vocabulary',reason=>{
  expect(FALLBACK_REASONS).toContain(reason);
 });
});

describe('vitest reverse-importer closure',()=>{
 it('collects tests that reach changed source through relative imports',()=>{
  const sources:Record<string,string>={
   'apps/web/src/a.ts':'export const a=1;\n',
   'apps/web/src/b.ts':"import './a';\nexport const b=2;\n",
   'apps/web/src/b.test.ts':"import './b';\n",
   'apps/web/src/unrelated.test.ts':"import 'three';\n",
  };
  const result=collectVitestTargets({
   trackedFiles:Object.keys(sources),
   changedPaths:[{path:'apps/web/src/a.ts'}],
   readFile:file=>sources[file]??'',
  });
  expect(result.tests).toEqual(['apps/web/src/b.test.ts']);
  expect(result.uncertain).toBe(false);
 });

 it('reports uncertainty for unresolved relative source imports',()=>{
  const sources:Record<string,string>={
   'apps/web/src/a.ts':'export const a=1;\n',
   'apps/web/src/b.test.ts':"import './missing';\n",
  };
  const result=collectVitestTargets({
   trackedFiles:Object.keys(sources),
   changedPaths:[{path:'apps/web/src/a.ts'}],
   readFile:file=>sources[file]??'',
  });
  expect(result.uncertain).toBe(true);
 });

 it('resolves workspace package imports through package exports',()=>{
  const sources:Record<string,string>={
   'packages/motion-core/src/a.ts':'export const a=1;\n',
   'packages/motion-core/src/index.ts':"export * from './a';\n",
   'apps/server/src/a.test.ts':"import {a} from '@human3d/motion-core';\n",
  };
  const result=collectVitestTargets({
   trackedFiles:Object.keys(sources),
   changedPaths:[{path:'packages/motion-core/src/a.ts'}],
   readFile:file=>sources[file]??'',
   workspacePackages:{'@human3d/motion-core':{'.':'packages/motion-core/src/index.ts'}},
  });
  expect(result.tests).toEqual(['apps/server/src/a.test.ts']);
  expect(result.uncertain).toBe(false);
 });

 it('fails open for unresolved workspace imports',()=>{
  const sources:Record<string,string>={
   'apps/web/src/a.test.ts':"import '@human3d/unknown';\n",
  };
  const result=collectVitestTargets({
   trackedFiles:Object.keys(sources),
   changedPaths:[{path:'apps/web/src/a.test.ts'}],
   readFile:file=>sources[file]??'',
  });
  expect(result.uncertain).toBe(true);
 });
});

describe('receipt contract',()=>{
 const snapshot={headSha:'a'.repeat(40),baseSha:'b'.repeat(40),mergeBaseSha:null,shallow:false,dirty:false,status:[],changedPaths:[]};
 const build=()=>createReceipt({
  state:'planned',mode:'local',runId:'run-1',createdAt:'2026-01-01T00:00:00.000Z',
  outputPath:'/tmp/receipt.json',baseSha:'b'.repeat(40),requestedHeadSha:null,
  headSha:'a'.repeat(40),mergeBaseSha:null,selectedCheckIds:['fast'],
  snapshotFingerprint:fingerprintSnapshot(snapshot),cliExitCode:0,
 });

 it('pins schemaVersion and authority constants',()=>{
  expect(RECEIPT_SCHEMA_VERSION).toBe(1);
  expect(RECEIPT_AUTHORITY).toBe('human3d.local-check-runner');
  const receipt=build();
  expect(receipt.schemaVersion).toBe(1);
  expect(receipt.authority).toBe('human3d.local-check-runner');
 });

 it('keeps the fixed top-level key order',()=>{
  expect(Object.keys(build())).toEqual([
   'schemaVersion','authority','state','mode','runId','createdAt','outputPath',
   'baseSha','requestedHeadSha','headSha','mergeBaseSha','claimScope',
   'selectedCheckIds','executedCheckIds','checkResults','fallbackReasons','changedPaths',
   'repository','toolIdentity','environment','snapshotComplete','snapshotEqual',
   'snapshotConsistency','snapshotCaptures','snapshotFingerprint','failureKind',
   'failureMessage','cliExitCode',
  ]);
 });

 it('serializes deterministic pretty JSON with exactly one trailing LF',()=>{
  const receipt=build();
  const bytes=serializeReceipt(receipt);
  expect(bytes.toString('utf8')).toBe(`${JSON.stringify(receipt,null,2)}\n`);
  expect(bytes.at(-1)).toBe(0x0a);
  expect(bytes.toString('utf8').endsWith('\n\n')).toBe(false);
  expect(serializeReceipt(receipt).equals(bytes)).toBe(true);
 });

 it('fingerprints snapshots deterministically',()=>{
  const first=fingerprintSnapshot(snapshot);
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(fingerprintSnapshot({...snapshot})).toBe(first);
  expect(fingerprintSnapshot({...snapshot,dirty:true})).not.toBe(first);
 });
});

describe('CLI argument contract',()=>{
 const sha='a'.repeat(40);
 it('accepts flags in any order and an optional run flag',()=>{
  expect(parseArgs(['--run','--head',sha,'--base',sha])).toEqual({base:sha,head:sha,run:true});
 });
 it.each([
  ['missing base',[]],
  ['missing value',['--base']],
  ['duplicate base',['--base',sha,'--base',sha]],
  ['equals form',['--base='+sha]],
  ['extra positional',['--base',sha,'extra']],
  ['unknown flag',['--base',sha,'--out-dir','x']],
 ])('rejects %s',(_label,args)=>{
  expect(()=>parseArgs(args)).toThrow();
 });
});

describe.skipIf(process.platform==='win32')('affected-check CLI in a temporary repository',()=>{
 const prepareRepo=()=>{
  const root=tempDir();
  git(root,['init','--quiet']);
  git(root,['config','user.name','Issue 11 test']);
  git(root,['config','user.email','issue-11-tests@example.invalid']);
  for(const relative of ['scripts/check-affected.mjs','scripts/lib/affected-checks.mjs','scripts/lib/capture.mjs','scripts/lib/qa-output.mjs']){
   const target=path.join(root,relative);
   fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.copyFileSync(path.join(repoRoot,relative),target);
  }
  const stub=(relative:string,contents:string)=>{
   const target=path.join(root,relative);
   fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.writeFileSync(target,contents);
   fs.chmodSync(target,0o755);
  };
  stub('node_modules/vitest/vitest.mjs','process.exit(0);\n');
  stub('node_modules/typescript/bin/tsc','process.exit(0);\n');
  stub('node_modules/vite/bin/vite.js','process.exit(0);\n');
  stub('scripts/validate-action-spec.py','import sys\nsys.exit(0)\n');
  stub('scripts/test-dynamics-records.py','import sys\nsys.exit(0)\n');
  const lifecycle=JSON.parse(fs.readFileSync(path.join(repoRoot,'package.json'),'utf8')).scripts['check:affected'];
  fs.writeFileSync(path.join(root,'package.json'),`${JSON.stringify({
   name:'fixture',private:true,type:'module',workspaces:['apps/*','packages/*'],
   scripts:{'check:affected':lifecycle},
  },null,2)}\n`);
  fs.writeFileSync(path.join(root,'.gitignore'),'.out/\nnode_modules/\n');
  fs.mkdirSync(path.join(root,'assets','source','dynamics'),{recursive:true});
  fs.mkdirSync(path.join(root,'apps','web'),{recursive:true});
  fs.mkdirSync(path.join(root,'apps','server'),{recursive:true});
  fs.mkdirSync(path.join(root,'packages','motion-core'),{recursive:true});
  fs.mkdirSync(path.join(root,'node_modules','@human3d'),{recursive:true});
  fs.symlinkSync(path.join('..','..','apps','web'),path.join(root,'node_modules','@human3d','web'));
  fs.symlinkSync(path.join('..','..','apps','server'),path.join(root,'node_modules','@human3d','server'));
  fs.symlinkSync(path.join('..','..','packages','motion-core'),path.join(root,'node_modules','@human3d','motion-core'));
  fs.writeFileSync(path.join(root,'assets','source','dynamics','myofullbody-parameters.json'),'{"version":1}\n');
  git(root,['add','-A']);
  git(root,['commit','--quiet','-m','base']);
  return {root,base:git(root,['rev-parse','HEAD']).toString('ascii').trim()};
 };
 const runCli=(root:string,args:string[])=>{
  const result=spawnSync(process.execPath,[path.join(root,'scripts','check-affected.mjs'),...args],{
   cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],
  });
  return {status:result.status,stdout:result.stdout,stderr:result.stderr};
 };
 const receiptFiles=(root:string)=>{
  const directory=path.join(root,'.out','check-affected');
  if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory).flatMap(run=>{
   const file=path.join(directory,run,'receipt.json');
   return fs.existsSync(file)?[file]:[];
  });
 };

 it('writes a planned receipt for a clean unchanged commit',()=>{
  const {root,base}=prepareRepo();
  const result=runCli(root,['--base',base]);

  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('');
  const [file]=receiptFiles(root);
  expect(file).toBeDefined();
  const receipt=JSON.parse(fs.readFileSync(file!,'utf8'));
  expect(receipt.schemaVersion).toBe(1);
  expect(receipt.authority).toBe('human3d.local-check-runner');
  expect(receipt.state).toBe('planned');
  expect(receipt.selectedCheckIds).toEqual(['fast']);
  expect(receipt.cliExitCode).toBe(0);
  expect(fs.realpathSync(receipt.outputPath)).toBe(fs.realpathSync(file!));
  expect(Object.keys(receipt)[0]).toBe('schemaVersion');
 });

 it('forces all six when the worktree is dirty',()=>{
  const {root,base}=prepareRepo();
  fs.writeFileSync(path.join(root,'untracked.txt'),'dirty\n');

  const result=runCli(root,['--base',base]);

  expect(result.status).toBe(0);
  const [file]=receiptFiles(root);
  const receipt=JSON.parse(fs.readFileSync(file!,'utf8'));
  expect(receipt.selectedCheckIds).toEqual([...CHECK_IDS]);
  expect(receipt.fallbackReasons).toContain('dirty-tree');
 });

 it('emits no receipt for malformed arguments or revisions',()=>{
  const {root,base}=prepareRepo();
  const cases=[
   {args:[],status:2,stderr:'check:affected: invalid arguments\n'},
   {args:['--base',base,'--bogus'],status:2,stderr:'check:affected: invalid arguments\n'},
   {args:['--base','deadbeef'],status:2,stderr:'check:affected: invalid commit argument\n'},
   {args:['--base',base,'--base',base],status:2,stderr:'check:affected: invalid arguments\n'},
  ];
  for(const entry of cases){
   const result=runCli(root,entry.args);
   expect(result.status).toBe(entry.status);
   expect(result.stdout).toBe('');
   expect(result.stderr).toBe(entry.stderr);
  }
  expect(receiptFiles(root)).toEqual([]);
 });

 it('rejects an explicit head that differs from actual HEAD',()=>{
  const {root,base}=prepareRepo();
  fs.writeFileSync(path.join(root,'README.md'),'second\n');
  git(root,['add','-A']);
  git(root,['commit','--quiet','-m','second']);

  const result=runCli(root,['--base',base,'--head',base]);

  expect(result.status).toBe(1);
  expect(result.stderr).toBe('check:affected: repository-identity-mismatch\n');
  const [file]=receiptFiles(root);
  const receipt=JSON.parse(fs.readFileSync(file!,'utf8'));
  expect(receipt.state).toBe('failed');
  expect(receipt.failureKind).toBe('repository-identity-mismatch');
  expect(receipt.cliExitCode).toBe(1);
 });

 it('publishes a failed check-failed receipt when selected checks fail',()=>{
  const {root,base}=prepareRepo();
  fs.writeFileSync(path.join(root,'node_modules','vitest','vitest.mjs'),'process.exit(1);\n');
  fs.writeFileSync(path.join(root,'assets','source','dynamics','myofullbody-parameters.json'),'{"version":2}\n');
  git(root,['add','-A']);
  git(root,['commit','--quiet','-m','allowlisted dynamics change']);

  const result=runCli(root,['--base',base,'--run']);

  expect(result.status).toBe(1);
  expect(result.stderr).toBe('check:affected: check-failed\n');
  const [file]=receiptFiles(root);
  const receipt=JSON.parse(fs.readFileSync(file!,'utf8'));
  expect(receipt.state).toBe('failed');
  expect(receipt.failureKind).toBe('check-failed');
  expect(receipt.cliExitCode).toBe(1);
  expect(receipt.executedCheckIds).toEqual(['fast','dynamics-validate','dynamics-test']);
  expect(receipt.checkResults.some((entry:{outcome:string})=>entry.outcome==='failed')).toBe(true);
  for(const entry of receipt.checkResults){
   expect(Object.keys(entry)).toEqual(['checkId','selected','outcome','argv','cwd','startedAt','endedAt','durationMs','exitCode','signal','runnerError']);
   if(entry.selected){
    expect(Array.isArray(entry.argv)).toBe(true);
    expect(Array.isArray(entry.cwd)).toBe(true);
   }
  }
 });

 it('reports verified all-six checks with a second snapshot capture on a passing run',()=>{
  const {root,base}=prepareRepo();
  fs.writeFileSync(path.join(root,'docs.md'),'# docs\n');
  git(root,['add','-A']);
  git(root,['commit','--quiet','-m','docs change']);

  const result=runCli(root,['--base',base,'--run']);

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const [file]=receiptFiles(root);
  const receipt=JSON.parse(fs.readFileSync(file!,'utf8'));
  expect(receipt.state).toBe('verified');
  expect(receipt.mode).toBe('run');
  expect(receipt.claimScope).toBe('all-six-checks');
  expect(receipt.checkResults.map((entry:{checkId:string})=>entry.checkId)).toEqual([...CHECK_IDS]);
  expect(receipt.executedCheckIds).toEqual([...CHECK_IDS]);
  expect(receipt.snapshotComplete).toBe(true);
  expect(receipt.snapshotCaptures).toHaveLength(18);
  expect(receipt.snapshotEqual).toBe(true);
  expect(receipt.failureKind).toBeNull();
  expect(receipt.cliExitCode).toBe(0);
  expect(receipt.checkResults.map((entry:{outcome:string})=>entry.outcome)).toEqual(
   Array(6).fill('passed'),
  );
  expect(receipt.checkResults.every((entry:{argv:unknown})=>Array.isArray(entry.argv))).toBe(true);
 });

 it('treats assume-unchanged tracked files as hidden and runs all six',()=>{
  const {root,base}=prepareRepo();
  fs.mkdirSync(path.join(root,'apps','web','src'),{recursive:true});
  fs.writeFileSync(path.join(root,'apps','web','src','a.ts'),'export const a=1;\n');
  git(root,['add','-A']);
  git(root,['commit','--quiet','-m','source']);
  git(root,['update-index','--assume-unchanged','apps/web/src/a.ts']);
  fs.writeFileSync(path.join(root,'apps','web','src','a.ts'),'export const a=2;\n');

  const result=runCli(root,['--base',base]);

  expect(result.status).toBe(0);
  const [file]=receiptFiles(root);
  const receipt=JSON.parse(fs.readFileSync(file!,'utf8'));
  expect(receipt.selectedCheckIds).toEqual([...CHECK_IDS]);
  expect(receipt.fallbackReasons).toContain('dirty-tree');
  expect(receipt.repository.worktreeMatchesIndex).toBe(false);
 });

 it('ignores repository-local excludesFile when detecting untracked source',()=>{
  const {root,base}=prepareRepo();
  const excludes=path.join(root,'.local-excludes');
  fs.writeFileSync(excludes,'notes.ts\n');
  git(root,['config','core.excludesFile',excludes]);
  fs.writeFileSync(path.join(root,'notes.ts'),'export const hidden=1;\n');

  const result=runCli(root,['--base',base]);

  expect(result.status).toBe(0);
  const [file]=receiptFiles(root);
  const receipt=JSON.parse(fs.readFileSync(file!,'utf8'));
  expect(receipt.selectedCheckIds).toEqual([...CHECK_IDS]);
  expect(receipt.fallbackReasons).toContain('dirty-tree');
 });

 it('refuses a symlinked .out directory without writing outside the repository',()=>{
  const {root,base}=prepareRepo();
  const outside=tempDir();
  fs.rmSync(path.join(root,'.out'),{recursive:true,force:true});
  fs.symlinkSync(outside,path.join(root,'.out'));

  const result=runCli(root,['--base',base]);

  expect(result.status).toBe(4);
  expect(result.stderr).toBe('check:affected: receipt output unavailable\n');
  expect(fs.readdirSync(outside)).toEqual([]);
 });

 it('records an explicit head that equals actual HEAD',()=>{
  const {root,base}=prepareRepo();
  const result=runCli(root,['--base',base,'--head',base]);
  expect(result.status).toBe(0);
  const [file]=receiptFiles(root);
  const receipt=JSON.parse(fs.readFileSync(file!,'utf8'));
  expect(receipt.requestedHeadSha).toBe(base);
 });

 it('runs through the literal public npm wrapper and records npm identity',()=>{
  const {root,base}=prepareRepo();
  const npm=path.join(path.dirname(process.execPath),'npm');
  const result=spawnSync(npm,[
   '--silent','--userconfig=/dev/null','--globalconfig=/dev/null','--script-shell=/bin/sh',
   'run','check:affected','--','--base',base,
  ],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env}});

  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('');
  const [file]=receiptFiles(root);
  const receipt=JSON.parse(fs.readFileSync(file!,'utf8'));
  expect(receipt.state).toBe('planned');
  expect(receipt.toolIdentity.npm).not.toBeNull();
 });
});
