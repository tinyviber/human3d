import {afterEach,describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';

const repoRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checkerSource=path.join(repoRoot,'scripts','check-docs-links.mjs');

const tempDirs:string[]=[];
const tempDir=()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'human3d-docs-links-'));
 tempDirs.push(dir);
 return dir;
};
afterEach(()=>{
 for(const dir of tempDirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});
});

// The checker resolves its root from its own location, so the real script is
// copied into a scratch git repo — the same real-path pattern as
// affected-checks fixtures.
const prepareRepo=(files:Record<string,string>)=>{
 const root=tempDir();
 execFileSync('git',['-C',root,'init','-q']);
 execFileSync('git',['-C',root,'config','user.name','test']);
 execFileSync('git',['-C',root,'config','user.email','test@example.com']);
 fs.mkdirSync(path.join(root,'scripts'),{recursive:true});
 // The real ALLOWLIST entries reference files absent from the fixture repo
 // (they would count as stale exemptions); strip the list — scanning logic is
 // untouched.
 const source=fs.readFileSync(checkerSource,'utf8').replace(/const ALLOWLIST = \[[\s\S]*?\];/,'const ALLOWLIST = [];');
 fs.writeFileSync(path.join(root,'scripts','check-docs-links.mjs'),source);
 for(const [name,content] of Object.entries(files)){
  const target=path.join(root,name);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,content);
 }
 execFileSync('git',['-C',root,'add','-A']);
 return root;
};

const runChecker=(root:string)=>spawnSync(process.execPath,[path.join(root,'scripts','check-docs-links.mjs')],{cwd:root,encoding:'utf8'});

describe('check-docs-links coverage',()=>{
 it('passes a clean markdown set',()=>{
  const root=prepareRepo({'a.md':'[b](b.md)\n','b.md':'# b\n'});
  const result=runChecker(root);
  expect(result.status).toBe(0);
 });

 it('reports a dead link in a .md file',()=>{
  const root=prepareRepo({'a.md':'[b](missing.md)\n'});
  const result=runChecker(root);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('[DEAD] a.md:1 -> missing.md');
 });

 // Selector parity (PR-11B): classifyChangedPath maps *.mdx to the docs
 // category — the checker must actually enumerate .mdx, or an .mdx dead link
 // would pass while being charged as a docs check.
 it('reports a dead link in a .mdx file and counts the file',()=>{
  const root=prepareRepo({'a.mdx':'[b](missing.md)\n','b.md':'# b\n'});
  const result=runChecker(root);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('[DEAD] a.mdx:1 -> missing.md');
  expect(result.stdout).toContain('检查 2 个 Markdown 文件');
 });

 it('also covers un-traked-but-unignored .mdx files',()=>{
  const root=prepareRepo({'b.md':'# b\n'});
  fs.writeFileSync(path.join(root,'new.mdx'),'[b](missing.md)\n');
  const result=runChecker(root);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('[DEAD] new.mdx:1 -> missing.md');
 });
});
