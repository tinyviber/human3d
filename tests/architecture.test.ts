import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Workspace boundary enforcement — the rules `docs/ARCHITECTURE.md` states,
 * made executable. Docs and one-off scans cannot hold a boundary while several
 * agents edit the repo; this test fails the build instead.
 *
 * Enforced:
 *  1. `@human3d/motion-core` production code is pure: no `node:` imports, no
 *     DOM globals, and no imports of the apps (only the repo-root
 *     `assets/motions/*.json` registry is allowed to sit outside the package).
 *  2. `apps/web` production code never imports `@human3d/server`.
 *  3. `apps/server` never imports `@human3d/web`.
 *  4. No package-internal deep paths (`@human3d/<pkg>/src/...`) anywhere.
 *  5. Every `@human3d/*` import is declared in the importing package's
 *     package.json (dependencies or devDependencies).
 *
 * Tests are exempt from rules 1–3 (they read fixtures and reuse the server as a
 * harness); they still obey 4–5. */

const ROOT=path.resolve('.');
const CORE='packages/motion-core';
const PKG_DIRS:{dir:string;name:string}[]=[
  {dir:CORE,name:'@human3d/motion-core'},
  {dir:'apps/web',name:'@human3d/web'},
  {dir:'apps/server',name:'@human3d/server'},
];

const walk=(dir:string,out:string[]=[]):string[]=>{
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name);
    if(e.isDirectory())walk(p,out);
    else if(/\.(ts|tsx)$/.test(e.name))out.push(p);
  }
  return out;
};
const files=PKG_DIRS.flatMap(p=>walk(path.join(ROOT,p.dir,'src')));
const isTest=f=>/\.test\.tsx?$/.test(f);
const pkgOf=f=>PKG_DIRS.find(p=>f.startsWith(path.join(ROOT,p.dir)+path.sep))!;
const specifiers=src=>[
  ...[...src.matchAll(/from\s+'([^']+)'/g)].map(m=>m[1]),
  ...[...src.matchAll(/import\(\s*'([^']+)'\s*\)/g)].map(m=>m[1]),
];
/** Comment- and string-stripped source, for global-identifier scanning. */
const stripped=src=>src
  .replace(/'(?:[^'\\\n]|\\.)*'/g,"''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g,'""')
  .replace(/`(?:[^`\\]|\\.)*`/g,'``')
  .replace(/\/\*[\s\S]*?\*\//g,'')
  .replace(/(^|[^:])\/\/[^\n]*/g,'$1');
const rel=(f:string)=>path.relative(ROOT,f);

const violations:string[]=[];
for(const file of files){
  const src=fs.readFileSync(file,'utf8'),specs=specifiers(src),pkg=pkgOf(file);
  for(const s of specs){
    // 4 — no deep package paths
    if(/^@human3d\/[a-z-]+\/src\//.test(s))violations.push(`[deep-path] ${rel(file)} → ${s}`);
    // 5 — declared workspace dependency
    const m=/^(@human3d\/[a-z-]+)(\/|$)/.exec(s);
    if(m){
      const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,pkg.dir,'package.json'),'utf8')) as {
        dependencies?:Record<string,string>;devDependencies?:Record<string,string>;peerDependencies?:Record<string,string>};
      const declared={...manifest.dependencies,...manifest.devDependencies,...manifest.peerDependencies};
      if(!(m[1] in declared))violations.push(`[undeclared] ${rel(file)} → ${s}（${pkg.name} 的 package.json 未声明 ${m[1]}）`);
    }
    if(isTest(file))continue;
    // 1–3 — production-code direction and purity
    if(pkg.name==='@human3d/motion-core'){
      if(s.startsWith('node:'))violations.push(`[core-node] ${rel(file)} → ${s}`);
      if(/^@human3d\/(web|server)(\/|$)/.test(s))violations.push(`[core→app] ${rel(file)} → ${s}`);
      if(s.startsWith('.')){
        const target=path.resolve(path.dirname(file),s);
        if(!target.startsWith(path.join(ROOT,CORE)+path.sep)&&!/assets[\\/]motions[\\/][^\\/]+\.json$/.test(target))
          violations.push(`[core-escape] ${rel(file)} → ${s}（包外路径，仅 assets/motions/*.json 例外）`);
      }
    }
    if(pkg.name==='@human3d/web'&&/^@human3d\/server(\/|$)/.test(s))violations.push(`[web→server] ${rel(file)} → ${s}`);
    if(pkg.name==='@human3d/server'&&/^@human3d\/web(\/|$)/.test(s))violations.push(`[server→web] ${rel(file)} → ${s}`);
  }
  if(!isTest(file)&&pkg.name==='@human3d/motion-core'){
    // Property/type keys named `document` (`{document:WorkshopDoc}`) are data,
    // not the DOM: skip identifiers immediately followed by `:`/`?:`.
    const code=stripped(src),domRe=/(?<![.\w$])(window|document|localStorage|sessionStorage|navigator|HTMLElement|createImageBitmap|requestAnimationFrame)\b/g;
    for(let m;(m=domRe.exec(code));){
      if(/^\s*\??\s*:/.test(code.slice(m.index+m[0].length)))continue;
      violations.push(`[core-dom] ${rel(file)} 使用了 DOM 全局 ${m[1]}`);
      break;
    }
  }
}

describe('workspace boundaries (docs/ARCHITECTURE.md, enforced)',()=>{
  it('scans every workspace source file',()=>{
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(f=>f.includes('packages/motion-core/src/solver.ts'))).toBe(true);
    expect(files.some(f=>f.includes('apps/web/src/lab/engine.ts'))).toBe(true);
    expect(files.some(f=>f.includes('apps/server/src/service.ts'))).toBe(true);
  });
  it('has no boundary violations',()=>{
    expect(violations,`\n${violations.join('\n')}\n`).toEqual([]);
  });
});
