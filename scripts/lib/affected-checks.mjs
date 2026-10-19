import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

export const CHECK_IDS=Object.freeze([
 'docs','fast','spec','vitest','build','dynamics-validate','dynamics-test',
]);

export const SNAPSHOT_CONSISTENCY='double-collected-git-visible';
export const SNAPSHOT_CONSISTENCY_PLAN='single-collected-boundary-git-visible';

export class AffectedCheckError extends Error{
 constructor(message,kind='snapshot-unavailable',options){
  super(message,options);
  this.name='AffectedCheckError';
  this.kind=kind;
 }
}

const asBuffer=value=>Buffer.isBuffer(value)?Buffer.from(value):Buffer.from(value??[]);
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const hex=value=>Buffer.from(value).toString('hex');
const b64=value=>Buffer.from(value).toString('base64');
const sortBuffers=values=>[...values].sort(Buffer.compare);
const utf8Decoder=new TextDecoder('utf-8',{fatal:true});

export function decodeUtf8Strict(input){
 const value=asBuffer(input);
 try{
  const text=utf8Decoder.decode(value);
  if(!Buffer.from(text,'utf8').equals(value))return undefined;
  return text;
 }catch{return undefined;}
}

function nulRecords(input,label){
 const buffer=asBuffer(input);
 if(buffer.length===0)return [];
 if(buffer[buffer.length-1]!==0)throw new AffectedCheckError(`${label} is not NUL terminated`,'malformed-path-manifest');
 const records=[];
 let start=0;
 for(let index=0;index<buffer.length;index++){
  if(buffer[index]!==0)continue;
  if(index===start)throw new AffectedCheckError(`${label} contains an empty record`,'malformed-path-manifest');
  records.push(Buffer.from(buffer.subarray(start,index)));
  start=index+1;
 }
 return records;
}

const tokenText=(buffer,label)=>{
 const text=decodeUtf8Strict(buffer);
 if(text===undefined||/[\0\r\n]/.test(text))throw new AffectedCheckError(`${label} is not valid protocol text`,'malformed-path-manifest');
 return text;
};

export function parseNameStatusZ(input){
 const tokens=nulRecords(input,'name-status stream');
 const records=[];
 for(let index=0;index<tokens.length;){
  const statusText=tokenText(tokens[index++],'name-status code');
  let status;
  let score;
  let arity;
  if(/^[AMD TUXB]$/.test(statusText)&&statusText!==' '){
   status=statusText;
   arity=1;
  }else{
   const match=/^([RC])([0-9]{1,3})$/.exec(statusText);
   if(!match)throw new AffectedCheckError(`unsupported or malformed name-status code ${JSON.stringify(statusText)}`,'malformed-path-manifest');
   status=match[1];
   score=Number(match[2]);
   if(score<0||score>100)throw new AffectedCheckError(`invalid rename/copy score ${statusText}`,'malformed-path-manifest');
   arity=2;
  }
  if(index+arity>tokens.length)throw new AffectedCheckError(`name-status ${statusText} has too few path records`,'malformed-path-manifest');
  if(arity===1){
   records.push({status,path:Buffer.from(tokens[index++])});
  }else{
   const oldPath=Buffer.from(tokens[index++]);
   const newPath=Buffer.from(tokens[index++]);
   records.push({status,score,oldPath,path:newPath});
  }
 }
 return records;
}

function splitPorcelainPath(record,prefixFieldCount,label){
 let cursor=0;
 for(let field=0;field<prefixFieldCount;field++){
  const separator=record.indexOf(0x20,cursor);
  if(separator<0)throw new AffectedCheckError(`${label} record has too few fields`,'malformed-porcelain');
  if(separator===cursor)throw new AffectedCheckError(`${label} record has an empty field`,'malformed-porcelain');
  cursor=separator+1;
 }
 const pathBytes=Buffer.from(record.subarray(cursor));
 if(pathBytes.length===0)throw new AffectedCheckError(`${label} record has an empty path`,'malformed-porcelain');
 return pathBytes;
}

