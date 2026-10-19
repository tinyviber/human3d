#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
 CHECK_IDS,FALLBACK_REASONS,decodeUtf8Strict,RECEIPT_AUTHORITY,RECEIPT_SCHEMA_VERSION,SNAPSHOT_CONSISTENCY,GIT_CONFIG_PREAMBLE,FAILURE_MESSAGES,snapshotFingerprintFromCaptures,
 AffectedCheckError,collectVitestTargets,createReceipt,fingerprintSnapshot,
 findGitRedirect,isSafeSha,parseNameStatusZ,parsePorcelainV2Z,
 sanitizedGitEnv,selectAffectedChecks,serializeReceipt,
} from './lib/affected-checks.mjs';
import {ensureOutputDir,assertTrackedWriteAllowed} from './lib/qa-output.mjs';
import {
 framedHash,orderedJsonSha256,captureDigest,PROJECTION_KEYS,CAPTURE_KEYS,
 probeRepositoryState,repositoryIdentityObject,repositoryIdentitySha256,
 trackedContentDigest,untrackedContentDigest,ignoredInputManifestDigest,
 nulPathList,trimOneLf as trimLf,sha256Hex,
} from './lib/capture.mjs';

const modulePath=fileURLToPath(import.meta.url);
export const repositoryRoot=path.dirname(path.dirname(modulePath));

const EXIT_USAGE=2;
const EXIT_STARTUP=3;
const EXIT_OUTPUT=4;
const EXIT_RESULT=1;

const USAGE_MESSAGE='check:affected: invalid arguments\n';
const COMMIT_MESSAGE='check:affected: invalid commit argument\n';
const ROOT_MESSAGE='check:affected: repository root unavailable\n';
const TOOL_MESSAGE='check:affected: required tool unavailable\n';
const CONFIG_MESSAGE='check:affected: repository configuration unavailable\n';
const OUTPUT_MESSAGE='check:affected: receipt output unavailable\n';

class StartupError extends Error{
 constructor(message,code,diagnostic){
  super(message);
  this.name='StartupError';
  this.code=code;
  this.diagnostic=diagnostic;
 }
}

const usageError=()=>new StartupError('invalid arguments',EXIT_USAGE,USAGE_MESSAGE);
const commitError=()=>new StartupError('invalid commit argument',EXIT_USAGE,COMMIT_MESSAGE);

export function parseArgs(argv){
 if(!Array.isArray(argv))throw usageError();
 const result={base:undefined,head:undefined,run:false};
 for(let index=0;index<argv.length;index++){
  const argument=argv[index];
  if(argument==='--run'){
   if(result.run)throw usageError();
   result.run=true;
   continue;
  }
  if(argument==='--base'||argument==='--head'){
   const key=argument==='--base'?'base':'head';
   if(result[key]!==undefined)throw usageError();
   const value=argv[++index];
   if(value===undefined||value.startsWith('--'))throw usageError();
   result[key]=value;
   continue;
  }
  throw usageError();
 }
 if(result.base===undefined)throw usageError();
 return result;
}

const trimOneLf=value=>{
 const text=String(value);
 return text.endsWith('\n')?text.slice(0,-1):text;
};

const findExecutable=name=>{
 for(const directory of (process.env.PATH??'').split(path.delimiter)){
  if(!path.isAbsolute(directory))continue;
  const candidate=path.join(directory,name);
  try{
   fs.accessSync(candidate,fs.constants.X_OK);
   if(fs.statSync(candidate).isFile())return candidate;
  }catch{}
 }
 return undefined;
};

export const GIT_EXECUTABLE=findExecutable('git');

class GitContext{
 constructor(root,env){
  this.root=root;
  this.env=env;
  if(!GIT_EXECUTABLE)throw new StartupError('git unavailable',EXIT_STARTUP,TOOL_MESSAGE);
  const dotGit=path.join(root,'.git');
  let gitDir;
  try{
   const stats=fs.lstatSync(dotGit);
   if(stats.isDirectory())gitDir=dotGit;
   else if(stats.isFile()){
    const line=fs.readFileSync(dotGit,'utf8');
    const match=/^gitdir: (.+)\n?$/.exec(line);
    if(!match)throw new Error('malformed gitdir file');
    gitDir=path.resolve(root,match[1]);
   }else throw new Error('unsupported .git entry');
  }catch(error){
   throw new StartupError(`repository metadata unavailable: ${error.message}`,EXIT_STARTUP,CONFIG_MESSAGE);
  }
  this.gitDir=fs.realpathSync(gitDir);
  this.commonDir=this.gitDir;
  try{
   const commonDirFile=path.join(this.gitDir,'commondir');
   if(fs.existsSync(commonDirFile)){
    const value=trimOneLf(fs.readFileSync(commonDirFile,'utf8'));
    if(value.length===0||path.isAbsolute(value))throw new Error('invalid commondir');
    this.commonDir=fs.realpathSync(path.resolve(this.gitDir,value));
   }
  }catch(error){
   throw new StartupError(`repository metadata unavailable: ${error.message}`,EXIT_STARTUP,CONFIG_MESSAGE);
  }
  this.baseArgs=[...GIT_CONFIG_PREAMBLE,`--git-dir=${this.gitDir}`,`--work-tree=${root}`];
  this.#validateConfig();
 }

 #validateConfig(){
  const configPath=path.join(this.commonDir,'config');
  const result=spawnSync(GIT_EXECUTABLE,['config','--no-includes','--null','--list','--file',configPath],{
   env:this.env,encoding:'buffer',stdio:['ignore','pipe','ignore'],
  });
  if(result.status!==0||!Buffer.isBuffer(result.stdout))throw new StartupError('repository configuration unavailable',EXIT_STARTUP,CONFIG_MESSAGE);
  const records=result.stdout.length===0?[]:result.stdout.toString('utf8').split('\0').filter(Boolean);
  for(const record of records){
   const separator=record.indexOf('\n');
   const key=separator<0?record:record.slice(0,separator);
   const value=separator<0?'':record.slice(separator+1);
   if(key.startsWith('include.')||key.startsWith('includeif.'))throw new StartupError('unsupported include',EXIT_STARTUP,CONFIG_MESSAGE);
   if(key.startsWith('filter.'))throw new StartupError('unsupported filter',EXIT_STARTUP,CONFIG_MESSAGE);
   if(key==='core.bare'&&value!=='false')throw new StartupError('bare repository',EXIT_STARTUP,CONFIG_MESSAGE);
  }
 }

 run(args,{allowFailure=false}={}){
  const result=spawnSync(GIT_EXECUTABLE,[...this.baseArgs,...args],{
   cwd:this.root,env:this.env,encoding:'buffer',stdio:['ignore','pipe','pipe'],
  });
  if(result.error)throw new StartupError(`git failed: ${result.error.message}`,EXIT_STARTUP,TOOL_MESSAGE);
  if(result.status!==0&&!allowFailure){
   throw new StartupError(`git ${args.join(' ')} failed`,EXIT_STARTUP,CONFIG_MESSAGE);
  }
  return {status:result.status,stdout:result.stdout,stderr:result.stderr};
 }
}

