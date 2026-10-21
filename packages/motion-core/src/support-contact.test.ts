import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from './rig';
import {motionFileById} from './motion-files';
import {type WorkshopDoc} from './document';
import {probeDocument} from './quality-probe';
import {CONTACT_FLOOR_TOL_M,supportDrift} from './support-contact';
import {VALIDATION_LIMITS} from './validate';

/* ADR-0010 support-contact slip. The helper is exercised on the real rest rig
 * (real toe joints and sole plane); the lunge case runs the real solve path. */
let rig:HumanRig;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
},30000);

/** Synthetic sample series: the rest foot joints, each moved by `move(k, name)`. */
const series=(move:(k:number,name:string)=>Vector3)=>(k:number,name:string)=>rig.rest.get(name)!.clone().add(move(k,name));
const none=()=>new Vector3();
const isToe=(name:string)=>name.startsWith('toe')&&name.endsWith('_R');

describe('support-contact slip (ADR-0010)',()=>{
 it('a foot standing still has no slip, judged on its floor contacts',()=>{
  const d=supportDrift('R',rig.rest,6,series(none));
  expect(d.contacts).toBe(true);
  expect(isToe(d.bone)).toBe(true);
  expect(d.value).toBe(0);
 });

 it('an ankle travelling above a toe that stays on the floor is not slip',()=>{
  const ankleMoves=(k:number,name:string)=>name==='foot_R'?new Vector3(k*.01,0,0):none();
  const d=supportDrift('R',rig.rest,6,series(ankleMoves));
  expect(d.contacts).toBe(true);
  expect(d.value).toBeLessThan(1e-9);
 });

 it('a whole foot sliding along the floor is slip, measured on the contact toes',()=>{
  const slides=(k:number)=>new Vector3(k*.003,0,0);
  const d=supportDrift('R',rig.rest,6,series(slides));
  expect(d.contacts).toBe(true);
  expect(isToe(d.bone)).toBe(true);
  expect(d.value).toBeCloseTo(5*.003,9);
 });

 it('a planted foot with no floor contact falls back to the ankle 3-D drift',()=>{
  const lifted=(k:number)=>new Vector3(k*.004,.05,0);
  const d=supportDrift('R',rig.rest,6,series(lifted));
  expect(d.contacts).toBe(false);
  expect(d.bone).toBe('foot_R');
  expect(d.value).toBeCloseTo(5*.004,9);
 });

 it('contact tolerance is the 1 cm floor band',()=>{
  expect(CONTACT_FLOOR_TOL_M).toBe(.01);
  expect(VALIDATION_LIMITS.supportSlipM).toBe(.01);
 });

 it('the real lunge: the rear foot is held by its toes while the ankle travels past the limit',()=>{
  const doc=structuredClone(motionFileById('basic-lunge')!.document!) as WorkshopDoc;
  const report=probeDocument(rig,doc,{fps:120});
  const rear=report.footSlip.find(s=>s.side==='R')!;
  expect(isToe(rear.contactBone)).toBe(true);
  expect(rear.contactDrift).toBeLessThan(VALIDATION_LIMITS.supportSlipM);
  expect(rear.maxDrift).toBeGreaterThan(VALIDATION_LIMITS.supportSlipM);
 });
});
