import {beforeAll,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig,WORKSHOP_LIMITS,frameAt,keyAt,motionFileById,normalizeDoc,serializeDoc,solveEffectiveFrame,validateDocShape,type WorkshopDoc} from '@human3d/motion-core';
import {basicInsertRefusal,insertBasicAction} from './basic-actions';
import {BASIC_PRESETS,OTHER_PRESETS,RACKET_PRESETS} from './library';

let rig:HumanRig;
// Same origin the engine passes: pelvis-frame hands resolve through the rest root.
const origin=()=>rig.rest.get('root')!;
const docOf=(id:string)=>structuredClone(motionFileById(id)!.document!) as WorkshopDoc;
const basicOf=(id:string)=>motionFileById(id)!.document!;

beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
},30000);

describe('basic action library',()=>{
 it('leads with the basic actions (≤3 keys each); racket motions and older motions follow in their own groups',()=>{
  expect(BASIC_PRESETS.map(p=>p.id)).toEqual(['basic-half-squat','basic-full-squat','basic-lunge','basic-weight-shift','basic-push-turn','basic-wide-squat','basic-forward-fold','basic-arms-up']);
  for(const p of BASIC_PRESETS){
   expect(p.document!.keys.length,p.id).toBeLessThanOrEqual(3);
   expect(p.capabilities,p.id).toBeUndefined();
  }
  expect(RACKET_PRESETS.length).toBeGreaterThan(0);
  expect(RACKET_PRESETS.every(p=>p.capabilities?.prop?.kind==='racket')).toBe(true);
  expect(RACKET_PRESETS.some(p=>p.id==='roger-federer-forehand')).toBe(true);
  // `ready` declares the racket prop, so it sits with the racket group, not here.
  expect(OTHER_PRESETS.map(p=>p.id).sort()).toEqual(['idle','reach','squat']);
 });
});