export function objectFormatOf(context){
 const result=context.run(['rev-parse','--show-object-format']);
 const value=trimOneLf(result.stdout.toString('ascii'));
 if(value!=='sha1'&&value!=='sha256')throw new StartupError('unsupported object format',EXIT_STARTUP,CONFIG_MESSAGE);
 return value;
}

const revParseSha=(context,revision)=>{
 const result=context.run(['rev-parse','--verify',`${revision}^{commit}`],{allowFailure:true});
 if(result.status!==0)return undefined;
 const value=trimOneLf(result.stdout.toString('ascii'));
 return isSafeSha(value)?value:undefined;
};

const isAncestorCommit=(context,sha)=>revParseSha(context,sha)!==undefined;

const flagRecords=output=>{
 const records=[];
 let start=0;
 for(let index=0;index<=output.length;index++){
  if(index===output.length||output[index]===0){
   if(index>start)records.push(output.subarray(start,index));
   start=index+1;
  }
 }
 return records;
};

const detectHiddenIndex=context=>{
 for(const record of flagRecords(context.run(['ls-files','-v','-z']).stdout)){
  if(record.length>1&&record[0]!==0x48)return true;
 }
 for(const record of flagRecords(context.run(['ls-files','-f','-z']).stdout)){
  if(record.length>1&&record[0]>=0x61&&record[0]<=0x7a)return true;
 }
 for(const probe of [['config','--bool','core.splitIndex'],['config','--bool','core.sparseCheckout']]){
  const result=context.run(probe,{allowFailure:true});
  if(result.status===0&&result.stdout.toString('ascii').trim()==='true')return true;
 }
 for(const record of flagRecords(context.run(['ls-files','--stage','-z']).stdout)){
  const space=record.indexOf(0x20);
  if(space<0)return true;
  if(record.subarray(0,space).toString('ascii')==='040000')return true;
  const rest=record.subarray(space+1).toString('ascii');
  const tab=rest.indexOf('\t');
  if(tab<0)return true;
  const fields=rest.slice(0,tab).split(' ');
  if(fields.length<2||fields[1]!=='0')return true;
 }
 return false;
};

const readTrackedFile=root=>relativePath=>fs.readFileSync(path.join(root,relativePath),'utf8');

export function resolveVitestTargets(context,root,selection){
 const tracked=context.run(['ls-files','-z']).stdout.toString('utf8').split('\0').filter(Boolean);
 const changed=selection.changedPaths.filter(item=>item.category!=='full-fallback');
 const {tests,uncertain}=collectVitestTargets({
  trackedFiles:tracked,
  changedPaths:changed,
  readFile:readTrackedFile(root),
  workspacePackages:workspacePackageMap(root,tracked),
 });
 return {tests,uncertain};
}

const toIso=date=>date.toISOString();

const toolIdentityFor=(root,format)=>{
 const identity={path:process.execPath,version:process.version,realpath:fs.realpathSync(process.execPath),dev:null,ino:null};
 try{
  const stats=fs.statSync(process.execPath);
  identity.dev=stats.dev;
  identity.ino=stats.ino;
 }catch{}
 const describe=file=>{
  try{
   const stats=fs.statSync(file);
   return {path:file,version:null,realpath:fs.realpathSync(file),dev:stats.dev,ino:stats.ino};
  }catch{return null;}
 };
 const probeVersion=(command,args)=>{
  const result=spawnSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','ignore']});
  if(result.status!==0||typeof result.stdout!=='string')return null;
  const value=result.stdout.trim();
  return value.length>0?value:null;
 };
 const npmPath=process.env.npm_execpath;
 const npm=npmPath&&path.isAbsolute(npmPath)?describe(npmPath):null;
 if(npm)npm.version=probeVersion(process.execPath,[npmPath,'--version']);
 const git=GIT_EXECUTABLE?describe(GIT_EXECUTABLE):null;
 if(git)git.version=probeVersion(GIT_EXECUTABLE,['--version']);
 const python=describe(path.join(root,'.venv-dynamics','bin','python'))??{
  path:findExecutable('python3')??'python3',version:null,realpath:null,dev:null,ino:null,
 };
 if(python.path!=='python3')python.version=probeVersion(python.path,['-V'])??probeVersion(python.path,['--version']);
 const packageVersion=relative=>{
  try{return JSON.parse(fs.readFileSync(path.join(root,relative,'package.json'),'utf8')).version??null;}catch{return null;}
 };
 const vitest=describe(path.join(root,'node_modules','vitest','vitest.mjs'));
 if(vitest)vitest.version=packageVersion('node_modules/vitest');
 const typescript=describe(path.join(root,'node_modules','typescript','bin','tsc'));
 if(typescript)typescript.version=packageVersion('node_modules/typescript');
 const vite=describe(path.join(root,'node_modules','vite','bin','vite.js'));
 if(vite)vite.version=packageVersion('node_modules/vite');
 const complete=Boolean(git?.version&&python.version&&vitest?.version&&typescript?.version&&vite?.version);
 return {
  complete,
  node:identity,
  npmNodeExecPath:process.env.npm_node_execpath&&path.isAbsolute(process.env.npm_node_execpath)?process.env.npm_node_execpath:null,
  npm,
  git,
  gitConfigPreamble:GIT_CONFIG_PREAMBLE,
  python,
  pythonPackages:['myo-sim==0.2.3','mujoco==3.6.0','numpy==2.5.4','scipy==1.18.1'],
  vitest,
  typescript,
  vite,
  npmScriptShell:'/bin/sh',
 };
};

const environmentFor=(root,runRoot)=>({
 fingerprint:null,
 platform:process.platform,
 arch:process.arch,
 pathComponents:null,
 buildOutDir:path.join(runRoot,'build'),
});

const ENVIRONMENT_ALLOWLIST=[
 'PATH','LC_ALL','LANG','TZ','GIT_NO_REPLACE_OBJECTS','GIT_OPTIONAL_LOCKS','GIT_NO_LAZY_FETCH',
 'GIT_CONFIG_NOSYSTEM','GIT_CONFIG_SYSTEM','GIT_CONFIG_GLOBAL','GIT_ATTR_NOSYSTEM','GIT_PAGER',
 'npm_config_userconfig','npm_config_globalconfig','npm_config_script_shell',
 'HUMAN3D_RUN_ID','HUMAN3D_BUILD_OUT_DIR','platform','arch',
];

