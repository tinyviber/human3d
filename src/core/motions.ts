import type {MotionSpec} from './types';
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
export const AUTHORED_MOTIONS:MotionSpec[]=[
{id:'idle',name:'自然站立',english:'STAND & BREATHE',duration:4.8,description:'安静站立，观察比例与轻微呼吸。',method:'关键姿态 · 呼吸近似',focus:['脊柱','肩带','平衡'],phases:[{time:0,label:'呼气'},{time:2.4,label:'吸气'},{time:4.8,label:'呼气'}]},
{id:'walk',name:'行走',english:'WALK CYCLE',duration:1.12,description:'普通自然步态，保持稳定步宽与协调摆臂。',method:'CMU 35_01 · 普通行走动捕',focus:['髋膝协同','足部接地','对侧摆臂'],phases:[{time:0,label:'左支撑'},{time:.28,label:'右摆动'},{time:.56,label:'右支撑'},{time:.84,label:'左摆动'}]},
{id:'reach',name:'抬手与转身',english:'REACH & TURN',duration:6,description:'视线、胸廓与肩带共同转向，抬起右臂。',method:'关键姿态 · 上肢 IK',focus:['肩带','胸椎旋转','肘关节'],phases:[{time:0,label:'站立'},{time:1.5,label:'转向'},{time:3,label:'抬手'},{time:4.5,label:'回落'}]},
{id:'squat',name:'下蹲',english:'CONTROLLED SQUAT',duration:5.6,description:'髋部后移、屈膝与踝背屈，保持双足支撑。',method:'关键姿态 · 双足 IK',focus:['髋膝踝','足底支撑','躯干前倾'],phases:[{time:0,label:'站立'},{time:2.1,label:'下降'},{time:2.8,label:'最低点'},{time:4.8,label:'起立'}]},
{id:'ready',name:'持拍准备',english:'RACKET READY',duration:4,description:'屈膝准备，以右手固定抓握球拍。',method:'预设抓握 · 刚性握柄约束',focus:['手指包裹','掌柄接触','屈膝'],phases:[{time:0,label:'准备'},{time:2,label:'重心微调'},{time:4,label:'准备'}]},
{id:'forehand',name:'正手挥拍',english:'FOREHAND STUDY',duration:5.2,description:'已知上臂与躯干穿插，按本次要求暂未修复。',method:'研究参考关键姿态 · 工程近似',focus:['骨盆先行','躯干旋转','随挥恢复'],phases:[{time:0,label:'准备'},{time:1.3,label:'引拍'},{time:2.1,label:'加速'},{time:2.55,label:'击球区'},{time:3.35,label:'随挥'},{time:4.6,label:'恢复'}]},
];
export const AUTHORED_KEYFRAMED_IDS=['idle','reach','squat','ready','forehand'] as const;
export const MOTIONS:MotionSpec[]=[...AUTHORED_MOTIONS,...actionMotions];
export const DYNAMICS_MOTION_IDS=new Set(actionMotions.map(m=>m.id));
export const isDynamicsMotion=(id:string)=>DYNAMICS_MOTION_IDS.has(id);
export const motionById=(id:string)=>MOTIONS.find(m=>m.id===id)??MOTIONS[0];
