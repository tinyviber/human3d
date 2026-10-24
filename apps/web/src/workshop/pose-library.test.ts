import {beforeAll,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {WorkshopDoc} from '@human3d/motion-core';
import {HumanRig,blankDocument,frameAt,motionFileById,solveEffectiveFrame} from '@human3d/motion-core';
import {applyPoseAt,isPoseShape,PoseLibrary,type StorageLike} from './pose-library';

const docOf=(id:string)=>structuredClone(motionFileById(id)!.document!) as WorkshopDoc;
const idle=docOf('idle');
const origin={x:0,y:0,z:0};
/** An in-memory StorageLike recording writes, for persistence round-trips. */
const memoryStore=()=>{
  const map=new Map<string,string>();
  const writes:string[]=[];
  const store:StorageLike={getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);writes.push(v);}};
  return {store,writes,map};
};

let rig:HumanRig;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
},30000);

describe('PoseLibrary',()=>{
 it('captures a pose, persists it and reloads it across instances',()=>{
  const {store,writes}=memoryStore();
  const lib=new PoseLibrary(store).load();
  const pose=structuredClone(idle.keys[0].pose);
  const preset=lib.add('大鹏展翅',pose);
  expect(lib.presets).toHaveLength(1);
  expect(preset.name).toBe('大鹏展翅');
  expect(writes).toHaveLength(1);
  // mutate the source after capture — the preset must be an independent copy
  pose.handL.target.y=9;
  expect(preset.pose.handL.target.y).not.toBe(9);
  const reloaded=new PoseLibrary(store).load();
  expect(reloaded.presets).toHaveLength(1);
  expect(reloaded.presets[0].name).toBe('大鹏展翅');
  expect(reloaded.presets[0].pose).toEqual(idle.keys[0].pose);
 });
 it('deduplicates names and honours an empty capture name',()=>{
  const lib=new PoseLibrary(null).load();
  const a=lib.add('姿势',structuredClone(idle.keys[0].pose));
  const b=lib.add('姿势',structuredClone(idle.keys[1].pose));
  const c=lib.add('  ',structuredClone(idle.keys[1].pose));
  expect([a.name,b.name,c.name]).toEqual(['姿势','姿势 2','我的姿态']);
 });
 it('drops malformed stored entries on load instead of throwing',()=>{
  const {store}=memoryStore();
  store.setItem('kinesis-workshop-poses',JSON.stringify([
   null,42,{id:'x',name:'半截',pose:{root:{x:0}}},
   {id:'ok',name:'完整',pose:idle.keys[0].pose},
  ]));
  const lib=new PoseLibrary(store).load();
  expect(lib.presets.map(p=>p.name)).toEqual(['完整']);
  expect(isPoseShape(idle.keys[0].pose)).toBe(true);
  expect(isPoseShape({})).toBe(false);
 });
});

