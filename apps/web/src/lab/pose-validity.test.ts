import {beforeAll,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Vector3} from 'three';
import type {SkinnedMesh} from 'three';
import {angleAt,attachRacket,blankDocument,DEG,frameAt,HumanRig,LIMITS,MOTION_FILES,mountRacket,solveEffectiveFrame} from '@human3d/motion-core';
import type {WorkshopDoc} from '@human3d/motion-core';
import {PoseValidityChecker} from './pose-validity';

type Arm={target:{x:number;y:number;z:number};pole:{x:number;y:number;z:number}};
let rig:HumanRig,mesh:SkinnedMesh,checker:PoseValidityChecker;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
 rig.model.traverse(object=>{if((object as SkinnedMesh).isSkinnedMesh)mesh=object as SkinnedMesh;});
 checker=new PoseValidityChecker(mesh,rig);
},30000);

function solved(doc:WorkshopDoc,time=.5){
 solveEffectiveFrame(rig,frameAt(doc,time,rig.rest.get('root')!));
 rig.model.updateMatrixWorld(true);
 return checker.inspect();
}
function documentWithArms(name:string,right:Arm,left?:Arm){
 const doc=blankDocument(rig.rest,name,name.toLowerCase().replaceAll(' ','-'));
 for(const key of doc.keys){
  key.pose.handR.target={...right.target};key.pose.handR.pole={...right.pole};
  if(left){key.pose.handL.target={...left.target};key.pose.handL.pole={...left.pole};}
 }
 return doc;
}
function projectedArmGap(){
 const a0=rig.point('lowerarm01_L'),a1=rig.point('wrist_L'),b0=rig.point('lowerarm01_R'),b1=rig.point('wrist_R');
 let gap=Infinity,depth=0;
 // Dense segment sampling makes this a direct check of the visible front-view
 // overlap while retaining the corresponding solved 3D depth separation.
 for(let i=0;i<=200;i++)for(let j=0;j<=200;j++){
  const u=i/200,v=j/200;
  const ax=a0.x+(a1.x-a0.x)*u,ay=a0.y+(a1.y-a0.y)*u;
  const bx=b0.x+(b1.x-b0.x)*v,by=b0.y+(b1.y-b0.y)*v;
  const d=Math.hypot(ax-bx,ay-by);
  if(d<gap){gap=d;depth=Math.abs((a0.z+(a1.z-a0.z)*u)-(b0.z+(b1.z-b0.z)*v));}
 }
 return {gap,depth};
}
const elbowFlexion=(side:'L'|'R')=>angleAt(rig.point(`upperarm01_${side}`),rig.point(`lowerarm01_${side}`),rig.point(`wrist_${side}`));

