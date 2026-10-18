import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {AnimationClip,AnimationMixer,Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from './rig';
import {attachRacket} from './racket';
import {checkPosePackageShape,ClipSource,DocumentSource,PosePackageSource} from './motion-source';
import {normalizeMotionFile} from './motion-file';
import {buildRigManifest,sha256,type RigManifest} from '../server/rig-manifest';
import type {PosePackage} from '../server/pose-package';

/* MotionSource coverage: the package shape gate on the golden artifact and on
 * broken copies, the reference decoder cross-proved against an independent
 * manifest FK walk (the same math measurePackage uses, extended to arbitrary
 * times — no shared decode code), and smoke coverage for the document and
 * clip sources through their real seek paths. */
let rig:HumanRig,manifest:RigManifest,golden:PosePackage;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const rigJson=JSON.parse(fs.readFileSync('public/models/rig.json','utf8'));
 rig=new HumanRig(gltf.scene,rigJson);
 attachRacket(rig);
 manifest=buildRigManifest(rigJson,sha256(fs.readFileSync('public/models/rig.json')));
 golden=JSON.parse(fs.readFileSync('spec/examples/idle.pose.json','utf8'));
},30000);

const validBones=()=>new Set(rig.bones.keys());
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));

describe('checkPosePackageShape',()=>{
 it('accepts the golden idle package',()=>{
  expect(checkPosePackageShape(golden,validBones())).toEqual([]);
  expect(checkPosePackageShape(golden)).toEqual([]);
 });
 it('rejects each broken copy with a readable problem',()=>{
  const cases:[string,(p:PosePackage)=>void,RegExp][]=[
   ['末时间戳不等于 duration',p=>{p.timeline.duration+=.5;},/末时间戳/],
   ['timestamps 乱序',p=>{const t=p.timeline.timestamps;[t[5],t[6]]=[t[6],t[5]];},/严格递增/],
   ['rotation values 长度',p=>{p.tracks.rotations[0].values=p.tracks.rotations[0].values.slice(0,-4);},/count×4/],
   ['未知 bone',p=>{p.tracks.rotations[0].bone='no_such_bone';},/rig 外的骨骼/],
   ['schemaVersion',p=>{(p as {schemaVersion:number}).schemaVersion=3;},/schemaVersion/],
  ];
  for(const [name,mutate,pattern]of cases){
   const p=clone(golden);mutate(p);
   const errs=checkPosePackageShape(p,validBones());
   expect(errs.length,`${name}: expected problems`).toBeGreaterThan(0);
   expect(errs.join('|'),`${name}: expected a matching message`).toMatch(pattern);
  }
 });
 it('fails closed on a non-object package',()=>{
  expect(checkPosePackageShape('nope').length).toBeGreaterThan(0);
  expect(new PosePackageSource(rig,42).status).toBe('error');
 });
});

/** Independent FK re-walk of a package at an arbitrary time: manifest rest
 * translations + delivered local rotations slerped between bracketing
 * samples. Mirrors measurePackage's traversal (restLocalT from bone heads,
 * identity for untracked bones) — a second implementation, so agreement with
 * PosePackageSource's three.js decode is a real cross-check. */
function fkWorldAt(pkg:PosePackage,t:number){
 const byBone=new Map(manifest.bones.map(b=>[b.name,b]));
 const headOf=(n:string)=>new Vector3(...(byBone.get(n)!.head as [number,number,number]));
 const restLocalT=(n:string)=>{const b=byBone.get(n)!;return b.parent?headOf(n).sub(headOf(b.parent)):headOf(n);};
 const tracks=new Map(pkg.tracks.rotations.map(tr=>[tr.bone,tr.values]));
 const ts=pkg.timeline.timestamps,count=ts.length,T=pkg.tracks.translation.values;
 let lo=0,hi=count-1;
 const time=Math.max(0,Math.min(pkg.timeline.duration,t));
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(ts[mid]<=time)lo=mid;else hi=mid-1;}
 const i=lo,j=Math.min(i+1,count-1),dt=ts[j]-ts[i],u=dt>1e-9?(time-ts[i])/dt:0;
 const wq=new Map<string,Quaternion>(),wp=new Map<string,Vector3>();
 const qa=new Quaternion(),qb=new Quaternion();
 for(const b of manifest.bones){
  const v=tracks.get(b.name);
  const lq=v?qa.fromArray(v,i*4).clone().slerp(qb.fromArray(v,j*4),u):new Quaternion();
  if(!b.parent){
   wq.set(b.name,lq);
   wp.set(b.name,new Vector3(T[i*3]+(T[j*3]-T[i*3])*u,T[i*3+1]+(T[j*3+1]-T[i*3+1])*u,T[i*3+2]+(T[j*3+2]-T[i*3+2])*u));
  }else{
   const pq=wq.get(b.parent)!,pp=wp.get(b.parent)!;
   wq.set(b.name,pq.clone().multiply(lq));
   wp.set(b.name,restLocalT(b.name).applyQuaternion(pq).add(pp));
  }
 }
 return wp;
}

