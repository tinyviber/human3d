import type {PoseParams,V3,WorkshopDoc} from '@human3d/motion-core';
import {ensureKey,nearestKey,WORKSHOP_LIMITS} from '@human3d/motion-core';
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
 * place ('replaced') or a new key carrying the pose was inserted ('inserted'). */
export type PoseApplyResult='replaced'|'inserted';
/** Write `pose` onto the key at the playhead: an existing key within the
 * insert tolerance is overwritten; otherwise a new key is inserted (undefined
 * when the time is invalid or the key limit refuses the insert). Constraints
 * and label stay the key's own — only the pose is stamped. */
export function applyPoseAt(doc:WorkshopDoc,pose:PoseParams,time:number,origin:V3|Vector3,tolerance=.02):PoseApplyResult|undefined{
  if(!Number.isFinite(time))return undefined;
  const ceiling=doc.duration-(doc.loop?WORKSHOP_LIMITS.loopGap:0);
  const t=Math.max(0,Math.min(ceiling,time));
  const existing=nearestKey(doc,t,tolerance);
  if(existing){existing.pose=JSON.parse(JSON.stringify(pose));return 'replaced';}
  const inserted=doc.keys.length;
  const key=ensureKey(doc,t,origin,tolerance);
  if(!key)return undefined;
  key.pose=JSON.parse(JSON.stringify(pose));
  return doc.keys.length>inserted?'inserted':'replaced';
}
