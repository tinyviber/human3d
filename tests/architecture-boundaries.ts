import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Boundary checker behind `tests/architecture.test.ts` — AST-based, so the
 * rules cannot be dodged by quoting or import form. Extracted from the test so
 * the checker itself can be unit-tested with synthetic sources.
 *
 * Covered syntax: static imports (`import x from '…'`, `import {a} from "…"`,
 * `import '…'` side-effect form), re-exports (`export … from '…'`), literal
 * dynamic imports (`import('…')`) and `import('…').T` type nodes.
 *
 * Covered rules: package purity and direction, declared workspace dependencies,
 * package-internal deep paths, and — for every workspace, not just core —
 * relative paths that leave the importing package (a relative path is a
 * dependency like any other).
 *
 * Known limits (a deliberate, documented line — the alternative is a compiler
 * plugin): dynamic imports built from variables (`import(name)`), and DOM access
 * through an alias (`const g = globalThis; g.window`). */

/** DOM globals that must never appear in motion-core production code. Node 18+
 * also ships `fetch`/`Blob`/`TextEncoder`, so those are NOT in the list. */
export const DOM_GLOBALS=new Set([
  'window','document','localStorage','sessionStorage','navigator','location','self',
  'HTMLElement','HTMLCanvasElement','Image','XMLHttpRequest','FileReader',
  'createImageBitmap','requestAnimationFrame','cancelAnimationFrame',
]);

export interface Specifier{specifier:string;line:number}
export interface DomUse{name:string;line:number}
export interface SourceFileLike{file:string;source:string}
export interface PackageDir{dir:string;name:string}

const parse=(file:string,source:string)=>ts.createSourceFile(file,source,ts.ScriptTarget.ESNext,true,
  /\.tsx$/.test(file)?ts.ScriptKind.TSX:ts.ScriptKind.TS);

const lineOf=(sf:ts.SourceFile,node:ts.Node)=>sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1;

/** Every module specifier the file resolves at build time, whatever the syntax. */
export function collectModuleSpecifiers(file:string,source:string):Specifier[]{
  const sf=parse(file,source),out:Specifier[]=[];
  const visit=(node:ts.Node)=>{
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){
      const ms=node.moduleSpecifier;
      if(ms&&ts.isStringLiteral(ms))out.push({specifier:ms.text,line:lineOf(sf,ms)});
    }else if(ts.isImportTypeNode(node)){
      const arg=node.argument;
      if(ts.isLiteralTypeNode(arg)&&ts.isStringLiteral(arg.literal))out.push({specifier:arg.literal.text,line:lineOf(sf,arg.literal)});
    }else if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){
      const arg=node.arguments[0];
      if(arg&&ts.isStringLiteral(arg))out.push({specifier:arg.text,line:lineOf(sf,arg)});
    }
    ts.forEachChild(node,visit);
  };
  visit(sf);
  return out;
}

const isPropertyName=(node:ts.Node)=>{
  const p=node.parent;
  return (ts.isPropertyAccessExpression(p)&&p.name===node)
    ||(ts.isPropertyAssignment(p)&&p.name===node)
    ||(ts.isPropertySignature(p)&&p.name===node)
    ||(ts.isPropertyDeclaration(p)&&p.name===node)
    ||(ts.isMethodDeclaration(p)&&p.name===node)
    ||(ts.isMethodSignature(p)&&p.name===node)
    ||(ts.isQualifiedName(p)&&p.right===node)
    ||(ts.isBindingElement(p)&&p.propertyName===node)
    ||(ts.isImportSpecifier(p)&&p.propertyName===node)
    ||(ts.isExportSpecifier(p)&&p.propertyName===node);
};
const isDeclarationName=(node:ts.Node)=>{
  const p=node.parent as {name?:ts.Node};
  return ((ts.isVariableDeclaration(p as ts.Node)||ts.isParameter(p as ts.Node)||ts.isFunctionDeclaration(p as ts.Node)
    ||ts.isClassDeclaration(p as ts.Node)||ts.isInterfaceDeclaration(p as ts.Node)||ts.isTypeAliasDeclaration(p as ts.Node)
    ||ts.isEnumDeclaration(p as ts.Node)||ts.isBindingElement(p as ts.Node)||ts.isFunctionExpression(p as ts.Node)
    ||ts.isClassExpression(p as ts.Node)||ts.isMethodDeclaration(p as ts.Node)||ts.isPropertyDeclaration(p as ts.Node)
    ||ts.isPropertySignature(p as ts.Node)||ts.isImportSpecifier(p as ts.Node)||ts.isImportClause(p as ts.Node)
    ||ts.isNamespaceImport(p as ts.Node)||ts.isModuleDeclaration(p as ts.Node)||ts.isEnumMember(p as ts.Node)
    ||ts.isTypeParameterDeclaration(p as ts.Node))&&p.name===node);
};
/** DOM global *uses* — identifiers in expression position, plus any access
 * through `globalThis` (`globalThis.window`, `globalThis['document']`). Property
 * and declaration names are data, not the DOM: `{document: WorkshopDoc}` and
 * `doc.document` do not count. Conservative on purpose: a DOM-named identifier
 * in expression position is flagged even when locally bound — shadowing
 * `window`/`document` inside motion-core is itself worth failing on. */
