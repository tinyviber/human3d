import {Quaternion,Vector3} from 'three';
import {DEG} from '../core/kinematics';

/** Trajectory-first motion document: keyframes carry task-space poses AND
 * constraints (foot plants, grip, contact). MuJoCo dynamics is deliberately
 * absent — continuous motion comes from bounded Hermite in-betweens over
 * effector targets, and plausibility is checked kinematically (see solver.ts). */

export interface V3{x:number;y:number;z:number}
export const v3=(x=0,y=0,z=0):V3=>({x,y,z});
export const toV=(v:V3)=>new Vector3(v.x,v.y,v.z);
export const fromV=(v:Vector3):V3=>({x:v.x,y:v.y,z:v.z});

export interface HandTarget{target:V3;pole:V3;forward:V3;normal:V3}
export interface FootTarget{target:V3;pole:V3;yaw:number;pitch:number}
export interface PoseParams{
  /** Root offset from the rest pelvis origin, metres, world space. */
  root:V3;
  /** Engineering joint coordinates: yaw of the pelvis, then spine bend/twist/side in degrees. */
  yaw:number;lean:number;chest:number;side:number;
  handL:HandTarget;handR:HandTarget;
  footL:FootTarget;footR:FootTarget;
}
export interface KeyConstraints{
  /** A planted foot's target is held constant across the interval that starts at this key. */
  plantL:boolean;plantR:boolean;
  /** Right hand keeps the grip-wrap fingers and shows the racket. */
  grip:boolean;
  /** Contact event: the racket head position at this key is a target point. */
  contact:boolean;
}
export interface WorkshopKey{id:string;time:number;label:string;pose:PoseParams;constraints:KeyConstraints;videoTime?:number}
export interface WorkshopDoc{
  schemaVersion:1;id:string;name:string;english:string;
  duration:number;inbetweens:boolean;
  keys:WorkshopKey[];
}
export interface EffectiveFrame{pose:PoseParams;constraints:KeyConstraints;keyIndex:number}

const FLAT:string[]=[];
/** Deterministic flatten/unflatten so Hermite runs over every numeric field. */
function flattenInto(p:PoseParams,out:number[]){
  out.length=0;
  const push=(v:V3)=>{out.push(v.x,v.y,v.z);};
  push(p.root);out.push(p.yaw,p.lean,p.chest,p.side);
  for(const h of [p.handL,p.handR]){push(h.target);push(h.pole);push(h.forward);push(h.normal);}
  for(const f of [p.footL,p.footR]){push(f.target);push(f.pole);out.push(f.yaw,f.pitch);}
}
export function flattenPose(p:PoseParams):number[]{const out:number[]=[];flattenInto(p,out);return out;}
export function unflattenPose(a:number[]):PoseParams{
  let i=0;
  const vec=():V3=>({x:a[i++],y:a[i++],z:a[i++]});
  const num=()=>a[i++];
  const p:PoseParams={root:vec(),yaw:num(),lean:num(),chest:num(),side:num(),
    handL:{target:vec(),pole:vec(),forward:vec(),normal:vec()},
    handR:{target:vec(),pole:vec(),forward:vec(),normal:vec()},
    footL:{target:vec(),pole:vec(),yaw:num(),pitch:num()},
    footR:{target:vec(),pole:vec(),yaw:num(),pitch:num()}};
  return p;
}
FLAT.length=0;

export const clonePose=(p:PoseParams):PoseParams=>unflattenPose(flattenPose(p));
export const cloneConstraints=(c:KeyConstraints):KeyConstraints=>({...c});

/** Nonuniform cubic Hermite with Catmull-Rom tangents — same scheme as the
 * authored clip builder, so velocity stays continuous through keyframes. */
