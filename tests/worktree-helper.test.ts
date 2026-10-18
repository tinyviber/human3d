import {afterEach,describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {validateWorktreePath,validateWorkspaceLinks,assertPortAvailable} from '../scripts/lib/worktree-check.mjs';

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

function makeWorkspaceLinks(worktreeRoot:string,escapeWorkspace?:string){
 const packages={
  'motion-core':'packages/motion-core',
  'web':'apps/web',
  'server':'apps/server',
 } as const;
 for(const [name,relativeTarget] of Object.entries(packages)){
  const target=name===escapeWorkspace?path.join(path.dirname(worktreeRoot),'outside-workspace'):path.join(worktreeRoot,relativeTarget);
  fs.mkdirSync(target,{recursive:true});
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
