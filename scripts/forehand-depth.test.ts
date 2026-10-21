import {beforeAll,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import {Quaternion,Vector3} from 'three';
import {frameAt,measurePackage,MOTION_FILES,solveEffectiveFrame,validatePosePackage,type PosePackage,type WorkshopDoc} from '@human3d/motion-core';
import {createService,handleRequest,type ServiceContext} from '../apps/server/src/service';
import {analyzePlayer,depthTargets,phaseMedians,PRESET_KEYS,readFrame} from './lib/forehand-depth.mts';
import {mergeSelectedProfiles} from './lib/forehand-depth-report.mts';

/** Issue #17 contract for the 17 generated forehand presets, checked through
 * the real service (POST /v1/motions → solveWorkshop → validatePosePackage)
 * and the real frameAt → solveEffectiveFrame path:
 *   - the takeback sits within 1.5 cm of the MediaPipe worldLandmarks
 *     measurement in evidence/forehand-depth.json;
 *   - every key's solved depth follows the study-derived target, except where
 *     the stance cannot straighten that far (floor) — never deeper;
 *   - the rear-ankle guard keeps dorsiflexion ≤ 20.05° WITHOUT lifting the
 *     pelvis: contact-phase crouch is the target ±0.6 cm;
 *   - root acceleration ≤ 36 m/s² and support slip ≤ 9 mm at the service's
 *     40 Hz default and its 60 Hz maximum; no 422.
 * The study figures come from the evidence file; the derivation is the same
 * function the generator uses (scripts/lib/forehand-depth.mts). */
const study=JSON.parse(fs.readFileSync('evidence/forehand-depth.json','utf8'));
const medians=phaseMedians(study);
const PRESETS=MOTION_FILES.filter(f=>f.kind==='workshop-motion'&&f.capabilities?.prop?.kind==='racket'
 &&f.phases?.some(p=>p.label==='引拍')&&f.id!=='forehand');
const TAKEBACK_TOLERANCE_CM=1.5,CONTACT_LOSS_CM=.6,ANKLE_MAX=20.05,ACCEL_MAX=36,SLIP_MAX_M=.009;
/** The stance floor: with a staggered, turned stance both legs cannot be
 * straight at once, so a near-upright measurement solves to this depth. */
const STANCE_FLOOR_CM=4.0; // deep floored crouch + stagger: follow/recover cannot straighten to 2.4 cm

let ctx:ServiceContext;
let CHAIN:number,REST_RATIO:number;
beforeAll(async()=>{
 ctx=await createService('public');
 const rest=ctx.rig.rest;
 CHAIN=rest.get('upperleg01_L')!.distanceTo(rest.get('lowerleg01_L')!)+rest.get('lowerleg01_L')!.distanceTo(rest.get('foot_L')!);
 REST_RATIO=((rest.get('upperleg01_L')!.y+rest.get('upperleg01_R')!.y)/2-rest.get('foot_L')!.y)/CHAIN;
},30000);

const solvedDepth=(doc:WorkshopDoc,t:number)=>{
 const rig=ctx.rig;
 rig.reset();solveEffectiveFrame(rig,frameAt(doc,t,rig.rest.get('root')!));
 let ratio=-Infinity;
 for(const s of ['L','R'] as const)ratio=Math.max(ratio,(rig.point(`upperleg01_${s}`).y-rig.point(`foot_${s}`).y)/CHAIN);
 return (REST_RATIO-ratio)*CHAIN*100;
};
const peakDorsiflexion=(doc:WorkshopDoc,samples=240)=>{
 const rig=ctx.rig,origin=rig.rest.get('root')!;
 let peak=-Infinity;
 for(let i=0;i<=samples;i++){
  rig.reset();solveEffectiveFrame(rig,frameAt(doc,i/samples*doc.duration,origin));rig.model.updateMatrixWorld(true);
  for(const s of ['L','R'] as const){
   const shank=rig.point(`foot_${s}`).sub(rig.point(`lowerleg01_${s}`)).applyQuaternion(rig.bone(`foot_${s}`).getWorldQuaternion(new Quaternion()).invert());
   peak=Math.max(peak,Math.atan2(-shank.z,-shank.y)*180/Math.PI);
  }
 }
 return peak;
};

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

 it('puts each takeback within 1.5 cm of its (floored) target and keeps every key at its target or the stance floor',()=>{
  for(const file of PRESETS){
   const doc=file.document! as WorkshopDoc;
   const {targets,takeback}=depthTargets(study.profiles[file.id],medians)!;
   expect(doc.keys.map(k=>k.label),file.id).toEqual(PRESET_KEYS);
   const take=solvedDepth(doc,doc.keys[1].time);
   // Compare against depthTargets load (includes MIN_TAKEBACK_CM floor), not the raw MediaPipe median.
   expect(Math.abs(take-takeback),`${file.id} takeback ${take.toFixed(2)} vs target ${takeback}`).toBeLessThanOrEqual(TAKEBACK_TOLERANCE_CM);
   doc.keys.forEach((key,i)=>{
    const depth=solvedDepth(doc,key.time),at=`${file.id} ${key.label}`;
    // At the measurement; a near-upright target the stance cannot straighten
    // to solves at the floor instead, and never deeper than that.
    const note=`${at} ${depth.toFixed(2)} vs target ${targets[i].toFixed(2)}`;
    expect(depth,note).toBeLessThanOrEqual(Math.max(targets[i],STANCE_FLOOR_CM)+.05);
    expect(depth,note).toBeGreaterThanOrEqual(targets[i]-.05);
   });
  }
 },120000);

 it('holds the contact-phase crouch through the ankle guard (no pelvis lift)',()=>{
  for(const file of PRESETS){
   const doc=file.document! as WorkshopDoc;
   const {targets}=depthTargets(study.profiles[file.id],medians)!;
   // 前挥 → 击球 → 延伸: the segment the old guard raised by 6–24 mm.
   for(const i of [3,4,5]){
    const depth=solvedDepth(doc,doc.keys[i].time);
    if(targets[i]<STANCE_FLOOR_CM)continue; // floor-bound key: covered above
    expect(targets[i]-depth,`${file.id} ${doc.keys[i].label} loses ${(targets[i]-depth).toFixed(2)} cm`).toBeLessThanOrEqual(CONTACT_LOSS_CM);
   }
  }
 },120000);

 it('carries the arms with the pelvis: both wrists still reach their targets',()=>{
  // The depth change moves the trunk; hand targets are world-space and must
  // move with the SOLVED pelvis (incl. the solver's posterior correction), or
  // the racket wrist falls short (Cilic/Federer missed by 4–5 mm).
  const rig=ctx.rig,origin=rig.rest.get('root')!;
  for(const file of PRESETS){
   const doc=file.document! as WorkshopDoc;
   const times=[...doc.keys.map(k=>k.time),...Array.from({length:17},(_,i)=>i/16*doc.duration)];
   for(const t of times){
    rig.reset();const frame=frameAt(doc,t,origin);solveEffectiveFrame(rig,frame);
    for(const s of ['L','R'] as const){
     const h=(s==='L'?frame.pose.handL:frame.pose.handR).target;
     const miss=rig.point(`wrist_${s}`).distanceTo(new Vector3(h.x,h.y,h.z));
     expect(miss,`${file.id} wrist_${s} @${t.toFixed(3)}s`).toBeLessThanOrEqual(.001);
    }
   }
  }
 },120000);

 it('keeps the rear ankle within 20.05° on a 240-sample grid',()=>{
  for(const file of PRESETS){
   const peak=peakDorsiflexion(file.document! as WorkshopDoc);
   expect(peak,file.id).toBeLessThanOrEqual(ANKLE_MAX);
  }
 },180000);

 it('solves every preset through the service with root acceleration ≤ 36 m/s² and slip ≤ 9 mm',()=>{
  for(const file of PRESETS)for(const fps of [40,60]){
   const r=handleRequest(ctx,'POST','/v1/motions',{action:{id:file.id},sample:{fps}},{});
   expect(r.status,`${file.id} @${fps} Hz: ${JSON.stringify(r.body).slice(0,300)}`).toBe(200);
   const pkg=r.body as PosePackage;
   expect(validatePosePackage(pkg,ctx.manifest),`${file.id} @${fps} Hz`).toEqual([]);
   const m=measurePackage(pkg,ctx.manifest);
   expect(m.rootAccel.value,`${file.id} @${fps} Hz root acceleration`).toBeLessThanOrEqual(ACCEL_MAX);
   expect(m.slip?.value??0,`${file.id} @${fps} Hz slip`).toBeLessThanOrEqual(SLIP_MAX_M);
  }
 },180000);
});