const environmentSha256For=env=>{
 const ordered={};
 for(const key of ENVIRONMENT_ALLOWLIST){
  if(key==='platform'){ordered.platform=env.platform;continue;}
  if(key==='arch'){ordered.arch=env.arch;continue;}
  if(key==='PATH'){ordered.PATH=env.pathComponents;continue;}
  if(key==='HUMAN3D_BUILD_OUT_DIR'){ordered[key]=env.buildOutDir;continue;}
  const source=env.values??{};
  ordered[key]=source[key]===undefined?null:source[key];
 }
 return orderedJsonSha256(ordered);
};

const toolIdentitySha256For=tool=>{
 const ordered={
  node:tool.node??null,
  npmNodeExecPath:tool.npmNodeExecPath??null,
  npm:tool.npm??null,
  git:tool.git??null,
  gitConfigPreamble:tool.gitConfigPreamble??null,
  python:tool.python??null,
  pythonPackages:tool.pythonPackages??null,
  vitest:tool.vitest??null,
  typescript:tool.typescript??null,
  vite:tool.vite??null,
  npmScriptShell:tool.npmScriptShell??null,
 };
 return orderedJsonSha256(ordered);
};

const REPOSITORY_KEYS=[
 'identityComplete','root','gitDir','commonDir','indexPath','objectDir','objectFormat',
 'headSha','gitNoReplaceObjects','shallow','coreSparseCheckoutState','indexSparseState',
 'worktreeMatchesIndex','localConfigSha256','infoExcludeState','infoExcludeSha256',
 'infoAttributesPath','infoAttributesState','infoAttributesSha256','objectAlternatesState',
 'objectAlternatesSha256','objectAlternates','replaceRefs','grafts','workspaceLinks',
];

const repositoryFor=(root,context,format,snapshot,repository=null)=>{
 if(repository!==null&&typeof repository==='object'){
  const ordered={};
  for(const key of REPOSITORY_KEYS){
   if(key==='identityComplete')continue;
   ordered[key]=repository[key]===undefined?null:repository[key];
  }
  ordered.identityComplete=Object.entries(ordered).every(([key,value])=>value!==null||key==='localConfigSha256'||key==='infoExcludeSha256'||key==='infoAttributesSha256'||key==='objectAlternatesSha256');
  const result={identityComplete:ordered.identityComplete};
  for(const key of REPOSITORY_KEYS.slice(1))result[key]=ordered[key];
  return result;
 }
 return {
  identityComplete:false,
  root,
  gitDir:context.gitDir,
  commonDir:context.commonDir,
  indexPath:path.join(context.gitDir,'index'),
  objectDir:null,
  objectFormat:format,
  headSha:snapshot?.headSha??null,
  gitNoReplaceObjects:true,
  shallow:snapshot?.shallow??null,
  coreSparseCheckoutState:null,
  indexSparseState:null,
  worktreeMatchesIndex:null,
  localConfigSha256:null,
  infoExcludeState:null,
  infoExcludeSha256:null,
  infoAttributesPath:null,
  infoAttributesState:null,
  infoAttributesSha256:null,
  objectAlternatesState:null,
  objectAlternatesSha256:null,
  objectAlternates:null,
  replaceRefs:null,
  grafts:null,
  workspaceLinks:null,
 };
};

const repositoryForCapture=(root,context,format,snapshot)=>{
 const derived=snapshot?.derived??{};
 return repositoryFor(root,context,format,{headSha:derived.headSha??null,shallow:derived.shallow??null},{
  ...(derived.repository??{}),
  root,
  gitDir:context.gitDir,
  commonDir:context.commonDir,
  indexPath:derived.repository?.indexPath??path.join(context.gitDir,'index'),
  objectFormat:format,
  headSha:derived.headSha??null,
  gitNoReplaceObjects:true,
  shallow:derived.shallow??null,
  worktreeMatchesIndex:derived.worktreeMatchesIndex??null,
  ...(derived.repositoryExtras??{}),
 });
};

export const runIdFor=clock=>`${toIso(clock).replace(/[:.]/g,'-')}-${process.pid}`;