export function parsePorcelainV2Z(input){
 const records=nulRecords(input,'porcelain-v2 stream');
 const parsed=[];
 for(let index=0;index<records.length;index++){
  const record=records[index];
  const kind=String.fromCharCode(record[0]);
  if(kind==='#'){
   parsed.push({kind:'header',raw:Buffer.from(record)});
   continue;
  }
  if(kind==='1'){
   const pathBytes=splitPorcelainPath(record,8,'ordinary');
   const prefix=record.subarray(0,record.length-pathBytes.length-1).toString('ascii').split(' ');
   if(prefix.length!==8||prefix[0]!=='1'||!/^[.MADRCUT?!]{2}$/.test(prefix[1])||!/^S[.C][.M.][.U.]$|^N\.\.\.$/.test(prefix[2]))
    throw new AffectedCheckError('malformed ordinary porcelain-v2 record','malformed-porcelain');
   parsed.push({kind:'ordinary',xy:prefix[1],sub:prefix[2],path:pathBytes});
   continue;
  }
  if(kind==='2'){
   const pathBytes=splitPorcelainPath(record,9,'rename/copy');
   if(index+1>=records.length)throw new AffectedCheckError('rename/copy porcelain-v2 record has no original path','malformed-porcelain');
   const prefix=record.subarray(0,record.length-pathBytes.length-1).toString('ascii').split(' ');
   if(prefix.length!==9||prefix[0]!=='2'||!/^[.MADRCUT?!]{2}$/.test(prefix[1])||!/^S[.C][.M.][.U.]$|^N\.\.\.$/.test(prefix[2])||!/^.[0-9]{1,3}$/.test(prefix[8]))
    throw new AffectedCheckError('malformed rename/copy porcelain-v2 record','malformed-porcelain');
   const originalPath=Buffer.from(records[++index]);
   parsed.push({kind:'rename-copy',xy:prefix[1],sub:prefix[2],score:prefix[8],path:pathBytes,originalPath});
   continue;
  }
  if(kind==='u'){
   const pathBytes=splitPorcelainPath(record,10,'unmerged');
   const prefix=record.subarray(0,record.length-pathBytes.length-1).toString('ascii').split(' ');
   if(prefix.length!==10||prefix[0]!=='u'||!/^[.MADRCUT?!]{2}$/.test(prefix[1]))
    throw new AffectedCheckError('malformed unmerged porcelain-v2 record','malformed-porcelain');
   parsed.push({kind:'unmerged',xy:prefix[1],path:pathBytes});
   continue;
  }
  if(kind==='?'){
   if(record[1]!==0x20||record.length<3)throw new AffectedCheckError('malformed untracked porcelain-v2 record','malformed-porcelain');
   parsed.push({kind:'untracked',path:Buffer.from(record.subarray(2))});
   continue;
  }
  throw new AffectedCheckError(`unsupported porcelain-v2 record type ${JSON.stringify(kind)}`,'malformed-porcelain');
 }
 return parsed;
}

export const RECEIPT_SCHEMA_VERSION=2;
export const RECEIPT_AUTHORITY='human3d.local-check-runner';

export const GIT_CONFIG_PREAMBLE=Object.freeze([
 '--no-pager',
 '-c','core.fsmonitor=false','-c','core.untrackedCache=false',
 '-c','core.excludesFile=/dev/null','-c','core.attributesFile=/dev/null',
 '-c','core.autocrlf=false','-c','core.filemode=true','-c','core.symlinks=true',
 '-c','diff.external=','-c','diff.renameLimit=0','-c','core.quotepath=false',
]);

export const FALLBACK_REASONS=Object.freeze([
 'dirty-tree','delete-rename-copy','broad-input','graph-uncertainty',
 'merge-base-unavailable','shallow-repository','unclassified-path','unrepresentable-path',
]);

