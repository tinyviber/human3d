import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const safeSegment=value=>String(value).replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^[-.]+|[-.]+$/g,'')||'unknown';
const MAX_SYMLINK_EXPANSIONS=40;
const tracePathAliases=target=>{
 let candidate=path.normalize(path.resolve(target));
 const candidates=[];
 const componentPrefixes=[];
 const symlinkPrefixes=[];
 const seen=new Set();
 let expansions=0;
 while(true){
  const normalized=path.normalize(path.resolve(candidate));
  if(seen.has(normalized))throw new Error(`refusing to trace cyclic path alias ${normalized}`);
  seen.add(normalized);
  candidates.push(normalized);
  const {root:pathRoot}=path.parse(normalized);
  const relative=path.relative(pathRoot,normalized);
  const components=relative===''?[]:relative.split(path.sep);
  let prefix=pathRoot;
  let expanded=false;
  for(let index=0;index<components.length;index++){
   prefix=path.join(prefix,components[index]);
   let stat;
   try{
    stat=fs.lstatSync(prefix);
   }catch(error){
    const code=error&&typeof error==='object'&&'code'in error?error.code:undefined;
    if(code==='ENOENT')break;
    throw new Error(`could not trace path ${normalized} at ${prefix}: ${error instanceof Error?error.message:String(error)}`);
   }
   componentPrefixes.push(prefix);
   if(!stat.isSymbolicLink())continue;
   symlinkPrefixes.push(prefix);
   if(expansions>=MAX_SYMLINK_EXPANSIONS)
    throw new Error(`refusing to trace ${normalized}; exceeded ${MAX_SYMLINK_EXPANSIONS} symlink expansions`);
   let linkTarget;
   try{
    linkTarget=fs.readlinkSync(prefix,'utf8');
   }catch(error){
    throw new Error(`could not read symlink ${prefix}: ${error instanceof Error?error.message:String(error)}`);
   }
   candidate=path.resolve(path.dirname(prefix),linkTarget,...components.slice(index+1));
   expansions++;
   expanded=true;
   break;
  }
  if(!expanded)return {candidates,componentPrefixes,symlinkPrefixes,canonicalTarget:normalized};
 }
};
const isSameOrWithin=(directory,target)=>{
 const relative=path.relative(directory,target);
 return relative===''||(relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative));
};
const lstatIfPresent=target=>{
 try{
  return fs.lstatSync(target);
 }catch(error){
  const code=error&&typeof error==='object'&&'code'in error?error.code:undefined;
  if(code==='ENOENT')return undefined;
  throw new Error(`could not inspect path ${target}: ${error instanceof Error?error.message:String(error)}`);
 }
};
const sameFileEntry=(left,right)=>left.dev===right.dev&&left.ino===right.ino;
const canonicalPathWithActualCase=(target,rootDir,canonicalRoot)=>{
 const absolute=path.normalize(path.resolve(target));
 const boundary=[rootDir,canonicalRoot].find(root=>isSameOrWithin(root,absolute));
 if(!boundary)return absolute;
 const relative=path.relative(boundary,absolute);
 const components=relative===''?[]:relative.split(path.sep);
 let current=boundary;
 for(let index=0;index<components.length;index++){
  let names;
  try{
   names=fs.readdirSync(current);
  }catch(error){
   const code=error&&typeof error==='object'&&'code'in error?error.code:undefined;
   if(code==='ENOENT')return path.join(current,...components.slice(index));
   throw new Error(`could not inspect path entries in ${current}: ${error instanceof Error?error.message:String(error)}`);
  }
  const requestedName=components[index];
  const exactName=names.find(name=>name===requestedName);
  const caseFoldedName=exactName??names.find(name=>name.toLowerCase()===requestedName.toLowerCase());
  if(!caseFoldedName)return path.join(current,...components.slice(index));
  if(!exactName){
   const requestedStat=lstatIfPresent(path.join(current,requestedName));
   const actualStat=lstatIfPresent(path.join(current,caseFoldedName));
   if(!requestedStat||!actualStat||!sameFileEntry(requestedStat,actualStat))
    return path.join(current,...components.slice(index));
  }
  current=path.join(current,caseFoldedName);
  const stat=lstatIfPresent(current);
  if(stat?.isSymbolicLink())return path.join(current,...components.slice(index+1));
 }
 return current;
};
const aliasesScratchRootByEntryIdentity=(trace,rootDir,canonicalRoot)=>{
 const scratchRoots=[path.join(rootDir,'.out'),path.join(canonicalRoot,'.out')];
 for(const prefix of trace.componentPrefixes){
  if(path.basename(prefix).toLowerCase()!=='.out')continue;
  const prefixStat=lstatIfPresent(prefix);
  if(!prefixStat)throw new Error(`path component disappeared while checking scratch alias ${prefix}`);
  for(const scratchRoot of scratchRoots){
   const scratchStat=lstatIfPresent(scratchRoot);
   if(scratchStat&&sameFileEntry(prefixStat,scratchStat))return true;
  }
 }
 return false;
};
const validateScratchTarget=(trace,rootDir,canonicalRoot,{allowRoot=false}={})=>{
 const lexicalScratchRoot=path.join(rootDir,'.out');
 const expectedScratchRoot=path.join(canonicalRoot,'.out');
 const traceEntries=[...trace.candidates,...trace.componentPrefixes,...trace.symlinkPrefixes];
 const pathIndicatesScratch=traceEntries.some(entry=>isSameOrWithin(lexicalScratchRoot,entry)||isSameOrWithin(expectedScratchRoot,entry));
 if(!pathIndicatesScratch&&!aliasesScratchRootByEntryIdentity(trace,rootDir,canonicalRoot))return undefined;
 const scratchRootStat=lstatIfPresent(expectedScratchRoot);
 if(scratchRootStat&&(!scratchRootStat.isDirectory()||scratchRootStat.isSymbolicLink()))
  throw new Error(`scratch root must be a real directory directly beneath ${canonicalRoot}: ${expectedScratchRoot}`);
 const canonicalScratchRoot=scratchRootStat?realPathForDestination(expectedScratchRoot):expectedScratchRoot;
 const resolvedScratchRoot=realPathForDestination(tracePathAliases(lexicalScratchRoot).canonicalTarget);
 if(resolvedScratchRoot!==canonicalScratchRoot)
  throw new Error(`scratch root must resolve to ${canonicalScratchRoot}; resolved to ${resolvedScratchRoot}`);
 if(!isSameOrWithin(canonicalRoot,canonicalScratchRoot))
  throw new Error(`scratch root must remain inside ${canonicalRoot}; resolved to ${canonicalScratchRoot}`);
 const scratchRootStatAfter=lstatIfPresent(expectedScratchRoot);
 if(scratchRootStat){
  if(!scratchRootStatAfter||!sameFileEntry(scratchRootStat,scratchRootStatAfter)||!scratchRootStatAfter.isDirectory()||scratchRootStatAfter.isSymbolicLink())
   throw new Error(`scratch root changed while checking ${expectedScratchRoot}`);
 }else if(scratchRootStatAfter){
  throw new Error(`scratch root appeared while checking ${expectedScratchRoot}`);
 }
 const canonicalTarget=realPathForDestination(trace.canonicalTarget);
 const relative=path.relative(canonicalScratchRoot,canonicalTarget);
 if(!isSameOrWithin(canonicalScratchRoot,canonicalTarget)||(!allowRoot&&relative===''))
  throw new Error(`scratch target must remain${allowRoot?'':' strictly'} inside ${canonicalScratchRoot}; resolved to ${canonicalTarget}`);
 return trace.canonicalTarget;
};
const trackedRelativePaths=(trace,rootDir,canonicalRoot)=>{
 const paths=new Set([...trace.candidates,...trace.symlinkPrefixes,trace.canonicalTarget]);
 const boundaries=new Set([rootDir,canonicalRoot]);
 const relativePaths=new Set();
 const addRelative=(candidate,boundary)=>{
  if(!isSameOrWithin(boundary,candidate))return;
  const relative=path.relative(boundary,candidate);
  if(relative)relativePaths.add(relative.split(path.sep).join('/'));
 };
 for(const candidate of paths)
  for(const boundary of boundaries)addRelative(candidate,boundary);
 for(const candidate of trace.candidates){
  const caseCanonical=canonicalPathWithActualCase(candidate,rootDir,canonicalRoot);
  for(const boundary of boundaries)addRelative(caseCanonical,boundary);
  addRelative(realPathForDestination(candidate),canonicalRoot);
 }
 for(const prefix of trace.symlinkPrefixes){
  const caseCanonical=canonicalPathWithActualCase(prefix,rootDir,canonicalRoot);
  for(const boundary of boundaries)addRelative(caseCanonical,boundary);
  addRelative(realPathForEntryPreservingSymlink(prefix,rootDir,canonicalRoot),canonicalRoot);
 }
 return relativePaths;
};