const reserveRunRoot=root=>{
 try{
  ensureOutputDir(path.join(root,'.out'),{root});
  ensureOutputDir(path.join(root,'.out','check-affected'),{root});
  const canonicalRoot=fs.realpathSync(root);
  let attempt=0;
  for(;attempt<8;attempt++){
   const suffix=toIso(new Date()).replace(/[:.]/g,'-');
   const runId=attempt===0?`${suffix}-${process.pid}`:`${suffix}-${process.pid}-${attempt}`;
   const runRoot=path.join(root,'.out','check-affected',runId);
   const relative=path.relative(canonicalRoot,runRoot);
   if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('run root escapes repository');
   try{
    fs.mkdirSync(runRoot);
    ensureOutputDir(runRoot,{root});
    return {runId,runRoot,outputPath:path.join(runRoot,'receipt.json')};
   }catch(error){
    if(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST')continue;
    throw error;
   }
  }
  throw new Error('unable to reserve a unique run root');
 }catch(error){
  throw new StartupError(`receipt output unavailable: ${error.message}`,EXIT_OUTPUT,OUTPUT_MESSAGE);
 }
};

const publishReceipt=(root,outputPath,receipt)=>{
 const bytes=serializeReceipt(receipt);
 const temporary=`${outputPath}.tmp-${process.pid}`;
 try{
  assertTrackedWriteAllowed(outputPath,{root});
  fs.writeFileSync(temporary,bytes,{flag:'wx'});
  fs.linkSync(temporary,outputPath);
  fs.unlinkSync(temporary);
 }catch(error){
  try{fs.rmSync(temporary,{force:true});}catch{}
  throw new StartupError(`receipt publication failed: ${error.message}`,EXIT_OUTPUT,OUTPUT_MESSAGE);
 }
};

const pythonFor=root=>{
 const candidate=path.join(root,'.venv-dynamics','bin','python');
 try{
  fs.accessSync(candidate,fs.constants.X_OK);
  return candidate;
 }catch{return findExecutable('python3')??'python3';}
};

const FAST_TESTS=['tests/ci-gate.test.ts','tests/qa-output.test.ts','tests/worktree-helper.test.ts'];
const SPEC_TESTS=[...FAST_TESTS,'apps/server/src/contract.test.ts'];

export function checkCommands(checkId,{root,runRoot,vitestTargets=[]}){
 const node=process.execPath;
 const nodeBin=name=>path.join(root,'node_modules',name);
 switch(checkId){
  case 'fast':
   return [{checkId,command:node,args:[nodeBin('vitest/vitest.mjs'),'run','--maxWorkers=1','--no-file-parallelism',...FAST_TESTS],cwd:root}];
  case 'spec':
   return [{checkId,command:node,args:[nodeBin('vitest/vitest.mjs'),'run','--maxWorkers=1','--no-file-parallelism',...SPEC_TESTS],cwd:root}];
  case 'vitest':
   return [{checkId,command:node,args:[nodeBin('vitest/vitest.mjs'),'run','--maxWorkers=1','--no-file-parallelism',...vitestTargets],cwd:root}];
  case 'build':
   return [
    {checkId,command:node,args:[nodeBin('typescript/bin/tsc'),'-b','--pretty','false'],cwd:root},
    {checkId,command:node,args:[nodeBin('vite/bin/vite.js'),'build','--outDir',path.join(runRoot,'build'),'--emptyOutDir'],cwd:path.join(root,'apps/web')},
   ];
  case 'dynamics-validate':
   return [{checkId,command:pythonFor(root),args:['scripts/validate-action-spec.py'],cwd:root}];
  case 'dynamics-test':
   return [{checkId,command:pythonFor(root),args:['scripts/test-dynamics-records.py'],cwd:root}];
  default:
   return [];
 }
}

export function checkCommand(checkId,options){
 return checkCommands(checkId,options)[0];
}

const checkEnv=(root,runRoot)=>({
 PATH:process.env.PATH??'/usr/local/bin:/usr/bin:/bin',
 HOME:process.env.HOME??'',
 TMPDIR:process.env.TMPDIR??'/tmp',
 LANG:'C.UTF-8',
 LC_ALL:'C.UTF-8',
 CI:'1',
 NO_COLOR:'1',
 FORCE_COLOR:'0',
 HUMAN3D_BUILD_OUT_DIR:path.join(runRoot,'build'),
});

export function executeChecks(checkIds,{root,runRoot,vitestTargets=[]}){
 const results=[];
 for(const checkId of checkIds){
  const commands=checkCommands(checkId,{root,runRoot,vitestTargets});
  const startedAt=toIso(new Date());
  const startedNs=process.hrtime.bigint();
  const argv=commands.map(descriptor=>[descriptor.command,...descriptor.args]);
  const cwd=commands.map(descriptor=>descriptor.cwd);
  if(commands.length===0){
   results.push({checkId,selected:true,outcome:'failed',argv:[],cwd:[],startedAt,endedAt:startedAt,durationMs:0,exitCode:null,signal:null,runnerError:'no-command'});
   continue;
  }
  let outcome='passed';
  let exitCode=null;
  let signal=null;
  let runnerError=null;
  for(const descriptor of commands){
   try{
    const result=spawnSync(descriptor.command,descriptor.args,{
     cwd:descriptor.cwd,env:checkEnv(root,runRoot),stdio:'ignore',shell:false,
    });
    if(result.error){
     outcome='failed';
     runnerError='spawn-failed';
     break;
    }
    if(typeof result.status==='number'){
     exitCode=result.status;
     signal=null;
     if(result.status!==0){outcome='failed';break;}
     continue;
    }
    if(result.signal){
     signal=result.signal;
     exitCode=null;
     outcome='failed';
     runnerError='signal-terminated';
     break;
    }
    outcome='failed';
    runnerError='invalid-runner-result';
    break;
   }catch{
    outcome='failed';
    runnerError='spawn-failed';
    break;
   }
  }
  const endedAt=toIso(new Date());
  const durationMs=Number((process.hrtime.bigint()-startedNs)/1000000n);
  results.push({checkId,selected:true,outcome,argv,cwd,startedAt,endedAt,durationMs,exitCode,signal,runnerError});
 }
 return results;
}

const claimScopeFor=state=>
 state==='verified'?'all-six-checks'
  :state==='selected-passed'?'selected-checks-only'
   :state==='planned'?'selection-only':'none';

const normalizeCheckResults=(selectedCheckIds,results)=>{
 const selected=new Set(selectedCheckIds);
 const byId=new Map(results.map(result=>[result.checkId,result]));
 return CHECK_IDS.map(checkId=>{
  const result=byId.get(checkId);
  if(!selected.has(checkId))return {
   checkId,selected:false,outcome:'not-run',argv:null,cwd:null,startedAt:null,endedAt:null,
   durationMs:null,exitCode:null,signal:null,runnerError:null,
  };
  return {
   checkId,
   selected:true,
   outcome:result?.outcome??'not-run',
   argv:result?.argv??null,
   cwd:result?.cwd??null,
   startedAt:result?.startedAt??null,
   endedAt:result?.endedAt??null,
   durationMs:result?.durationMs??null,
   exitCode:result?.exitCode??null,
   signal:result?.signal??null,
   runnerError:result?.runnerError??null,
  };
 });
};

const buildReceipt=({
 state,mode,runId,createdAt,outputPath,baseSha,requestedHeadSha,headSha,mergeBaseSha,
 selection,executedCheckIds=[],checkResults=[],repository,toolIdentity,environment,
 snapshotComplete,snapshotEqual,snapshotConsistency,snapshotCaptures,snapshotFingerprint,
 failureKind=null,failureMessage=null,cliExitCode,
})=>createReceipt({
 state,mode,runId,createdAt,outputPath,baseSha,requestedHeadSha:requestedHeadSha??null,headSha,mergeBaseSha,
 selectedCheckIds:selection.selectedCheckIds,
 executedCheckIds,checkResults:normalizeCheckResults(selection.selectedCheckIds,checkResults),
 fallbackReasons:selection.fallbackReasons,
 changedPaths:selection.changedPaths.map(item=>({
  path:item.path,category:item.category,selectedCheckIds:[...item.selectedCheckIds],
 })),
 repository,toolIdentity,environment,
 snapshotComplete,
 snapshotEqual,
 snapshotConsistency,
 snapshotCaptures:snapshotCaptures.map((capture,index)=>({
  captureId:index+1,
  capturedAt:capture.capturedAt,
  captureSha256:capture.captureSha256,
 })),
 snapshotFingerprint,
 failureKind,failureMessage:failureKind===null?null:(failureMessage??FAILURE_MESSAGES[failureKind]??'unknown failure'),cliExitCode,
 claimScope:claimScopeFor(state),
});

const writeDiagnostic=message=>process.stderr.write(message);

const workspacePackageMap=(root,trackedFiles)=>{
 const map={};
 for(const file of trackedFiles){
  if(!/^(?:apps|packages)\/[^/]+\/package\.json$/.test(file))continue;
  let manifest;
  try{manifest=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));}catch{continue;}
  if(typeof manifest.name!=='string')continue;
  const directory=path.posix.dirname(file);
  const entries={};
  const exportsField=manifest.exports;
  if(typeof exportsField==='string')entries['.']=path.posix.join(directory,exportsField);
  else if(exportsField&&typeof exportsField==='object'){
   for(const [key,value] of Object.entries(exportsField)){
    const target=typeof value==='string'?value:value?.import??value?.default??value?.types;
    if(typeof target==='string')entries[key]=path.posix.join(directory,target);
   }
  }
  if(!entries['.']){
   const main=manifest.module??manifest.main??'src/index.ts';
   entries['.']=path.posix.join(directory,main);
  }
  map[manifest.name]=entries;
 }
 return map;
};