export const CATEGORY_CHECKS=Object.freeze({
 docs:Object.freeze(['docs']),
 web:Object.freeze(['fast','vitest','build']),
 server:Object.freeze(['fast','spec','vitest','build']),
 'motion-core':Object.freeze(['fast','spec','vitest','build']),
 'dynamics-source':Object.freeze(['fast','dynamics-validate','dynamics-test']),
});

const SOURCE_EXTENSIONS=new Set(['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs']);
const TEST_PATTERN=/\.(?:test|spec)\.[cm]?[jt]sx?$/;
const DYNAMICS_SOURCE_ALLOWLIST=new Set([
 'assets/source/dynamics/myofullbody-complete.xml',
 'assets/source/dynamics/myofullbody-parameters.json',
]);
const PROTECTED_CORE_FILES=new Set([
 'packages/motion-core/src/solver.ts',
 'packages/motion-core/src/limits.ts',
 'packages/motion-core/src/kinematics.ts',
 'packages/motion-core/src/rig.ts',
 'packages/motion-core/src/package-const.ts',
]);
const PROTOCOL_ENTRY_FILES=new Set([
 'apps/server/src/contract.ts',
 'packages/motion-core/src/protocol.ts',
 'packages/motion-core/src/pose-package.ts',
 'packages/motion-core/src/package-export.ts',
 'packages/motion-core/src/package-inspect.ts',
 'packages/motion-core/src/index.ts',
 'packages/motion-core/src/glb-export.ts',
]);

const extensionOf=relativePath=>{
 const dot=relativePath.lastIndexOf('.');
 const slash=relativePath.lastIndexOf('/');
 return dot>slash?relativePath.slice(dot):'';
};

const isBroadInputPath=relativePath=>{
 const base=relativePath.slice(relativePath.lastIndexOf('/')+1);
 if(base==='package.json'||base==='package-lock.json'||base==='pnpm-lock.yaml'||base==='yarn.lock')return true;
 if(/^tsconfig.*\.json$/.test(base))return true;
 if(/^(?:vite|vitest|build)\.config\.[cm]?[jt]s$/.test(base))return true;
 if(relativePath==='.gitignore'||relativePath==='.npmrc'||relativePath==='.gitattributes')return true;
 if(relativePath.startsWith('scripts/')||relativePath.startsWith('tests/')||relativePath.startsWith('spec/')||relativePath.startsWith('.github/'))return true;
 if(relativePath.startsWith('public/'))return true;
 if(relativePath.startsWith('assets/motions/')||relativePath.startsWith('assets/dynamics/'))return true;
 if(PROTOCOL_ENTRY_FILES.has(relativePath)||PROTECTED_CORE_FILES.has(relativePath))return true;
 return false;
};

const fullFallback=fallbackReason=>({
 category:'full-fallback',fallbackReason,selectedCheckIds:Object.freeze([...CHECK_IDS]),
});

const safeRelativePath=value=>{
 const text=typeof value==='string'?value:'';
 if(text.length===0||text.startsWith('/')||/[\\\0\r\n]/.test(text)||text.split('/').includes('..'))return undefined;
 return text;
};

export function classifyChangedPath(relativePath,status='M'){
 const safe=safeRelativePath(relativePath);
 if(safe===undefined)return fullFallback('unrepresentable-path');
 if(TEST_PATTERN.test(safe))return fullFallback('broad-input');
 if(isBroadInputPath(safe))return fullFallback('broad-input');
 if(DYNAMICS_SOURCE_ALLOWLIST.has(safe)){
  if(status!=='M')return fullFallback('delete-rename-copy');
  const category='dynamics-source';
  return {category,fallbackReason:null,selectedCheckIds:Object.freeze([...CATEGORY_CHECKS[category]])};
 }
 if(safe.startsWith('assets/'))return fullFallback('broad-input');
 if(/\.mdx?$/i.test(safe))return {category:'docs',fallbackReason:null,selectedCheckIds:Object.freeze([...CATEGORY_CHECKS.docs])};
 const candidates=[
  ['apps/web/src/', 'web'],
  ['apps/server/src/', 'server'],
  ['packages/motion-core/src/', 'motion-core'],
 ];
 for(const [prefix,category] of candidates){
  if(!safe.startsWith(prefix))continue;
  if(!SOURCE_EXTENSIONS.has(extensionOf(safe)))return fullFallback('unclassified-path');
  return {category,fallbackReason:null,selectedCheckIds:Object.freeze([...CATEGORY_CHECKS[category]])};
 }
 return fullFallback('unclassified-path');
}

