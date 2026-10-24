import type {FootTarget,PoseParams,V3,WorkshopDoc,WorkshopKey} from '@human3d/motion-core';
import {ensureKey,nearestKey,sortedKeys,WORKSHOP_LIMITS} from '@human3d/motion-core';
import type {Vector3} from 'three';

/** The user's own quick poses: captured from any authored key with one click,
 * applied at the playhead with another. Persisted under its own localStorage
 * key (not the motion library) — poses are tiny, reusable across documents
 * and independent of the doc list. The injected StorageLike keeps the store
 * testable and side-effect free outside the browser. */

export interface UserPosePreset{id:string;name:string;pose:PoseParams}
export const POSE_LIBRARY_KEY='kinesis-workshop-poses';
export type StorageLike={getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem?(k:string):void};

const isV3=(v:unknown):v is V3=>!!v&&typeof v==='object'&&['x','y','z'].every(k=>Number.isFinite((v as Record<string,unknown>)[k]));
/** A storable pose needs every channel the editor writes; partial captures
 * would silently erase channels on apply. */
export const isPoseShape=(v:unknown):v is PoseParams=>{
  if(!v||typeof v!=='object')return false;
  const p=v as Record<string,unknown>;
  const hand=(h:unknown)=>!!h&&typeof h==='object'&&isV3((h as Record<string,unknown>).target)&&isV3((h as Record<string,unknown>).pole)
   &&isV3((h as Record<string,unknown>).forward)&&isV3((h as Record<string,unknown>).normal);
  const foot=(f:unknown)=>!!f&&typeof f==='object'&&isV3((f as Record<string,unknown>).target)&&isV3((f as Record<string,unknown>).pole)
   &&Number.isFinite((f as Record<string,unknown>).yaw)&&Number.isFinite((f as Record<string,unknown>).pitch);
  return isV3(p.root)&&Number.isFinite(p.yaw)&&Number.isFinite(p.lean)&&Number.isFinite(p.chest)&&Number.isFinite(p.side)
   &&hand(p.handL)&&hand(p.handR)&&foot(p.footL)&&foot(p.footR);
};

export class PoseLibrary{
  presets:UserPosePreset[]=[];
  /** Set when the last save() failed (quota/private mode) — the UI must not
   * claim the pose was persisted when it only lives in memory. */
  lastError='';
  constructor(private store?:StorageLike|null){}
  load(){
    try{
      const raw=this.store?.getItem(POSE_LIBRARY_KEY)??null;
      if(raw){
        const parsed:unknown=JSON.parse(raw);
        if(Array.isArray(parsed))this.presets=parsed.filter((p):p is UserPosePreset=>
          !!p&&typeof p==='object'&&typeof (p as UserPosePreset).id==='string'&&typeof (p as UserPosePreset).name==='string'
          &&isPoseShape((p as UserPosePreset).pose));
      }
    }catch{this.presets=[];}
    return this;
  }
  save(){
    if(!this.store)return;
    try{this.store.setItem(POSE_LIBRARY_KEY,JSON.stringify(this.presets));this.lastError='';}
    catch(err){this.lastError=err instanceof Error?err.message:String(err);}
  }
  /** Capture a pose under a unique name; returns the new preset. */
  add(name:string,pose:PoseParams):UserPosePreset{
    const trimmed=name.trim()||'我的姿态';
    let unique=trimmed,n=2;
    while(this.presets.some(p=>p.name===unique))unique=`${trimmed} ${n++}`;
    const preset:UserPosePreset={id:`p${Date.now().toString(36)}${this.presets.length}`,name:unique,pose:JSON.parse(JSON.stringify(pose))};
    this.presets.push(preset);this.save();return preset;
  }
  remove(id:string){const i=this.presets.findIndex(p=>p.id===id);if(i>=0){this.presets.splice(i,1);this.save();}}
}

/** What applying a pose at `time` did: the playhead key was overwritten in
 * place ('replaced') or a new key carrying the pose was inserted ('inserted').
 * `heldFoot` lists the sides whose foot target/yaw/pitch were NOT written:
 * contactPlan pins those channels to the support run's anchor on a held key,
 * so writing them would promise a pose the solver silently keeps at the old
 * contact. The knee pole is NOT locked and still applies, as do root, spine
 * and hands. */
