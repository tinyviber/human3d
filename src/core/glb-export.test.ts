import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {AnimationMixer,Quaternion,Vector3,type AnimationClip,type Bone,type Group} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {exportGlb,posePackageToClip} from './glb-export';
import {buildRigManifest,sha256,type RigManifest} from '../server/rig-manifest';
import {installFileReaderShim} from '../../scripts/lib/filereader-shim.mts';
import type {PosePackage} from './pose-package';

/* GLB export coverage on the real Node path: golden idle package →
 * posePackageToClip → exportGlb on a CLEAN human.glb re-parse (the live-rig
 * contamination rule) → GLTFLoader read-back. Wire-level structure comes from
 * the GLB's own JSON chunk; correctness is a mixer-vs-FK roundtrip — the
 * decoded animation's world positions must agree with an independent FK walk
 * of the package (the same second-implementation pattern motion-source.test
 * uses against PosePackageSource). A tampered-package control proves the
 * roundtrip binds the file bytes, not the package in memory. */
let humanGlb:ArrayBuffer,manifest:RigManifest,golden:PosePackage;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 humanGlb=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 const rigJsonBytes=fs.readFileSync('public/models/rig.json');
 manifest=buildRigManifest(JSON.parse(rigJsonBytes.toString('utf8')),sha256(rigJsonBytes));
 golden=JSON.parse(fs.readFileSync('spec/examples/idle.pose.json','utf8'));
 installFileReaderShim(); // GLTFExporter's binary path reads Blobs via FileReader
},30000);

interface GlbJson{
 animations:{name:string;channels:{sampler:number;target:{node:number;path:string}}[];
  samplers:{input:number;output:number;interpolation:string}[]}[];
 nodes:{name?:string}[];accessors:{count:number;max?:number[];min?:number[]}[];
}
/** GLB container header + JSON chunk — the assertions deliberately read the
 * file's own declarations, not the parsed scene. */
function glbJson(buf:ArrayBuffer):GlbJson{
 const dv=new DataView(buf);
 expect(dv.getUint32(0,true)).toBe(0x46546c67); // 'glTF'
 expect(dv.getUint32(4,true)).toBe(2); // glTF version
 expect(dv.getUint32(8,true)).toBe(buf.byteLength); // declared length == bytes
 expect(dv.getUint32(16,true)).toBe(0x4e4f534a); // 'JSON'
 return JSON.parse(new TextDecoder().decode(new Uint8Array(buf,20,dv.getUint32(12,true))));
}
/** Export a package through a fresh model parse, then read the GLB back. */
async function bake(pkg:PosePackage){
 const model=(await new GLTFLoader().parseAsync(humanGlb,'')).scene;
 const buf=await exportGlb(model,posePackageToClip(pkg));
 const back=await new GLTFLoader().parseAsync(buf,'');
 return {buf,scene:back.scene,clip:back.animations[0]};
}
/** Independent FK re-walk of a package at arbitrary time (copied from
 * motion-source.test.ts on purpose — agreement with the mixer decode is a
 * real cross-check only while the math shares no code): manifest rest
 * translations + delivered local rotations slerped between bracketing
 * samples, untracked bones at identity local rotation. */
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
/** Worst world-position deviation between the mixer's decode of `clip` on
 * `scene` and the independent FK walk of `pkg`, across `times`. */
function worstDeviation(scene:Group,clip:AnimationClip,pkg:PosePackage,times:number[]){
 const bones=new Map<string,Bone>();
 scene.traverse(o=>{if((o as Bone).isBone)bones.set(o.name,o as Bone);});
 const mixer=new AnimationMixer(scene),action=mixer.clipAction(clip);
 action.play();
 const p=new Vector3();
 let worst=0,bone='';
 for(const t of times){
  // The ClipSource seek idiom: steer the action's time, update(0) applies it.
  action.enabled=true;action.setEffectiveWeight(1);action.paused=false;
  action.time=Math.min(clip.duration-1e-6,Math.max(0,t));
  mixer.update(0);scene.updateMatrixWorld(true);
  const wp=fkWorldAt(pkg,t);
  for(const [n,b]of bones){
   const d=b.getWorldPosition(p).distanceTo(wp.get(n)!);
   if(d>worst){worst=d;bone=n;}
  }
 }
 return {worst,bone};
}

