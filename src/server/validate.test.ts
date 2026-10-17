import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {createService,handleRequest,type ServiceContext} from './service';
import {measurePackage,validatePosePackage,VALIDATION_LIMITS} from './validate';
import type {PosePackage} from './pose-package';

let ctx:ServiceContext;
beforeAll(async()=>{ctx=await createService('public');},30000);
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
function solve(body:unknown):PosePackage{
 const r=handleRequest(ctx,'POST','/v1/motions',body,{});
 if(r.status!==200)throw new Error(`solve failed ${r.status}: ${JSON.stringify(r.body).slice(0,300)}`);
 return r.body as PosePackage;
}

describe('semantic validator — shipped motions',()=>{
 it('accepts every shipped keyframed motion at the default rate',()=>{
  for(const id of ['idle','reach','squat','ready','forehand']){
   const pkg=solve({action:{id}});
   expect(validatePosePackage(pkg,ctx.manifest),id).toEqual([]);
  }
 });
 it('measures the shipped forehand well inside every speed limit',()=>{
  const m=measurePackage(solve({action:{id:'forehand'}}),ctx.manifest);
  expect(m.angularSpeed.value).toBeLessThan(VALIDATION_LIMITS.angularSpeedRadPerS);
  expect(m.rootSpeed.value).toBeLessThan(VALIDATION_LIMITS.rootSpeedMPerS);
  expect(m.rootAccel.value).toBeLessThan(VALIDATION_LIMITS.rootAccelMPerS2);
  expect(m.fkDriftM).toBeLessThan(1e-6);
 });
});

describe('semantic validator — rejects what it must',()=>{
 it('rejects a non-unit quaternion',()=>{
  const pkg=clone(solve({action:{id:'idle'},sample:{fps:10}}));
  const tr=pkg.tracks.rotations[0];
  for(let k=4;k<8;k++)tr.values[k]*=1.5;
  expect(validatePosePackage(pkg,ctx.manifest).some(e=>e.includes('non-unit quaternion'))).toBe(true);
 });
 it('rejects a hemisphere flip between consecutive samples',()=>{
  const pkg=clone(solve({action:{id:'idle'},sample:{fps:10}}));
  const tr=pkg.tracks.rotations[0];
  for(let k=4;k<8;k++)tr.values[k]*=-1;
  expect(validatePosePackage(pkg,ctx.manifest).some(e=>e.includes('hemisphere flip'))).toBe(true);
 });
 it('rejects a root that steps by half a metre in one frame',()=>{
  const pkg=clone(solve({action:{id:'idle'},sample:{fps:10}}));
  const mid=Math.floor(pkg.timeline.count/2);
  for(let k=mid;k<pkg.timeline.count;k++)pkg.tracks.translation.values[k*3]+=.5;
  const e=validatePosePackage(pkg,ctx.manifest);
  expect(e.some(s=>s.includes('root speed'))).toBe(true);
  expect(e.some(s=>s.includes('root acceleration'))).toBe(true);
 });
 it('rejects a package whose quality check passes beyond its own limit',()=>{
  const pkg=clone(solve({action:{id:'squat'},sample:{fps:10}}));
  const c=pkg.quality.checks.find(x=>x.code==='knee-flexion-L')!;
  expect(c.limit).not.toBeNull();
  c.ok=true;c.value=c.limit!+5;
  expect(validatePosePackage(pkg,ctx.manifest).some(e=>e.includes('passes with value'))).toBe(true);
 });
 it('rejects a one-sample package instead of passing it without semantic checks',()=>{
  const pkg=clone(solve({action:{id:'idle'},sample:{fps:5}}));
  const one={...pkg,timeline:{...pkg.timeline,count:1,timestamps:[0],duration:0},
   tracks:{...pkg.tracks,translation:{...pkg.tracks.translation,values:pkg.tracks.translation.values.slice(0,3)},
    rotations:pkg.tracks.rotations.map(tr=>({...tr,values:tr.values.slice(0,4)}))}};
  expect(validatePosePackage(one as PosePackage,ctx.manifest).some(e=>e.includes('at least 2'))).toBe(true);
 });
 it('rejects a bone that turns through random unit quaternions every frame (negative control)',()=>{
  const pkg=clone(solve({action:{id:'idle'},sample:{fps:40}}));
  let seed=7;const rnd=()=>{seed=seed*16807%2147483647;return seed/2147483647;};
  const tr=pkg.tracks.rotations[0];
  let prev:number[]|null=null;
  for(let i=0;i<pkg.timeline.count;i++){
   const v=[0,0,0,0].map(()=>rnd()*2-1);const n=Math.hypot(...v);const q=v.map(x=>x/n);
   // Keep the sign continuous so only the rate check can object, not the hemisphere check.
   if(prev&&prev.reduce((s,x,j)=>s+x*q[j],0)<0)for(let j=0;j<4;j++)q[j]=-q[j];
   tr.values.splice(i*4,4,...q);prev=q;
  }
  const errors=validatePosePackage(pkg,ctx.manifest);
  expect(errors.some(e=>e.startsWith('semantic: angular speed'))).toBe(true);
  expect(errors.some(e=>e.includes('hemisphere'))).toBe(false);
 });
 it('rejects a support event without a side and a foreign schema version',()=>{
  const pkg=clone(solve({action:{id:'idle'},sample:{fps:5}}));
  const bad={...pkg,events:[...pkg.events,{time:0,label:'x',type:'support-start' as const}]};
  expect(validatePosePackage(bad as PosePackage,ctx.manifest).some(e=>e.includes('lacks side'))).toBe(true);
  expect(validatePosePackage({...pkg,schemaVersion:1} as unknown as PosePackage,ctx.manifest)).toContain('bad schemaVersion/kind');
 });
});

describe('semantic validator — documented pelvis-fold limitation',()=>{
 it('refuses the documented pelvis-fold motion with the root-acceleration check',()=>{
  const req=JSON.parse(fs.readFileSync(path.resolve('spec/examples/rejected-pelvis-fold.request.json'),'utf8'));
  const r=handleRequest(ctx,'POST','/v1/motions',req,{});
  // The solver emits a package; the validator is what refuses it.
  expect(r.status).toBe(422);
  const details=(r.body as {error:{details:string[]}}).error.details;
  expect(details.some(d=>d.includes('root acceleration'))).toBe(true);
 });
});