const orderedUnion=checkIds=>CHECK_IDS.filter(checkId=>checkIds.has(checkId));

export function selectAffectedChecks(changedPaths,{
 dirty=false,hiddenIndex=false,mergeBaseUnavailable=false,shallow=false,graphUncertainty=false,
}={}){
 if(!Array.isArray(changedPaths))throw new TypeError('changedPaths must be an array');
 const reasons=new Set();
 if(dirty||hiddenIndex)reasons.add('dirty-tree');
 if(mergeBaseUnavailable)reasons.add('merge-base-unavailable');
 if(shallow)reasons.add('shallow-repository');
 if(graphUncertainty)reasons.add('graph-uncertainty');
 const items=changedPaths.map((record,index)=>{
  if(!record||typeof record!=='object')throw new TypeError(`changed path record ${index} is not an object`);
  const status=typeof record.status==='string'?record.status:'M';
  const path=record.path;
  if(status!=='M')reasons.add('delete-rename-copy');
  const classified=classifyChangedPath(path,status);
  if(classified.fallbackReason!==null)reasons.add(classified.fallbackReason);
  return {path:typeof path==='string'?path:'',status,index,...classified};
 });
 const fallbackReasons=FALLBACK_REASONS.filter(reason=>reasons.has(reason));
 if(fallbackReasons.length>0){
  for(const item of items){
   item.category='full-fallback';
   item.selectedCheckIds=Object.freeze([...CHECK_IDS]);
  }
  return {selectedCheckIds:Object.freeze([...CHECK_IDS]),fallbackReasons,changedPaths:items};
 }
 const selected=new Set(items.length===0?['fast']:[]);
 for(const item of items){
  for(const checkId of item.selectedCheckIds)selected.add(checkId);
 }
 return {selectedCheckIds:Object.freeze(orderedUnion(selected)),fallbackReasons,changedPaths:items};
}

const importSpecifierPattern=/(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*|export\s+\*\s+from\s*)['"]([^'"\n]+)['"]/g;

