import {Quaternion} from 'three';
import {HumanRig} from './rig';
import {frameAt,sortedKeys,type WorkshopDoc} from './document';
import {analyzePose,solveEffectiveFrame,type CheckItem} from './solver';
import {RIG_ID} from './protocol';
import {POSE_PACKAGE_KIND,POSE_PACKAGE_SCHEMA_VERSION} from './package-const';

/** One aggregated quality check. `value` is the worst sample observed and
 * `worstTime` is when it occurred; `ok` holds only if every sample passed.
 * Checks are machine-readable: `code` is a stable identifier, never prose. */
export interface QualityCheck{code:string;ok:boolean;label:string;value:number|null;limit:number|null;unit:string;worstTime:number|null}
export type PackageEventType='phase'|'keyframe'|'contact'|'support-start'|'support-end';
export interface PackageEvent{time:number;label:string;type:PackageEventType;side?:'L'|'R'}
export interface PosePackage{
 schemaVersion:typeof POSE_PACKAGE_SCHEMA_VERSION;kind:typeof POSE_PACKAGE_KIND;id:string;
 units:{length:'meter';angle:'radian';time:'second'};
 frame:{handedness:'right';up:'+Y';forward:'+Z'};
 poseMode:'local-trs';quaternionOrder:'xyzw';
 action:{id:string;revision:string;parameters:Record<string,unknown>;definitionSHA256:string};
 rig:{id:string;manifestSHA256:string;bones:number};
 timeline:{fps:number;duration:number;count:number;timestamps:number[]};
 tracks:{translation:{bone:'root';values:number[]};rotations:{bone:string;values:number[]}[]};
 events:PackageEvent[];
 quality:{checks:QualityCheck[];warnings:string[]};
 provenance:{solver:string;solverRevision:string;source:string;requestFingerprint:string;license:{motion:string;rig:string};parametersResolved:Record<string,unknown>};
}
interface CaptureMeta{
 motionId:string;action:PosePackage['action'];events:PackageEvent[];
 quality:{warnings:string[]};provenance:PosePackage['provenance'];
 manifestSHA256:string;bones:number;
}
type Sampler=(t:number)=>CheckItem[];

/** Fold one measured item into the aggregate. Items without a value (not
 * applicable at this sample, e.g. CoM with no planted foot) are skipped. */
function fold(acc:Map<string,QualityCheck>,it:CheckItem,t:number){
 if(it.value===null)return;
 const prev=acc.get(it.code);
 const ok=(prev?.ok??true)&&it.ok;
 if(!prev||prev.value===null||it.value>prev.value){
  acc.set(it.code,{code:it.code,ok,label:it.label,value:it.value,limit:it.limit,unit:it.unit,worstTime:t});
 }else acc.set(it.code,{...prev,ok});
}

