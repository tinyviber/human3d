import {afterEach,describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {validateWorktreePath,validateWorkspaceLinks,assertPortAvailable,verifyWebIdentity} from '../scripts/lib/worktree-check.mjs';
import {createServer as createHttpServer} from 'node:http';
import type {AddressInfo} from 'node:net';

const WORKSPACES=['motion-core','web','server'];
const tempDirs:string[]=[];
const tempDir=()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'human3d-worktree-helper-'));
 tempDirs.push(dir);
 return dir;
};
afterEach(()=>{
 for(const dir of tempDirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});
});

const PACKAGE_DIRS={
 'motion-core':'packages/motion-core',
 'web':'apps/web',
 'server':'apps/server',
} as const;

function makeWorkspaceLinks(worktreeRoot:string,escapeWorkspace?:string,swapTarget?:string){
 fs.writeFileSync(path.join(worktreeRoot,'package.json'),JSON.stringify({workspaces:['apps/*','packages/*']}));
 for(const [name,relativeTarget] of Object.entries(PACKAGE_DIRS)){
  const declared=path.join(worktreeRoot,relativeTarget);
  fs.mkdirSync(declared,{recursive:true});
  fs.writeFileSync(path.join(declared,'package.json'),JSON.stringify({name:`@human3d/${name}`}));
  const target=name===escapeWorkspace
   ?path.join(path.dirname(worktreeRoot),'outside-workspace')
   :name===swapTarget
    ?path.join(worktreeRoot,Object.values(PACKAGE_DIRS).find(d=>d!==relativeTarget)!)
    :declared;
  if(name===swapTarget)fs.mkdirSync(target,{recursive:true});
  const link=path.join(worktreeRoot,'node_modules','@human3d',name);
  fs.mkdirSync(path.dirname(link),{recursive:true});
  fs.symlinkSync(target,link,'dir');
 }
}

describe('worktree path isolation',()=>{
 it('accepts a worktree located beside the source repository',()=>{
  const base=tempDir();
  const repoRoot=path.join(base,'source');
  const worktreeRoot=path.join(base,'issue-branch');
  const result=validateWorktreePath(repoRoot,worktreeRoot);
  expect(result.ok).toBe(true);
  expect(result.issues).toEqual([]);
 });

 it('rejects a missing child beneath an alias to the source repository deterministically',()=>{
   const base=tempDir();
   const repoRoot=path.join(base,'source');
   const sourceAlias=path.join(base,'source-alias');
   const worktreeRoot=path.join(sourceAlias,'missing-worktree');
   fs.mkdirSync(repoRoot,{recursive:true});
   fs.symlinkSync(repoRoot,sourceAlias,'dir');

   const first=validateWorktreePath(repoRoot,worktreeRoot);
   const second=validateWorktreePath(repoRoot,worktreeRoot);
   expect(first.ok).toBe(false);
   expect(first.issues.length).toBeGreaterThan(0);
   expect(second).toEqual(first);
   expect(fs.existsSync(worktreeRoot)).toBe(false);
   expect(fs.existsSync(path.join(repoRoot,'missing-worktree'))).toBe(false);
  });

  it('fails closed when a missing worktree child follows a symlink to a regular file',()=>{
   const base=tempDir();
   const repoRoot=path.join(base,'source');
   const sourceFile=path.join(base,'source-file');
   const fileAlias=path.join(base,'file-alias');
   const worktreeRoot=path.join(fileAlias,'missing-worktree');
   fs.mkdirSync(repoRoot,{recursive:true});
   fs.writeFileSync(sourceFile,'not a directory');
   fs.symlinkSync(sourceFile,fileAlias);

   expect(()=>validateWorktreePath(repoRoot,worktreeRoot)).toThrow(/resolved path ancestor is not a directory/);
   expect(fs.existsSync(worktreeRoot)).toBe(false);
  });

  it('throws when a worktree path has a dangling symlink ancestor',()=>{
   const base=tempDir();
   const repoRoot=path.join(base,'source');
   const missingTarget=path.join(base,'missing-target');
   const danglingAncestor=path.join(base,'dangling-alias');
   const worktreeRoot=path.join(danglingAncestor,'issue-branch');
   fs.mkdirSync(repoRoot,{recursive:true});
   fs.symlinkSync(missingTarget,danglingAncestor,'dir');

   expect(()=>validateWorktreePath(repoRoot,worktreeRoot)).toThrow(/could not resolve existing path ancestor/);
   expect(fs.existsSync(missingTarget)).toBe(false);
   expect(fs.existsSync(worktreeRoot)).toBe(false);
  });

 it.each(['same root','nested under source'])('rejects a worktree path that is %s',kind=>{
  const base=tempDir();
  const repoRoot=path.join(base,'source');
  const worktreeRoot=kind==='same root'?repoRoot:path.join(repoRoot,'nested','worktree');
  const result=validateWorktreePath(repoRoot,worktreeRoot);
  expect(result.ok).toBe(false);
  expect(result.issues.length).toBeGreaterThan(0);
 });
});

