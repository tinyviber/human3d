import {AnimationClip,QuaternionKeyframeTrack,VectorKeyframeTrack,Vector3,Quaternion} from 'three';
import {HumanRig} from './rig';
import {applyGrip} from './racket';
import {DEG,solveTwoBone} from './kinematics';
import {AUTHORED_KEYFRAMED_IDS,authoredMotionById,type AuthoredKeyframedId} from './authored-motions';
type KeyframedMotionId=AuthoredKeyframedId;
type V=[number,number,number];
interface Controls{y:number;z:number;yaw:number;chest:number;lean:number;right:V;left:V;rf:V;rn:V;lf:V;ln:V;stance:number}
type Key={t:number;pose:Partial<Controls>};
const base:Controls={y:.002,z:0,yaw:0,chest:0,lean:0,right:[-.25,.915,.035],left:[.25,.915,.035],rf:[0,-1,0],rn:[1,0,0],lf:[0,-1,0],ln:[-1,0,0],stance:.135};
const ready:Partial<Controls>={y:-.055,z:-.05,lean:5,right:[-.24,1.09,.29],left:[.17,1.14,.30],rf:[0,0,1],rn:[1,0,0],lf:[-.6,-.2,.7],ln:[-.4,.8,0],stance:.20};
const seq:Record<KeyframedMotionId,Key[]>={
 idle:[{t:0,pose:{}},{t:1.2,pose:{lean:-.2,right:[-.251,.916,.036]}},{t:2.4,pose:{lean:-.65,right:[-.253,.919,.037],left:[.253,.919,.037]}},{t:3.6,pose:{lean:-.2}},{t:4.8,pose:{}}],
 reach:[{t:0,pose:{}},{t:.7,pose:{}},{t:1.5,pose:{yaw:16,chest:8,right:[-.37,1.12,.24],left:[.25,.94,.09],rf:[0,.1,1]}},{t:2.7,pose:{yaw:22,chest:12,right:[-.32,1.72,.22],left:[.25,.95,.10],rf:[-.2,.95,.2],rn:[.8,0,.2]}},{t:3.3,pose:{yaw:22,chest:12,right:[-.32,1.72,.22],left:[.25,.95,.10],rf:[-.2,.95,.2],rn:[.8,0,.2]}},{t:4.7,pose:{yaw:10,chest:5,right:[-.36,1.15,.19],rf:[0,-.6,.8]}},{t:6,pose:{}}],
 squat:[{t:0,pose:{}},{t:.6,pose:{}},{t:1.5,pose:{y:-.16,z:-.09,lean:17,right:[-.23,1.09,.40],left:[.23,1.09,.40],rf:[0,0,1],lf:[0,0,1]}},{t:2.5,pose:{y:-.31,z:-.25,lean:37,right:[-.20,1.12,.59],left:[.20,1.12,.59],rf:[0,0,1],lf:[0,0,1]}},{t:3.1,pose:{y:-.31,z:-.25,lean:37,right:[-.20,1.12,.59],left:[.20,1.12,.59],rf:[0,0,1],lf:[0,0,1]}},{t:4.7,pose:{}},{t:5.6,pose:{}}],
 ready:[{t:0,pose:ready},{t:1,pose:{...ready,y:-.060,z:-.045}},{t:2,pose:{...ready,y:-.052,z:-.052}},{t:3,pose:{...ready,y:-.058}},{t:4,pose:ready}],
 forehand:[{t:0,pose:ready},{t:.55,pose:ready},
 {t:1.3,pose:{...ready,y:-.085,yaw:-32,chest:-18,right:[-.43,1.15,-.015],left:[.12,1.23,.37],rf:[0,0,1],rn:[1,0,.1]}},
 {t:1.85,pose:{...ready,y:-.09,yaw:-26,chest:-20,right:[-.43,.98,-.045],left:[.13,1.23,.32],rf:[0,.35,.94],rn:[.8,.3,-.1]}},
 {t:2.25,pose:{...ready,y:-.05,yaw:0,chest:-8,right:[-.43,1.01,.27],left:[.18,1.25,.19],rf:[0,.15,1],rn:[.35,.94,0]}},
 {t:2.55,pose:{...ready,y:-.03,yaw:15,chest:10,right:[-.34,1.12,.43],left:[.27,1.20,.10],rf:[0,.1,1],rn:[.15,.99,0]}},
 {t:3.35,pose:{...ready,y:-.025,yaw:31,chest:25,right:[.16,1.40,.25],left:[.25,1.18,.08],rf:[-.55,.66,.30],rn:[.40,.15,.80]}},
 {t:3.8,pose:{...ready,y:-.03,yaw:28,chest:18,right:[.19,1.39,.24],left:[.26,1.15,.08],rf:[-.55,.66,.30],rn:[.40,.15,.80]}},
 {t:4.6,pose:{...ready,yaw:8,chest:4,right:[-.15,1.13,.35]}},{t:5.2,pose:ready}],
};
/** Canonical authoring data behind a keyframed motion: the control frames
 * resolved against `base`, i.e. every number that drives the trajectory.
 * Hashing this (not the action id) is what ties a pose package to the motion
 * definition it was solved from. The returned object is a deep copy —
 * mutating it cannot corrupt the authored `seq`/`base` module data. */
