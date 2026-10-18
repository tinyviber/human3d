import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {collectDomUses,collectModuleSpecifiers,findViolations,type SourceFileLike} from './architecture-boundaries';

/** Workspace boundary enforcement — the rules `docs/ARCHITECTURE.md` states,
 * made executable. Docs and one-off scans cannot hold a boundary while several
 * agents edit the repo; this test fails the build instead.
 *
 * The checker is AST-based (TypeScript Compiler API), so no import form dodges
 * it: single/double quotes, side-effect imports, re-exports, literal dynamic
 * imports and `import('…').T` type nodes are all read from the syntax tree, and
 * DOM globals are found as identifiers in expression position (including
 * `globalThis.window`), not by text search. The checker has its own unit
 * coverage below — a guard that cannot fail is not a guard. */

const ROOT=path.resolve('.');
const CORE='packages/motion-core';
const PACKAGES=[
  {dir:CORE,name:'@human3d/motion-core'},
  {dir:'apps/web',name:'@human3d/web'},
  {dir:'apps/server',name:'@human3d/server'},
];
const opts={root:ROOT,packages:PACKAGES};

const walk=(dir:string,out:string[]=[]):string[]=>{
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name);
    if(e.isDirectory())walk(p,out);
    else if(/\.(ts|tsx)$/.test(e.name))out.push(p);
  }
  return out;
};

/** A synthetic file inside a real package, so manifest lookups stay real. */
const synth=(pkgDir:string,name:string,source:string):SourceFileLike=>({file:path.join(ROOT,pkgDir,'src',name),source});
const check=(files:SourceFileLike[])=>findViolations(files,opts);

describe('boundary checker — syntax coverage',()=>{
  const cases:[string,SourceFileLike,RegExp][]=[
    ['single-quoted static import',synth('apps/web','a.ts',`import {x} from '@human3d/server';`),/\[web→server\]/],
    ['double-quoted static import',synth('apps/web','a.ts',`import {x} from "@human3d/server";`),/\[web→server\]/],
    ['side-effect import of node:',synth(CORE,'a.ts',`import 'node:fs';`),/\[core-node\]/],
    ['literal dynamic import',synth('apps/server','a.ts',`const m=await import('@human3d/web');`),/\[server→web\]/],
    ['import type',synth('apps/server','a.ts',`import type {X} from '@human3d/web';`),/\[server→web\]/],
    ['inline type specifier',synth('apps/server','a.ts',`import {type X} from '@human3d/web';`),/\[server→web\]/],
    ['re-export',synth('apps/server','a.ts',`export * from '@human3d/web';`),/\[server→web\]/],
    ['import() type node',synth('apps/server','a.ts',`type T=import('@human3d/web').X;`),/\[server→web\]/],
    ['deep path',synth('apps/web','a.ts',`import {rig} from '@human3d/motion-core/src/rig';`),/\[deep-path\]/],
    ['undeclared workspace dep',synth('apps/server','a.ts',`import {x} from '@human3d/web';`),/\[server→web\]|\[undeclared\]/],
    ['core escaping its package',synth(CORE,'a.ts',`import x from '../../../../scripts/lib/filereader-shim.mts';`),/\[core-escape\]/],
    ['globalThis.window',synth(CORE,'a.ts',`const w=globalThis.window;`),/\[core-dom\].*window/],
    ["globalThis['document']",synth(CORE,'a.ts',`const d=globalThis['document'];`),/\[core-dom\].*document/],
    ['bare DOM identifier',synth(CORE,'a.ts',`const w=window.innerWidth;`),/\[core-dom\].*window/],
    ['createImageBitmap in core',synth(CORE,'a.ts',`const b=await createImageBitmap(blob);`),/\[core-dom\]/],
    ['a DOM name in expression position even when locally bound (conservative)',
      synth(CORE,'a.ts',`export const f=(window:{title:string})=>window.title;`),/\[core-dom\].*window/],
  ];
  for(const [name,file,pattern] of cases)
    it(`flags ${name}`,()=>{expect(check([file]).join('\n')).toMatch(pattern);});

  const clean:[string,SourceFileLike][]=[
    ['a property/type key named document',synth(CORE,'a.ts',`export type S={document:{duration:number}};`)],
    ['a property access named document',synth(CORE,'a.ts',`export const d=(x:{document:{duration:number}})=>x.document.duration;`)],
    ['the string "@human3d/server"',synth('apps/web','a.ts',`export const s='@human3d/server';`)],
    ['a comment mentioning window.',synth(CORE,'a.ts',`/** inside the active window. */\nexport const n=1;`)],
    ['core reading the root envelope registry',synth(CORE,'a.ts',`import idle from '../../../assets/motions/idle.json';`)],
    ['core importing three',synth(CORE,'a.ts',`import {Vector3} from 'three';`)],
    ['a test file importing the server package',synth('apps/web','a.test.ts',`import {createService} from '@human3d/server';`)],
    ['web importing its own workspace dependency',synth('apps/web','a.ts',`import {rig} from '@human3d/motion-core';`)],
  ];
  for(const [name,file] of clean)
    it(`accepts ${name}`,()=>{expect(check([file]),check([file]).join('\n')).toEqual([]);});
});

describe('boundary checker — extraction units',()=>{
  it('collects every specifier form and reports its line',()=>{
    const src=[`import a from 'x';`,`import {b} from "y";`,`import 'z';`,`export * from 'w';`,
      `const c=await import('d');`,`type T=import('e').F;`].join('\n');
    expect(collectModuleSpecifiers('f.ts',src).map(s=>s.specifier)).toEqual(['x','y','z','w','d','e']);
    expect(collectModuleSpecifiers('f.ts',src).map(s=>s.line)).toEqual([1,2,3,4,5,6]);
  });
  it('separates DOM uses from data positions',()=>{
    const src=[`const ok={document:1};`,`const no=window.title;`,`const g=globalThis.document;`,`const p=x.document;`].join('\n');
    expect(collectDomUses('f.ts',src).map(u=>`${u.name}@${u.line}`)).toEqual(['window@2','document@3']);
  });
});

describe('workspace boundaries (docs/ARCHITECTURE.md, enforced)',()=>{
  const files=walk(path.join(ROOT,CORE,'src')).concat(
    walk(path.join(ROOT,'apps/web','src')),walk(path.join(ROOT,'apps/server','src')))
    .map(file=>({file,source:fs.readFileSync(file,'utf8')}));
  it('scans every workspace source file',()=>{
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(f=>f.file.endsWith('packages/motion-core/src/solver.ts'))).toBe(true);
    expect(files.some(f=>f.file.endsWith('apps/web/src/lab/engine.ts'))).toBe(true);
    expect(files.some(f=>f.file.endsWith('apps/server/src/service.ts'))).toBe(true);
  });
  it('has no boundary violations',()=>{
    const violations=findViolations(files,opts);
    expect(violations,`\n${violations.join('\n')}\n`).toEqual([]);
  });
});