export function samplePose(keys:WorkshopKey[],time:number):PoseParams{
  const flat=keys.map(k=>flattenPose(k.pose));
  let i=0;while(i<keys.length-2&&time>keys[i+1].time)i++;
  const t0=keys[i].time,t1=keys[i+1].time,dt=t1-t0;
  const u=dt>1e-9?Math.max(0,Math.min(1,(time-t0)/dt)):0;
  const n=flat[0].length,out=new Array<number>(n);
  for(let c=0;c<n;c++){
    const val=(j:number)=>flat[Math.max(0,Math.min(keys.length-1,j))][c];
    const m0=i===0?0:(val(i+1)-val(i-1))/(keys[i+1].time-keys[i-1].time);
    const m1=i+1===keys.length-1?0:(val(i+2)-val(i))/(keys[i+2].time-keys[i].time);
    out[c]=(2*u**3-3*u*u+1)*val(i)+(u**3-2*u*u+u)*dt*m0+(-2*u**3+3*u*u)*val(i+1)+(u**3-u*u)*dt*m1;
  }
  const pose=unflattenPose(out);
  // Planted feet are positional constraints, not samples: hold the planting
  // key's world-space target strictly inside the interval; at the boundary the
  // next key's own pose applies (a replant is an intended discrete step).
  const interior=time<keys[i+1].time-1e-9;
  if(interior){
    const c=keys[i].constraints;
    if(c.plantL)pose.footL.target={...keys[i].pose.footL.target};
    if(c.plantR)pose.footR.target={...keys[i].pose.footR.target};
  }
  return pose;
}

export function constraintsAt(keys:WorkshopKey[],time:number):{constraints:KeyConstraints;keyIndex:number}{
  let i=0;while(i<keys.length-1&&time>=keys[i+1].time-1e-9)i++;
  if(time<keys[0].time)i=0;
  return {constraints:keys[i].constraints,keyIndex:i};
}
export function frameAt(doc:WorkshopDoc,time:number):EffectiveFrame{
  const keys=sortedKeys(doc);
  const {constraints,keyIndex}=constraintsAt(keys,time);
  const pose=doc.inbetweens?samplePose(keys,time):clonePose(keys[keyIndex].pose);
  return {pose,constraints:{...constraints},keyIndex};
}
export const sortedKeys=(doc:WorkshopDoc)=>[...doc.keys].sort((a,b)=>a.time-b.time);

export function keyAt(doc:WorkshopDoc,id:string){return doc.keys.find(k=>k.id===id);}
export function insertKey(doc:WorkshopDoc,key:WorkshopKey){doc.keys.push(key);doc.keys.sort((a,b)=>a.time-b.time);}
export function nearestKey(doc:WorkshopDoc,time:number,eps=.02){
  let best:WorkshopKey|undefined,bd=Infinity;
  for(const k of doc.keys){const d=Math.abs(k.time-time);if(d<bd){bd=d;best=k;}}
  return bd<=eps?best:undefined;
}
/** Auto-key: reuse the key at this time or sample the live pose into a new one. */
export function ensureKey(doc:WorkshopDoc,time:number):WorkshopKey{
  const existing=nearestKey(doc,time);
  if(existing)return existing;
  const frame=frameAt(doc,time);
  const key:WorkshopKey={id:`k${Math.random().toString(36).slice(2,8)}`,time:Math.max(0,Math.min(doc.duration,time)),label:'',pose:frame.pose,constraints:frame.constraints};
  insertKey(doc,key);return key;
}

export function serializeDoc(doc:WorkshopDoc){return JSON.stringify(doc,null,2);}
export function parseDoc(text:string):WorkshopDoc{
  const d=JSON.parse(text) as WorkshopDoc;
  if(d.schemaVersion!==1||!Array.isArray(d.keys)||d.keys.length<2)throw new Error('不是有效的动作工作台文件');
  for(const k of d.keys){if(typeof k.time!=='number'||!k.pose||!k.constraints)throw new Error('关键帧缺少姿态或约束');}
  d.keys.sort((a,b)=>a.time-b.time);return d;
}

/* ---- Default example: a compact forehand seeded from the same task-space
 * numbers as the authored ready/forehand poses, retimed into 0.80s so the
 * workbench opens with a usable five-key motion instead of a T-pose. ---- */

