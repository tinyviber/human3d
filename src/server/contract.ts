import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import Ajv2020, {type ErrorObject,type ValidateFunction} from 'ajv/dist/2020.js';

/** The executable contract. Every schema is read from spec/ at startup and
 * compiled once with Ajv 2020 in strict mode, so the served behaviour and the
 * published schema cannot drift apart silently. */
export interface Contract{
 request:ValidateFunction;
 posePackage:ValidateFunction;
 /** Compiles an action's parameter schema (no $id; compiled per action). */
 compileParameters(schema:object):ValidateFunction;
}

const SPEC_DIR=fileURLToPath(new URL('../../spec/',import.meta.url));

export function readSpec(name:string):object{
 return JSON.parse(fs.readFileSync(`${SPEC_DIR}${name}`,'utf8')) as object;
}

/** Human-readable failure list: "/sample/fps must be <= 60". */
export function describeErrors(errors:ErrorObject[]|null|undefined):string[]{
 return (errors??[]).map(e=>`${e.instancePath||'/'} ${e.message??'is invalid'}`.trim());
}

export function createContract():Contract{
 const ajv=new Ajv2020({allErrors:true,strict:true});
 const request=ajv.compile(readSpec('motion-request.schema.json'));
 const posePackage=ajv.compile(readSpec('pose-package.schema.json'));
 ajv.addSchema(readSpec('rig-manifest.schema.json'));
 // Parameter schemas are static per action: compile each object once.
 const compiled=new WeakMap<object,ValidateFunction>();
 return {
  request,
  posePackage,
  compileParameters(schema){
   let fn=compiled.get(schema);
   if(!fn){fn=ajv.compile(schema);compiled.set(schema,fn);}
   return fn;
  },
 };
}