const emptyCapture=(captureId,boundary,checkId,pass)=>({
 captureId,boundary,checkId,pass,complete:false,
 headStartSha:null,headEndSha:null,
 statusSha256:null,committedManifestSha256:null,stagedManifestSha256:null,
 unstagedManifestSha256:null,untrackedManifestSha256:null,
 committedPatchSha256:null,stagedPatchSha256:null,unstagedPatchSha256:null,
 trackedContentSha256:null,untrackedContentSha256:null,ignoredInputManifestSha256:null,
 indexFileSha256:null,indexEntriesSha256:null,indexFlagsSha256:null,splitIndexSha256:null,
 replaceRefsSha256:null,graftsSha256:null,workspaceLinksSha256:null,
 repositoryIdentitySha256:null,toolIdentitySha256:null,environmentSha256:null,captureSha256:null,
});

const DIFF_FLAGS=['-l0','--name-status','-z','--find-renames=50%','--find-copies=50%','--find-copies-harder','--no-ext-diff','--no-textconv','--no-color'];
const PATCH_FLAGS=['--binary','--full-index','-l0','--find-renames=50%','--find-copies=50%','--find-copies-harder','--no-ext-diff','--no-textconv','--no-color'];
const IGNORED_SCOPE=['apps','packages','tests','spec','assets','public','scripts','.npmrc','.gitattributes'];

// One boundary capture per the §4/§7 record contract. Returns {capture,derived,specialized}.
const captureOnce=({context,root,format,baseSha,captureId,boundary,checkId,pass,toolHash,envHash})=>{
 const capture=emptyCapture(captureId,boundary,checkId,pass);
 const derived={headSha:null,mergeBaseSha:null,mergeBaseUnavailable:true,shallow:null,dirty:null,hiddenIndex:true,changedPaths:[],ignoredInputCount:null,worktreeMatchesIndex:null};
 let specialized=null;
 const safe=fn=>{try{return fn();}catch{return null;}};

 derived.headSha=safe(()=>revParseSha(context,'HEAD'));
 capture.headStartSha=derived.headSha;

 let repo;
 try{
  repo=probeRepositoryState(context,{root,gitDir:context.gitDir,commonDir:context.commonDir,objectFormat:format});
  specialized=repo.failureKind;
 }catch{repo=null;}

 const shallowText=safe(()=>trimLf(context.run(['rev-parse','--is-shallow-repository']).stdout));
 derived.shallow=shallowText==='true'?true:shallowText==='false'?false:null;

 const mergeBaseResult=context.run(['merge-base',baseSha,derived.headSha??'HEAD'],{allowFailure:true});
 derived.mergeBaseSha=mergeBaseResult.status===0?trimLf(mergeBaseResult.stdout):null;
 derived.mergeBaseUnavailable=derived.mergeBaseSha===null;
 const diffBase=derived.mergeBaseSha??baseSha;
 const headRef=derived.headSha??'HEAD';

 capture.statusSha256=safe(()=>framedHash('status-v1',[[context.run(['status','--porcelain=v2','-z','--untracked-files=all','--find-renames=50%']).stdout]]));
 const committedManifest=safe(()=>context.run(['diff',...DIFF_FLAGS,diffBase,headRef,'--']).stdout);
 capture.committedManifestSha256=committedManifest===null?null:framedHash('committed-manifest-v1',[[committedManifest]]);
 const stagedManifest=safe(()=>context.run(['diff',...DIFF_FLAGS,'--cached',headRef,'--']).stdout);
 capture.stagedManifestSha256=stagedManifest===null?null:framedHash('staged-manifest-v1',[[stagedManifest]]);
 const unstagedManifest=safe(()=>context.run(['diff',...DIFF_FLAGS,'--']).stdout);
 capture.unstagedManifestSha256=unstagedManifest===null?null:framedHash('unstaged-manifest-v1',[[unstagedManifest]]);
 const committedPatch=safe(()=>context.run(['diff',...PATCH_FLAGS,diffBase,headRef,'--']).stdout);
 capture.committedPatchSha256=committedPatch===null?null:framedHash('committed-patch-v1',[[committedPatch]]);
 const stagedPatch=safe(()=>context.run(['diff',...PATCH_FLAGS,'--cached',headRef,'--']).stdout);
 capture.stagedPatchSha256=stagedPatch===null?null:framedHash('staged-patch-v1',[[stagedPatch]]);
 const unstagedPatch=safe(()=>context.run(['diff',...PATCH_FLAGS,'--']).stdout);
 capture.unstagedPatchSha256=unstagedPatch===null?null:framedHash('unstaged-patch-v1',[[unstagedPatch]]);

 const untrackedManifest=safe(()=>context.run(['ls-files','--others','--exclude-standard','-z']).stdout);
 capture.untrackedManifestSha256=untrackedManifest===null?null:framedHash('untracked-manifest-v1',[[untrackedManifest]]);
 capture.untrackedContentSha256=safe(()=>untrackedContentDigest(context,root));

 const tracked=safe(()=>trackedContentDigest(context,root,format));
 capture.trackedContentSha256=tracked===null?null:tracked.digest;
 derived.worktreeMatchesIndex=tracked===null?null:tracked.worktreeMatchesIndex;

 const ignored=safe(()=>ignoredInputManifestDigest(context,root,IGNORED_SCOPE));
 capture.ignoredInputManifestSha256=ignored===null?null:ignored.digest;
 derived.ignoredInputCount=ignored===null?null:ignored.count;

 // index digests
 const indexPath=repo?.indexPath??null;
 if(indexPath!==null){
  const bytes=safe(()=>fs.readFileSync(indexPath));
  capture.indexFileSha256=bytes===null?null:framedHash('index-file-v1',[[bytes]]);
 }
 capture.indexEntriesSha256=safe(()=>framedHash('index-entries-v1',[[context.run(['ls-files','--stage','-z']).stdout]]));
 capture.indexFlagsSha256=safe(()=>{
  const rawV=context.run(['ls-files','-v','-z']).stdout;
  const rawT=context.run(['ls-files','-t','-z']).stdout;
  const rawF=context.run(['ls-files','-f','-z']).stdout;
  return framedHash('index-flags-v1',[['ls-files-v',rawV],['ls-files-t',rawT],['ls-files-f',rawF]]);
 });

 // hidden-index detection from captured flags
 try{
  derived.hiddenIndex=detectHiddenIndex(context);
 }catch{derived.hiddenIndex=true;}
 if(repo!==null&&(repo.splitIndexState==='active'||repo.coreSparseCheckoutState==='true'||repo.indexSparseState==='true'))derived.hiddenIndex=true;

 capture.splitIndexSha256=repo?.splitIndexSha256??null;
 capture.replaceRefsSha256=repo?.replaceRefsSha256??null;
 capture.graftsSha256=repo?.graftsSha256??null;
 capture.workspaceLinksSha256=repo?.workspaceLinksSha256??null;

 // dirty from status + tracked/untracked/ignored evidence
 try{
  const statusRecords=parsePorcelainV2Z(context.run(['status','--porcelain=v2','-z','--untracked-files=all','--find-renames=50%']).stdout);
  derived.statusRecords=statusRecords;
  derived.dirty=statusRecords.length>0||(derived.worktreeMatchesIndex===false)||((derived.ignoredInputCount??0)>0);
 }catch{derived.dirty=null;}

 try{
  derived.changedPaths=committedManifest===null?[]:parseNameStatusZ(committedManifest);
 }catch{derived.changedPaths=null;}

 // repository identity + digest
 if(repo!==null&&indexPath!==null){
  const identity=repositoryIdentityObject({
   root,gitDir:context.gitDir,commonDir:context.commonDir,indexPath,
   objectDir:repo.objectDir,objectFormat:format,headSha:derived.headSha,
   shallow:derived.shallow,coreSparseCheckoutState:repo.coreSparseCheckoutState,
   indexSparseState:repo.indexSparseState,
   worktreeMatchesIndex:derived.worktreeMatchesIndex===null?false:derived.worktreeMatchesIndex,
   splitIndexSha256:repo.splitIndexSha256,localConfigSha256:repo.localConfigSha256,
   infoExcludeState:repo.infoExcludeState,infoExcludeSha256:repo.infoExcludeSha256,
   infoAttributesPath:repo.infoAttributesPath,infoAttributesState:repo.infoAttributesState,
   infoAttributesSha256:repo.infoAttributesSha256,objectAlternatesState:repo.objectAlternatesState,
   objectAlternatesSha256:repo.objectAlternatesSha256,replaceRefsSha256:repo.replaceRefsSha256,
   graftsSha256:repo.graftsSha256,workspaceLinksSha256:repo.workspaceLinksSha256,
  });
  derived.repository=identity;
  derived.repositoryExtras={
   objectAlternates:repo.objectAlternates===undefined?null:repo.objectAlternates,
   replaceRefs:repo.replaceRefs===undefined?null:repo.replaceRefs,
   grafts:repo.grafts===undefined?null:repo.grafts,
   workspaceLinks:repo.workspaceLinks===undefined?null:repo.workspaceLinks,
  };
  capture.repositoryIdentitySha256=repositoryIdentitySha256(identity);
 }else{derived.repository=null;derived.repositoryExtras=null;}

 capture.toolIdentitySha256=toolHash;
 capture.environmentSha256=envHash;
 capture.headEndSha=safe(()=>revParseSha(context,'HEAD'));

 const REQUIRED=['headStartSha','headEndSha','statusSha256','committedManifestSha256','stagedManifestSha256','unstagedManifestSha256','untrackedManifestSha256','committedPatchSha256','stagedPatchSha256','unstagedPatchSha256','trackedContentSha256','untrackedContentSha256','ignoredInputManifestSha256','indexFileSha256','indexEntriesSha256','indexFlagsSha256','splitIndexSha256','replaceRefsSha256','graftsSha256','workspaceLinksSha256','repositoryIdentitySha256','toolIdentitySha256','environmentSha256'];
 capture.complete=REQUIRED.every(key=>capture[key]!==null);
 capture.captureSha256=capture.complete?captureDigest(capture):null;
 if(repo!==null&&repo.workspaceLinks===null&&specialized===null)specialized='workspace-link-invalid';
 return {capture,derived,specialized};
};

