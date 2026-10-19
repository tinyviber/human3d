import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const inside=(root,target)=>{
 const relative=path.relative(root,target);
 return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative));
};
const realOrResolved=value=>{
 let current=path.resolve(value);
 const suffix=[];
 while(true){
  try{
   fs.lstatSync(current);
  }catch(error){
   const code=error&&typeof error==='object'&&'code'in error?error.code:undefined;
   if(code!=='ENOENT'&&code!=='ENOTDIR')
    throw new Error(`could not inspect path ${current}: ${error instanceof Error?error.message:String(error)}`);
   const parent=path.dirname(current);
   if(parent===current)throw new Error(`could not resolve path ${value}`);
   suffix.unshift(path.basename(current));
   current=parent;
   continue;
  }
  let resolvedAncestor;
  try{
   resolvedAncestor=fs.realpathSync(current);
  }catch(error){
   throw new Error(`could not resolve existing path ancestor ${current}: ${error instanceof Error?error.message:String(error)}`);
  }
  if(suffix.length){
   let stat;
   try{
    stat=fs.statSync(resolvedAncestor);
   }catch(error){
    throw new Error(`could not inspect resolved path ancestor ${resolvedAncestor}: ${error instanceof Error?error.message:String(error)}`);
   }
   if(!stat.isDirectory())throw new Error(`resolved path ancestor is not a directory: ${resolvedAncestor}`);
  }
  return path.join(resolvedAncestor,...suffix);
 }
};

export function validateWorktreePath(repoRoot,worktreeRoot){
 const source=realOrResolved(repoRoot);
 const worktree=realOrResolved(worktreeRoot);
 const issues=[];
 if(inside(source,worktree))issues.push(`worktree ${worktree} must be outside source root ${source}`);
 return {ok:issues.length===0,issues};
}

const workspacePackageDirs=root=>{
 const manifestPath=path.join(root,'package.json');
 let manifest;
 try{manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));}
 catch(error){throw new Error(`could not read workspace manifest ${manifestPath}: ${error instanceof Error?error.message:String(error)}`);}
 const dirs=new Map();
 for(const pattern of manifest.workspaces??[]){
  if(typeof pattern!=='string'||pattern.includes('**'))continue;
  const star=pattern.indexOf('*');
  if(star<0){
   let name;
   try{name=JSON.parse(fs.readFileSync(path.join(root,pattern,'package.json'),'utf8')).name;}
   catch{continue;}
   if(typeof name==='string'&&name)dirs.set(name,path.join(root,pattern));
   continue;
  }
  const parentDir=path.join(root,pattern.slice(0,star));
  let entries;
  try{entries=fs.readdirSync(parentDir,{withFileTypes:true});}catch{continue;}
  for(const entry of entries){
   if(!entry.isDirectory())continue;
   let name;
   try{name=JSON.parse(fs.readFileSync(path.join(parentDir,entry.name,'package.json'),'utf8')).name;}
   catch{continue;}
   if(typeof name==='string'&&name)dirs.set(name,path.join(parentDir,entry.name));
  }
 }
 return dirs;
};

export function validateWorkspaceLinks(worktreeRoot,workspaceNames){
 const root=realOrResolved(worktreeRoot);
 const issues=[];
 let packages;
 try{packages=workspacePackageDirs(root);}
 catch(error){return {ok:false,issues:[error instanceof Error?error.message:String(error)]};}
 for(const name of workspaceNames){
  const scoped=name.startsWith('@')?name:`@human3d/${name}`;
  const link=path.join(root,'node_modules','@human3d',scoped.replace(/^@[^/]+\//,''));
  let resolved;
  try{resolved=fs.realpathSync(link);}catch{
   issues.push(`missing workspace link ${path.relative(root,link)}; run npm ci inside this worktree`);
   continue;
  }
  if(!inside(root,resolved)){
   issues.push(`workspace link ${path.relative(root,link)} resolves outside worktree: ${resolved}`);
   continue;
  }
  const expected=packages.get(scoped);
  if(!expected){
   issues.push(`workspace ${scoped} is not declared in ${path.join(root,'package.json')} workspaces`);
   continue;
  }
  const expectedResolved=realOrResolved(expected);
  if(resolved!==expectedResolved){
   issues.push(`workspace link ${path.relative(root,link)} resolves to ${resolved}, expected ${expectedResolved}`);
   continue;
  }
  let manifestName;
  try{manifestName=JSON.parse(fs.readFileSync(path.join(resolved,'package.json'),'utf8')).name;}
  catch{issues.push(`workspace link target ${resolved} has no readable package.json`);continue;}
  if(manifestName!==scoped)
   issues.push(`workspace link ${path.relative(root,link)} resolves to package ${manifestName??'<unnamed>'}, expected ${scoped}`);
 }
 return {ok:issues.length===0,issues};
}

export function assertPortAvailable(host,port){
 if(typeof host!=='string'||!host)throw new TypeError('host must be a non-empty string');
 if(!Number.isInteger(port)||port<1||port>65535)throw new RangeError(`invalid port: ${port}`);
 return new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.once('error',error=>{
   if(error.code==='EADDRINUSE'){
    error.message=`${host}:${port} is already in use; choose distinct HUMAN3D_WEB_PORT, HUMAN3D_PREVIEW_PORT, and HUMAN3D_PORT values (for example 5174, 4174, and 8789)`;
   }
   reject(error);
  });
  server.listen({host,port,exclusive:true},()=>{
   server.close(error=>error?reject(error):resolve({host,port,available:true}));
  });
 });
}