// Grid, off-grid and tail times. 2.4 (= ts[96]) is included because the
// negative control tampers with exactly that sample — the corrupted key's
// deviation peaks at its own timestamp and is invisible between brackets.
const TIMES=[0,.0137,.0375,.5,1.111,2.2,2.4,4.0,4.79,4.8];

describe('posePackageToClip',()=>{
 it('keys every rotation track plus root translation on the package timeline verbatim',()=>{
  const clip=posePackageToClip(golden);
  expect(clip.name).toBe(golden.id);
  expect(clip.duration).toBe(golden.timeline.duration);
  expect(clip.tracks.length).toBe(golden.tracks.rotations.length+1);
  const names=clip.tracks.map(t=>t.name);
  for(const tr of golden.tracks.rotations)expect(names).toContain(`${tr.bone}.quaternion`);
  expect(names).toContain(`${golden.tracks.translation.bone}.position`);
  // No resampling: every track carries the package's own timestamps — the
  // terminal key is exactly duration, whatever the fps grid produced.
  for(const t of clip.tracks){
   expect(t.times.length).toBe(golden.timeline.count);
   golden.timeline.timestamps.forEach((s,i)=>expect(t.times[i]).toBeCloseTo(s,5));
  }
 });
 it('uses the given name',()=>{
  expect(posePackageToClip(golden,'idle@40').name).toBe('idle@40');
 });
});

describe('exportGlb — golden package through a clean model parse',()=>{
 let glb:ArrayBuffer,scene:Group,clip:AnimationClip;
 beforeAll(async()=>{({buf:glb,scene,clip}=await bake(golden));},60000);
 it('is a glTF 2.0 binary container whose animation spans the package timeline',()=>{
  const json=glbJson(glb);
  expect(json.animations.length).toBe(1);
  const anim=json.animations[0];
  // Rotation channels == package rotation tracks, plus exactly one root
  // translation channel; every sampler input tops out at duration.
  expect(anim.channels.filter(c=>c.target.path==='rotation').length).toBe(golden.tracks.rotations.length);
  const trans=anim.channels.filter(c=>c.target.path==='translation');
  expect(trans.length).toBe(1);
  expect(json.nodes[trans[0].target.node].name).toBe('root');
  for(const s of anim.samplers)expect(json.accessors[s.input].max![0]).toBeCloseTo(golden.timeline.duration,5);
 });
 it('re-parses to a clip whose tracks all bind to real rig bones',()=>{
  expect(clip.duration).toBeCloseTo(golden.timeline.duration,5);
  const bones=new Set<string>();
  scene.traverse(o=>{if((o as Bone).isBone)bones.add(o.name);});
  expect(bones.size).toBe(163);
  expect(clip.tracks.length).toBe(golden.tracks.rotations.length+1);
  for(const t of clip.tracks)expect(bones.has(t.name.split('.')[0]),`track ${t.name}`).toBe(true);
 });
 it('mixer sampling reproduces the package FK world positions (f32 tolerance)',()=>{
  const {worst,bone}=worstDeviation(scene,clip,golden,TIMES);
  expect(worst,`worst bone ${bone}`).toBeLessThan(1e-3);
 });
 it('negative control: a tampered sample breaks the roundtrip',async()=>{
  const corrupted:PosePackage=JSON.parse(JSON.stringify(golden));
  const v=corrupted.tracks.rotations[0].values,i=(golden.timeline.count>>1)*4;
  v[i+2]+=.25;
  const n=Math.hypot(v[i],v[i+1],v[i+2],v[i+3]);
  for(let k=0;k<4;k++)v[i+k]/=n; // keep it a unit quaternion — a fair corruption
  const bad=await bake(corrupted);
  const {worst,bone}=worstDeviation(bad.scene,bad.clip,golden,TIMES);
  expect(worst,`worst bone ${bone}`).toBeGreaterThan(1e-3);
 },60000);
});
