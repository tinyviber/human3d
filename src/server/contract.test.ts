import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {createContract,readSpec,type Contract} from './contract';
import {normalizeMotionFile} from '../core/motion-file';
import {load as loadYaml} from 'js-yaml';
import {createService,handleRequest,LIMITS_SVC,type ServiceContext} from './service';
import {ERROR_CODES} from './errors';
import {validatePosePackage} from './validate';
import type {PosePackage} from './pose-package';

const SPEC=path.resolve('spec');
let contract:Contract;
let ctx:ServiceContext;
beforeAll(async()=>{contract=createContract();ctx=await createService('public');},30000);
const read=(rel:string)=>JSON.parse(fs.readFileSync(path.join(SPEC,rel),'utf8'));

describe('executable contract',()=>{
 it('compiles every published schema in strict Ajv 2020 mode',()=>{
  expect(()=>createContract()).not.toThrow();
  expect(readSpec('motion-request.schema.json')).toBeTruthy();
  expect(readSpec('pose-package.schema.json')).toBeTruthy();
 });
 it('accepts the minimal request and rejects each envelope violation',()=>{
  expect(contract.request({action:{id:'idle'}})).toBe(true);
  expect(contract.request({action:{id:'idle'},sample:{fps:61}})).toBe(false);
  expect(contract.request({action:{id:'idle'},sample:{fps:0}})).toBe(false);
  expect(contract.request({action:{id:'idle'},extra:true})).toBe(false);
  expect(contract.request({action:{id:''}})).toBe(false);
  expect(contract.request({action:{id:'idle',parameters:[]}})).toBe(false);
  expect(contract.request({action:{id:'idle'},outputs:[1,2,3,4,5].map(()=>({kind:'motion',format:'pose-json'}))})).toBe(false);
 });
 it('accepts the published request example',()=>{
  expect(contract.request(read('examples/rejected-pelvis-fold.request.json'))).toBe(true);
 });
 it('rejects foreign package versions and malformed quality codes',()=>{
  const pkg=read('examples/idle.pose.json');
  expect(contract.posePackage(pkg)).toBe(true);
  expect(contract.posePackage({...pkg,schemaVersion:1})).toBe(false);
  const bad=JSON.parse(JSON.stringify(pkg));
  bad.quality.checks[0].code='Foot Depth';
  expect(contract.posePackage(bad)).toBe(false);
  const badSide=JSON.parse(JSON.stringify(pkg));
  badSide.events.push({time:0,label:'x',type:'support-start',side:'X'});
  expect(contract.posePackage(badSide)).toBe(false);
 });
});

describe('golden examples',()=>{
 it('the published idle package is schema-valid and passes the semantic validator',()=>{
  const pkg=read('examples/idle.pose.json') as PosePackage;
  expect(contract.posePackage(pkg),JSON.stringify(contract.posePackage.errors)).toBe(true);
  expect(validatePosePackage(pkg,ctx.manifest)).toEqual([]);
 });
 it('every served bundled action matches the published package schema',()=>{
  for(const id of ['idle','reach','squat','ready','forehand']){
   const r=handleRequest(ctx,'POST','/v1/motions',{action:{id}},{});
   expect(r.status).toBe(200);
   expect(contract.posePackage(r.body),id).toBe(true);
  }
 });
});

describe('motion file envelopes',()=>{
 it('every assets/motions/*.json satisfies its published schema and normalizes',()=>{
  const dir=path.resolve('assets/motions');
  const ajv=new Ajv2020({allErrors:true,strict:true});
  const check=ajv.compile(JSON.parse(fs.readFileSync(path.join(dir,'motion.schema.json'),'utf8')));
  const files=fs.readdirSync(dir).filter(n=>n.endsWith('.json')&&n!=='motion.schema.json').sort();
  expect(files).toEqual(['forehand.json','idle.json','reach.json','ready.json','squat.json','walk.json']);
  for(const name of files){
   const raw=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
   expect(check(raw),`${name}: ${JSON.stringify(check.errors)}`).toBe(true);
   expect(()=>normalizeMotionFile(raw),name).not.toThrow();
  }
 });
});

describe('OpenAPI description matches the executable contract',()=>{
 const doc=loadYaml(fs.readFileSync(path.join(SPEC,'openapi.yaml'),'utf8')) as Record<string,any>;
 it('documents exactly the error codes the service can emit',()=>{
  const enumCodes:string[]=doc.components.schemas.Error.properties.error.properties.code.enum;
  expect([...enumCodes].sort()).toEqual([...ERROR_CODES].sort());
 });
 it('states the Idempotency-Key bounds the service enforces',()=>{
  const header=doc.paths['/v1/motions'].post.parameters.find((p:{name:string})=>p.name==='Idempotency-Key');
  expect(header.schema.maxLength).toBe(LIMITS_SVC.idempotencyKeyMaxLength);
  expect(header.schema.pattern).toBe(`^[!-~]{1,${LIMITS_SVC.idempotencyKeyMaxLength}}$`);
 });
 it('resolves every $ref to an existing component or spec file',()=>{
  const refs:string[]=[];
  const walk=(v:unknown)=>{
   if(Array.isArray(v))v.forEach(walk);
   else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(k==='$ref'&&typeof x==='string')refs.push(x);else walk(x);}
  };
  walk(doc);
  expect(refs.length).toBeGreaterThan(5);
  for(const ref of refs){
   if(ref.startsWith('#/')){
    let node:unknown=doc;
    for(const seg of ref.slice(2).split('/'))node=(node as Record<string,unknown>)?.[seg];
    expect(node,ref).toBeDefined();
   }else expect(fs.existsSync(path.join(SPEC,ref)),ref).toBe(true);
  }
 });
 it('documents every endpoint the service advertises, and no other',()=>{
  const served=(handleRequest(ctx,'GET','/v1/capabilities').body as {endpoints:string[]}).endpoints;
  const documented=Object.entries(doc.paths).flatMap(([p,ops])=>Object.keys(ops as object).map(m=>`${m.toUpperCase()} ${p}`));
  expect([...documented].sort()).toEqual([...served].sort());
 });
});