export function collectDomUses(file:string,source:string):DomUse[]{
  const sf=parse(file,source),out:DomUse[]=[];
  const visit=(node:ts.Node)=>{
    if(ts.isIdentifier(node)&&DOM_GLOBALS.has(node.text)&&!isPropertyName(node)&&!isDeclarationName(node))
      out.push({name:node.text,line:lineOf(sf,node)});
    if(ts.isPropertyAccessExpression(node)&&DOM_GLOBALS.has(node.name.text)&&node.expression.getText(sf).includes('globalThis'))
      out.push({name:node.name.text,line:lineOf(sf,node)});
    if(ts.isElementAccessExpression(node)&&ts.isStringLiteral(node.argumentExpression)
      &&DOM_GLOBALS.has(node.argumentExpression.text)&&node.expression.getText(sf).includes('globalThis'))
      out.push({name:node.argumentExpression.text,line:lineOf(sf,node)});
    ts.forEachChild(node,visit);
  };
  visit(sf);
  return out;
}

const isTest=(file:string)=>/\.test\.tsx?$/.test(file);
/** The one documented escape hatch: the toolchain-owned envelope registry that
 * lives at the repo root (see docs/ARCHITECTURE.md「已知泄漏」). */
const REGISTRY=/assets[\\/]motions[\\/][^\\/]+\.json$/;

export interface BoundaryOptions{root:string;packages:PackageDir[]}
/** Violations as human-readable strings; empty means the boundaries hold. */
export function findViolations(files:SourceFileLike[],{root,packages}:BoundaryOptions):string[]{
  const rel=(f:string)=>path.relative(root,f);
  const pkgOf=(f:string)=>packages.find(p=>f.startsWith(path.join(root,p.dir)+path.sep));
  const out:string[]=[];
  for(const {file,source} of files){
    const pkg=pkgOf(file);
    if(!pkg)continue;
    const test=isTest(file);
    const manifest=JSON.parse(fs.readFileSync(path.join(root,pkg.dir,'package.json'),'utf8')) as {
      dependencies?:Record<string,string>;devDependencies?:Record<string,string>;peerDependencies?:Record<string,string>};
    const declared={...manifest.dependencies,...manifest.devDependencies,...manifest.peerDependencies};
    for(const {specifier,line} of collectModuleSpecifiers(file,source)){
      const where=`${rel(file)}:${line}`;
      if(/^@human3d\/[a-z-]+\/src\//.test(specifier))out.push(`[deep-path] ${where} → ${specifier}`);
      const m=/^(@human3d\/[a-z-]+)(\/|$)/.exec(specifier);
      if(m&&!(m[1] in declared))out.push(`[undeclared] ${where} → ${specifier}（${pkg.name} 的 package.json 未声明 ${m[1]}）`);
      if(test)continue;
      if(pkg.name==='@human3d/motion-core'){
        if(specifier.startsWith('node:'))out.push(`[core-node] ${where} → ${specifier}`);
        if(/^@human3d\/(web|server)(\/|$)/.test(specifier))out.push(`[core→app] ${where} → ${specifier}`);
      }
      /* Relative paths must not leave the importing package — for EVERY
       * workspace, not just core: `import type {Contract} from
       * '../../server/src/contract'` inside apps/web is a web → server
       * dependency wearing a relative-path disguise. The single documented
       * exception is core reading the toolchain-owned envelope registry at the
       * repo root (see docs/ARCHITECTURE.md「已知泄漏」). */
      if(specifier.startsWith('.')){
        const target=path.resolve(path.dirname(file),specifier);
        const pkgRoot=path.join(root,pkg.dir);
        const escaped=!target.startsWith(pkgRoot+path.sep);
        const registryException=pkg.name==='@human3d/motion-core'&&REGISTRY.test(target);
        if(escaped&&!registryException){
          const tag=pkg.name==='@human3d/motion-core'?'core-escape':pkg.name==='@human3d/web'?'web-escape':'server-escape';
          out.push(`[${tag}] ${where} → ${specifier}（越出 ${pkg.dir}${pkg.name==='@human3d/motion-core'?'；仅 assets/motions/*.json 例外':'；相对路径不得跨包'}）`);
        }
      }
      if(pkg.name==='@human3d/web'&&/^@human3d\/server(\/|$)/.test(specifier))out.push(`[web→server] ${where} → ${specifier}`);
      if(pkg.name==='@human3d/server'&&/^@human3d\/web(\/|$)/.test(specifier))out.push(`[server→web] ${where} → ${specifier}`);
    }
    if(!test&&pkg.name==='@human3d/motion-core')
      for(const {name,line} of collectDomUses(file,source))out.push(`[core-dom] ${rel(file)}:${line} 使用了 DOM 全局 ${name}`);
  }
  return out;
}
