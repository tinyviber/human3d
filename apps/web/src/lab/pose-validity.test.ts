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

 it('swings every forehand through the hand-authored reference into a folded finish at the off shoulder',()=>{
  // The player presets are rebuilt from the USER'S hand-authored workshop
  // document (scripts/forehand-arm-reference.json): its 引拍1 / 引拍2 / 击球 racket
  // and off arms are the reference, read back as torso-frame coefficients. This
  // test pins what that reference actually contains, measured on the production
  // sampler + solver + racket mount, so a future regeneration cannot quietly
  // drift away from it. The thresholds are the authored pose ± a small band;
  // the reference's own solved values are quoted in each comment.
  //
  // The bundled 49-key `forehand` is NOT part of this contract — the user's
  // 2026-10-20 note judged its arms wrong, and it is tracked separately.
  const origin=rig.rest.get('root')!;
  const forehands=MOTION_FILES.filter(f=>f.kind==='workshop-motion'&&f.capabilities?.prop?.kind==='racket'
   &&f.phases?.some(p=>p.label==='引拍')&&f.id!=='forehand');
  expect(forehands.length).toBe(17);
  const racket=attachRacket(rig);
  const phaseTime=(file:typeof forehands[number],label:string)=>file.phases!.find(p=>p.label===label)!.time;
  for(const file of forehands){
   const doc=file.document!,dominant=doc.gripSide==='L'?'L':'R',off=dominant==='L'?'R':'L';
   mountRacket(rig,racket,dominant);
   const at=(t:number)=>{solveEffectiveFrame(rig,frameAt(doc,t,origin));rig.model.updateMatrixWorld(true);};
   const racketAxis=()=>{const o=racket.localToWorld(new Vector3());return {origin:o,axis:racket.localToWorld(new Vector3(0,1,0)).sub(o).normalize()};};
   const upperElevation=()=>{const s=rig.point(`upperarm01_${dominant}`),e=rig.point(`lowerarm01_${dominant}`);return Math.asin(Math.max(-1,Math.min(1,e.clone().sub(s).normalize().y)))/DEG;};
   // 引拍: off arm from per-player video semantics (evidence/forehand-semantics.json).
   // Video takeback is near-straight (inner elbow 136–179° ⇒ flexion ≈ 1–44°),
   // pointing toward the oncoming ball at about shoulder height. The old
   // authored Djokovic guard (flexion ≈ 113°) is the fallback only.
   at(phaseTime(file,'引拍'));
   const offShoulder=rig.point(`upperarm01_${off}`),offWrist=rig.point(`wrist_${off}`),racketShoulder=rig.point(`upperarm01_${dominant}`);
   const front=offShoulder.clone().sub(racketShoulder).setY(0).normalize().cross(new Vector3(0,1,0)).multiplyScalar(dominant==='R'?1:-1);
   expect(elbowFlexion(off),`${file.id} guard elbow`).toBeGreaterThan(5);
   expect(elbowFlexion(off),`${file.id} guard elbow`).toBeLessThan(90); // near-straight video takeback
   expect(offWrist.clone().sub(offShoulder).dot(front),`${file.id} guard hand forward of shoulder`).toBeGreaterThan(.05);
   expect(offWrist.y-offShoulder.y,`${file.id} guard hand height`).toBeGreaterThan(-.45);
   // 引拍 → 击球区: the shoulder takes the upper arm DOWN first (落拍, the
   // authored 引拍2 is the bottom of the C) and then UP into the ball. Authored
   // elevations: −19.9° (引拍1) → −42.9° (引拍2) → −23.2° (击球).
   const tTake=phaseTime(file,'引拍'),tHit=phaseTime(file,'击球区');
   at(tTake);const takebackElev=upperElevation();
   let dropElev=Infinity;
   for(let i=0;i<=20;i++){at(tTake+(tHit-tTake)*i/20);dropElev=Math.min(dropElev,upperElevation());}
   expect(dropElev,`${file.id} upper arm drops below the takeback`).toBeLessThan(takebackElev-12);
   // 击球 (= authored 击球): the racket is horizontal and points across the
   // body; the authored elbow is 47.9°, the arm NOT straight. The old "<30° at
   // contact" bound came from the previous generator and is retired here.
   at(tHit);
   expect(elbowFlexion(dominant),`${file.id} contact elbow`).toBeGreaterThan(20);
   expect(elbowFlexion(dominant),`${file.id} contact elbow`).toBeLessThan(70);
   const hitAxis=racketAxis().axis;
   expect(Math.abs(hitAxis.y),`${file.id} contact racket axis horizontal`).toBeLessThan(.35);
   // 随挥: elbow folded, racket near vertical with the head above the off
   // shoulder, off hand on the throat (all designed around the reference).
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
   // Measured rise across the 17 presets is 29.5°–34.2° (the shortest-reach
   // player sits at the bottom: a folded finish bends the elbow more, which
   // lowers the finish elevation). The bound pins the rise as real without
   // demanding a longer lever than a short player has.
   expect(upperElevation(),`${file.id} upper arm rises from the drop to the finish`).toBeGreaterThan(dropElev+28);
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