export function keyframedDefinition(id:AuthoredKeyframedId){
 return {format:'keyframed-controls/v1' as const,id,
  keys:seq[id].map(k=>({t:k.t,controls:JSON.parse(JSON.stringify({...base,...k.pose})) as Controls}))};
}
function sample(keys:Key[],time:number):Controls{
 const frames=keys.map(k=>({...base,...k.pose}));let i=0;while(i<keys.length-2&&time>keys[i+1].t)i++;
 const dt=keys[i+1].t-keys[i].t,u=Math.max(0,Math.min(1,(time-keys[i].t)/dt));
 const scalar=(k:keyof Controls,c?:number)=>{
  const val=(j:number)=>{const v=frames[j][k];return Array.isArray(v)?v[c!]:v as number;};
  const a=val(i),b=val(i+1);
  // Nonuniform cubic Hermite: continuous velocity at the measured/constructed phases.
  const m0=i===0?0:(val(i+1)-val(i-1))/(keys[i+1].t-keys[i-1].t);
  const m1=i+1===keys.length-1?0:(val(i+2)-val(i))/(keys[i+2].t-keys[i].t);
  return (2*u**3-3*u*u+1)*a+(u**3-2*u*u+u)*dt*m0+(-2*u**3+3*u*u)*b+(u**3-u*u)*dt*m1;
 };
 const out={} as Controls;
 for(const k of Object.keys(base) as (keyof Controls)[]){(out as unknown as Record<string,number|number[]>)[k]=Array.isArray(base[k])?[0,1,2].map(c=>scalar(k,c)):scalar(k);}
 return out;
}
export function poseAt(rig:HumanRig,id:KeyframedMotionId,time:number){
 rig.reset();const p=sample(seq[id],time),root=rig.bone('root'),origin=rig.rest.get('root')!;
 p.y=Math.min(base.y,p.y);
 root.position.copy(origin).add(new Vector3(0,p.y,p.z));rig.rotate('root',0,p.yaw,0);
 for(const n of ['spine05','spine04','spine03','spine02','spine01'])rig.rotate(n,p.lean/5,p.chest/5,0);
 rig.rotate('neck01',-p.lean*.22,-p.chest*.15,0);rig.rotate('neck02',-p.lean*.22,0,0);rig.rotate('head',-p.lean*.12,0,0);
 const yaw=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),p.yaw*DEG);
 const world=(v:V)=>new Vector3(...v).sub(origin).applyQuaternion(yaw).add(root.position);
 const legInputs=(['L','R'] as const).map(side=>{
  const sign=side==='L'?1:-1;
  return {side,hip:rig.point(`upperleg01_${side}`),target:new Vector3(sign*p.stance,rig.rest.get(`foot_${side}`)!.y,.018+(id==='ready'||id==='forehand'?sign*.045:0)),pole:new Vector3(sign*.22,.5,1),footQ:new Quaternion().setFromAxisAngle(new Vector3(0,1,0),sign*7*DEG),a:rig.rest.get(`upperleg01_${side}`)!.distanceTo(rig.rest.get(`lowerleg01_${side}`)!),b:rig.rest.get(`lowerleg01_${side}`)!.distanceTo(rig.rest.get(`foot_${side}`)!)};
 });
 // Solve a posterior pelvis correction if a planted foot would exceed 20°
 // dorsiflexion. This is a geometric constraint search, not a hand-tuned angle.
 const maxDorsi=(bias:number)=>Math.max(...legInputs.map(l=>{
  const s=solveTwoBone(l.hip.clone().add(new Vector3(0,0,-bias)),l.target,l.pole,l.a,l.b,135);
  const shank=s.end.clone().sub(s.mid).applyQuaternion(l.footQ.clone().invert());
  return Math.atan2(-shank.z,-shank.y)/DEG;
 }));
 if(maxDorsi(0)>20){let lo=0,hi=.15;for(let i=0;i<14;i++){const mid=(lo+hi)/2;if(maxDorsi(mid)>20)lo=mid;else hi=mid;}root.position.z-=hi;rig.model.updateMatrixWorld(true);}
 for(const l of legInputs){rig.limb(l.side,'leg',l.target,l.pole);rig.worldRotation(`foot_${l.side}`,l.footQ);}
 // A modest clavicle elevation shares shoulder movement during reaching.
 if(id==='reach'){
  const lift=Math.max(0,(p.right[1]-1.1)/.62);
  rig.rotate('clavicle_R',0,0,-lift*8);rig.rotate('shoulder01_R',0,0,-lift*5);
 }
 const rtarget=world(p.right),ltarget=world(p.left);
 // Keep shoulders down and elbows on the anatomical flexion side of the chain.
 rig.limb('R','arm',rtarget,world([- .52,1.17,-.12]));
 rig.limb('L','arm',ltarget,world([.51,1.13,-.12]));
 rig.hand('R',new Vector3(...p.rf).applyQuaternion(yaw),new Vector3(...p.rn).applyQuaternion(yaw));
 rig.hand('L',new Vector3(...p.lf).applyQuaternion(yaw),new Vector3(...p.ln).applyQuaternion(yaw));
 if(id==='ready'||id==='forehand')applyGrip(rig);
 for(const side of (id==='ready'||id==='forehand'?['L']:['L','R']))rig.relaxHand(side as 'L'|'R');
 rig.model.updateMatrixWorld(true);
}
export function buildAuthoredClips(rig:HumanRig){
 const clips=new Map<string,AnimationClip>();
 for(const id of AUTHORED_KEYFRAMED_IDS){
  const spec=authoredMotionById(id)!;
  const times:number[]=[],positions:number[]=[],rot=new Map([...rig.bones.keys()].map(n=>[n,[] as number[]]));const frames=Math.ceil(spec.duration*40);
  for(let i=0;i<=frames;i++){
   const t=i/frames*spec.duration;poseAt(rig,id,t);times.push(t);positions.push(...rig.bone('root').position.toArray());
   for(const [n,b]of rig.bones)rot.get(n)!.push(...b.quaternion.toArray());
  }
  const tracks=[...rot].map(([n,v])=>new QuaternionKeyframeTrack(n+'.quaternion',times,v));
  clips.set(id,new AnimationClip(id,spec.duration,[...tracks,new VectorKeyframeTrack('root.position',times,positions)]));
 }
 rig.reset();return clips;
}
