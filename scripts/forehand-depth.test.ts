import {beforeAll,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import {measurePackage,MOTION_FILES,validatePosePackage,type PosePackage,type WorkshopDoc} from '@human3d/motion-core';
import {createService,handleRequest,type ServiceContext} from '../apps/server/src/service';
import {analyzePlayer,depthTargets,phaseMedians,PRESET_KEYS,readFrame} from './lib/forehand-depth.mts';
import {semanticDepthTargets} from './lib/forehand-semantics.mts';
import {mergeSelectedProfiles} from './lib/forehand-depth-report.mts';
import {GATES} from './lib/forehand-gates.mts';
import {legRest,peakDorsiflexion,solvedDepth,wristMiss,wristSampleTimes,type LegRest} from './lib/forehand-measure.mts';

/** Issue #17 contract for the 17 generated forehand presets, checked through
 * the real service (POST /v1/motions → solveWorkshop → validatePosePackage)
 * and the real frameAt → solveEffectiveFrame path:
 *   - the takeback sits within 1.5 cm of the MediaPipe worldLandmarks
 *     measurement in evidence/forehand-depth.json;
 *   - every key's solved depth follows the study-derived target (depth ≥ target
 *     − 0.05 cm and ≤ max(target, 2.4) + 0.05 cm); a key whose target the stance
 *     cannot reach is a recorded stance-floor fallback (receipt `stanceFloor`)
 *     and is held to its recorded floor, which must lie above the target and
 *     within GATES.stanceFloorMaxCm;
 *   - the rear-ankle guard keeps dorsiflexion ≤ 20.05° WITHOUT lifting the
 *     pelvis (per-key lower bound above; no separate contact-loss limit);
 *   - root acceleration ≤ 36 m/s² and support slip ≤ 9 mm at the service's
 *     40 Hz default and its 60 Hz maximum; no 422.
 * The study figures come from the evidence file; the derivation is the same
 * function the generator uses (scripts/lib/forehand-depth.mts). */
const study=JSON.parse(fs.readFileSync('evidence/forehand-depth.json','utf8'));
const RECEIPT='evidence/forehand-presets.json';
const medians=phaseMedians(study);
const PRESETS=MOTION_FILES.filter(f=>f.kind==='workshop-motion'&&f.capabilities?.prop?.kind==='racket'
 &&f.phases?.some(p=>p.label==='引拍')&&f.id!=='forehand');
let ctx:ServiceContext;
let LEGS:LegRest;
beforeAll(async()=>{
 ctx=await createService('public');
 LEGS=legRest(ctx.rig);
},30000);

const depthAt=(doc:WorkshopDoc,t:number)=>solvedDepth(ctx.rig,doc,t,LEGS).depth;
const ankleAt=(doc:WorkshopDoc)=>peakDorsiflexion(ctx.rig,doc,240).peak;

describe('forehand depth study (pure analysis)',()=>{
 // Synthetic MediaPipe world rows: pelvis-centred, metres, +y DOWN.
 const pose=(hipToAnkle:number,kneeForward=0,{offFrame=false}={})=>{
  const world=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1}));
  const image=Array.from({length:33},()=>({x:.5,y:.5}));
  for(const [hip,knee,ankle,x] of [[23,25,27,.1],[24,26,28,-.1]] as const){
   world[hip]={x,y:0,z:0,visibility:1};
   world[knee]={x,y:hipToAnkle/2,z:-kneeForward,visibility:1};
   world[ankle]={x,y:hipToAnkle,z:0,visibility:1};
   if(offFrame)image[ankle]={x:.5,y:1.2};
  }
  return {world,image};
 };
 it('reads +y-down metres as hip height above the ankle and confirms it on the standing frame',()=>{
  const rows=[];
  for(let i=0;i<20;i++){const p=pose(.8);rows.push(readFrame(p.world,i*.1,p.image));}
  const report=analyzePlayer(rows,[.2,.6,1,1.4,1.8]);
  expect(report.measurable).toBe(true);
  expect(report.standing).toMatchObject({verticalDown:true,metres:true,upright:true,hipAboveAnkleM:.8});
  expect(report.phases.takeback.depthCm).toBe(0);
 });
 it('flags feet outside the image instead of measuring them',()=>{
  const rows=[];
  for(let i=0;i<20;i++){const p=pose(.8,0,{offFrame:i>=8&&i<=12});rows.push(readFrame(p.world,i*.1,p.image));}
  const report=analyzePlayer(rows,[.2,.6,1,1.4,1.8]);
  expect(report.flagCounts['off-frame']).toBe(5);
  expect(report.frames.filter((f:{flags:string[]})=>f.flags.includes('off-frame')).map((f:{time:number})=>Math.round(f.time*10))).toEqual([8,9,10,11,12]);
 });
 it('does not count smoothed values from a consecutive off-frame block as usable samples',()=>{
  const rows=[];
  for(let i=0;i<20;i++){const p=pose(.8,0,{offFrame:i>=8&&i<=18});rows.push(readFrame(p.world,i*.1,p.image));}
  const report=analyzePlayer(rows,[.2,.6,1,1.4,1.8]);
  expect(report.frames[10].smoothedRatio).not.toBeNull(); // neighbour smoothing still describes the gap
  expect(report.frames[10].flags).toContain('off-frame');
  expect(report.usable).toBe(9);
  expect(report.phases.contact).toBeNull(); // only one genuine sample remains in this window
 });
 it('does not let a low-visibility gap manufacture the minimum phase sample count',()=>{
  const rows=[];
  for(let i=0;i<20;i++){
   const p=pose(.8);
   if(i>=2)for(const index of [23,25,27,24,26,28])p.world[index].visibility=.1;
   rows.push(readFrame(p.world,i*.1,p.image));
  }
  const report=analyzePlayer(rows,[.2,.6,1,1.4,1.8]);
  expect(report.usable).toBe(2);
  expect(report.phases.ready).toBeNull();
 });
 it('merges selected player updates without dropping other evidence profiles',()=>{
  const old={generated:'old',profiles:{a:{value:1},b:{value:2},c:{value:3}}};
  const update={generated:'new',profiles:{b:{value:20}}};
  expect(mergeSelectedProfiles(old,update,['b'])).toEqual({generated:'new',profiles:{a:{value:1},b:{value:20},c:{value:3}}});
 });
 it('derives targets that never exceed the (floored) takeback and replace lost phases with the cross-player median',()=>{
  const lost={measurable:true,phases:{ready:{depthCm:9,frames:9},takeback:{depthCm:5,frames:7},contact:null,follow:{depthCm:2,frames:2},recover:{depthCm:-1,frames:9}}};
  const r=depthTargets(lost,{contact:3,follow:2.5,recover:2})!;
  expect(r.targets).toHaveLength(PRESET_KEYS.length);
  // measured takeback 5 cm is floored to MIN_TAKEBACK_CM (8); ready 9 clamps to 8
  expect(r.takeback).toBe(8);
  expect(r.measuredTakeback).toBe(5);
  expect(r.floored).toBe(true);
  expect(r.targets[0]).toBe(8);
  expect(r.targets[1]).toBe(8);
  expect(r.targets[4]).toBe(3); // lost contact → median (still ≤ load)
  // follow median 2.5 raised by floored release floor 8*0.36=2.88; recover stays 0 then floor min(2.88,1.6)=1.6
  expect(r.targets[7]).toBe(4);
  expect(r.targets[8]).toBeCloseTo(1.6, 5);
  expect(r.fallback).toEqual(['contact','follow']);
  expect(depthTargets({measurable:false},medians)).toBeNull();
 });
});

