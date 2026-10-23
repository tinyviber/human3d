import {describe,expect,it} from 'vitest';
import type {WorkshopDoc} from '@human3d/motion-core';
import {motionFileById} from '@human3d/motion-core';
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
  expect(result).toBe('replaced');
  expect(doc.keys).toHaveLength(n0);
  expect(target.pose).toEqual(idle.keys[2].pose);
  expect(target.constraints).toEqual(before.constraints);
  expect(target.time).toBe(before.time);
 });
 it('inserts a new key carrying the pose when the playhead is between keys',()=>{
  const doc=docOf('idle');
  const n0=doc.keys.length;
  const result=applyPoseAt(doc,structuredClone(idle.keys[0].pose),.55,origin);
  expect(result).toBe('inserted');
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
  expect(result).toBe('replaced');
  expect(doc.keys).toHaveLength(n0);
  expect(doc.keys[0].pose).toEqual(idle.keys[1].pose);
 });
});
