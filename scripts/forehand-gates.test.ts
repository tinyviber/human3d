import {describe,expect,it} from 'vitest';
import {VALIDATION_LIMITS} from '@human3d/motion-core';
import {
 GATES,RATCHET_KEYS,RATCHET_TOLERANCE,gateFailures,jsonDiff,nextCeiling,ratchetFailures,round,
 type PresetFacts,type Ratchet,
} from './lib/forehand-gates.mts';

/** A preset that passes every gate; each test changes one fact. */
const passing=(over:Partial<PresetFacts>={}):PresetFacts=>({
 takeback:{targetCm:6,solvedCm:6},
 keys:Array.from({length:9},(_,i)=>({label:`k${i}`,targetCm:6,solvedCm:6})),
 ankleDeg:20,
 wristM:0.0005,
 service:[
  {fps:40,schema:true,rejected:[],rootAccel:20,slip:0.002},
  {fps:60,schema:true,rejected:[],rootAccel:22,slip:0.002},
 ],
 ...over,
});
const withKey=(i:number,patch:Partial<PresetFacts['keys'][number]>)=>passing({keys:passing().keys.map((k,j)=>j===i?{...k,...patch}:k)});

describe('forehand gates (scripts/lib/forehand-gates.mts)',()=>{
 it('passes a preset that meets every gate',()=>{
  expect(gateFailures('p',passing())).toEqual([]);
 });

 it('keeps the gate margins inside the service limits it protects',()=>{
  expect(GATES.rootAccelMax).toBeLessThan(VALIDATION_LIMITS.rootAccelMPerS2);
  expect(GATES.slipMaxM).toBeLessThan(VALIDATION_LIMITS.supportSlipM);
  expect(GATES.ankleMaxDeg).toBeGreaterThanOrEqual(20); // the solver's own dorsiflexion limit
  expect(GATES.rates).toEqual([40,60]);
 });

 it('uses inclusive limits at the boundary and fails just beyond them',()=>{
  expect(gateFailures('p',passing({ankleDeg:GATES.ankleMaxDeg}))).toEqual([]);
  expect(gateFailures('p',passing({ankleDeg:GATES.ankleMaxDeg+0.01}))).toHaveLength(1);
  expect(gateFailures('p',passing({wristM:GATES.wristMaxM}))).toEqual([]);
  expect(gateFailures('p',passing({wristM:GATES.wristMaxM+1e-4}))).toHaveLength(1);
  expect(gateFailures('p',passing({takeback:{targetCm:6,solvedCm:6+GATES.takebackTolCm}}))).toEqual([]);
  expect(gateFailures('p',passing({takeback:{targetCm:6,solvedCm:6+GATES.takebackTolCm+0.01}}))).toHaveLength(1);
 });

 it('rejects a served motion above the root-acceleration or slip gate at either rate',()=>{
  const at=(fps:number,patch:Partial<PresetFacts['service'][number]>)=>passing({service:passing().service.map(s=>s.fps===fps?{...s,...patch}:s)});
  expect(gateFailures('p',at(40,{rootAccel:GATES.rootAccelMax}))).toEqual([]);
  expect(gateFailures('p',at(60,{rootAccel:GATES.rootAccelMax+0.01}))[0]).toMatch(/60 Hz root acceleration/);
  expect(gateFailures('p',at(40,{slip:GATES.slipMaxM+0.0001}))[0]).toMatch(/40 Hz support slip/);
 });

 it('treats a schema or semantic rejection as a failure, and never reads its margins as passing',()=>{
  const rejected=passing({service:[{fps:40,schema:true,rejected:['rootAccel 52 > 40'],rootAccel:Infinity,slip:Infinity}]});
  const msgs=gateFailures('p',rejected);
  expect(msgs.some(m=>m.includes('rejected by the semantic validator'))).toBe(true);
  expect(msgs.some(m=>m.includes('root acceleration'))).toBe(true);
  expect(gateFailures('p',passing({service:[{fps:40,schema:false,rejected:['schema'],rootAccel:Infinity,slip:Infinity}]}))
   .some(m=>m.includes('published schema'))).toBe(true);
 });

 it('bounds each key from both sides, with the stance floor as the shallowest allowed ceiling',()=>{
  expect(gateFailures('p',withKey(2,{targetCm:6,solvedCm:6-GATES.depthSlackCm}))).toEqual([]);
  expect(gateFailures('p',withKey(2,{targetCm:6,solvedCm:6-GATES.depthSlackCm-0.01}))).toHaveLength(1); // too shallow
  expect(gateFailures('p',withKey(2,{targetCm:6,solvedCm:6+1}))).toHaveLength(1); // deeper than the target
  // A near-upright target solves at the stance floor, never deeper.
  expect(gateFailures('p',withKey(2,{targetCm:1,solvedCm:GATES.stanceFloorCm+GATES.depthSlackCm}))).toEqual([]);
  expect(gateFailures('p',withKey(2,{targetCm:1,solvedCm:GATES.stanceFloorCm+GATES.depthSlackCm+0.01}))).toHaveLength(1);
 });

 it('holds the contact-phase crouch (前挥, 击球, 延伸) through the per-key shortfall bound',()=>{
  // A shortfall (the pelvis lifted by the ankle guard) beyond the slack fails on any key.
  expect(gateFailures('p',withKey(4,{targetCm:6,solvedCm:6-GATES.depthSlackCm}))).toEqual([]);
  expect(gateFailures('p',withKey(4,{targetCm:6,solvedCm:6-GATES.depthSlackCm-0.1}))[0]).toMatch(/k4 depth/);
  expect(gateFailures('p',withKey(3,{targetCm:6,solvedCm:6-0.6}))[0]).toMatch(/k3 depth/);
 });
});

