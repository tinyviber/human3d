import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from '../core/rig';
import {attachRacket,gripFrame} from '../core/racket';
import {angleAt} from '../core/kinematics';
import {blankDocument,defaultDocument,ensureKey,flattenPose,frameAt,parseDoc,retimeKeys,samplePose,serializeDoc,setKeyTime,sortedKeys,toV,unflattenPose,validateDocShape,type WorkshopKey} from './document';
import {LIBRARY_KEY,MotionLibrary,type StorageLike} from './library';
import {DocHistory,HistoryBook,RecordGate} from './history';
import {WORKSHOP_LIMITS} from './limits';
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
   const p=samplePose(doc,k.time);
   for(const [a,b]of [[flattenPose(p),flattenPose(k.pose)]]as const)for(let i=0;i<a.length;i++)expect(a[i]).toBeCloseTo(b[i],6);
  }
  for(let i=0;i<=200;i++){const p=samplePose(doc,i/200*doc.duration);expect(flattenPose(p).every(Number.isFinite)).toBe(true);}
 });
 it('holds planted-foot targets constant over each interval',()=>{
  const doc=defaultDocument(rig.rest),keys=sortedKeys(doc);
  for(let i=0;i<keys.length-1;i++){
   const k=keys[i];if(!k.constraints.plantL)continue;
   for(let s=0;s<=10;s++){
    const p=samplePose(doc,k.time+(keys[i+1].time-k.time)*s/10);
    expect(toV(p.footL.target).distanceTo(toV(k.pose.footL.target))).toBeLessThan(1e-9);
   }
  }
 });
 it('takes the short angular path when yaw wraps through ±180°',()=>{
  const doc=blankDocument(rig.rest,'转身','yaw-wrap');
  doc.keys[0].pose.yaw=179;doc.keys[1].pose.yaw=-179;
  const mid=samplePose(doc,.5);
  // 2° short path: midpoint ≈ ±180°, never crosses 0.
  expect(Math.abs(mid.yaw)).toBeGreaterThan(179.5);expect(Math.abs(mid.yaw)).toBeLessThan(181);
 });
 it('interpolates hand direction frames as rotations, never through the zero vector',()=>{
  const doc=blankDocument(rig.rest,'转手','frame-slerp');
  doc.keys[0].pose.handR.forward={x:1,y:0,z:0};doc.keys[0].pose.handR.normal={x:0,y:1,z:0};
  doc.keys[1].pose.handR.forward={x:-1,y:0,z:0};doc.keys[1].pose.handR.normal={x:0,y:1,z:0};
  for(let i=0;i<=10;i++){
   const p=samplePose(doc,i/10),f=toV(p.handR.forward),n=toV(p.handR.normal);
   expect(f.length()).toBeGreaterThan(.99);expect(n.length()).toBeGreaterThan(.99);
   expect(Math.abs(f.dot(n))).toBeLessThan(1e-6);
  }
 });
 it('holds a continuous foot contact across planted keys and lifts off from the contact point',()=>{
  const doc=blankDocument(rig.rest,'换脚','contact-run');
  const A={x:.2,y:0,z:.3},B={x:.5,y:.12,z:.1},C={x:-.1,y:0,z:.4};
  doc.keys[0].pose.footL.target={...A};doc.keys[1].pose.footL.target={...B};
  // Second planted key mid-run: contact still holds A even though the key stores B.
  const mid=samplePose(doc,.5),atKey=samplePose(doc,1);
  expect(toV(mid.footL.target).distanceTo(toV(A))).toBeLessThan(1e-9);
  expect(toV(atKey.footL.target).distanceTo(toV(A))).toBeLessThan(1e-9);
  // Release key between two contacts: the stored (already-lifted) B is
  // ignored — the foot lifts FROM A and swings to the replant target C.
  const lifted={...doc.keys[1],constraints:{...doc.keys[1].constraints,plantL:false}};
  const replanted={id:'k3',time:2,label:'',pose:{...doc.keys[1].pose,footL:{...doc.keys[1].pose.footL,target:{...C}}},constraints:{...doc.keys[1].constraints}};
  doc.duration=2;doc.keys=[doc.keys[0],lifted,replanted];
  const at=(t:number)=>toV(samplePose(doc,t).footL.target);
  expect(at(1).distanceTo(toV(A))).toBeLessThan(1e-9);
  expect(at(2).distanceTo(toV(C))).toBeLessThan(1e-9);
  expect(at(1.5).distanceTo(toV(A))).toBeGreaterThan(.05);
  expect(at(1.5).distanceTo(toV(C))).toBeGreaterThan(.05);
 });
 it('keeps foot position AND velocity continuous across support transitions',()=>{
  const doc=blankDocument(rig.rest,'换脚','boundary-continuity');
  const A={x:.2,y:0,z:.3},C={x:-.1,y:0,z:.4};
  doc.duration=2;
  doc.keys[0].pose.footL.target={...A};
  doc.keys[1].constraints.plantL=false;doc.keys[1].pose.footL.target={x:.5,y:.12,z:.1}; // released mid-doc, stores a lifted pose
  doc.keys.push({id:'k3',time:2,label:'',pose:{...doc.keys[1].pose,footL:{...doc.keys[1].pose.footL,target:{...C}}},constraints:{...doc.keys[1].constraints,plantL:true}});
  doc.keys.sort((a,b)=>a.time-b.time);
  const at=(t:number)=>toV(samplePose(doc,t).footL.target);
  // Position: approaching the lift key from the left keeps A; at and after
  // the key the foot departs from A — never teleports to the stored pose.
  for(const t of [.95,.999,1,1.001])expect(at(t).distanceTo(toV(A))).toBeLessThan(.01);
  // Velocity: both transitions move through rest — finite differences shrink
  // to ~0 at the lift (t=1) and the replant (t=2).
  const eps=1e-3,v=(t:number)=>at(t+eps).sub(at(t-eps)).length()/(2*eps);
  expect(v(1)).toBeLessThan(.05);
  expect(v(2)).toBeLessThan(.05);
  // Mid-swing the foot is genuinely in flight — and genuinely OFF THE
  // GROUND: the release key's stored pose is a waypoint the path passes
  // through at the interval midpoint, not a smoothstep slide.
  expect(v(1.5)).toBeGreaterThan(.1);
  expect(at(1.5).y).toBeCloseTo(.12,9);
  expect(at(1.5).y).toBeGreaterThan(Math.max(A.y,C.y)+.05);
  for(let s=0;s<=20;s++)expect(at(1+s/40).y).toBeGreaterThanOrEqual(-1e-9);
 });
 it('retimes duration proportionally instead of collapsing keys onto one time',()=>{
  const doc=defaultDocument(rig.rest);retimeKeys(doc,.4);
  const times=sortedKeys(doc).map(k=>k.time);
  times.forEach((t,i)=>expect(t).toBeCloseTo([0,.11,.25,.33,.4][i],6));
  for(let i=1;i<times.length;i++)expect(times[i]).toBeGreaterThan(times[i-1]);
  for(let i=0;i<=50;i++)expect(flattenPose(samplePose(doc,i/50*.4)).every(Number.isFinite)).toBe(true);
 });
 it('keeps loop keys strictly increasing when shrinking duration into the seam',()=>{
  // Repro from review: 0, .98, .99 at 1.0s retimed to 0.2s — clamping only the
  // last key into the seam gap used to drop it below its predecessor.
  const doc=blankDocument(rig.rest,'循环','loop-retime');
  doc.keys[1].time=.98;
  const tail=JSON.parse(JSON.stringify(doc.keys[1])) as WorkshopKey;tail.id='k-tail';tail.time=.99;
  doc.keys.push(tail);doc.loop=true;
  retimeKeys(doc,.2);
  const times=sortedKeys(doc).map(k=>k.time);
  expect(times[0]).toBe(0);
  for(let i=1;i<times.length;i++)expect(times[i]).toBeGreaterThan(times[i-1]);
  expect(Math.max(...times)).toBeLessThanOrEqual(doc.duration-WORKSHOP_LIMITS.loopGap+1e-9);
  expect(validateDocShape(doc)).toEqual([]);
 });
 it('keeps loop keys ordered when duration grows too',()=>{
  const doc=blankDocument(rig.rest,'循环','loop-grow');
  doc.keys[1].time=.98;doc.duration=1;doc.loop=true;
  retimeKeys(doc,5);
  const times=sortedKeys(doc).map(k=>k.time);
  expect(times[0]).toBe(0);expect(times[1]).toBeCloseTo(.98*(5-WORKSHOP_LIMITS.loopGap)/.99,9);
  expect(validateDocShape(doc)).toEqual([]);
 });
 it('keeps single-key retiming strictly inside neighbour bounds',()=>{
  const doc=defaultDocument(rig.rest),keys=sortedKeys(doc);
  setKeyTime(doc,keys[2],99);
  expect(keys[2].time).toBeCloseTo(keys[3].time-.01,9);
  setKeyTime(doc,keys[2],-99);
  expect(keys[2].time).toBeCloseTo(keys[1].time+.01,9);
 });
 it('rejects malformed docs on every checked dimension',()=>{
  const good=JSON.parse(serializeDoc(blankDocument(rig.rest,'好','ok')));
  expect(validateDocShape(good)).toEqual([]);
  const cases:[string,(d:Record<string,unknown>)=>void][]=[
   ['重复时间',d=>{(d.keys as {time:number}[])[1].time=(d.keys as {time:number}[])[0].time;}],
   ['NaN 目标',d=>{((d.keys as {pose:{handL:{target:{x:number}}}}[])[0].pose.handL.target.x)=NaN;}],
   ['零向量朝向',d=>{((d.keys as {pose:{handL:{forward:{x:number;y:number;z:number}}}}[])[0].pose.handL.forward)={x:0,y:0,z:0};}],
   ['非布尔约束',d=>{((d.keys as {constraints:{plantL:unknown}}[])[0].constraints.plantL)='yes';}],
   ['越界时间',d=>{(d.keys as {time:number}[])[1].time=99;}],
  ];
  for(const [,mutate]of cases){const d=JSON.parse(JSON.stringify(good));mutate(d);expect(validateDocShape(d).length).toBeGreaterThan(0);}
  for(const [,mutate]of cases){const d=JSON.parse(JSON.stringify(good));mutate(d);expect(()=>parseDoc(JSON.stringify(d))).toThrow();}
 });
 it('auto-keys by sampling the live pose at insert time',()=>{
  const doc=defaultDocument(rig.rest);
  const k=ensureKey(doc,.35)!;
  expect(doc.keys.length).toBe(6);expect(k.time).toBe(.35);
  const expected=samplePose(doc,.35);
  for(let i=0;i<flattenPose(expected).length;i++)expect(flattenPose(k.pose)[i]).toBeCloseTo(flattenPose(expected)[i],6);
  expect(ensureKey(doc,.35)!.id).toBe(k.id);
 });
 it('refuses a new key at the maxKeys limit instead of saving an invalid doc',()=>{
  const doc=blankDocument(rig.rest,'满','full');
  doc.duration=WORKSHOP_LIMITS.maxDuration;
  doc.keys.forEach((k,i)=>{k.time=i*doc.duration/WORKSHOP_LIMITS.maxKeys;});
  while(doc.keys.length<WORKSHOP_LIMITS.maxKeys){const k=JSON.parse(JSON.stringify(doc.keys[1])) as WorkshopKey;k.id=`kf${doc.keys.length}`;k.time=doc.keys.length*doc.duration/WORKSHOP_LIMITS.maxKeys;doc.keys.push(k);}
  expect(validateDocShape(doc)).toEqual([]);
  // A time between existing keys cannot take a new key; the doc stays valid.
  expect(ensureKey(doc,.045)).toBeUndefined();
  expect(doc.keys.length).toBe(WORKSHOP_LIMITS.maxKeys);
  expect(validateDocShape(doc)).toEqual([]);
  // Reusing an existing key still works at the limit.
  expect(ensureKey(doc,doc.keys[3].time)!.id).toBe(doc.keys[3].id);
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
  const doc=defaultDocument(rig.rest),k=ensureKey(doc,0)!;
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
describe('undo and redo',()=>{
 it('restores exact snapshots, clears redo on a new edit and respects the limit',()=>{
  const h=new DocHistory(3),doc=blankDocument(rig.rest,'u','u');
  const s0=serializeDoc(doc);
  h.record(doc);doc.keys[0].pose.lean=10;
  h.record(doc);doc.keys[0].pose.lean=20;
  expect(h.canUndo()).toBe(true);expect(h.canRedo()).toBe(false);
  const back=h.undo(doc)!;expect(back.keys[0].pose.lean).toBe(10);
  const again=h.redo(back)!;expect(again.keys[0].pose.lean).toBe(20);
  const back2=h.undo(again)!;const back3=h.undo(back2)!;
  expect(serializeDoc(back3)).toBe(s0);
  expect(h.undo(back3)).toBeUndefined();
  // A new edit after an undo discards the redo branch.
  h.record(back3);expect(h.canRedo()).toBe(false);
  // Identical snapshots collapse, and the limit drops the oldest entries.
  for(let i=0;i<10;i++){h.record(doc);doc.keys[0].pose.lean=30+i;}
  let n=0;let cur=doc;while(h.canUndo()){cur=h.undo(cur)!;n++;}
  expect(n).toBe(3);
 });
 it('keeps a separate history per motion', ()=>{
  const book=new HistoryBook(),a=blankDocument(rig.rest,'a','a'),b=blankDocument(rig.rest,'b','b');
  book.of('a').record(a);expect(book.of('b').canUndo()).toBe(false);
 });
 it('merges rapid edits only inside one document and one transaction',()=>{
  const g=new RecordGate(600);
  expect(g.should('a',1000)).toBe(true);
  expect(g.should('a',1200)).toBe(false); // same doc, inside the window → one step
  expect(g.should('b',1300)).toBe(true);  // a different doc always gets a snapshot
  expect(g.should('b',1400)).toBe(false);
  expect(g.should('a',1500)).toBe(true);  // switching back is a new transaction
  g.reset();
  expect(g.should('a',1600)).toBe(true);  // after undo/redo the next edit records
  expect(g.should('a',1700)).toBe(false);
  expect(g.should('a',2400)).toBe(true);  // window elapsed
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
 it('surfaces storage failures instead of claiming the motion was saved',()=>{
  const failing:StorageLike={getItem:()=>null,setItem:()=>{throw new Error('quota');}};
  const l=lib(failing);
  expect(l.lastError).toBe('quota');
  l.create('X');expect(l.lastError).toBe('quota');
 });
 it('round-trips boundary documents through save and reload without quarantine',()=>{
  const store=memStorage(),l=lib(store);
  // A document at the key limit…
  const full=l.create('满'),tmpl=JSON.parse(JSON.stringify(full.keys[0])) as WorkshopKey;
  full.duration=WORKSHOP_LIMITS.maxDuration;
  full.keys.forEach((k,i)=>{k.time=i*full.duration/WORKSHOP_LIMITS.maxKeys;});
  while(full.keys.length<WORKSHOP_LIMITS.maxKeys){const k=JSON.parse(JSON.stringify(tmpl)) as WorkshopKey;k.id=`kf${full.keys.length}`;k.time=full.keys.length*full.duration/WORKSHOP_LIMITS.maxKeys;full.keys.push(k);}
  // …and a loop document retimed down to the shortest duration.
  const looped=l.create('循环');
  looped.keys[1].time=.98;looped.duration=1;looped.loop=true;
  retimeKeys(looped,.2);
  for(const d of [full,looped])expect(validateDocShape(d)).toEqual([]);
  l.save();
  const back=new MotionLibrary(rig.rest,store).load();
  expect(back.quarantine.length).toBe(0);
  expect(back.docs.find(d=>d.id===full.id)?.keys.length).toBe(WORKSHOP_LIMITS.maxKeys);
  expect(back.docs.find(d=>d.id===looped.id)?.loop).toBe(true);
 });
 it('keeps an unreadable library file in quarantine instead of overwriting it',()=>{
  const store=memStorage();
  // Unparseable JSON: preserved verbatim, storage untouched.
  store.map.set(LIBRARY_KEY,'{"schemaVersion":2,"docs":[{broken');
  const l=lib(store);
  expect(l.docs.length).toBe(1); // a usable seed document in memory
  expect(l.quarantine.length).toBe(1);
  expect(l.quarantine[0].raw).toBe('{"schemaVersion":2,"docs":[{broken');
  expect(store.map.get(LIBRARY_KEY)).toBe('{"schemaVersion":2,"docs":[{broken');
  // Parseable but unknown schemaVersion (e.g. a future format): same rule.
  store.map.set(LIBRARY_KEY,JSON.stringify({schemaVersion:9,docs:[]}));
  const l2=new MotionLibrary(rig.rest,store).load();
  expect(l2.quarantine.length).toBe(1);
  expect(JSON.parse(store.map.get(LIBRARY_KEY)!).schemaVersion).toBe(9);
 });
 it('quarantines deeply-invalid stored docs with a reason instead of dropping them',()=>{
  const store=memStorage(),doc=JSON.parse(serializeDoc(defaultDocument(rig.rest)));
  doc.keys[1].time=doc.keys[0].time; // duplicate times now fail validation
  store.map.set(LIBRARY_KEY,JSON.stringify({schemaVersion:1,activeId:doc.id,docs:[doc,defaultDocument(rig.rest)]}));
  const l=new MotionLibrary(rig.rest,store).load();
  expect(l.docs.length).toBe(1);expect(l.docs[0].id).toBe('forehand-workshop');
  expect(l.quarantine.length).toBe(1);expect(l.quarantine[0].id).toBe(doc.id);
  expect(l.quarantine[0].reason.length).toBeGreaterThan(0);
  expect(JSON.parse(l.quarantineText(0)).keys[1].time).toBe(doc.keys[0].time);
  // The quarantine survives a save/load cycle and is written as schema v2.
  const back=new MotionLibrary(rig.rest,store).load();
  expect(back.quarantine.length).toBe(1);
  expect(JSON.parse(store.map.get(LIBRARY_KEY)!).schemaVersion).toBe(2);
  back.discardQuarantine(0);expect(back.quarantine.length).toBe(0);
 });
 it('migrates v1 documents to v2 with the behaviour they had',()=>{
  const store=memStorage(),doc=JSON.parse(serializeDoc(defaultDocument(rig.rest)));
  delete doc.loop;delete doc.handFrames;doc.schemaVersion=1;
  store.map.set(LIBRARY_KEY,JSON.stringify({schemaVersion:1,activeId:doc.id,docs:[doc]}));
  const l=new MotionLibrary(rig.rest,store).load();
  expect(l.docs[0].schemaVersion).toBe(2);expect(l.docs[0].loop).toBe(false);
  expect(l.docs[0].handFrames).toEqual({L:'world',R:'world'});expect(l.quarantine.length).toBe(0);
 });
});
