import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const inside=(root,target)=>{
 const relative=path.relative(root,target);
 return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative));
};
const realOrResolved=value=>{
 const absolute=path.resolve(value);
 try{return fs.realpathSync(absolute);}catch{return absolute;}
};

export function validateWorktreePath(repoRoot,worktreeRoot){
 const source=realOrResolved(repoRoot);
 const worktree=realOrResolved(worktreeRoot);
 const issues=[];
 if(inside(source,worktree))issues.push(`worktree ${worktree} must be outside source root ${source}`);
 return {ok:issues.length===0,issues};
}

export function validateWorkspaceLinks(worktreeRoot,workspaceNames){
 const root=realOrResolved(worktreeRoot);
 const issues=[];
 for(const name of workspaceNames){
  const link=path.join(root,'node_modules','@human3d',name);
  let resolved;
  try{resolved=fs.realpathSync(link);}catch{
   issues.push(`missing workspace link ${path.relative(root,link)}; run npm ci inside this worktree`);
   continue;
  }
  if(!inside(root,resolved))issues.push(`workspace link ${path.relative(root,link)} resolves outside worktree: ${resolved}`);
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