describe('forehand ratchet (recorded ceilings may not silently worsen)',()=>{
 const values:Ratchet={rootAccel240:50,posteriorCm:6,stance:1.5};
 it('records a first value without judging it',()=>{
  expect(ratchetFailures('p',values,undefined)).toEqual([]);
  expect(nextCeiling(values,undefined,false)).toEqual(values);
 });

 it('allows a rise within each tolerance and fails beyond it, naming the metric',()=>{
  const within={...values,rootAccel240:values.rootAccel240+RATCHET_TOLERANCE.rootAccel240};
  expect(ratchetFailures('p',within,values)).toEqual([]);
  const beyond={...values,posteriorCm:values.posteriorCm+RATCHET_TOLERANCE.posteriorCm+0.01};
  const msgs=ratchetFailures('p',beyond,values);
  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toMatch(/posteriorCm/);
  expect(msgs[0]).toMatch(/--rebaseline/);
 });

 it('ratchets the ceiling down on improvement and raises it only on an explicit re-baseline',()=>{
  const better={...values,rootAccel240:40};
  expect(nextCeiling(better,values,false).rootAccel240).toBe(40);
  const worse={...values,stance:1.6};
  expect(nextCeiling(worse,values,false).stance).toBe(1.5); // kept, though the run is inside tolerance
  expect(nextCeiling(worse,values,true).stance).toBe(1.6);
 });

 it('covers exactly the three recorded metrics',()=>{
  expect([...RATCHET_KEYS].sort()).toEqual(['posteriorCm','rootAccel240','stance']);
 });
});

describe('forehand receipt comparison helpers',()=>{
 it('compares numbers with a tolerance and reports structural differences',()=>{
  expect(jsonDiff({a:[1,2]},{a:[1+1e-9,2]},1e-6)).toEqual([]);
  expect(jsonDiff({a:1},{a:1.1},1e-6)).toEqual(['$.a: 1 vs 1.1']);
  expect(jsonDiff({a:'x'},{a:'y'},1e-6)).toEqual(['$.a: "x" vs "y"']);
  expect(jsonDiff({a:1},{a:1,b:2},1e-6)).toEqual(['$.b: present on one side only']);
  expect(jsonDiff([1],[1,2],1e-6)[0]).toMatch(/length/);
 });

 it('rounds for storage without moving the stored value by more than half a unit',()=>{
  expect(round(1.23456,3)).toBe(1.235);
  expect(round(19.9994,3)).toBe(19.999);
 });
});