const captureProjection=capture=>PROJECTION_KEYS.map(key=>capture[key]??null);
const projectionsEqual=(a,b)=>{
 const pa=captureProjection(a);
 const pb=captureProjection(b);
 for(let index=0;index<pa.length;index++){
  if(pa[index]===null||pb[index]===null)continue;
  if(pa[index]!==pb[index])return false;
 }
 return true;
};
const demonstratedMismatch=captures=>{
 // any pairwise non-null inequality across all semantic fields or vs headSha
 const heads=captures.flatMap(c=>[c.headStartSha,c.headEndSha]).filter(v=>v!==null);
 if(new Set(heads).size>1)return true;
 for(let i=0;i<captures.length;i++){
  for(let j=i+1;j<captures.length;j++){
   if(!projectionsEqual(captures[i],captures[j]))return true;
  }
 }
 return false;
};

const selectorErrorReceipt=({root,context,format,reserved,baseSha,requestedHeadSha,failureKind,captures=[],repository=null,toolIdentity=null,environment=null,mode='plan-only',selection=null})=>
 buildReceipt({
  state:'failed',mode,runId:reserved.runId,createdAt:toIso(new Date()),outputPath:reserved.outputPath,
  baseSha,requestedHeadSha,headSha:null,mergeBaseSha:null,
  selection:selection??{selectedCheckIds:[...CHECK_IDS],changedPaths:[],fallbackReasons:[...FALLBACK_REASONS]},
  executedCheckIds:[],checkResults:[],
  repository:repository??repositoryFor(root,context,format,null),
  toolIdentity:toolIdentity??toolIdentityFor(root,format),environment:environment??environmentFor(root,reserved.runRoot),
  snapshotComplete:false,snapshotEqual:null,snapshotConsistency:null,
  snapshotCaptures:captures.map((c,i)=>({captureId:c.captureId??i+1,capturedAt:c.capturedAt??toIso(new Date()),captureSha256:c.captureSha256})),
  snapshotFingerprint:null,
  failureKind,cliExitCode:EXIT_RESULT,
 });