describe('PosePackageSource — reference decoder',()=>{
 it('decodes the golden package to the same world positions an independent FK walk computes',()=>{
  const src=new PosePackageSource(rig,golden);
  expect(src.status).toBe('ready');
  const D=golden.timeline.duration;
  // Grid points and off-grid times, including one past the end (clamped).
  const times=[0,.0137,.0375,.5,1.111,2.2,D/2,D-.001,D,D+.4];
  for(const t of times){
   src.seek(t);
   const wp=fkWorldAt(golden,t);
   let worst=0,worstBone='';
   for(const b of manifest.bones){
    const d=rig.point(b.name).distanceTo(wp.get(b.name)!);
    if(d>worst){worst=d;worstBone=b.name;}
   }
   expect(worst,`t=${t} worst bone ${worstBone}`).toBeLessThan(1e-6);
   const rd=src.rootPoint().distanceTo(wp.get('root')!);
   expect(rd,`t=${t} root`).toBeLessThan(1e-6);
  }
 });
 it('exposes diagnostics and never wants the prop',()=>{
  const src=new PosePackageSource(rig,golden);
  src.seek(.5);
  const d=src.diagnostics();
  expect(d).not.toBeNull();
  expect(Number.isFinite(d!.knee)).toBe(true);
  expect(d!.bones).toBe(rig.bones.size);
  expect(src.wantsProp()).toBe(false);
 });
});

describe('DocumentSource smoke',()=>{
 const load=(id:string)=>normalizeMotionFile(JSON.parse(fs.readFileSync(`assets/motions/${id}.json`,'utf8'))).document!;
 it('seeks a grip document to finite poses and reports the prop',()=>{
  for(const id of ['ready','forehand']){
   const src=new DocumentSource(rig,load(id));
   for(const t of [0,.5,1.7,src.duration]){
    src.seek(t);
    expect(src.point('foot_L')!.toArray().every(Number.isFinite)).toBe(true);
    expect(src.rootPoint().toArray().every(Number.isFinite)).toBe(true);
   }
   src.seek(Math.min(2,src.duration));
   expect(src.wantsProp()).toBe(true);
   expect(src.diagnostics()!.bones).toBe(163);
  }
 });
 it('keeps a non-grip document prop-free',()=>{
  const src=new DocumentSource(rig,load('idle'));
  src.seek(1);
  expect(src.wantsProp()).toBe(false);
  expect(src.diagnostics()).not.toBeNull();
 });
});

describe('ClipSource smoke',()=>{
 it('plays the baked walk clip through the shared mixer without throwing',()=>{
  const clip=AnimationClip.parse(JSON.parse(fs.readFileSync('public/models/walk.json','utf8')));
  const meta=JSON.parse(fs.readFileSync('public/models/walk-meta.json','utf8'));
  const mixer=new AnimationMixer(rig.model);
  const src=new ClipSource(rig,mixer,mixer.clipAction(clip),new Vector3().fromArray(meta.stride));
  src.setLoop(true);src.activate();
  for(const t of [0,.3,.7,src.duration-.01]){
   src.seek(t);
   expect(src.rootPoint().toArray().every(Number.isFinite)).toBe(true);
   expect(src.point('foot_L')!.toArray().every(Number.isFinite)).toBe(true);
  }
  // The stride side effect of a loop wrap accumulates into modelOffset.
  src.loopWrapAdvance();
  expect(src.modelOffset.distanceTo(new Vector3().fromArray(meta.stride))).toBeLessThan(1e-9);
  expect(src.wantsProp()).toBe(false);
  const d=src.diagnostics()!;
  expect(Number.isFinite(d.knee)).toBe(true);
  src.deactivate();
 });
});
