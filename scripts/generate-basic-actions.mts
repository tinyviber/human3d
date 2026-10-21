import fs from 'node:fs';
import path from 'node:path';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {
 HumanRig,ankleYForLift,blankDocument,canonicalizeHands,footGeometry,footRotation,normalizeDoc,type KeyConstraints,type RigInfo,type WorkshopDoc,type WorkshopKey,type PoseParams,
} from '@human3d/motion-core';

/* Basic actions: the workshop's built-in library. Each action is a short
 * body/leg movement with AT MOST three keyframes. Keys are authored as
 * offsets from the standing stance, and the hands stay at the neutral stance
 * (the insertion tool keeps the user's own hands and copies only these body
 * and leg offsets — see apps/web/src/workshop/basic-actions.ts).
 *
 * Constraints: feet plant by default (a planted run holds its first key's
 * contact). Only the lunge releases the lead foot, so it can step out. The
 * lunge's rear foot is a toe-stand (ADR-0010): it pitches onto its toes and
 * keeps its own height and pitch from the keys. Squats stand with both feet on
 * one line, so the posterior pelvis shift is the only hip motion. */

type Patch=(p:PoseParams)=>void;
interface BasicKey{time:number;label:string;patch?:Patch;lead?:'free'|'planted';toeR?:boolean}
interface BasicSpec{id:string;name:string;english:string;order:number;description:string;focus:string[];keys:BasicKey[];symmetricFeet?:boolean}

const root=process.cwd();
const glb=fs.readFileSync(path.join(root,'public/models/human.glb'));
const gltf=await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync(path.join(root,'public/models/rig.json'),'utf8')) as RigInfo);
const stance=blankDocument(rig.rest,'stance','stance').keys[0].pose;
/** Both feet on the stance's centre line (the staggered stance's z midpoint). */
const symmetricStance=(p:PoseParams)=>{
 // Rounded to a micrometre: the average of the staggered offsets carries float noise.
 const zMid=Number(((stance.footL.target.z+stance.footR.target.z)/2).toFixed(6));
 p.footL.target.z=zMid;p.footR.target.z=zMid;
};
/** Rear-foot toe-stand (ADR-0010): the right foot pitches forward until its toe
 * joints touch the floor (lift 0). The toe contact is the joint that is lowest at
 * TOE_PITCH. The foot rocks rigidly about that joint, so the ankle target moves
 * back and up by the rotated offset and the contact keeps its planted x/z. */
const TOE_PITCH=20;
const footRightGeometry=footGeometry(rig.rest,'R');
const toeContactOffset=(yaw:number)=>{
 const q=footRotation(yaw,TOE_PITCH);
 let best=0;
 footRightGeometry.offsets.forEach((o,i)=>{if(o.clone().applyQuaternion(q).y<footRightGeometry.offsets[best].clone().applyQuaternion(q).y)best=i;});
 return footRightGeometry.offsets[best];
};
const toeStandR:Patch=p=>{
 // The planted contact is the flat foot at the same yaw (pitch 0), so its
 // offset is rotated by that yaw; the toe-stand offset adds the pitch.
 const yaw=p.footR.yaw,off=toeContactOffset(yaw);
 const planted=off.clone().applyQuaternion(footRotation(yaw,0)),rotated=off.clone().applyQuaternion(footRotation(yaw,TOE_PITCH));
 p.footR.pitch=TOE_PITCH;
 p.footR.target.y=ankleYForLift(footRightGeometry,0,yaw,TOE_PITCH);
 p.footR.target.x=stance.footR.target.x+planted.x-rotated.x;
 p.footR.target.z=stance.footR.target.z+planted.z-rotated.z;
};
const lungeStep:Patch=p=>{p.footL.target.z+=.24;p.footL.pole.z+=.24;p.root.y-=.09;p.root.z+=.02;toeStandR(p);};