export function main(argv=process.argv.slice(2),{root=repositoryRoot}={}){
 let context;
 let format;
 let args;
 try{
  args=parseArgs(argv);
  const redirect=findGitRedirect(process.env);
  const rootPackage=path.join(root,'package.json');
  try{
   const manifest=JSON.parse(fs.readFileSync(rootPackage,'utf8'));
   if(!Array.isArray(manifest.workspaces)||!manifest.workspaces.includes('apps/*')||!manifest.workspaces.includes('packages/*'))
    throw new Error('workspace identity mismatch');
  }catch{
   throw new StartupError('repository root unavailable',EXIT_STARTUP,ROOT_MESSAGE);
  }
  if(redirect){
   // sanitized env continues; redirect becomes a receipt failure after reservation
  }
  try{
   context=new GitContext(root,sanitizedGitEnv());
   format=objectFormatOf(context);
  }catch(error){
   if(error instanceof StartupError)throw error;
   throw new StartupError(error.message,EXIT_STARTUP,CONFIG_MESSAGE);
  }
  for(const value of [args.base,args.head]){
   if(value===undefined)continue;
   const width=format==='sha256'?64:40;
   if(!new RegExp(`^[0-9a-f]{${width}}$`).test(value))throw commitError();
   if(!isAncestorCommit(context,value))throw commitError();
  }
 }catch(error){
  if(error instanceof StartupError){
   writeDiagnostic(error.diagnostic);
   return error.code;
  }
  writeDiagnostic(TOOL_MESSAGE);
  return EXIT_STARTUP;
 }

 let reserved;
 try{
  reserved=reserveRunRoot(root);
 }catch(error){
  if(error instanceof StartupError){
   writeDiagnostic(error.diagnostic);
   return error.code;
  }
  writeDiagnostic(OUTPUT_MESSAGE);
  return EXIT_OUTPUT;
 }

 const {runId,runRoot,outputPath}=reserved;
 const createdAt=toIso(new Date());
 const toolIdentity=toolIdentityFor(root,format);
 const environment=environmentFor(root,runRoot);
 const toolHash=toolIdentitySha256For(toolIdentity);
 const envHash=environmentSha256For(environment);
 const redirect=findGitRedirect(process.env);
 const captures=[];
 let nextCaptureId=1;
 const capturePair=boundary=>{
  const a=captureOnce({context,root,format,baseSha:args.base,captureId:nextCaptureId++,boundary,checkId:null,pass:'A',toolHash,envHash});
  a.capture.capturedAt=toIso(new Date());
  captures.push(a.capture);
  const b=captureOnce({context,root,format,baseSha:args.base,captureId:nextCaptureId++,boundary,checkId:null,pass:'B',toolHash,envHash});
  b.capture.capturedAt=toIso(new Date());
  captures.push(b.capture);
  return {a,b};
 };

 const finish=(receipt)=>{
  try{publishReceipt(root,outputPath,receipt);}catch(error){
   if(error instanceof StartupError){writeDiagnostic(error.diagnostic);return error.code;}
   writeDiagnostic(OUTPUT_MESSAGE);
   return EXIT_OUTPUT;
  }
  const kind=receipt.failureKind;
  if(kind!==null){writeDiagnostic(`check:affected: ${kind}\n`);return EXIT_RESULT;}
  return 0;
 };
 const snapshotFields=()=>({
  snapshotCaptures:captures.map(c=>({captureId:c.captureId,capturedAt:c.capturedAt,captureSha256:c.captureSha256})),
  snapshotFingerprint:captures.every(c=>c.complete)?snapshotFingerprintFromCaptures(captures.map(c=>({captureId:c.captureId,captureSha256:c.captureSha256}))):null,
 });
 const snapshotState=()=>{
  const complete=captures.length>0&&captures.every(c=>c.complete);
  const mismatch=demonstratedMismatch(captures);
  return {complete,mismatch,equal:complete&&!mismatch};
 };

 if(redirect){
  return finish(selectorErrorReceipt({
   root,context,format,reserved,baseSha:args.base,requestedHeadSha:args.head,
   failureKind:'git-environment-redirect',toolIdentity,environment,
  }));
 }

 // S0 boundary
 const s0=capturePair('S0');
 const receiptRepository=repositoryForCapture(root,context,format,s0.a);
 const firstSpecial=s0.a.specialized??s0.b.specialized;
 const headSha=s0.a.derived.headSha??s0.b.derived.headSha;
 if(firstSpecial){
  return finish(buildReceipt({
   state:'failed',mode:'plan-only',runId,createdAt,outputPath,
   baseSha:args.base,requestedHeadSha:args.head??null,headSha,mergeBaseSha:null,
   selection:{selectedCheckIds:[],changedPaths:[],fallbackReasons:[]},executedCheckIds:[],checkResults:[],
   repository:receiptRepository,
   toolIdentity,environment,
   ...snapshotFields(),snapshotComplete:false,snapshotEqual:null,snapshotConsistency:null,
   failureKind:firstSpecial,cliExitCode:EXIT_RESULT,
  }));
 }

 if(args.head!==undefined&&args.head!==headSha){
  return finish(buildReceipt({
   state:'failed',mode:'plan-only',runId,createdAt,outputPath,
   baseSha:args.base,requestedHeadSha:args.head,headSha,mergeBaseSha:s0.a.derived.mergeBaseSha,
   selection:{selectedCheckIds:[],changedPaths:[],fallbackReasons:[]},executedCheckIds:[],checkResults:[],
   repository:receiptRepository,
   toolIdentity,environment,
   ...snapshotFields(),snapshotComplete:s0.a.capture.complete&&s0.b.capture.complete,
   snapshotEqual:null,snapshotConsistency:null,
   failureKind:'repository-identity-mismatch',cliExitCode:EXIT_RESULT,
  }));
 }

 const s0state=snapshotState();
 if(s0state.mismatch){
  return finish(buildReceipt({
   state:'invalidated',mode:'plan-only',runId,createdAt,outputPath,
   baseSha:args.base,requestedHeadSha:args.head??null,headSha,mergeBaseSha:s0.a.derived.mergeBaseSha,
   selection:{selectedCheckIds:[],changedPaths:[],fallbackReasons:[]},executedCheckIds:[],checkResults:[],
   repository:receiptRepository,
   toolIdentity,environment,
   ...snapshotFields(),snapshotComplete:s0state.complete,snapshotEqual:false,snapshotConsistency:null,
   failureKind:'snapshot-mismatch',cliExitCode:EXIT_RESULT,
  }));
 }
 if(!s0state.complete){
  return finish(buildReceipt({
   state:'failed',mode:'plan-only',runId,createdAt,outputPath,
   baseSha:args.base,requestedHeadSha:args.head??null,headSha,mergeBaseSha:s0.a.derived.mergeBaseSha,
   selection:{selectedCheckIds:[],changedPaths:[],fallbackReasons:[]},executedCheckIds:[],checkResults:[],
   repository:receiptRepository,
   toolIdentity,environment,
   ...snapshotFields(),snapshotComplete:false,snapshotEqual:null,snapshotConsistency:null,
   failureKind:'snapshot-unavailable',cliExitCode:EXIT_RESULT,
  }));
 }

 // selection from S0-A derived data
 const derived=s0.a.derived;
 let selection;
 let vitestTargets=[];
 try{
  const selectorInput={
   dirty:derived.dirty===true,hiddenIndex:derived.hiddenIndex===true,
   mergeBaseUnavailable:derived.mergeBaseUnavailable,shallow:derived.shallow===true,
  };
  const records=(derived.changedPaths??[]).map(record=>{
   let text;
   try{text=decodeUtf8Strict(record.path);}catch{text=undefined;}
   return {path:text,status:record.status};
  });
  selection=selectAffectedChecks(records,selectorInput);
  if(derived.changedPaths===null)selection=selectAffectedChecks(records,{...selectorInput,graphUncertainty:true});
  if(selection.fallbackReasons.length===0&&selection.selectedCheckIds.includes('vitest')){
   const tracked=context.run(['ls-files','-z']).stdout.toString('utf8').split('\0').filter(Boolean);
   const workspacePackages=workspacePackageMap(root,tracked);
   const targets=collectVitestTargets({
    trackedFiles:tracked,
    changedPaths:selection.changedPaths.filter(item=>item.category!=='full-fallback'),
    readFile:readTrackedFile(root),
    workspacePackages,
   });
   vitestTargets=targets.tests;
   if(targets.uncertain)selection=selectAffectedChecks(records,{...selectorInput,graphUncertainty:true});
  }
 }catch(error){
  return finish(selectorErrorReceipt({
   root,context,format,reserved,baseSha:args.base,requestedHeadSha:args.head,
   failureKind:'selector-error',captures,toolIdentity,environment,
   repository:receiptRepository,
  }));
 }

 // S1 boundary (post-selection)
 const s1=capturePair('S1');
 const s1special=s1.a.specialized??s1.b.specialized;
 const s1state=snapshotState();
 const headBound=headSha;
 if(s1special||s1state.mismatch||!s1state.complete){
  const kind=s1special??(s1state.mismatch?'snapshot-mismatch':'snapshot-unavailable');
  return finish(buildReceipt({
   state:s1state.mismatch?'invalidated':'failed',mode:'plan-only',runId,createdAt,outputPath,
   baseSha:args.base,requestedHeadSha:args.head??null,headSha:headBound,mergeBaseSha:derived.mergeBaseSha,
   selection,executedCheckIds:[],checkResults:[],
   repository:receiptRepository,
   toolIdentity,environment,
   ...snapshotFields(),snapshotComplete:s1state.complete,snapshotEqual:s1state.mismatch?false:null,snapshotConsistency:null,
   failureKind:kind,cliExitCode:EXIT_RESULT,
  }));
 }

 if(args.run===false){
  return finish(buildReceipt({
   state:'planned',mode:'plan-only',runId,createdAt,outputPath,
   baseSha:args.base,requestedHeadSha:args.head??null,headSha:headBound,mergeBaseSha:derived.mergeBaseSha,
   selection,executedCheckIds:[],checkResults:[],
   repository:receiptRepository,
   toolIdentity,environment,
   ...snapshotFields(),snapshotComplete:true,snapshotEqual:true,snapshotConsistency:SNAPSHOT_CONSISTENCY,
   cliExitCode:0,
  }));
 }

 // S2 boundary (pre-first-check)
 const s2=capturePair('S2');
 const s2special=s2.a.specialized??s2.b.specialized;
 const s2state=snapshotState();
 if(s2special||s2state.mismatch||!s2state.complete){
  const kind=s2special??(s2state.mismatch?'snapshot-mismatch':'snapshot-unavailable');
  return finish(buildReceipt({
   state:s2state.mismatch?'invalidated':'failed',mode:'run',runId,createdAt,outputPath,
   baseSha:args.base,requestedHeadSha:args.head??null,headSha:headBound,mergeBaseSha:derived.mergeBaseSha,
   selection,executedCheckIds:[],checkResults:[],
   repository:receiptRepository,
   toolIdentity,environment,
   ...snapshotFields(),snapshotComplete:s2state.complete,snapshotEqual:s2state.mismatch?false:null,snapshotConsistency:null,
   failureKind:kind,cliExitCode:EXIT_RESULT,
  }));
 }

 if(selection.fallbackReasons.length>0)vitestTargets=[];

 // serial checks with P-<checkId> A/B capture after every attempt
 const checkResults=[];
 let runnerError=null;
 let specialized=null;
 let broken=false;
 for(const checkId of selection.selectedCheckIds){
  let results;
  try{
   results=executeChecks([checkId],{root,runRoot,vitestTargets});
  }catch(error){
   checkResults.push({checkId,selected:true,outcome:'failed',argv:null,cwd:null,startedAt:null,endedAt:null,durationMs:null,exitCode:null,signal:null,runnerError:'spawn-failed'});
   runnerError='runner-error';
   broken=true;
  }
  if(!broken&&results&&results.length>0)checkResults.push(...results);
  // post-attempt pair
  const pa=captureOnce({context,root,format,baseSha:args.base,captureId:nextCaptureId++,boundary:'P',checkId,pass:'A',toolHash,envHash});
  pa.capture.capturedAt=toIso(new Date());captures.push(pa.capture);
  const pb=captureOnce({context,root,format,baseSha:args.base,captureId:nextCaptureId++,boundary:'P',checkId,pass:'B',toolHash,envHash});
  pb.capture.capturedAt=toIso(new Date());captures.push(pb.capture);
  const pairSpecial=pa.specialized??pb.specialized;
  if(pairSpecial){specialized=pairSpecial;broken=true;break;}
  if(!(pa.capture.complete&&pb.capture.complete)||!projectionsEqual(pa.capture,pb.capture)){broken=true;break;}
  if(broken)break;
 }
 for(const checkId of selection.selectedCheckIds){
  if(!checkResults.some(r=>r.checkId===checkId))checkResults.push({checkId,selected:true,outcome:'not-run',argv:null,cwd:null,startedAt:null,endedAt:null,durationMs:null,exitCode:null,signal:null,runnerError:null});
 }
 const executedCheckIds=checkResults
  .filter(result=>result.selected&&result.outcome!=='not-run'&&result.runnerError!=='spawn-failed')
  .map(result=>result.checkId);

 const finalState=snapshotState();
 const checksFailed=checkResults.some(r=>r.selected&&r.outcome==='failed'&&r.runnerError===null);
 const runErrored=runnerError!==null||checkResults.some(r=>r.runnerError!==null&&r.runnerError!==null);
 let failureKind=null;
 let state;
 if(specialized){failureKind=specialized;state='failed';}
 else if(finalState.mismatch){failureKind='snapshot-mismatch';state='invalidated';}
 else if(!finalState.complete){failureKind='snapshot-unavailable';state='failed';}
 else if(runErrored){failureKind='runner-error';state='failed';}
 else if(checksFailed){failureKind='check-failed';state='failed';}
 else{state=selection.selectedCheckIds.length===CHECK_IDS.length?'verified':'selected-passed';}

 return finish(buildReceipt({
  state,mode:'run',runId,createdAt,outputPath,
  baseSha:args.base,requestedHeadSha:args.head??null,headSha:headBound,mergeBaseSha:derived.mergeBaseSha,
  selection,executedCheckIds,checkResults,
  repository:receiptRepository,
  toolIdentity,environment,
  ...snapshotFields(),snapshotComplete:finalState.complete,snapshotEqual:finalState.complete?finalState.equal:null,
  snapshotConsistency:finalState.complete&&finalState.equal?SNAPSHOT_CONSISTENCY:null,
  failureKind,cliExitCode:failureKind?EXIT_RESULT:0,
 }));
}

const isMainModule=process.argv[1]&&pathToFileURL(fs.realpathSync(process.argv[1])).href===pathToFileURL(fs.realpathSync(modulePath)).href;

if(isMainModule){
 process.exitCode=main();
}
