import type {MotionSpec} from './types';
import {AUTHORED_MOTIONS} from './authored-motions';
export {AUTHORED_MOTIONS,AUTHORED_KEYFRAMED_IDS} from './authored-motions';
export interface MuscleActionFile{
 id:string;title:string;schemaVersion:number;
 model:{carriedObject?:{massKg:number;radiusM:number;body:string}|null};
 simulation:{referenceSpeedScale?:number;leadSeconds?:number;tailSeconds?:number;sampleHz:number;stepSeconds:number;startPose?:'neutral'|'first-keyframe'};
 reference:{kind:'task-keyframes'|'captured-points';armControl?:'endpoint-keyframes'|'joint-keyframes';keyframes?:{timeSeconds:number;phase:string;elbow?:number[];hand?:number[];leftElbow?:number[];leftHand?:number[];rightShoulderRotvecRad?:number[];rightElbowFlexionRad?:number;jointTargetsDeg?:Record<string,number>}[];source:{frameRangeSeconds?:[number,number]}};
 display:{english:string;description:string;method:string;focus:string[];oneShot?:boolean;durationSeconds?:number;phases?:{time:number;label:string}[];objectDescription?:string;handPoseSource?:'muscle-state'|'task-keyframe-retarget';leftGuardHandPoseDeg?:{thumb:{cmcFlexion:number;cmcOpposition:number;mcp:number;ip:number};fingers:Record<'2'|'3'|'4'|'5',{mcp:number;pip:number;dip:number}>}};
}
const actionFiles=Object.values(import.meta.glob<MuscleActionFile>('../../assets/actions/*.json',{eager:true,import:'default'}))
 .filter((action)=>action.schemaVersion===1&&typeof action.id==='string'&&!!action.display);
const actionFilesById=new Map(actionFiles.map(action=>[action.id,action]));
export const muscleActionById=(id:string)=>actionFilesById.get(id);
const actionMotions:MotionSpec[]=actionFiles.map((action)=>{
 const {leadSeconds=0,tailSeconds=0,referenceSpeedScale=1}=action.simulation;
 const last=action.reference.kind==='task-keyframes'
  ?(action.reference.keyframes?.at(-1)?.timeSeconds??0)
  :(action.reference.source.frameRangeSeconds?.[1]??0)-(action.reference.source.frameRangeSeconds?.[0]??0);
 const sourceScale=action.reference.kind==='captured-points'?referenceSpeedScale:1/referenceSpeedScale;
 const rawDuration=leadSeconds+last*sourceScale+tailSeconds;
 const samples=Math.floor((rawDuration+1e-8)*action.simulation.sampleHz)+1;
 const referenceDuration=(samples-1)/action.simulation.sampleHz;
 const duration=action.display.durationSeconds??(action.reference.kind==='task-keyframes'
  ?(Math.round(referenceDuration/action.simulation.stepSeconds)+1)*action.simulation.stepSeconds
  :rawDuration);
 const phases=(action.display.phases??action.reference.keyframes?.map(k=>({time:leadSeconds+k.timeSeconds/referenceSpeedScale,label:k.phase}))??[])
  .map(p=>({...p,time:Math.min(p.time,duration)}));
 return {id:action.id,name:action.title,english:action.display.english,duration,
  description:action.display.description,method:action.display.method,focus:action.display.focus,phases,
  physics:true,oneShot:action.display.oneShot,objectDescription:action.display.objectDescription};
});
export const MOTIONS:MotionSpec[]=[...AUTHORED_MOTIONS,...actionMotions];
export const DYNAMICS_MOTION_IDS=new Set(actionMotions.map(m=>m.id));
export const isDynamicsMotion=(id:string)=>DYNAMICS_MOTION_IDS.has(id);
export const motionById=(id:string)=>MOTIONS.find(m=>m.id===id)??MOTIONS[0];