describe('workspace dependency link isolation',()=>{
 it('accepts workspace links that resolve inside the worktree',()=>{
  const base=tempDir();
  const worktreeRoot=path.join(base,'worktree');
  fs.mkdirSync(worktreeRoot,{recursive:true});
  makeWorkspaceLinks(worktreeRoot);
  const result=validateWorkspaceLinks(worktreeRoot,WORKSPACES);
  expect(result.ok).toBe(true);
  expect(result.issues).toEqual([]);
 });

 it('rejects a workspace link that resolves outside the worktree',()=>{
  const base=tempDir();
  const worktreeRoot=path.join(base,'worktree');
  fs.mkdirSync(worktreeRoot,{recursive:true});
  makeWorkspaceLinks(worktreeRoot,'web');
  const result=validateWorkspaceLinks(worktreeRoot,WORKSPACES);
  expect(result.ok).toBe(false);
  expect(result.issues.length).toBeGreaterThan(0);
 });

 it('rejects a workspace link resolving to the wrong in-worktree package dir',()=>{
  const base=tempDir();
  const worktreeRoot=path.join(base,'worktree');
  fs.mkdirSync(worktreeRoot,{recursive:true});
  makeWorkspaceLinks(worktreeRoot,undefined,'motion-core');
  const result=validateWorkspaceLinks(worktreeRoot,WORKSPACES);
  expect(result.ok).toBe(false);
  expect(result.issues.some(i=>i.includes('motion-core')&&i.includes('expected'))).toBe(true);
 });
});

describe('web dev-server identity',()=>{
 const writeProtocol=(root:string,version:string)=>{
  const file=path.join(root,'packages/motion-core/src/protocol.ts');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,`export const SERVICE_VERSION='${version}';\n`);
  return file;
 };
 // Vite serves /@fs/<abs> only under server.fs.allow; a foreign worktree's
 // server must answer non-200 for paths outside its root.
 const fakeVite=(allowedRoot:string,body:string)=>{
  const server=createHttpServer((req,res)=>{
   const url=new URL(req.url??'/','http://127.0.0.1');
   if(!url.pathname.startsWith('/@fs/')){res.writeHead(404);res.end();return;}
   const target=decodeURIComponent(url.pathname.slice('/@fs'.length));
   if(!target.startsWith(allowedRoot)){res.writeHead(403);res.end();return;}
   res.writeHead(200,{'content-type':'text/javascript'});res.end(body);
  });
  return new Promise<{url:string,close:()=>Promise<void>}>((resolve,reject)=>{
   server.once('error',reject);
   server.listen(0,'127.0.0.1',()=>{
    const {port}=(server.address() as AddressInfo);
    resolve({url:`http://127.0.0.1:${port}/`,close:()=>new Promise<void>((res,rej)=>server.close(e=>e?rej(e):res()))});
   });
  });
 };

 it('accepts a dev server that serves this checkout files',async()=>{
  const root=tempDir();
  const file=writeProtocol(root,'0.4.0');
  const vite=await fakeVite(root,`export const SERVICE_VERSION = "0.4.0";`);
  try{
   const result=await verifyWebIdentity(root,vite.url);
   expect(result.ok).toBe(true);
  }finally{await vite.close();}
  expect(fs.existsSync(file)).toBe(true);
 });

 it('rejects a dev server that refuses the checkout path (foreign worktree)',async()=>{
  const root=tempDir();
  writeProtocol(root,'0.4.0');
  const foreignRoot=path.join(tempDir(),'foreign');
  const vite=await fakeVite(foreignRoot,'export const SERVICE_VERSION = "0.4.0";');
  try{
   const result=await verifyWebIdentity(root,vite.url);
   expect(result.ok).toBe(false);
   expect(result.detail).toContain('403');
  }finally{await vite.close();}
 });

 it('rejects when the served file lacks this checkout version',async()=>{
  const root=tempDir();
  writeProtocol(root,'0.4.0');
  const vite=await fakeVite(root,`export const SERVICE_VERSION = "0.3.0";`);
  try{
   const result=await verifyWebIdentity(root,vite.url);
   expect(result.ok).toBe(false);
   expect(result.detail).toContain('0.4.0');
  }finally{await vite.close();}
 });

 it('rejects when nothing answers on the port',async()=>{
  const root=tempDir();
  writeProtocol(root,'0.4.0');
  const reservation=createServer();
  await new Promise<void>((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const {port}=(reservation.address() as AddressInfo);
  await new Promise<void>((resolve,reject)=>reservation.close(e=>e?reject(e):resolve()));
  const result=await verifyWebIdentity(root,`http://127.0.0.1:${port}/`);
  expect(result.ok).toBe(false);
 });
});

describe('port conflict detection',()=>{
 it('rejects an occupied host/port with EADDRINUSE',async()=>{
  const host='127.0.0.1';
  const reservation=createServer();
  await new Promise<void>((resolve,reject)=>{
   reservation.once('error',reject);
   reservation.listen(0,host,resolve);
  });
  const address=reservation.address();
  if(!address||typeof address==='string')throw new Error('expected an internet socket address');
  try{
   await expect(assertPortAvailable(host,address.port)).rejects.toMatchObject({code:'EADDRINUSE'});
  }finally{
   await new Promise<void>((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  }
 });
});
