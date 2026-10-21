import {beforeAll,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import {Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {angleAt,frameAt,HumanRig,normalizeDoc,solveEffectiveFrame} from '@human3d/motion-core';
import type {WorkshopDoc} from '@human3d/motion-core';
import {armLengths,placeOffArm,placeRacketArm,readReference,setHand,torsoFrame} from './lib/forehand-arms.mts';

/** The forehand arm reference is the USER'S hand-authored workshop document
 * (scripts/forehand-arm-reference.json). Its 引拍1 / 引拍2 / 击球 racket and off
 * arms are authored poses; everything else in that document was an untouched
 * copy of the old generated preset. The preset generator transfers those three
 * poses onto each player's trunk through torso-frame coefficients, so this file
 * guards the transfer itself:
 *   1. the reference document still carries the authored values (a silent edit
 *      to the JSON must fail here, not in a screenshot six weeks later);
 *   2. reading the poses into torso coefficients and re-placing them on the
 *      SAME trunk reproduces the authored wrists/elbows exactly;
 *   3. the shapes stay inside the solver's joint limits when placed. */
let rig:HumanRig;
let reference:WorkshopDoc;
const root=()=>rig.rest.get('root')!;
const v=(a:{x:number;y:number;z:number})=>new Vector3(a.x,a.y,a.z);

beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
 const raw=JSON.parse(fs.readFileSync('scripts/forehand-arm-reference.json','utf8'));
 reference=normalizeDoc(raw.document) as WorkshopDoc;
},30000);

const AUTHORS=['引拍1','引拍2','击球'];
const solve=(doc:WorkshopDoc,time:number)=>solveEffectiveFrame(rig,frameAt(doc,time,root()));

describe('hand-authored forehand arm reference',()=>{
 it('declares exactly the three authored keys and refuses to be read as more',()=>{
  const raw=JSON.parse(fs.readFileSync('scripts/forehand-arm-reference.json','utf8'));
  expect(raw.authoredKeys).toEqual(['ke3f3aa','klg6yno','klg6yno-copy']);
  expect(reference.keys.filter(k=>AUTHORS.includes(k.label)).map(k=>k.label)).toEqual(AUTHORS);
  // The remaining keys are inherited from the generated preset — the file says
  // so, and the generator must not treat them as reference data.
  expect(raw.inheritedNotice).toMatch(/NOT reference/);
 });

 it('transfers each authored pose onto the same trunk without moving it',()=>{
  const coeffs=readReference(rig,reference,AUTHORS,(doc,time)=>solveEffectiveFrame(rig,frameAt(doc as WorkshopDoc,time,root())));
  const rebuilt=structuredClone(reference);
  const racketArm=armLengths(rig,'R'),offArm=armLengths(rig,'L');
  for(const label of AUTHORS){
   const key=rebuilt.keys.find(k=>k.label===label)!;
   solve(reference,key.time);
   const before={wr:rig.point('wrist_R').clone(),er:rig.point('lowerarm01_R').clone(),wl:rig.point('wrist_L').clone()};
   const f=torsoFrame('R',rig.point('upperarm01_R'),rig.point('upperarm01_L'));
   setHand(key.pose.handR,placeRacketArm(f,racketArm,coeffs[label].racket));
   setHand(key.pose.handL,placeOffArm(f,offArm,f.offShoulder,coeffs[label].off));
   solve(rebuilt,key.time);
   expect(rig.point('wrist_R').distanceTo(before.wr),`${label} racket wrist`).toBeLessThan(1e-4);
   expect(rig.point('lowerarm01_R').distanceTo(before.er),`${label} racket elbow`).toBeLessThan(1e-4);
   expect(rig.point('wrist_L').distanceTo(before.wl),`${label} off wrist`).toBeLessThan(1e-4);
  }
 });

 it('keeps the transferred shapes inside the solver joint limits',()=>{
  const coeffs=readReference(rig,reference,AUTHORS,(doc,time)=>solveEffectiveFrame(rig,frameAt(doc as WorkshopDoc,time,root())));
  const rebuilt=structuredClone(reference);
  const racketArm=armLengths(rig,'R'),offArm=armLengths(rig,'L');
  for(const label of AUTHORS){
   const key=rebuilt.keys.find(k=>k.label===label)!;
   const f=(solve(reference,key.time),torsoFrame('R',rig.point('upperarm01_R'),rig.point('upperarm01_L')));
   setHand(key.pose.handR,placeRacketArm(f,racketArm,coeffs[label].racket));
   setHand(key.pose.handL,placeOffArm(f,offArm,f.offShoulder,{...coeffs[label].off,reach:coeffs[label].off.reach*.86}));
   solve(rebuilt,key.time);
   for(const side of ['L','R'] as const){
    const elbow=angleAt(rig.point(`upperarm01_${side}`),rig.point(`lowerarm01_${side}`),rig.point(`wrist_${side}`));
    expect(elbow,`${label} ${side} elbow`).toBeLessThan(145);
    expect(elbow,`${label} ${side} elbow`).toBeGreaterThan(0);
    const hand=side==='R'?key.pose.handR:key.pose.handL;
    const wrist=rig.point(`wrist_${side}`);
    expect(wrist.distanceTo(v(hand.target)),`${label} ${side} wrist residual`).toBeLessThan(.01);
   }
  }
 });
});