describe('generated forehand presets match the measured depth',()=>{
 it('covers all 17 presets, each with a usable takeback measurement and a passing standing check',()=>{
  expect(PRESETS).toHaveLength(17);
  for(const file of PRESETS){
   const profile=study.profiles[file.id];
   expect(profile?.measurable,file.id).toBe(true);
   expect(profile.phases.takeback?.frames,file.id).toBeGreaterThanOrEqual(3);
   expect(profile.standing,file.id).toMatchObject({verticalDown:true,metres:true,upright:true});
  }
 });

 it('puts each takeback within 1.5 cm of its (floored) target and keeps every key at its target, or at its recorded stance floor',()=>{
  const receipt=JSON.parse(fs.readFileSync(RECEIPT,'utf8'));
  for(const file of PRESETS){
   const doc=file.document! as WorkshopDoc;
   const {targets,takeback}=semanticDepthTargets(study.profiles[file.id],medians)!;
   expect(doc.keys.map(k=>k.label),file.id).toEqual(PRESET_KEYS);
   const take=depthAt(doc,doc.keys[1].time);
   // Compare against depthTargets load (includes MIN_TAKEBACK_CM floor), not the raw MediaPipe median.
   expect(Math.abs(take-takeback),`${file.id} takeback ${take.toFixed(2)} vs target ${takeback}`).toBeLessThanOrEqual(GATES.takebackTolCm);
   const floors=new Map<number,{studyCm:number;floorCm:number}>(
    (receipt.presets[file.id]?.stanceFloor??[]).map((f:{index:number;studyCm:number;floorCm:number})=>[f.index,f]));
   doc.keys.forEach((key,i)=>{
    const depth=depthAt(doc,key.time),at=`${file.id} ${key.label}`;
    const fb=floors.get(i);
    if(fb){
     // Stance-floor fallback: the study target is out of the stance's reach, so the
     // key sits at its recorded floor, which must be above the target and capped.
     const note=`${at} ${depth.toFixed(2)} vs stance floor ${fb.floorCm.toFixed(2)} (study target ${targets[i].toFixed(2)})`;
     expect(fb.studyCm,note).toBeCloseTo(targets[i],2);
     expect(fb.floorCm,note).toBeGreaterThan(targets[i]+GATES.depthSlackCm);
     expect(fb.floorCm,note).toBeLessThanOrEqual(GATES.stanceFloorMaxCm);
     expect(Math.abs(depth-fb.floorCm),note).toBeLessThanOrEqual(GATES.depthSlackCm);
     return;
    }
    // Every other key follows its target from both sides; a near-upright target has no allowance.
    const note=`${at} ${depth.toFixed(2)} vs target ${targets[i].toFixed(2)}`;
    expect(Math.abs(depth-targets[i]),note).toBeLessThanOrEqual(GATES.depthSlackCm);
   });
  }
 },120000);

 // The contact-phase crouch (前挥 / 击球 / 延伸, no pelvis lift through the ankle guard) is
 // held by the per-key lower bound in the first test (depth ≥ target − 0.05 cm on every key).
 // A separate 0.6 cm contact-loss assertion used to sit here; it was strictly weaker and
 // could never fail, so it was removed rather than kept as a false guarantee.

 it('carries the arms with the pelvis: both wrists still reach their targets',()=>{
  // The depth change moves the trunk; hand targets are world-space and must
  // move with the SOLVED pelvis (incl. the solver's posterior correction), or
  // the racket wrist falls short (Cilic/Federer missed by 4–5 mm).
  for(const file of PRESETS){
   const doc=file.document! as WorkshopDoc;
   for(const t of wristSampleTimes(doc)){
    const miss=wristMiss(ctx.rig,doc,t);
    for(const s of ['L','R'] as const)expect(miss[s],`${file.id} wrist_${s} @${t.toFixed(3)}s`).toBeLessThanOrEqual(GATES.wristMaxM);
   }
  }
 },120000);

 it('keeps the rear ankle within 20.05° on a 240-sample grid',()=>{
  for(const file of PRESETS){
   const peak=ankleAt(file.document! as WorkshopDoc);
   expect(peak,file.id).toBeLessThanOrEqual(GATES.ankleMaxDeg);
  }
 },180000);

 it('solves every preset through the service with root acceleration ≤ 36 m/s² and slip ≤ 9 mm',()=>{
  for(const file of PRESETS)for(const fps of [40,60]){
   const r=handleRequest(ctx,'POST','/v1/motions',{action:{id:file.id},sample:{fps}},{});
   expect(r.status,`${file.id} @${fps} Hz: ${JSON.stringify(r.body).slice(0,300)}`).toBe(200);
   const pkg=r.body as PosePackage;
   expect(validatePosePackage(pkg,ctx.manifest),`${file.id} @${fps} Hz`).toEqual([]);
   const m=measurePackage(pkg,ctx.manifest);
   expect(m.rootAccel.value,`${file.id} @${fps} Hz root acceleration`).toBeLessThanOrEqual(GATES.rootAccelMax);
   expect(m.slip?.value??0,`${file.id} @${fps} Hz slip`).toBeLessThanOrEqual(GATES.slipMaxM);
  }
 },180000);
});