describe('Lab pose validity on the production skinned rig',()=>{
 it('accepts crossed forearms whose front projections overlap but whose 3D surfaces remain separated',()=>{
  const report=solved(documentWithArms('Crossed arms',
   {target:{x:.05,y:1.3,z:.45},pole:{x:-.4,y:1.45,z:-.2}},
   {target:{x:-.05,y:1.3,z:.3},pole:{x:.2,y:1.45,z:.6}}));
  const projection=projectedArmGap();
  expect(projection.gap).toBeLessThan(.01);
  expect(projection.depth).toBeGreaterThan(.05);
  expect(report.status).toBe('valid');
  expect(report.intersections.map(x=>x.count)).toEqual([0,0]);
  expect(report.checks.every(check=>check.ok)).toBe(true);
 });

 it('reports a right arm swept through the chest — the pre-fix forehand follow-through shape',()=>{
  // Wrist wrapped to the far side with the elbow pole still parked behind the
  // trunk: the two-bone solve puts the elbow inside the torso while every
  // joint-limit reading stays legal, so only the surface check can see it.
  const report=solved(documentWithArms('Arm through torso',{target:{x:.3,y:1.38,z:.07},pole:{x:-.48,y:1.15,z:.11}}));
  const right=report.intersections.find(hit=>hit.side==='R')!;
  expect(report.status).toBe('invalid');
  expect(right.count).toBeGreaterThan(0);
  expect(right.bones).toContain('upperarm01_R');
  expect(right.bones.some(name=>/^spine\d+$/.test(name))).toBe(true);
  expect(right.position?.every(Number.isFinite)).toBe(true);
  expect(report.checks.every(check=>check.ok)).toBe(true);
 });

 it('keeps the shipped forehand follow-through (t=3.35 s) clear of the torso',()=>{
  // Regression for the 2026-10-20 fix: this instant used to report ~250
  // right arm–torso triangle crossings through the same sampler and solver.
  const doc=MOTION_FILES.find(m=>m.id==='forehand')!.document!;
  const report=solved(doc,3.35);
  expect(report.status).not.toBe('invalid');
  expect(report.intersections.map(x=>x.count)).toEqual([0,0]);
  expect(report.checks.every(check=>check.ok)).toBe(true);
 });

 it('keeps every bundled racket motion off the elbow clamp and clear of the torso',()=>{
  // The player presets used to fold the racket arm into the trunk (wrist
  // targets 0.14–0.17 m from the shoulder against 0.53 m of arm → the solver's
  // 145° flexion clamp). Sample every key plus a uniform grid through the real
  // frameAt → solveEffectiveFrame path and require both arms to stay below the
  // clamp, with no arm–torso surface crossing and every joint check passing.
  const racket=MOTION_FILES.filter(f=>f.kind==='workshop-motion'&&f.capabilities?.prop?.kind==='racket');
  expect(racket.map(f=>f.id)).toEqual(expect.arrayContaining(['ready','forehand','novak-djokovic-forehand','ben-shelton-forehand']));
  for(const file of racket){
   const doc=file.document!;
   const times=new Set(doc.keys.map(k=>k.time));
   for(let i=0;i<=16;i++)times.add(doc.duration*i/16);
   for(const t of times){
    const report=solved(doc,t);
    const at=`${file.id} @${t.toFixed(3)}s`;
    for(const side of ['L','R'] as const)expect(elbowFlexion(side),`${at} elbow ${side}`).toBeLessThan(LIMITS.elbowFlexion[1]-.5);
    expect(report.intersections.map(x=>x.count),at).toEqual([0,0]);
    expect(report.checks.filter(check=>!check.ok).map(check=>check.code),at).toEqual([]);
   }
  }
 },120000);

 it('swings every forehand through a straight contact into a folded finish at the off shoulder',()=>{
  // The forehand arm choreography (scripts/lib/forehand-arms.mts): through the
  // ball the forearm catches up with the upper arm (elbow < 30°); the finish
  // folds the elbow with the hand in front of the off shoulder, the racket
  // axis within ~30° of vertical and the head above that shoulder. The off arm
  // guards in front of the chest at takeback (elbow 40–110°, hand forward of
  // and across from its shoulder, not hanging at the hip) and ends on the
  // racket throat. Measured at the envelope phase markers through the real
  // sampler, solver and racket mount.
  const origin=rig.rest.get('root')!;
  const forehands=MOTION_FILES.filter(f=>f.kind==='workshop-motion'&&f.capabilities?.prop?.kind==='racket'&&f.phases?.some(p=>p.label==='引拍'));
  expect(forehands.length).toBe(18);
  const racket=attachRacket(rig);
  const phaseTime=(file:typeof forehands[number],label:string)=>file.phases!.find(p=>p.label===label)!.time;
  for(const file of forehands){
   const doc=file.document!,dominant=doc.gripSide==='L'?'L':'R',off=dominant==='L'?'R':'L';
   mountRacket(rig,racket,dominant);
   const at=(t:number)=>{solveEffectiveFrame(rig,frameAt(doc,t,origin));rig.model.updateMatrixWorld(true);};
   const racketAxis=()=>{const o=racket.localToWorld(new Vector3());return {origin:o,axis:racket.localToWorld(new Vector3(0,1,0)).sub(o).normalize()};};
   // takeback: off arm guarding in front of the chest
   at(phaseTime(file,'引拍'));
   const offShoulder=rig.point(`upperarm01_${off}`),offWrist=rig.point(`wrist_${off}`),racketShoulder=rig.point(`upperarm01_${dominant}`);
   const front=offShoulder.clone().sub(racketShoulder).setY(0).normalize().cross(new Vector3(0,1,0)).multiplyScalar(dominant==='R'?1:-1);
   expect(elbowFlexion(off),`${file.id} guard elbow`).toBeGreaterThan(40);
   expect(elbowFlexion(off),`${file.id} guard elbow`).toBeLessThan(110);
   expect(offWrist.clone().sub(offShoulder).dot(front),`${file.id} guard hand forward of shoulder`).toBeGreaterThan(.25);
   expect(offWrist.y-offShoulder.y,`${file.id} guard hand height`).toBeGreaterThan(-.25);
   // takeback → contact: the shoulder takes the upper arm DOWN first (the
   // drop, bottom of the C) and then diagonally UP into the finish — the
   // upper arm's elevation is the swing's main line, not a rotation about
   // the vertical axis only.
   const upperElevation=()=>{const s=rig.point(`upperarm01_${dominant}`),e=rig.point(`lowerarm01_${dominant}`);return Math.asin(Math.max(-1,Math.min(1,e.clone().sub(s).normalize().y)))/DEG;};
   const tTake=phaseTime(file,'引拍'),tHit=phaseTime(file,'击球区');
   at(tTake);const takebackElev=upperElevation();
   let dropElev=Infinity;
   for(let i=0;i<=20;i++){at(tTake+(tHit-tTake)*i/20);dropElev=Math.min(dropElev,upperElevation());}
   expect(dropElev,`${file.id} upper arm drops below the takeback`).toBeLessThan(takebackElev-12);
   // contact: racket arm nearly straight
   at(tHit);
   expect(elbowFlexion(dominant),`${file.id} contact elbow`).toBeLessThan(30);
   // finish: elbow folded, racket near vertical with the head above the off shoulder, off hand on the throat
   at(phaseTime(file,'随挥'));
   const {origin:grip,axis}=racketAxis();
   const head=grip.clone().addScaledVector(axis,.445),throat=grip.clone().addScaledVector(axis,.2);
   const finishShoulder=rig.point(`upperarm01_${off}`);
   expect(elbowFlexion(dominant),`${file.id} finish elbow`).toBeGreaterThan(55);
   expect(elbowFlexion(dominant),`${file.id} finish elbow`).toBeLessThan(110);
   expect(axis.angleTo(new Vector3(0,1,0))/DEG,`${file.id} finish racket tilt`).toBeLessThan(35);
   expect(head.y-finishShoulder.y,`${file.id} finish head above off shoulder`).toBeGreaterThan(.25);
   expect(Math.hypot(head.x-finishShoulder.x,head.z-finishShoulder.z),`${file.id} finish head over off shoulder`).toBeLessThan(.35);
   expect(rig.point(`wrist_${off}`).distanceTo(throat),`${file.id} off hand on the throat`).toBeLessThan(.12);
   expect(upperElevation(),`${file.id} upper arm rises from the drop to the finish`).toBeGreaterThan(dropElev+45);
  }
  racket.removeFromParent();
 },60000);

 it('reports a shoulder direction outside the diagnostic anatomical envelope',()=>{
  const report=solved(documentWithArms('Shoulder direction limit',
   {target:{x:0,y:1.4,z:-.1},pole:{x:.5,y:1.6,z:-.3}},
   {target:{x:-.15,y:1.1,z:.25},pole:{x:-.5,y:1.2,z:.5}}));
  const shoulder=report.checks.find(check=>check.code==='shoulder-direction-R')!;
  expect(shoulder.ok).toBe(false);
  expect(shoulder.value).toBeGreaterThan(shoulder.limit);
  expect(report.status).toBe('invalid');
  expect(report.checks.filter(check=>!check.ok).map(check=>check.code)).toEqual(['shoulder-direction-R']);
 });
});