const realPathForDestination=target=>{
 let existing=path.normalize(path.resolve(target));
 const suffix=[];
 while(true){
  try{
   fs.lstatSync(existing);
  }catch(error){
   const code=error&&typeof error==='object'&&'code'in error?error.code:undefined;
   if(code!=='ENOENT')throw new Error(`could not inspect canonical destination ${existing}: ${error instanceof Error?error.message:String(error)}`);
   const parent=path.dirname(existing);
   if(parent===existing)throw new Error(`could not resolve canonical destination ${target}`);
   suffix.unshift(path.basename(existing));
   existing=parent;
   continue;
  }
  try{
   return path.join(fs.realpathSync(existing),...suffix);
  }catch(error){
   throw new Error(`could not resolve canonical destination ${existing}: ${error instanceof Error?error.message:String(error)}`);
  }
 }
};

const realPathForEntryPreservingSymlink=(entry,rootDir,canonicalRoot)=>{
 const entryStat=lstatIfPresent(entry);
 if(!entryStat||!entryStat.isSymbolicLink())throw new Error(`symlink changed while checking tracked path ${entry}`);
 const actualEntry=canonicalPathWithActualCase(entry,rootDir,canonicalRoot);
 const actualStat=lstatIfPresent(actualEntry);
 if(!actualStat||!actualStat.isSymbolicLink()||!sameFileEntry(entryStat,actualStat))
  throw new Error(`symlink entry changed while checking tracked path ${entry}`);
 return actualEntry;
};

