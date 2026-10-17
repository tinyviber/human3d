import {Quaternion,Vector3} from 'three';
import {HumanRig} from '../core/rig';
import {angleAt,DEG,LIMITS} from '../core/kinematics';
import {poseAt} from '../core/authoring';
import type {AuthoredKeyframedId} from '../core/authored-motions';
import type {MotionSpec} from '../core/types';
import {frameAt,sortedKeys,type WorkshopDoc} from '../workshop/document';
import {analyzePose,solvePose} from '../workshop/solver';
import {canonical,sha256} from './rig-manifest';
export const POSE_PACKAGE_KIND='pose-package';
export interface PackageCheck{id:string;ok:boolean;detail:string}
export interface PosePackage{
 schemaVersion:1;kind:typeof POSE_PACKAGE_KIND;id:string;
 units:{length:'meter';angle:'radian';time:'second'};
 frame:{handedness:'right';up:'+Y';forward:'+Z'};
 poseMode:'local-trs';quaternionOrder:'xyzw';
 action:{id:string;revision:string;parameters:Record<string,unknown>;definitionSHA256:string};
 rig:{id:string;manifestSHA256:string;bones:number};
 timeline:{fps:number;duration:number;count:number;timestamps:number[]};
 tracks:{translation:{bone:'root';values:number[]};rotations:{bone:string;values:number[]}[]};
 events:{time:number;label:string;type:string}[];
 quality:{checks:PackageCheck[];warnings:string[]};
 provenance:{solver:string;solverRevision:string;source:string;requestFingerprint:string;license:{motion:string;rig:string};parametersResolved:Record<string,unknown>};
}
interface CaptureMeta{
 motionId:string;action:PosePackage['action'];events:PosePackage['events'];
 quality:PosePackage['quality'];provenance:PosePackage['provenance'];
 manifestSHA256:string;bones:number;
}
interface FrameCheck{check:PackageCheck;severity:number}
function jointChecks(rig:HumanRig):FrameCheck[]{
 const out:FrameCheck[]=[];
 const push=(id:string,value:number,limit:number,unit:string,tol=.5)=>
  out.push({severity:value/limit,check:{id,ok:value<=limit+tol,detail:`${value.toFixed(0)}${unit} / ≤${limit}${unit}`}});
 for(const side of ['L','R'] as const){
  const P=(n:string)=>rig.point(n);
  push(`knee-flexion-${side}`,angleAt(P(`upperleg01_${side}`),P(`lowerleg01_${side}`),P(`foot_${side}`)),LIMITS.kneeFlexion[1],'°');
  push(`elbow-flexion-${side}`,angleAt(P(`upperarm01_${side}`),P(`lowerarm01_${side}`),P(`wrist_${side}`)),LIMITS.elbowFlexion[1],'°');
  const shoulder=P(`lowerarm01_${side}`).clone().sub(P(`upperarm01_${side}`)).angleTo(new Vector3(0,-1,0))/DEG;
  push(`shoulder-elevation-${side}`,shoulder,LIMITS.shoulderElevation[1],'°');
 }
 for(const side of ['L','R'] as const)
  out.push({severity:-rig.point(`foot_${side}`).y*50,
   check:{id:`foot-clearance-${side}`,ok:rig.point(`foot_${side}`).y>-.02,detail:`sole-joint height ${(rig.point(`foot_${side}`).y*1000).toFixed(0)}mm`}});
 return out;
}
// Keep the worst-severity frame result per check id.
function mergeChecks(acc:Map<string,FrameCheck>,items:FrameCheck[]){
 for(const it of items){
  const prev=acc.get(it.check.id);
  if(!prev||it.severity>prev.severity)acc.set(it.check.id,it);
 }
}
function capture(rig:HumanRig,duration:number,fps:number,apply:(t:number)=>void,meta:CaptureMeta):PosePackage{
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
 const checkAcc=new Map<string,FrameCheck>();
 for(let i=0;i<count;i++){
  const t=timestamps[i];apply(t);
  rootPos.push(...rig.bone('root').position.toArray());
  for(const [n,b]of rig.bones)rot.get(n)!.set(b.quaternion.toArray(),i*4);
  mergeChecks(checkAcc,jointChecks(rig));
 }
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
  schemaVersion:1,kind:POSE_PACKAGE_KIND,id:meta.motionId,
  units:{length:'meter',angle:'radian',time:'second'},
  frame:{handedness:'right',up:'+Y',forward:'+Z'},
  poseMode:'local-trs',quaternionOrder:'xyzw',
  action:meta.action,rig:{id:'makehuman-body',manifestSHA256:meta.manifestSHA256,bones:meta.bones},
  timeline:{fps,duration,count,timestamps},
  tracks:{translation:{bone:'root',values:rootPos},rotations},
  events:meta.events,quality:{checks:[...checkAcc.values()].map(f=>f.check),warnings:meta.quality.warnings},
  provenance:meta.provenance,
 };
}
export function solveKeyframed(rig:HumanRig,spec:MotionSpec,fps:number,meta:Omit<CaptureMeta,'events'|'quality'>):PosePackage{
 const id=spec.id as AuthoredKeyframedId;
 const warnings:string[]=[];
 if(id==='forehand')warnings.push('documented-defect: 已知上臂与躯干穿插（研究姿态，未修复）');
 return capture(rig,spec.duration,fps,t=>poseAt(rig,id,t),{...meta,
  events:spec.phases.map(p=>({time:p.time,label:p.label,type:'phase'})),
  quality:{checks:[],warnings}});
}
export function solveWorkshop(rig:HumanRig,doc:WorkshopDoc,fps:number,meta:Omit<CaptureMeta,'events'|'quality'>):PosePackage{
 const warnings:string[]=['engineering-approximation: 运动学求解器输出，未做动力学验证'];
 const events:{time:number;label:string;type:string}[]=[];
 const keyChecks=new Map<string,PackageCheck>();
 // Support is an interval, not a per-key flag: emit support-start only on a
 // false→true transition (including a doc that begins planted) and
 // support-end on true→false, so each event pair brackets one contact.
 const support={plantL:false,plantR:false};
 for(const k of sortedKeys(doc)){
  events.push({time:k.time,label:k.label,type:'keyframe'});
  if(k.constraints.contact)events.push({time:k.time,label:`${k.label} · 触球`,type:'contact'});
  for(const side of ['plantL','plantR'] as const){
   const foot=side==='plantL'?'左脚':'右脚',now=k.constraints[side],was=support[side];
   support[side]=now;
   if(now&&!was)events.push({time:k.time,label:`${foot}支撑开始`,type:'support-start'});
   if(!now&&was)events.push({time:k.time,label:`${foot}支撑结束`,type:'support-end'});
  }
 }
 const pkg=capture(rig,doc.duration,fps,t=>{const f=frameAt(doc,t);solvePose(rig,f.pose,f.constraints);},{...meta,
  events,quality:{checks:[],warnings}});
 for(const k of sortedKeys(doc)){
  const f=frameAt(doc,k.time);solvePose(rig,f.pose,f.constraints);
  for(const it of analyzePose(rig,f.pose,f.constraints).items){
   const prev=keyChecks.get(it.label);
   keyChecks.set(it.label,{id:`keyframe:${it.label}`,ok:(prev?.ok??true)&&it.ok,
    detail:!it.ok?`t=${k.time.toFixed(2)}s ${it.detail}`:prev?.detail??`t=${k.time.toFixed(2)}s ${it.detail}`});
  }
 }
 rig.reset();
 pkg.quality.checks.push(...keyChecks.values());
 return pkg;
}
export const actionDefinitionHash=(payload:unknown)=>sha256(canonical(payload));
