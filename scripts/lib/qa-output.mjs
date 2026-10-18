import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const safeSegment=value=>String(value).replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^[-.]+|[-.]+$/g,'')||'unknown';
const realPathForTarget=target=>{
 const missing=[];
 let cursor=target;
 while(!fs.existsSync(cursor)){
  const parent=path.dirname(cursor);
  if(parent===cursor)return target;
  missing.unshift(path.basename(cursor));
  cursor=parent;
 }
 return path.resolve(fs.realpathSync(cursor),...missing);
};

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
 return {dir,args:remaining,updateEvidence};
}

export function assertTrackedWriteAllowed(target,{root,updateEvidence=false}){
 const rootDir=path.resolve(root);
 const canonicalRoot=fs.realpathSync(rootDir);
 const absoluteTarget=path.resolve(rootDir,target);
 const trackedCheckTarget=realPathForTarget(absoluteTarget);
 const relativeTarget=path.relative(canonicalRoot,trackedCheckTarget);
 if(relativeTarget==='..'||relativeTarget.startsWith(`..${path.sep}`)||path.isAbsolute(relativeTarget))return absoluteTarget;
 try{
  execFileSync('git',['ls-files','--error-unmatch','--',relativeTarget],{cwd:rootDir,stdio:'ignore'});
  if(!updateEvidence)throw new Error(`refusing to overwrite tracked file ${relativeTarget}; pass --update-evidence to allow this write`);
 }catch(error){
  if(error instanceof Error&&error.message.startsWith('refusing to overwrite tracked file'))throw error;
  const status=error&&typeof error==='object'&&'status'in error?error.status:undefined;
  if(status!==1)throw new Error(`could not verify whether ${relativeTarget} is tracked: ${error instanceof Error?error.message:String(error)}`);
 }
 return absoluteTarget;
}

export function ensureOutputDir(dir){
 fs.mkdirSync(dir,{recursive:true});
 return dir;
}