const stripComments=source=>source
 .replace(/\/\*[\s\S]*?\*\//g,'')
 .replace(/(^|[^:])\/\/[^\n]*/g,'$1');

export function extractImportSpecifiers(source){
 const specifiers=[];
 for(const match of stripComments(source).matchAll(importSpecifierPattern))specifiers.push(match[1]);
 return specifiers;
}

const probeImport=(fromPath,specifier,fileSet)=>{
 if(!specifier.startsWith('.'))return undefined;
 const base=path.posix.normalize(path.posix.join(path.posix.dirname(fromPath),specifier));
 const candidates=[base];
 if(extensionOf(base)==='')for(const extension of SOURCE_EXTENSIONS)candidates.push(base+extension);
 for(const extension of SOURCE_EXTENSIONS)candidates.push(`${base}/index${extension}`);
 for(const candidate of candidates)if(fileSet.has(candidate))return candidate;
 return undefined;
};

const probeWorkspaceImport=(specifier,fileSet,workspacePackages)=>{
 const names=Object.keys(workspacePackages).sort((left,right)=>right.length-left.length);
 const name=names.find(candidate=>specifier===candidate||specifier.startsWith(`${candidate}/`));
 if(name===undefined)return undefined;
 const subpath=specifier===name?'.':`.${specifier.slice(name.length)}`;
 const entry=workspacePackages[name]?.[subpath];
 if(typeof entry!=='string')return undefined;
 const candidates=[entry];
 if(extensionOf(entry)==='')for(const extension of SOURCE_EXTENSIONS)candidates.push(entry+extension);
 for(const extension of SOURCE_EXTENSIONS)candidates.push(`${entry}/index${extension}`);
 for(const candidate of candidates)if(fileSet.has(candidate))return candidate;
 return undefined;
};

export function collectVitestTargets({trackedFiles,changedPaths,readFile,workspacePackages={}}){
 if(!Array.isArray(trackedFiles)||typeof readFile!=='function')throw new TypeError('trackedFiles/readFile are required');
 const fileSet=new Set(trackedFiles);
 const seeds=new Set();
 for(const record of changedPaths){
  const pathValue=typeof record==='string'?record:record?.path;
  if(typeof pathValue==='string'&&fileSet.has(pathValue)&&!TEST_PATTERN.test(pathValue))seeds.add(pathValue);
 }
 const importers=new Map();
 let uncertain=false;
 for(const file of trackedFiles){
  if(!SOURCE_EXTENSIONS.has(extensionOf(file)))continue;
  let source;
  try{source=readFile(file);}catch{uncertain=true;continue;}
  for(const specifier of extractImportSpecifiers(String(source))){
   let resolved;
   if(specifier.startsWith('.'))resolved=probeImport(file,specifier,fileSet);
   else if(specifier.startsWith('@human3d/'))resolved=probeWorkspaceImport(specifier,fileSet,workspacePackages);
   else continue;
   if(resolved===undefined){
    if(specifier.startsWith('@human3d/'))uncertain=true;
    else uncertain=true;
    continue;
   }
   if(!importers.has(resolved))importers.set(resolved,new Set());
   importers.get(resolved).add(file);
  }
 }
 const reached=new Set();
 const queue=[...seeds];
 while(queue.length>0){
  const current=queue.pop();
  if(reached.has(current))continue;
  reached.add(current);
  for(const importer of importers.get(current)??[])if(!reached.has(importer))queue.push(importer);
 }
 const tests=[...reached].filter(file=>TEST_PATTERN.test(file)).sort();
 return {tests,uncertain};
}

export function serializeReceipt(receipt){
 return Buffer.from(`${JSON.stringify(receipt,null,2)}\n`,'utf8');
}

export function isSafeSha(value){
 return typeof value==='string'&&/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

export function createReceipt({
 state,mode,runId,createdAt,outputPath,baseSha,requestedHeadSha,headSha,mergeBaseSha,
 selectedCheckIds,executedCheckIds=[],checkResults=[],fallbackReasons=[],changedPaths=[],
 repository=null,toolIdentity=null,environment=null,snapshotComplete=false,snapshotEqual=null,
 snapshotConsistency=SNAPSHOT_CONSISTENCY,snapshotCaptures=[],snapshotFingerprint=null,
 failureKind=null,failureMessage=null,cliExitCode,claimScope='none',
}){
 if(!Number.isInteger(RECEIPT_SCHEMA_VERSION))throw new Error('schemaVersion must be an integer');
 return {
  schemaVersion:RECEIPT_SCHEMA_VERSION,
  authority:RECEIPT_AUTHORITY,
  state,
  mode,
  runId,
  createdAt,
  outputPath,
  baseSha,
  requestedHeadSha:requestedHeadSha??null,
  headSha,
  mergeBaseSha:mergeBaseSha??null,
  claimScope,
  selectedCheckIds:[...selectedCheckIds],
  executedCheckIds:[...executedCheckIds],
  checkResults:[...checkResults],
  fallbackReasons:[...fallbackReasons],
  changedPaths:[...changedPaths],
  repository,
  toolIdentity,
  environment,
  snapshotComplete,
  snapshotEqual,
  snapshotConsistency,
  snapshotCaptures:[...snapshotCaptures],
  snapshotFingerprint,
  failureKind,
  failureMessage,
  cliExitCode,
 };
}

export function snapshotFingerprintFromCaptures(captures){
 return sha256(JSON.stringify(['PR11B-SNAPSHOT-v1',captures.map(capture=>[
  capture.captureId,capture.captureSha256,
 ])]));
}

export function fingerprintSnapshot(snapshot){
 const payload={
  headSha:snapshot.headSha,
  baseSha:snapshot.baseSha,
  mergeBaseSha:snapshot.mergeBaseSha,
  shallow:snapshot.shallow,
  dirty:snapshot.dirty,
  status:snapshot.status.map(record=>({
   kind:record.kind,xy:record.xy??null,path:hex(record.path),
  })),
  changedPaths:snapshot.changedPaths.map(record=>({
   status:record.status,score:record.score??null,path:hex(record.path),oldPath:record.oldPath?hex(record.oldPath):null,
  })),
 };
 return sha256(JSON.stringify(payload));
}

export function sanitizedGitEnv(baseEnv=process.env,extra={}){
 const env={
  PATH:baseEnv.PATH??'/usr/local/bin:/usr/bin:/bin',
  GIT_NO_REPLACE_OBJECTS:'1',
  GIT_OPTIONAL_LOCKS:'0',
  GIT_NO_LAZY_FETCH:'1',
  GIT_CONFIG_NOSYSTEM:'1',
  GIT_CONFIG_SYSTEM:'/dev/null',
  GIT_CONFIG_GLOBAL:'/dev/null',
  GIT_ATTR_NOSYSTEM:'1',
  GIT_PAGER:'cat',
  GIT_TERMINAL_PROMPT:'0',
  LANG:'C.UTF-8',
  LC_ALL:'C.UTF-8',
  ...extra,
 };
 if(baseEnv.HOME)env.HOME=baseEnv.HOME;
 if(baseEnv.TMPDIR)env.TMPDIR=baseEnv.TMPDIR;
 return env;
}

export const FAILURE_MESSAGES=Object.freeze({
 'git-environment-redirect':'Git environment redirects are not allowed.',
 'toolchain-invalid':'Required tool identity is invalid.',
 'repository-identity-mismatch':'Requested HEAD does not match actual HEAD.',
 'git-history-rewrite':'Replacement refs, grafts, or alternates are not allowed.',
 'hidden-index-state':'Hidden or split index state is not supported.',
 'workspace-link-invalid':'Workspace links do not match the repository layout.',
 'snapshot-unavailable':'Required snapshot data is unavailable.',
 'snapshot-mismatch':'Repository snapshot changed during execution.',
 'selector-error':'Check selection could not be determined safely.',
 'check-failed':'One or more selected checks failed.',
 'runner-error':'A selected check could not produce a valid result.',
});

export const GIT_REDIRECT_VARIABLES=Object.freeze([
 'GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY',
 'GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_OBJECT_DIRECTORY_RELATIVE','GIT_QUARANTINE_PATH',
 'GIT_SHALLOW_FILE','GIT_GRAFT_FILE','GIT_REPLACE_REF_BASE','GIT_NAMESPACE',
 'GIT_CEILING_DIRECTORIES','GIT_DISCOVERY_ACROSS_FILESYSTEM','GIT_PREFIX','GIT_EXEC_PATH',
 'GIT_CONFIG','GIT_CONFIG_GLOBAL','GIT_CONFIG_SYSTEM','GIT_CONFIG_PARAMETERS','GIT_CONFIG_COUNT',
 'GIT_EXTERNAL_DIFF','GIT_DIFF_OPTS','GIT_ATTR_SOURCE',
]);

export function findGitRedirect(env=process.env){
 for(const name of Object.keys(env)){
  if(GIT_REDIRECT_VARIABLES.includes(name))return name;
  if(/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name))return name;
  if(/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|QUARANTINE_PATH|SHALLOW_FILE|GRAFT_FILE|REPLACE_REF_BASE|NAMESPACE)$/.test(name))return name;
 }
 return undefined;
}