export interface PoseApplyReport{result:'replaced'|'inserted';heldFoot:('L'|'R')[]}
/** Write `pose` onto the key at the playhead: an existing key within the
 * insert tolerance is overwritten; otherwise a new key is inserted (undefined
 * when the time is invalid or the key limit refuses the insert). Constraints
 * and label stay the key's own — only the pose is stamped, minus the foot
 * channels contactPlan would ignore. */
export function applyPoseAt(doc:WorkshopDoc,pose:PoseParams,time:number,origin:V3|Vector3,tolerance=.02):PoseApplyReport|undefined{
  if(!Number.isFinite(time))return undefined;
  const ceiling=doc.duration-(doc.loop?WORKSHOP_LIMITS.loopGap:0);
  const t=Math.max(0,Math.min(ceiling,time));
  const existing=nearestKey(doc,t,tolerance);
  const insertedLen=doc.keys.length;
  const key=existing??ensureKey(doc,t,origin,tolerance);
  if(!key)return undefined;
  const heldFoot=stampPoseIntoKey(doc,key,pose);
  return {result:existing?'replaced':doc.keys.length>insertedLen?'inserted':'replaced',heldFoot};
}
/** Stamp `pose` onto an existing key, skipping the foot target/yaw/pitch of
 * held sides (see footHeldByRun) while still applying their knee pole —
 * contactPlan locks target/yaw/pitch only. Everything else applies verbatim.
 * Returns the held sides so the UI can say what did not move. */
export function stampPoseIntoKey(doc:WorkshopDoc,key:WorkshopKey,pose:PoseParams):('L'|'R')[]{
  const stamped=JSON.parse(JSON.stringify(pose)) as PoseParams;
  const heldFoot=(['L','R'] as const).filter(side=>{
    if(!footHeldByRun(doc,key,side))return false;
    const f=side==='L'?key.pose.footL:key.pose.footR;
    const next=side==='L'?stamped.footL:stamped.footR;
    // Only a real attempted move is held (and worth reporting): a stamp that
    // agrees with the key's authored channels changes nothing anyway.
    if(Math.abs(next.target.x-f.target.x)<1e-3&&Math.abs(next.target.y-f.target.y)<1e-3
     &&Math.abs(next.target.z-f.target.z)<1e-3&&Math.abs(next.yaw-f.yaw)<1e-3
     &&Math.abs(next.pitch-f.pitch)<1e-3)return false;
    // Keep the key's locked channels, apply the editable pole.
    const held:FootTarget={target:f.target,pole:next.pole,yaw:f.yaw,pitch:f.pitch};
    stamped[side==='L'?'footL':'footR']=held;
    return true;
  });
  // Merge over the key's own pose so a held foot keeps its current channels.
  const merged=JSON.parse(JSON.stringify(key.pose)) as PoseParams;
  Object.assign(merged,stamped);
  key.pose=merged;
  return heldFoot;
}

/** True when contactPlan pins `key`'s `side` foot channels (target, yaw,
 * pitch) to a support run's anchor — the authored channels are fully
 * discarded there, for interpolation too. Two cases, both covered by "the
 * adjacent key before this one is planted":
 * - a planted run member that is not the run's anchor (previous key planted
 *   too): the run keeps the anchor's contact;
 * - the liftoff boundary right AFTER a planted run: the released key's
 *   instant inherits the run contact.
 * Anchor keys are exempt — writing their target re-anchors the run, the same
 * visible semantics as dragging the foot handle there. On a fully planted
 * loop contactPlan forces key 0 to be that anchor (`s<0?0:s`), so key 0
 * stays editable even though its cyclic predecessor is planted. */
function footHeldByRun(doc:WorkshopDoc,key:WorkshopKey,side:'L'|'R'):boolean{
  const flag=side==='L'?'plantL':'plantR';
  const keys=sortedKeys(doc),i=keys.indexOf(key);
  if(i<0)return false;
  const prev=doc.loop&&i===0?keys[keys.length-1]:keys[i-1];
  if(!prev||!prev.constraints[flag])return false;
  const allPlanted=doc.loop&&keys.length>1&&keys.every(k=>k.constraints[flag]);
  const isAnchor=key.constraints[flag]&&allPlanted&&i===0;
  return !isAnchor;
}