describe('insertBasicAction',()=>{
 it('inserts a half squat at a sampled frame: starts from the state, ripples later keys, keeps the arms',()=>{
  const doc=docOf('roger-federer-forehand');
  const original=structuredClone(doc);
  const t=.37;
  const before=frameAt(original,t,origin());
  const span=1.6;
  const ins=insertBasicAction(doc,basicOf('basic-half-squat'),t,origin());
  expect(ins).toBeDefined();
  expect(ins!.keyIds.length).toBe(3);
  expect(ins!.span).toBeCloseTo(span,9);
  expect(doc.keys.length).toBe(original.keys.length+3);
  expect(doc.duration).toBeCloseTo(original.duration+span,9);

  const [k0,k1,k2]=ins!.keyIds.map(id=>keyAt(doc,id)!);
  expect(k0.time).toBeCloseTo(t,9);
  expect(k1.time).toBeCloseTo(t+.8,9);
  expect(k2.time).toBeCloseTo(t+1.6,9);
  // The first inserted key is the playhead state itself.
  expect(k0.pose.root.y).toBeCloseTo(before.pose.root.y,9);
  expect(k0.pose.footL.target.z).toBeCloseTo(before.pose.footL.target.z,9);
  expect(k0.pose.lean).toBeCloseTo(before.pose.lean,9);
  // The squat is a relative offset: lower root, leaning 4° further, then back to the state.
  expect(k1.pose.root.y).toBeCloseTo(k0.pose.root.y-.12,9);
  expect(k1.pose.lean).toBeCloseTo(k0.pose.lean+4,9);
  expect(k2.pose.root.y).toBeCloseTo(k0.pose.root.y,9);
  // Arms are not part of a basic action: the hands stay where the playhead left them.
  expect(k1.pose.handR).toEqual(k0.pose.handR);
  expect(k2.pose.handL).toEqual(k0.pose.handL);

  // Original keys at or after the playhead move by the span; earlier keys stay put.
  for(const k of original.keys){
   const now=keyAt(doc,k.id)!;
   if(k.time>t)expect(now.time,k.id).toBeCloseTo(k.time+span,9);
   else expect(now.time,k.id).toBeCloseTo(k.time,9);
  }
  expect(validateDocShape(doc)).toEqual([]);
  expect(() => normalizeDoc(JSON.parse(serializeDoc(doc)))).not.toThrow();
 });

 it('reuses an existing key at the playhead instead of stacking a duplicate timestamp',()=>{
  const doc=docOf('roger-federer-forehand');
  const anchor=doc.keys[2];
  const pose=structuredClone(anchor.pose);
  const n=doc.keys.length;
  const ins=insertBasicAction(doc,basicOf('basic-half-squat'),anchor.time+.004,origin());
  expect(ins!.keyIds[0]).toBe(anchor.id);
  expect(ins!.time).toBeCloseTo(anchor.time,9);
  expect(doc.keys.length).toBe(n+2);
  expect(keyAt(doc,anchor.id)!.pose).toEqual(pose);
  const times=doc.keys.map(k=>k.time);
  expect(new Set(times.map(x=>x.toFixed(6))).size).toBe(times.length);
  expect(validateDocShape(doc)).toEqual([]);
 });

 it('ripples dense keys after the insertion boundary, including a key only 5 ms later',()=>{
  const doc=docOf('idle');
  doc.keys=doc.keys.slice(0,2);
  doc.keys[0].time=0;doc.keys[1].time=1;doc.duration=1.2;
  const dense=structuredClone(doc.keys[0]);dense.id='dense';dense.time=.005;
  doc.keys.push(dense);doc.keys.sort((a,b)=>a.time-b.time);
  const original=structuredClone(doc.keys);
  const ins=insertBasicAction(doc,basicOf('basic-lunge'),0,origin())!;
  expect(keyAt(doc,'dense')!.time).toBeCloseTo(.005+ins.span,9);
  expect(keyAt(doc,original[2].id)!.time).toBeCloseTo(1+ins.span,9);
  expect(validateDocShape(doc)).toEqual([]);
 });

 it('lunge: the lead foot steps forward, holds, and is released at the last key',()=>{
  const doc=docOf('roger-federer-forehand');
  const rightBefore=frameAt(doc,.5,origin()).constraints.plantR;
  const ins=insertBasicAction(doc,basicOf('basic-lunge'),.5,origin())!;
  const [k0,k1,k2]=ins.keyIds.map(id=>keyAt(doc,id)!);
  expect(k0.constraints.plantL).toBe(false);
  expect(k1.constraints.plantL).toBe(true);
  expect(k2.constraints.plantL).toBe(false);
  expect(k2.pose.footL.target.z).toBeCloseTo(k0.pose.footL.target.z+.24,9);
  // The lunge drops the pelvis and shifts it forward by the amount in the asset (.02 m).
  const lungeRoot=basicOf('basic-lunge').keys;
  expect(k2.pose.root.z-k0.pose.root.z).toBeCloseTo(lungeRoot[2].pose.root.z-lungeRoot[0].pose.root.z,9);
  // The trailing foot is not moved by the action: it keeps the state's contact.
  expect(k0.constraints.plantR).toBe(rightBefore);
  expect(k2.constraints.plantR).toBe(rightBefore);
  expect(validateDocShape(doc)).toEqual([]);
 });

 it('preserves a planted reused anchor when inserting a lunge',()=>{
  const doc=docOf('idle');
  const anchor=doc.keys[0];anchor.time=0;anchor.constraints.plantL=true;anchor.constraints.plantR=true;
  const original=structuredClone(anchor.constraints);
  rig.reset();solveEffectiveFrame(rig,frameAt(doc,anchor.time,origin()));
  const plantedFoot=rig.point('foot_L').clone();
  const ins=insertBasicAction(doc,basicOf('basic-lunge'),0,origin())!;
  expect(keyAt(doc,anchor.id)!.constraints).toEqual(original);
  const liftoff=keyAt(doc,ins.keyIds[0])!;
  expect(liftoff.time).toBeGreaterThan(anchor.time);
  expect(liftoff.constraints.plantL).toBe(false);
  rig.reset();solveEffectiveFrame(rig,frameAt(doc,.8,origin()));
  expect(rig.point('foot_L').distanceTo(plantedFoot)).toBeGreaterThan(.2);
  expect(validateDocShape(doc)).toEqual([]);
 });

 it('applies every basic action to every bundled motion and keeps the document valid',()=>{
  for(const basic of BASIC_PRESETS)for(const motion of [...RACKET_PRESETS,...OTHER_PRESETS]){
   const doc=docOf(motion.id);
   const n=doc.keys.length,d=doc.duration;
   const ins=insertBasicAction(doc,basic.document!,.3,origin());
   expect(ins,`${basic.id}->${motion.id}`).toBeDefined();
   const added=ins!.keyIds.length;
   expect(doc.keys.length,`${basic.id}->${motion.id}`).toBe(n+added);
   expect(doc.duration,`${basic.id}->${motion.id}`).toBeCloseTo(d+ins!.span,9);
   expect(validateDocShape(doc),`${basic.id}->${motion.id}`).toEqual([]);
  }
 });

 it('carry-hands templates translate the hand target/pole and keep the wrist orientation',()=>{
  const doc=docOf('roger-federer-forehand');
  const t=.37;
  const before=frameAt(structuredClone(doc),t,origin());
  const ins=insertBasicAction(doc,basicOf('basic-arms-up'),t,origin(),{carryHands:true})!;
  const [k0,k1]=ins.keyIds.map(id=>keyAt(doc,id)!);
  // The authored offset from the template's standing start: wrist up ~.82 m, slightly inward.
  const tpl=basicOf('basic-arms-up').keys;
  expect(k1.pose.handL.target.y-k0.pose.handL.target.y).toBeCloseTo(tpl[1].pose.handL.target.y-tpl[0].pose.handL.target.y,9);
  expect(k1.pose.handR.target.x-k0.pose.handR.target.x).toBeCloseTo(tpl[1].pose.handR.target.x-tpl[0].pose.handR.target.x,9);
  expect(k1.pose.handL.pole.z-k0.pose.handL.pole.z).toBeCloseTo(tpl[1].pose.handL.pole.z-tpl[0].pose.handL.pole.z,9);
  // Orientation is preserved verbatim, not differenced.
  expect(k1.pose.handL.forward).toEqual(k0.pose.handL.forward);
  expect(k1.pose.handR.normal).toEqual(k0.pose.handR.normal);
  expect(validateDocShape(doc)).toEqual([]);
 });

 it('without carryHands the same template leaves the hands untouched',()=>{
  const doc=docOf('idle');
  const ins=insertBasicAction(doc,basicOf('basic-arms-up'),0,origin())!;
  const [k0,k1]=ins.keyIds.map(id=>keyAt(doc,id)!);
  expect(k1.pose.handL).toEqual(k0.pose.handL);
  expect(k1.pose.handR).toEqual(k0.pose.handR);
 });

 it('refuses without touching the document when the key or duration limit would be exceeded',()=>{
  const full=docOf('roger-federer-forehand');
  const template=full.keys[0];
  for(let i=0;full.keys.length<WORKSHOP_LIMITS.maxKeys-1;i++){
   full.keys.push({...structuredClone(template),id:`fill-${i}`,time:.001+i*.0001,label:''});
  }
  full.keys.sort((a,b)=>a.time-b.time);
  const snapshot=serializeDoc(full);
  expect(basicInsertRefusal(full,basicOf('basic-half-squat'),1.7)).toMatch(/上限/);
  expect(insertBasicAction(full,basicOf('basic-half-squat'),1.7,origin())).toBeUndefined();
  expect(serializeDoc(full)).toBe(snapshot);

  const long=docOf('roger-federer-forehand');
  long.duration=9.5;
  const longSnapshot=serializeDoc(long);
  expect(basicInsertRefusal(long,basicOf('basic-half-squat'),.5)).toMatch(/时长/);
  expect(insertBasicAction(long,basicOf('basic-half-squat'),.5,origin())).toBeUndefined();
  expect(serializeDoc(long)).toBe(longSnapshot);
 });
});