const SPECS:BasicSpec[]=[
 {id:'basic-half-squat',name:'半蹲',english:'HALF SQUAT',order:25,symmetricFeet:true,
  description:'双脚不动，骨盆下沉约 12 cm 并随踝背屈约束向后移动（约 10 cm）、上身略前倾后回到站立。用于练习屈膝与重心下沉。',
  focus:['双脚固定','屈膝下沉','回到站立'],
  keys:[
   {time:0,label:'站立'},
   {time:.8,label:'半蹲',patch:p=>{p.root.y-=.12;p.lean+=4;}},
   {time:1.6,label:'站立'},
  ]},
 {id:'basic-full-squat',name:'全蹲',english:'FULL SQUAT',order:26,symmetricFeet:true,
  description:'双脚不动，骨盆下沉约 18 cm 并向后坐（关键帧髋后移约 6 cm，踝背屈超过 20° 时再由求解器后移约 10 cm）、上身前倾更明显后回到站立。屈膝幅度大于半蹲；踝关节背屈受 20° 门限限制，因此深度小于真实全蹲。',
  focus:['双脚固定','深度屈膝','回到站立'],
  keys:[
   {time:0,label:'站立'},
   {time:.9,label:'全蹲',patch:p=>{p.root.y-=.18;p.root.z-=.06;p.lean+=8;}},
   {time:1.8,label:'站立'},
  ]},
 {id:'basic-lunge',name:'弓步',english:'LUNGE',order:27,
  description:'左脚向前迈出一步并屈膝，右脚以脚尖支撑（足跟抬起约 20°）；第三帧保持弓步姿态。左脚在第一段为悬空迈步。骨盆下沉约 9 cm，无需后移。',
  focus:['前脚迈步','后脚脚尖支撑','保持弓步'],
  keys:[
   {time:0,label:'站立',lead:'free'},
   {time:.8,label:'弓步',lead:'planted',toeR:true,patch:lungeStep},
   {time:1.6,label:'保持',lead:'planted',toeR:true,patch:lungeStep},
  ]},
 {id:'basic-weight-shift',name:'重心转移',english:'WEIGHT SHIFT',order:28,
  description:'双脚着地，骨盆先向左脚（+x）移动再向右脚（−x）移动，屈膝幅度很小。',
  focus:['左右重心','双脚着地','屈膝缓冲'],
  keys:[
   {time:0,label:'居中'},
   {time:.8,label:'左移',patch:p=>{p.root.x+=.05;p.root.y-=.03;}},
   {time:1.6,label:'右移',patch:p=>{p.root.x-=.05;p.root.y-=.03;}},
  ]},
 {id:'basic-push-turn',name:'蹬转',english:'PUSH AND TURN',order:29,
  description:'屈膝蓄力后，双腿伸展蹬地，骨盆与上身同时转向前方，再回到站立。',
  focus:['屈膝蓄力','蹬地伸展','转体回位'],
  keys:[
   {time:0,label:'蓄力',patch:p=>{p.root.y-=.06;p.root.x-=.025;p.yaw-=10;p.chest-=6;}},
   {time:.6,label:'蹬转',patch:p=>{p.root.y+=0;p.root.x+=.025;p.yaw+=18;p.chest+=12;}},
   {time:1.2,label:'回位'},
  ]},
];

for(const spec of SPECS){
 const keys:WorkshopKey[]=spec.keys.map((k,i)=>{
  const pose=structuredClone(stance);
  const planted=k.lead!=='free';
  if(spec.symmetricFeet)symmetricStance(pose);
  // Stance offsets are authored from the standing pose; key 0 is the stance
  // itself unless it carries its own patch (the push-turn preparation).
  if(k.patch)k.patch(pose);
  const constraints:KeyConstraints={plantL:k.lead==='free'?false:planted||i!==0,plantR:true,
   ...(k.toeR?{toeStandR:true}:{}),grip:false,contact:false};
  return {id:`${spec.id}-k${i}`,time:k.time,label:k.label,pose,constraints};
 });
 for(const key of keys)canonicalizeHands(key.pose);
 const duration=spec.keys.at(-1)!.time;
 const doc:WorkshopDoc=normalizeDoc({schemaVersion:2,id:spec.id,name:spec.name,english:spec.english,duration,inbetweens:true,loop:false,handFrames:{L:'pelvis',R:'pelvis'},keys});
 const envelope={
  schemaVersion:1,kind:'workshop-motion',category:'basic',order:spec.order,id:spec.id,name:spec.name,english:spec.english,
  duration,
  description:spec.description,
  method:'基础动作模板 · 站立姿态上的骨盆/腿部偏移（至多 3 关键帧，手臂保持中立）',
  focus:spec.focus,
  phases:spec.keys.map(k=>({time:k.time,label:k.label})),
  notes:['基础动作库：每个动作不超过 3 个关键帧；插入到手捏动作时只复制骨盆与腿部的相对偏移，手部保留当前姿态。'],
  license:'Project-authored basic movement template.',
  document:doc,
 };
 const file=path.join(root,'assets/motions',`${spec.id}.json`);
 fs.writeFileSync(file,`${JSON.stringify(envelope,null,2)}\n`);
 console.log(`wrote ${path.relative(root,file)} (${doc.keys.length} keys, ${duration}s)`);
}
process.exit(0);