function capture(rig:HumanRig,duration:number,fps:number,sample:Sampler,meta:CaptureMeta,extraTimes:number[]=[]):PosePackage{
 // Sample grid: uniform 1/fps steps PLUS the exact action end — when
 // duration×fps is non-integer the last interval is partial, but the final
 // timestamp is always exactly `duration` so the package reproduces the
 // terminal pose.
 const timestamps:number[]=[0];
 while(timestamps[timestamps.length-1]<duration-1e-9)timestamps.push(Math.min(duration,timestamps.length/fps));
 if(timestamps.length<2)timestamps.push(duration);
 timestamps[timestamps.length-1]=duration;
 const count=timestamps.length;
 const rootPos:number[]=[];const rot=new Map([...rig.bones.keys()].map(n=>[n,new Float64Array(count*4)]));
 const checkAcc=new Map<string,QualityCheck>();
 for(let i=0;i<count;i++){
  const t=timestamps[i];
  for(const it of sample(t))fold(checkAcc,it,t);
  rootPos.push(...rig.bone('root').position.toArray());
  for(const [n,b]of rig.bones)rot.get(n)!.set(b.quaternion.toArray(),i*4);
 }
 // Authored key instants are checked too, even when they fall between grid samples.
 for(const t of extraTimes)for(const it of sample(t))fold(checkAcc,it,t);
 rig.reset();
 const rotations:{bone:string;values:number[]}[]=[];
 const prev=new Quaternion();
 for(const [n,v]of rot){
  let animated=false;
  for(let i=0;i<count;i++)if(v[i*4]!==0||v[i*4+1]!==0||v[i*4+2]!==0||v[i*4+3]!==1){animated=true;break;}
  if(!animated)continue;
  const values=Array.from(v);
  // Normalize quaternion hemisphere so any consumer's slerp takes the short arc.
  for(let i=4;i<values.length;i+=4){
   prev.set(values[i-4],values[i-3],values[i-2],values[i-1]);
   if(prev.x*values[i]+prev.y*values[i+1]+prev.z*values[i+2]+prev.w*values[i+3]<0)
    for(let j=0;j<4;j++)values[i+j]=-values[i+j];
  }
  rotations.push({bone:n,values});
 }
 return {
  schemaVersion:POSE_PACKAGE_SCHEMA_VERSION,kind:POSE_PACKAGE_KIND,id:meta.motionId,
  units:{length:'meter',angle:'radian',time:'second'},
  frame:{handedness:'right',up:'+Y',forward:'+Z'},
  poseMode:'local-trs',quaternionOrder:'xyzw',
  action:meta.action,rig:{id:RIG_ID,manifestSHA256:meta.manifestSHA256,bones:meta.bones},
  timeline:{fps,duration,count,timestamps},
  tracks:{translation:{bone:'root',values:rootPos},rotations},
  events:meta.events,
  quality:{checks:[...checkAcc.values()],warnings:meta.quality.warnings},
  provenance:meta.provenance,
 };
}
/** The single solve path: every servable action resolves to a WorkshopDoc and
 * comes through here. `phases` are the envelope's editorial phase labels —
 * emitted as 'phase' events and merge-sorted with the document's own
 * keyframe/contact/support events (stable: doc events keep their order at
 * equal times). `meta.warnings` lands in quality.warnings verbatim. */
export function solveWorkshop(rig:HumanRig,doc:WorkshopDoc,fps:number,
 meta:Omit<CaptureMeta,'events'|'quality'>&{warnings?:string[]},
 phases:{time:number;label:string}[]=[]):PosePackage{
 const events:PackageEvent[]=[];
 // Support is an interval, not a per-key flag: emit support-start only on a
 // false→true transition (including a doc that begins planted) and
 // support-end on true→false, so each event pair brackets one contact.
 const support={plantL:false,plantR:false};
 for(const k of sortedKeys(doc)){
  events.push({time:k.time,label:k.label,type:'keyframe'});
  if(k.constraints.contact)events.push({time:k.time,label:`${k.label} · 触球`,type:'contact'});
  for(const side of ['L','R'] as const){
   const flag=side==='L'?'plantL':'plantR',foot=side==='L'?'左脚':'右脚',now=k.constraints[flag],was=support[flag];
   support[flag]=now;
   if(now&&!was)events.push({time:k.time,label:`${foot}支撑开始`,type:'support-start',side});
   if(!now&&was)events.push({time:k.time,label:`${foot}支撑结束`,type:'support-end',side});
  }
 }
 for(const p of phases)events.push({time:p.time,label:p.label,type:'phase'});
 events.sort((a,b)=>a.time-b.time);
 const origin=rig.rest.get('root')!;
 const sample:Sampler=t=>{
  const f=frameAt(doc,t,origin);
  solveEffectiveFrame(rig,f);
  return analyzePose(rig,f.pose,f.constraints).items;
 };
 const keyTimes=sortedKeys(doc).map(k=>k.time);
 const {warnings=[],...rest}=meta;
 const pkg=capture(rig,doc.duration,fps,sample,{...rest,events,quality:{warnings}},keyTimes);
 rig.reset();
 return pkg;
}