describe('applyPoseAt',()=>{
 it('replaces the pose of the key at the playhead and keeps its constraints',()=>{
  const doc=docOf('idle');
  const n0=doc.keys.length;
  const target=doc.keys[1];
  const before=structuredClone(target);
  const result=applyPoseAt(doc,structuredClone(idle.keys[2].pose),target.time,origin);
  expect(result?.result).toBe('replaced');
  expect(doc.keys).toHaveLength(n0);
  expect(target.pose).toEqual(idle.keys[2].pose);
  expect(target.constraints).toEqual(before.constraints);
  expect(target.time).toBe(before.time);
 });
 it('inserts a new key carrying the pose when the playhead is between keys',()=>{
  const doc=docOf('idle');
  const n0=doc.keys.length;
  const result=applyPoseAt(doc,structuredClone(idle.keys[0].pose),.55,origin);
  expect(result?.result).toBe('inserted');
  expect(doc.keys).toHaveLength(n0+1);
  const added=doc.keys.find(k=>Math.abs(k.time-.55)<1e-9)!;
  expect(added.pose).toEqual(idle.keys[0].pose);
 });
 it('returns undefined instead of touching the document past the key limit',()=>{
  const doc=docOf('idle');
  const fills=120-doc.keys.length;
  doc.keys.push(...Array.from({length:fills},(_,i)=>({...structuredClone(doc.keys[0]),id:`fill-${i}`,time:5+i*.0001})));
  doc.duration=10;
  const snapshot=JSON.stringify(doc);
  expect(applyPoseAt(doc,structuredClone(idle.keys[0].pose),5.5,origin)).toBeUndefined();
  expect(JSON.stringify(doc)).toBe(snapshot);
 });
 it('replacing an existing pose does not grow the key list even at the limit',()=>{
  const doc=docOf('idle');
  const n0=doc.keys.length;
  const result=applyPoseAt(doc,structuredClone(idle.keys[1].pose),doc.keys[0].time,origin);
  expect(result?.result).toBe('replaced');
  expect(doc.keys).toHaveLength(n0);
  expect(doc.keys[0].pose).toEqual(idle.keys[1].pose);
 });

 it('holds foot targets on a planted non-anchor key: the solver really keeps the support contact',()=>{
  // Regression for the contactPlan trap: idle is planted throughout, so its
  // middle keys' foot channels are pinned to the run anchor. Writing a wide
  // stance there must NOT claim the feet moved — the channels are skipped
  // and the solved ankles stay at the anchor contact. The knee pole is not
  // locked and still applies.
  const doc=docOf('idle');
  const wide=structuredClone(docOf('basic-wide-squat').keys[1].pose);
  const t=doc.keys[1].time;
  const solved=(time:number)=>{
   rig.reset();solveEffectiveFrame(rig,frameAt(doc,time,origin));
   return {L:rig.point('foot_L').clone(),R:rig.point('foot_R').clone()};
  };
  const before=solved(t);
  const report=applyPoseAt(doc,wide,t,origin);
  expect(report?.result).toBe('replaced');
  expect(report?.heldFoot).toEqual(['L','R']);
  // Locked channels (target x/y/z, yaw, pitch) keep the key's own values…
  expect(doc.keys[1].pose.footL.target).toEqual(docOf('idle').keys[1].pose.footL.target);
  expect(doc.keys[1].pose.footR.yaw).toBe(docOf('idle').keys[1].pose.footR.yaw);
  expect(doc.keys[1].pose.footR.pitch).toBe(docOf('idle').keys[1].pose.footR.pitch);
  // …the editable knee pole follows the stamped pose…
  expect(doc.keys[1].pose.footL.pole.x).toBeCloseTo(wide.footL.pole.x,9);
  // …and the upper body applies.
  expect(doc.keys[1].pose.root.y).toBeCloseTo(wide.root.y,9);
  // The SOLVED feet confirm the hold: no stance change on the real rig.
  const after=solved(t);
  expect(after.L.distanceTo(before.L)).toBeLessThan(1e-4);
  expect(after.R.distanceTo(before.R)).toBeLessThan(1e-4);
 });
 it('holds the liftoff boundary too: a released key right after a planted run inherits the contact',()=>{
  // contactPlan pins the released key's instant to the run contact, so the
  // same honesty rule applies as for planted run members. The other foot
  // (free on both keys) is written and really moves.
  const doc=docOf('idle');
  doc.keys[0].constraints.plantR=false; // R free on both keys
  doc.keys[1].constraints.plantL=false; // L: planted → released (liftoff)
  doc.keys[1].constraints.plantR=false;
  const wide=structuredClone(docOf('basic-wide-squat').keys[1].pose);
  const t=doc.keys[1].time;
  const solved=(time:number)=>{
   rig.reset();solveEffectiveFrame(rig,frameAt(doc,time,origin));
   return {L:rig.point('foot_L').clone(),R:rig.point('foot_R').clone()};
  };
  const before=solved(t);
  const report=applyPoseAt(doc,wide,t,origin);
  expect(report?.heldFoot).toEqual(['L']);
  // L keeps its locked channels and gains the pole; R takes the wide target.
  expect(doc.keys[1].pose.footL.target.x).toBeCloseTo(docOf('idle').keys[1].pose.footL.target.x,9);
  expect(doc.keys[1].pose.footL.pole.x).toBeCloseTo(wide.footL.pole.x,9);
  expect(doc.keys[1].pose.footR.target.x).toBeCloseTo(wide.footR.target.x,9);
  const after=solved(t);
  expect(after.L.distanceTo(before.L)).toBeLessThan(1e-4);
  expect(after.R.x).toBeCloseTo(wide.footR.target.x,2);
 });
 it('fully planted loop: key 0 is the run anchor and stays editable',()=>{
  // contactPlan forces key 0 to anchor a fully planted loop (`s<0?0:s`) —
  // writing its target re-anchors the whole run, so it must not be held
  // even though its cyclic predecessor is planted.
  const doc=blankDocument(rig.rest,'循环锚点','loop-anchor');
  doc.duration=1.2;doc.loop=true;
  expect(doc.keys.every(k=>k.constraints.plantL&&k.constraints.plantR)).toBe(true);
  const wide=structuredClone(docOf('basic-wide-squat').keys[1].pose);
  const report=applyPoseAt(doc,wide,0,origin);
  expect(report?.heldFoot).toEqual([]);
  expect(doc.keys[0].pose.footL.target.x).toBeCloseTo(wide.footL.target.x,9);
  rig.reset();solveEffectiveFrame(rig,frameAt(doc,0,origin));
  expect(rig.point('foot_L').x).toBeCloseTo(wide.footL.target.x,2);
  expect(rig.point('foot_R').x).toBeCloseTo(wide.footR.target.x,2);
 });
 it('writes foot targets on free feet: the solved feet take the new stance',()=>{
  // Both keys released: no support run anywhere, so the written targets are
  // the effective ones (a released key directly AFTER a planted run would
  // still inherit that run's contact — the liftoff semantics).
  const doc=docOf('idle');
  for(const k of doc.keys){k.constraints.plantL=false;k.constraints.plantR=false;}
  const wide=structuredClone(docOf('basic-wide-squat').keys[1].pose);
  const t=doc.keys[1].time;
  const report=applyPoseAt(doc,wide,t,origin);
  expect(report?.heldFoot).toEqual([]);
  rig.reset();solveEffectiveFrame(rig,frameAt(doc,t,origin));
  expect(rig.point('foot_L').x).toBeCloseTo(.33,2);
  expect(rig.point('foot_R').x).toBeCloseTo(-.33,2);
 });
});
