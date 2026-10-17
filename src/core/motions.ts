import type {MotionSpec} from './types';
import {MOTION_FILES} from './motion-files';
export interface MuscleActionFile{
 id:string;title:string;schemaVersion:number;
 model:{carriedObject?:{massKg:number;radiusM:number;body:string}|null};
 simulation:{referenceSpeedScale?:number;leadSeconds?:number;tailSeconds?:number;sampleHz:number;stepSeconds:number;startPose?:'neutral'|'first-keyframe'};
 reference:{kind:'task-keyframes'|'captured-points';armControl?:'endpoint-keyframes'|'joint-keyframes';keyframes?:{timeSeconds:number;phase:string;elbow?:number[];hand?:number[];leftElbow?:number[];leftHand?:number[];rightShoulderRotvecRad?:number[];rightElbowFlexionRad?:number;jointTargetsDeg?:Record<string,number>}[];source:{frameRangeSeconds?:[number,number]}};
 display:{english:string;description:string;method:string;focus:string[];oneShot?:boolean;durationSeconds?:number;phases?:{time:number;label:string}[];objectDescription?:string;handPoseSource?:'muscle-state'|'task-keyframe-retarget';leftGuardHandPoseDeg?:{thumb:{cmcFlexion:number;cmcOpposition:number;mcp:number;ip:number};fingers:Record<'2'|'3'|'4'|'5',{mcp:number;pip:number;dip:number}>}};
}
/** Bundled envelopes → lab specs: the trajectory source stays on `source`
 * (a clip asset reference or the inline document). Envelope notes are service
 * metadata; the spec keeps display fields only. */
const fileMotions:MotionSpec[]=MOTION_FILES.map(f=>({
 id:f.id,name:f.name,english:f.english,duration:f.duration,description:f.description,method:f.method,
 focus:f.focus,phases:f.phases,oneShot:f.oneShot,capabilities:f.capabilities,
 source:f.kind==='clip-motion'
  ?{kind:'clip' as const,clip:f.clip!.url,meta:f.clip!.meta}
  :{kind:'document' as const,document:f.document!},
}));
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
  source:{kind:'dynamics' as const},oneShot:action.display.oneShot,objectDescription:action.display.objectDescription};
});
export const MOTIONS:MotionSpec[]=[...fileMotions,...actionMotions];
export const motionById=(id:string)=>MOTIONS.find(m=>m.id===id)??MOTIONS[0];