export function canonicalOutputTarget(target){
 const trace=tracePathAliases(target);
 return realPathForDestination(trace.canonicalTarget);
}

export function resolveOutputDir(scriptKey,args,root,env=process.env){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(scriptKey))throw new Error(`invalid output script key: ${scriptKey}`);
 const remaining=[];
 let requestedDir;
 let updateEvidence=false;
 for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(arg==='--update-evidence'){
   updateEvidence=true;
  }else if(arg==='--out-dir'){
   if(i+1>=args.length||args[i+1].startsWith('--'))throw new Error('--out-dir requires a directory');
   requestedDir=args[++i];
  }else if(arg.startsWith('--out-dir=')){
   requestedDir=arg.slice('--out-dir='.length);
   if(!requestedDir)throw new Error('--out-dir requires a directory');
  }else remaining.push(arg);
 }
 const rootDir=path.resolve(root);
 const worktreeId=safeSegment(env.HUMAN3D_WORKTREE_ID||path.basename(rootDir));
 const runId=safeSegment(env.GITHUB_RUN_ID||env.HUMAN3D_RUN_ID||`local-${randomUUID()}`);
 const relativeDefault=path.join('.out',worktreeId,runId,scriptKey);
 const dir=path.resolve(rootDir,requestedDir??relativeDefault);
 if(requestedDir===undefined){
  const canonicalRoot=fs.realpathSync(rootDir);
  const canonicalDir=validateScratchTarget(tracePathAliases(dir),rootDir,canonicalRoot);
  if(!canonicalDir)throw new Error('default output directory must be beneath the repository .out directory');
  return {dir:canonicalDir,args:remaining,updateEvidence};
 }
 return {dir,args:remaining,updateEvidence};
}

export function assertTrackedWriteAllowed(target,{root,updateEvidence=false}){
 const rootDir=path.resolve(root);
 const canonicalRoot=fs.realpathSync(rootDir);
 const absoluteTarget=path.resolve(rootDir,target);
 const trace=tracePathAliases(absoluteTarget);
 const trackedCheckTarget=trace.canonicalTarget;
 try{
  const stat=fs.lstatSync(trackedCheckTarget);
  if(stat.nlink>1)throw new Error(`refusing to overwrite multiply-linked file ${trackedCheckTarget}; link count is ${stat.nlink}`);
 }catch(error){
  const code=error&&typeof error==='object'&&'code'in error?error.code:undefined;
  if(code!=='ENOENT')throw error;
 }
 validateScratchTarget(trace,rootDir,canonicalRoot);
 for(const relativeTarget of trackedRelativePaths(trace,rootDir,canonicalRoot)){
  try{
   execFileSync('git',['ls-files','--error-unmatch','--',`:(literal)${relativeTarget}`],{cwd:rootDir,stdio:'ignore'});
  }catch(error){
   const status=error&&typeof error==='object'&&'status'in error?error.status:undefined;
   if(status===1)continue;
   throw new Error(`could not verify whether ${relativeTarget} is tracked: ${error instanceof Error?error.message:String(error)}`);
  }
  if(!updateEvidence)throw new Error(`refusing to overwrite tracked file ${relativeTarget}; pass --update-evidence to allow this write`);
 }
 return absoluteTarget;
}

export function ensureOutputDir(dir,{root}){
 const absoluteDir=path.resolve(dir);
 const rootDir=path.resolve(root);
 const canonicalRoot=fs.realpathSync(rootDir);
 validateScratchTarget(tracePathAliases(absoluteDir),rootDir,canonicalRoot,{allowRoot:true});
 fs.mkdirSync(absoluteDir,{recursive:true});
 const canonicalRootAfter=fs.realpathSync(rootDir);
 const outputTrace=tracePathAliases(absoluteDir);
 const canonicalDir=outputTrace.canonicalTarget;
 validateScratchTarget(outputTrace,rootDir,canonicalRootAfter,{allowRoot:true});
 if(!fs.statSync(canonicalDir).isDirectory())throw new Error(`output directory is not a directory: ${absoluteDir}`);
 return dir;
}