interface SeedControls{y:number;z:number;yaw:number;chest:number;lean:number;right:[number,number,number];left:[number,number,number];rf:[number,number,number];rn:[number,number,number];lf:[number,number,number];ln:[number,number,number];stance:number}
const readySeed:SeedControls={y:-.055,z:-.05,yaw:0,chest:0,lean:5,right:[-.24,1.09,.29],left:[.17,1.14,.30],rf:[0,0,1],rn:[1,0,0],lf:[-.6,-.2,.7],ln:[-.4,.8,0],stance:.20};
function seedPose(rest:ReadonlyMap<string,Vector3>,c:SeedControls):PoseParams{
  const origin=rest.get('root')!;
  const yaw=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),c.yaw*DEG);
  const rootPos=origin.clone().add(new Vector3(0,c.y,c.z));
  const world=(v:[number,number,number])=>new Vector3(...v).sub(origin).applyQuaternion(yaw).add(rootPos);
  const hand=(target:[number,number,number],f:[number,number,number],n:[number,number,number],pole:[number,number,number]):HandTarget=>({
    target:fromV(world(target)),pole:fromV(world(pole)),
    forward:fromV(new Vector3(...f).applyQuaternion(yaw)),normal:fromV(new Vector3(...n).applyQuaternion(yaw))});
  // Planted feet live in world space: authoring keeps foot targets and poles
  // unrotated so the stance never rotates with pelvis yaw.
  const foot=(side:'L'|'R'):FootTarget=>{
    const sign=side==='L'?1:-1;
    return {target:{x:sign*c.stance,y:rest.get(`foot_${side}`)!.y,z:.018+sign*.045},
      pole:{x:sign*.22,y:.5,z:1},yaw:sign*7,pitch:0};
  };
  return {root:fromV(new Vector3(0,c.y,c.z)),yaw:c.yaw,lean:c.lean,chest:c.chest,side:0,
    handL:hand(c.left,c.lf,c.ln,[.51,1.13,-.12]),handR:hand(c.right,c.rf,c.rn,[-.52,1.17,-.12]),
    footL:foot('L'),footR:foot('R')};
}
export function defaultDocument(rest:ReadonlyMap<string,Vector3>):WorkshopDoc{
  const P=(patch:Partial<SeedControls>)=>seedPose(rest,{...readySeed,...patch});
  const plant={plantL:true,plantR:true,grip:true,contact:false};
  const keys:WorkshopKey[]=[
    {id:'k-ready',time:0,label:'准备',pose:P({}),constraints:{...plant}},
    {id:'k-back',time:.22,label:'引拍',pose:P({y:-.085,z:-.05,yaw:-32,chest:-18,right:[-.43,1.15,-.015],left:[.12,1.23,.37],rf:[0,0,1],rn:[1,0,.1]}),constraints:{...plant}},
    {id:'k-contact',time:.5,label:'触球',pose:P({y:-.03,z:-.03,yaw:15,chest:10,right:[-.34,1.12,.43],left:[.27,1.20,.10],rf:[0,.1,1],rn:[.15,.99,0]}),constraints:{...plant,contact:true}},
    {id:'k-follow',time:.66,label:'随挥',pose:P({y:-.025,z:-.02,yaw:31,chest:25,right:[.16,1.40,.25],left:[.25,1.18,.08],rf:[-.55,.66,.30],rn:[.40,.15,.80]}),constraints:{...plant}},
    {id:'k-recover',time:.8,label:'恢复',pose:P({y:-.03,z:-.02,yaw:8,chest:4,right:[-.15,1.13,.35]}),constraints:{...plant}},
  ];
  return {schemaVersion:1,id:'forehand-workshop',name:'正手挥拍 · 工作区',english:'FOREHAND WORKSHOP',duration:.8,inbetweens:true,keys};
}

/** New-motion template: a two-key neutral stance so a custom action starts
 * from a valid planted pose instead of an empty document. */
const standSeed:SeedControls={y:.002,z:0,yaw:0,chest:0,lean:0,right:[-.25,.915,.035],left:[.25,.915,.035],rf:[0,-1,0],rn:[1,0,0],lf:[0,-1,0],ln:[-1,0,0],stance:.135};
export function blankDocument(rest:ReadonlyMap<string,Vector3>,name:string,id:string):WorkshopDoc{
  const pose=seedPose(rest,standSeed);
  const constraints:KeyConstraints={plantL:true,plantR:true,grip:false,contact:false};
  return {schemaVersion:1,id,name,english:'CUSTOM MOTION',duration:1,inbetweens:true,keys:[
    {id:`${id}-a`,time:0,label:'起始',pose:clonePose(pose),constraints:{...constraints}},
    {id:`${id}-b`,time:1,label:'结束',pose:clonePose(pose),constraints:{...constraints}},
  ]};
}
export const newDocId=(name:string)=>{
  const slug=name.trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g,'-').replace(/^-+|-+$/g,'');
  return `${slug||'motion'}-${Math.random().toString(36).slice(2,7)}`;
};
