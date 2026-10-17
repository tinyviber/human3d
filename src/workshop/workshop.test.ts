import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from '../core/rig';
import {attachRacket,gripFrame} from '../core/racket';
import {angleAt} from '../core/kinematics';
import {defaultDocument,ensureKey,flattenPose,frameAt,parseDoc,samplePose,serializeDoc,sortedKeys,toV,unflattenPose} from './document';
import {LIBRARY_KEY,MotionLibrary,type StorageLike} from './library';
import {analyzePose,rotateHandFrame,solvePose,supportPolygon} from './solver';

let rig:HumanRig,racket:ReturnType<typeof attachRacket>;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
 racket=attachRacket(rig);
},30000);

describe('workshop document',()=>{
 it('seeds a five-key forehand with constraints and a contact event',()=>{
  const doc=defaultDocument(rig.rest);
  expect(doc.keys.length).toBe(5);expect(doc.duration).toBe(.8);
  expect(doc.keys.every(k=>k.constraints.plantL&&k.constraints.plantR)).toBe(true);
  expect(doc.keys.filter(k=>k.constraints.contact).length).toBe(1);
 });
 it('flattens and restores poses bit-exactly',()=>{
  const doc=defaultDocument(rig.rest);
  for(const k of doc.keys)expect(unflattenPose(flattenPose(k.pose))).toEqual(k.pose);
 });
 it('round-trips through JSON',()=>{
  const doc=defaultDocument(rig.rest),back=parseDoc(serializeDoc(doc));
  expect(back.keys.length).toBe(doc.keys.length);
  expect(back.keys[2].constraints.contact).toBe(true);
  expect(back.keys[2].pose.handR.target.x).toBeCloseTo(doc.keys[2].pose.handR.target.x,10);
 });
 it('reproduces key poses at their exact times and stays finite between',()=>{
  const doc=defaultDocument(rig.rest),keys=sortedKeys(doc);
  for(const k of keys){
   const p=samplePose(keys,k.time);
   for(const [a,b]of [[flattenPose(p),flattenPose(k.pose)]]as const)for(let i=0;i<a.length;i++)expect(a[i]).toBeCloseTo(b[i],6);
  }
  for(let i=0;i<=200;i++){const p=samplePose(keys,i/200*doc.duration);expect(flattenPose(p).every(Number.isFinite)).toBe(true);}
 });
 it('holds planted-foot targets constant over each interval',()=>{
  const doc=defaultDocument(rig.rest),keys=sortedKeys(doc);
  for(let i=0;i<keys.length-1;i++){
   const k=keys[i];if(!k.constraints.plantL)continue;
   for(let s=0;s<=10;s++){
    const p=samplePose(keys,k.time+(keys[i+1].time-k.time)*s/10);
    expect(toV(p.footL.target).distanceTo(toV(k.pose.footL.target))).toBeLessThan(1e-9);
   }
  }
 });
 it('auto-keys by sampling the live pose at insert time',()=>{
  const doc=defaultDocument(rig.rest);
  const k=ensureKey(doc,.35);
  expect(doc.keys.length).toBe(6);expect(k.time).toBe(.35);
  const expected=samplePose(sortedKeys(doc),.35);
  for(let i=0;i<flattenPose(expected).length;i++)expect(flattenPose(k.pose)[i]).toBeCloseTo(flattenPose(expected)[i],6);
  expect(ensureKey(doc,.35).id).toBe(k.id);
 });
});
describe('workshop solver',()=>{
 it('keeps bone lengths and joint limits across the whole motion',()=>{
  const doc=defaultDocument(rig.rest);
  for(let i=0;i<=40;i++){
   const f=frameAt(doc,i/40*doc.duration);solvePose(rig,f.pose,f.constraints);
   for(const [n,b]of rig.bones){if(n!=='root')expect(b.position.distanceTo(rig.restLocal.get(n)!)).toBeLessThan(1e-7);expect(b.quaternion.length()).toBeCloseTo(1,4);}
   for(const side of ['L','R']as const){
    expect(angleAt(rig.point(`upperleg01_${side}`),rig.point(`lowerleg01_${side}`),rig.point(`foot_${side}`))).toBeLessThanOrEqual(135.1);
    expect(angleAt(rig.point(`upperarm01_${side}`),rig.point(`lowerarm01_${side}`),rig.point(`wrist_${side}`))).toBeLessThanOrEqual(145.1);
   }
  }
 });
 it('keeps planted feet at their targets within IK residual',()=>{
  const doc=defaultDocument(rig.rest);
  for(let i=0;i<=40;i++){
   const f=frameAt(doc,i/40*doc.duration);solvePose(rig,f.pose,f.constraints);
   for(const side of ['L','R']as const){
    const planted=side==='L'?f.constraints.plantL:f.constraints.plantR;if(!planted)continue;
    const t=toV((side==='L'?f.pose.footL:f.pose.footR).target);
    expect(rig.point(`foot_${side}`).distanceTo(t)).toBeLessThan(.005);
   }
  }
 });
 it('keeps the grip transform fixed while grip is constrained',()=>{
  const doc=defaultDocument(rig.rest);
  for(let i=0;i<=40;i++){
   const f=frameAt(doc,i/40*doc.duration);solvePose(rig,f.pose,f.constraints);
   const expected=rig.bone('wrist_R').localToWorld(gripFrame(rig).center.clone());
   expect(racket.getWorldPosition(new Vector3()).distanceTo(expected)).toBeLessThan(1e-10);
  }
 });
 it('reports a stable balance check on the ready key',()=>{
  const doc=defaultDocument(rig.rest),f=frameAt(doc,0);
  solvePose(rig,f.pose,f.constraints);
  const a=analyzePose(rig,f.pose,f.constraints,racket);
  expect(a.comStable).toBe(true);expect(a.support.length).toBeGreaterThanOrEqual(3);
  expect(a.items.every(i=>i.ok)).toBe(true);
 });
 it('flags balance when the root is dragged far off the feet',()=>{
  const doc=defaultDocument(rig.rest),k=ensureKey(doc,0);
  k.pose.root.z=.6;
  const f=frameAt(doc,0);solvePose(rig,f.pose,f.constraints);
  const a=analyzePose(rig,f.pose,f.constraints,racket);
  expect(a.comStable).toBe(false);
 });
});
describe('hand orientation editing',()=>{
 it('keeps the forward/normal pair orthonormal under slider deltas',()=>{
  const doc=defaultDocument(rig.rest),h=doc.keys[2].pose.handR;
  for(const [kind,d]of [['flex',23],['dev',-31],['twist',47]]as const)rotateHandFrame(h,kind,d);
  const f=toV(h.forward),n=toV(h.normal);
  expect(f.length()).toBeCloseTo(1,8);expect(n.length()).toBeCloseTo(1,8);
  expect(Math.abs(f.dot(n))).toBeLessThan(1e-8);
 });
 it('builds a support polygon only from planted feet',()=>{
  const doc=defaultDocument(rig.rest),k=doc.keys[0];
  const both=supportPolygon(k.pose,k.constraints);
  expect(both.length).toBeGreaterThanOrEqual(6);
  const none=supportPolygon(k.pose,{...k.constraints,plantL:false,plantR:false});
  expect(none.length).toBe(0);
 });
});
describe('motion library',()=>{
 const memStorage=():StorageLike&{map:Map<string,string>}=>{const map=new Map<string,string>();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);}}};
 const lib=(s?:StorageLike)=>new MotionLibrary(rig.rest,s).load();
 it('seeds with the example forehand on first run',()=>{
  const l=lib(memStorage());
  expect(l.docs.length).toBe(1);expect(l.active().id).toBe('forehand-workshop');
 });
 it('creates named blank motions with unique ids and a valid stance',()=>{
  const l=lib(memStorage());
  const a=l.create('发球'),b=l.create('发球');
  expect(a.id).not.toBe(b.id);expect(l.active().id).toBe(b.id);expect(l.docs.length).toBe(3);
  for(const doc of [a,b]){expect(doc.keys.length).toBe(2);expect(doc.keys.every(k=>k.constraints.plantL&&k.constraints.plantR&&!k.constraints.grip)).toBe(true);}
  const f=frameAt(a,0);solvePose(rig,f.pose,f.constraints);
  expect(analyzePose(rig,f.pose,f.constraints).comStable).toBe(true);
 });
 it('duplicates deep-copies keys so editing a copy leaves the source intact',()=>{
  const l=lib(memStorage()),src=l.active();
  const copy=l.duplicate(src.id)!;
  expect(copy.name).toBe(`${src.name} 副本`);expect(copy.keys.length).toBe(src.keys.length);
  copy.keys[0].pose.lean=44;copy.keys[0].constraints.grip=false;
  expect(src.keys[0].pose.lean).not.toBe(44);
 });
 it('selects, removes and always keeps at least one motion',()=>{
  const l=lib(memStorage());
  const a=l.create('A'),b=l.create('B');
  l.select(a.id);expect(l.active().id).toBe(a.id);
  l.remove(a.id);expect(l.active().id).toBe(b.id);
  l.remove(b.id);l.remove('forehand-workshop');
  expect(l.docs.length).toBe(1);expect(l.docs[0].keys.length).toBe(2);
 });
 it('persists and restores the whole library through storage',()=>{
  const store=memStorage(),l=lib(store);
  const made=l.create('正手截击');made.keys[0].label='引拍';made.name='改名后的截击';l.save();
  const back=new MotionLibrary(rig.rest,store).load();
  expect(back.docs.length).toBe(2);expect(back.active().id).toBe(made.id);
  expect(back.active().name).toBe('改名后的截击');expect(back.active().keys[0].label).toBe('引拍');
 });
 it('reseeds cleanly from corrupted storage and skips invalid docs',()=>{
  const store=memStorage();store.map.set(LIBRARY_KEY,'{corrupted');
  expect(lib(store).docs.length).toBe(1);
  store.map.set(LIBRARY_KEY,JSON.stringify({schemaVersion:1,activeId:'x',docs:[{bogus:true},defaultDocument(rig.rest)]}));
  const l=lib(store);expect(l.docs.length).toBe(1);expect(l.active().id).toBe('forehand-workshop');
 });
 it('regenerates clashing ids on import',()=>{
  const l=lib(memStorage()),doc=parseDoc(serializeDoc(l.active()));
  const added=l.add(doc);
  expect(added.id).not.toBe('forehand-workshop');expect(l.docs.length).toBe(2);expect(l.active().id).toBe(added.id);
 });
});
