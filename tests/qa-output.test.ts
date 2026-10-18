import {afterEach,describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertTrackedWriteAllowed,resolveOutputDir} from '../scripts/lib/qa-output.mjs';
import {resolveBuildOutDir} from '../apps/web/vite.config';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tempDirs:string[]=[];
const tempDir=()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'human3d-qa-output-'));
 tempDirs.push(dir);
 return dir;
};
afterEach(()=>{
 for(const dir of tempDirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});
});

describe('QA and generator output resolution',()=>{
 it('defaults to a stable per-worktree, per-run script scratch directory',()=>{
  const env={HUMAN3D_RUN_ID:'unit-run-42'};
  const first=resolveOutputDir('quality-probe',['--fps','240'],ROOT,env);
  const second=resolveOutputDir('quality-probe',['--fps','240'],ROOT,env);
  const relative=path.relative(ROOT,first.dir).split(path.sep);
  expect(relative).toHaveLength(4);
  expect(relative[0]).toBe('.out');
  expect(relative[1]).not.toBe(''); // Worktree identity is implementation-defined.
  expect(relative[2]).toBe('unit-run-42');
  expect(relative[3]).toBe('quality-probe');
  expect(second.dir).toBe(first.dir);
  expect(first.args).toEqual(['--fps','240']);
  expect(first.updateEvidence).toBe(false);
 });

 it('consumes output and evidence flags while preserving unrelated CLI arguments',()=>{
  const outDir=path.join(tempDir(),'explicit-output');
  const result=resolveOutputDir('package-export',[
   '--fps','60','--out-dir',outDir,'--update-evidence','--motion','idle',
  ],ROOT,{HUMAN3D_RUN_ID:'unit-run-7'});
  expect(result.dir).toBe(outDir);
  expect(result.args).toEqual(['--fps','60','--motion','idle']);
  expect(result.updateEvidence).toBe(true);
 });

 it('accepts the equals form of the output option and leaves evidence opt-in false',()=>{
  const outDir=path.join(tempDir(),'explicit-equals');
  const result=resolveOutputDir('package-export',[
   `--out-dir=${outDir}`,'--dry-run',
  ],ROOT,{HUMAN3D_RUN_ID:'unit-run-8'});
  expect(result.dir).toBe(outDir);
  expect(result.args).toEqual(['--dry-run']);
  expect(result.updateEvidence).toBe(false);
 });
});

describe('Vite build output resolution',()=>{
 it('rejects output that could erase tracked spec files',()=>{
  const root=tempDir();
  expect(()=>resolveBuildOutDir(root,'spec')).toThrow();
 });

 it('rejects the shared .out root',()=>{
  const root=tempDir();
  fs.mkdirSync(path.join(root,'.out'),{recursive:true});
  expect(()=>resolveBuildOutDir(root,'.out')).toThrow();
 });

 it('rejects a .out root symlink that resolves into the repository spec tree',()=>{
  const root=tempDir();
  const source=path.join(root,'spec');
  fs.mkdirSync(source);
  fs.symlinkSync(source,path.join(root,'.out'),'dir');
  expect(()=>resolveBuildOutDir(root,path.join('.out','build'))).toThrow();
 });

 it('rejects a dist root symlink that resolves into the repository spec tree',()=>{
  const root=tempDir();
  const source=path.join(root,'spec');
  fs.mkdirSync(source);
  fs.symlinkSync(source,path.join(root,'dist'),'dir');
  expect(()=>resolveBuildOutDir(root,undefined)).toThrow();
 });

 it('rejects an output path that escapes through a symlink',()=>{
  const root=tempDir();
  const outside=tempDir();
  const linkedOutput=path.join(root,'.out','redirected');
  fs.mkdirSync(path.dirname(linkedOutput),{recursive:true});
  fs.symlinkSync(outside,linkedOutput,'dir');
  expect(()=>resolveBuildOutDir(root,path.join('.out','redirected','build'))).toThrow();
 });

 it('uses dist by default and accepts explicit dist output',()=>{
  const root=tempDir();
  expect(resolveBuildOutDir(root,undefined)).toBe(path.join(fs.realpathSync(root),'dist'));
  expect(resolveBuildOutDir(root,'dist')).toBe(path.join(fs.realpathSync(root),'dist'));
 });

 it('allows nested .out build output',()=>{
  const root=tempDir();
  const nestedOutput=path.join(fs.realpathSync(root),'.out','worktree-a','build');
  expect(resolveBuildOutDir(root,path.join('.out','worktree-a','build'))).toBe(nestedOutput);
 });
});

describe('tracked evidence write protection',()=>{
 const trackedTarget=path.join(ROOT,'spec/examples/idle.pose.json');

 it('rejects a tracked write unless --update-evidence was provided',()=>{
  expect(()=>assertTrackedWriteAllowed(trackedTarget,{root:ROOT,updateEvidence:false})).toThrow();
 });

 it('allows a tracked write with explicit evidence update opt-in',()=>{
  expect(()=>assertTrackedWriteAllowed(trackedTarget,{root:ROOT,updateEvidence:true})).not.toThrow();
 });

 it('rejects a dangling symlink to an indexed file missing from the worktree',()=>{
  const root=tempDir();
  const trackedPath=path.join(root,'evidence','missing.json');
  const outputPath=path.join(root,'scratch','redirected.json');
  fs.mkdirSync(path.dirname(trackedPath),{recursive:true});
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.writeFileSync(trackedPath,'{}');
  execFileSync('git',['init','--quiet'],{cwd:root,stdio:'ignore'});
  execFileSync('git',['add','--','evidence/missing.json'],{cwd:root,stdio:'ignore'});
  fs.unlinkSync(trackedPath);
  fs.symlinkSync(trackedPath,outputPath);

  expect(()=>{
   const allowedTarget=assertTrackedWriteAllowed(outputPath,{root,updateEvidence:false});
   fs.writeFileSync(allowedTarget,'replacement');
  }).toThrow();
  expect(fs.existsSync(trackedPath)).toBe(false);
 });

 it('rejects a scratch hard link to staged evidence before writing through it',()=>{
  const root=tempDir();
  const trackedRelative='spec/evidence.json';
  const trackedPath=path.join(root,'spec','evidence.json');
  const aliasPath=path.join(root,'scratch','evidence-link.json');
  const originalBytes=Buffer.from('original evidence bytes\n');
  const replacementBytes=Buffer.from('replacement evidence bytes\n');
  fs.mkdirSync(path.dirname(trackedPath),{recursive:true});
  fs.mkdirSync(path.dirname(aliasPath),{recursive:true});
  fs.writeFileSync(trackedPath,originalBytes);
  execFileSync('git',['init','--quiet'],{cwd:root,stdio:'ignore'});
  execFileSync('git',['add','--',trackedRelative],{cwd:root,stdio:'ignore'});
  fs.linkSync(trackedPath,aliasPath);

  let writeReached=false;
  let writeError:unknown;
  try{
   const allowedTarget=assertTrackedWriteAllowed(aliasPath,{root,updateEvidence:false});
   writeReached=true;
   fs.writeFileSync(allowedTarget,replacementBytes);
  }catch(error){
   writeError=error;
  }
  expect(writeError).toBeInstanceOf(Error);
  expect(writeReached).toBe(false);
  expect(fs.readFileSync(trackedPath)).toEqual(originalBytes);
 });
});
