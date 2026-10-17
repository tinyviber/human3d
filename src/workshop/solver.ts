import {Euler,Quaternion,Vector3,MathUtils} from 'three';
import {HumanRig} from '../core/rig';
import {applyGrip} from '../core/racket';
import {DEG,LIMITS,solveTwoBone,angleAt} from '../core/kinematics';
import type {PoseParams,KeyConstraints} from './document';
import {toV} from './document';

/** Kinematic stage of the pipeline: task-space pose → skeleton, with joint
 * limits and planted-foot constraints enforced geometrically. This replaces
 * forward dynamics for authoring — muscle control stays a later stage. */
export function solvePose(rig:HumanRig,p:PoseParams,c:KeyConstraints){
  rig.reset();
  const root=rig.bone('root'),origin=rig.rest.get('root')!;
  root.position.copy(origin).add(new Vector3(
    MathUtils.clamp(p.root.x,-.6,.6),
    MathUtils.clamp(p.root.y,-.55,.35),
    MathUtils.clamp(p.root.z,-.6,.6)));
  rig.rotate('root',0,p.yaw,0);
  for(const n of ['spine05','spine04','spine03','spine02','spine01'])rig.rotate(n,p.lean/5,p.chest/5,p.side/5);
  rig.rotate('neck01',-p.lean*.22,-p.chest*.15,-p.side*.2);rig.rotate('neck02',-p.lean*.22,0,0);rig.rotate('head',-p.lean*.12,0,0);

  const legs=(['L','R'] as const).map(side=>{
    const f=side==='L'?p.footL:p.footR;
    return {side,target:toV(f.target),pole:toV(f.pole),
      footQ:new Quaternion().setFromEuler(new Euler(f.pitch*DEG,f.yaw*DEG,0,'YXZ')),
      a:rig.rest.get(`upperleg01_${side}`)!.distanceTo(rig.rest.get(`lowerleg01_${side}`)!),
      b:rig.rest.get(`lowerleg01_${side}`)!.distanceTo(rig.rest.get(`foot_${side}`)!),
      planted:side==='L'?c.plantL:c.plantR};
  });
  // Posterior pelvis correction when a planted foot would exceed 20°
  // dorsiflexion — same bisection as the authored motions.
  const planted=legs.filter(l=>l.planted);
  if(planted.length){
    const maxDorsi=(bias:number)=>Math.max(...planted.map(l=>{
      const s=solveTwoBone(rig.point(`upperleg01_${l.side}`).add(new Vector3(0,0,-bias)),l.target,l.pole,l.a,l.b,135);
      const shank=s.end.clone().sub(s.mid).applyQuaternion(l.footQ.clone().invert());
      return Math.atan2(-shank.z,-shank.y)/DEG;
    }));
    if(maxDorsi(0)>20){let lo=0,hi=.15;for(let i=0;i<14;i++){const mid=(lo+hi)/2;if(maxDorsi(mid)>20)lo=mid;else hi=mid;}root.position.z-=hi;rig.model.updateMatrixWorld(true);}
  }
  for(const l of legs){rig.limb(l.side,'leg',l.target,l.pole);rig.worldRotation(`foot_${l.side}`,l.footQ);}

  rig.limb('R','arm',toV(p.handR.target),toV(p.handR.pole));
  rig.limb('L','arm',toV(p.handL.target),toV(p.handL.pole));
  rig.hand('R',toV(p.handR.forward).normalize(),toV(p.handR.normal).normalize());
  rig.hand('L',toV(p.handL.forward).normalize(),toV(p.handL.normal).normalize());
  if(c.grip)applyGrip(rig);
  for(const side of (c.grip?['L']:['L','R'])as('L'|'R')[])rig.relaxHand(side);
  rig.model.updateMatrixWorld(true);
}

/** Rotate a hand's stored forward/normal pair by a delta around a named axis,
 * keeping the pair orthonormal. */
export function rotateHandFrame(h:{forward:{x:number;y:number;z:number};normal:{x:number;y:number;z:number}},kind:'flex'|'dev'|'twist',degrees:number){
  const f=toV(h.forward).normalize(),n=toV(h.normal).normalize();
  const axis=kind==='flex'?new Vector3().crossVectors(f,n):kind==='dev'?n.clone():f.clone();
  const q=new Quaternion().setFromAxisAngle(axis.normalize(),degrees*DEG);
  const nf=f.clone().applyQuaternion(q),nn=n.clone().applyQuaternion(q);
  nn.addScaledVector(nf,-nn.dot(nf)).normalize();
  h.forward={x:nf.x,y:nf.y,z:nf.z};h.normal={x:nn.x,y:nn.y,z:nn.z};
}

export interface CheckItem{ok:boolean;label:string;detail:string}
export interface Analysis{items:CheckItem[];com:Vector3;comStable:boolean;support:Vector3[];racketTip:Vector3}

/** Whole-body CoM estimate from segment midpoints with de Leva-style mass
 * fractions. Engineering approximation for balance checks, not anthropometrics. */
const SEGMENTS:[string,string,number][]=[
  ['spine01','neck01',.4346],['neck01','head',.0694],
  ['upperarm01_L','lowerarm01_L',.0271],['upperarm01_R','lowerarm01_R',.0271],
  ['lowerarm01_L','wrist_L',.0223],['lowerarm01_R','wrist_R',.0223],
  ['upperleg01_L','lowerleg01_L',.1416],['upperleg01_R','lowerleg01_R',.1416],
  ['lowerleg01_L','foot_L',.0433],['lowerleg01_R','foot_R',.0433],
];
export function estimateCoM(rig:HumanRig){
  const com=new Vector3();let mass=0;
  for(const [a,b,m]of SEGMENTS){const mid=rig.point(a).add(rig.point(b)).multiplyScalar(.5);com.addScaledVector(mid,m);mass+=m;}
  for(const side of ['L','R']as const){const foot=rig.point(`foot_${side}`).add(new Vector3(0,-.03,.05));com.addScaledVector(foot,.0137);mass+=.0137;}
  return com.multiplyScalar(1/mass);
}
/** Convex hull of planted-foot rectangles in the ground plane. */
export function supportPolygon(p:PoseParams,c:KeyConstraints){
  const pts:Vector3[]=[];
  for(const side of ['L','R']as const){
    const f=side==='L'?p.footL:p.footR;if(!(side==='L'?c.plantL:c.plantR))continue;
    const yaw=(f.yaw)*DEG,dir=new Vector3(Math.sin(yaw),0,Math.cos(yaw)),wide=new Vector3(dir.z,0,-dir.x);
    for(const [u,v]of [[.2,0],[-.07,0],[0,.05],[0,-.05]]as const){
      const base=toV(f.target).addScaledVector(dir,u).addScaledVector(wide,v);
      pts.push(new Vector3(base.x,0,base.z));
    }
  }
  if(pts.length<3)return pts.map(p2=>p2.clone());
  pts.sort((a,b)=>a.x-b.x||a.z-b.z);
  const cross=(o:Vector3,a:Vector3,b:Vector3)=>(a.x-o.x)*(b.z-o.z)-(a.z-o.z)*(b.x-o.x);
  const lower:Vector3[]=[];for(const p2 of pts){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p2)<=0)lower.pop();lower.push(p2);}
  const upper:Vector3[]=[];for(let i=pts.length-1;i>=0;i--){const p2=pts[i];while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p2)<=0)upper.pop();upper.push(p2);}
  lower.pop();upper.pop();return lower.concat(upper);
}
export function insidePolygon(p:Vector3,poly:Vector3[],margin=.02){
  if(poly.length<3)return false;
  let min=Infinity;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    const e=new Vector3().subVectors(b,a),d=new Vector3().subVectors(p,a);
    const u=MathUtils.clamp(d.dot(e)/e.lengthSq(),0,1);
    min=Math.min(min,a.clone().addScaledVector(e,u).distanceTo(p));
    const sign=(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
    if(sign<0)return min<=margin;
  }
  return true;
}

export function analyzePose(rig:HumanRig,p:PoseParams,c:KeyConstraints,racket?:{localToWorld(v:Vector3):Vector3}):Analysis{
  const items:CheckItem[]=[];
  const P=(n:string)=>rig.point(n);
  for(const side of ['L','R']as const){
    const label=side==='L'?'左':'右';
    const knee=angleAt(P(`upperleg01_${side}`),P(`lowerleg01_${side}`),P(`foot_${side}`));
    items.push({ok:knee<=LIMITS.kneeFlexion[1]+.5,label:`${label}膝屈曲`,detail:`${knee.toFixed(0)}° / ≤${LIMITS.kneeFlexion[1]}°`});
    const elbow=angleAt(P(`upperarm01_${side}`),P(`lowerarm01_${side}`),P(`wrist_${side}`));
    items.push({ok:elbow<=LIMITS.elbowFlexion[1]+.5,label:`${label}肘屈曲`,detail:`${elbow.toFixed(0)}° / ≤${LIMITS.elbowFlexion[1]}°`});
    const shoulder=P(`lowerarm01_${side}`).sub(P(`upperarm01_${side}`)).angleTo(new Vector3(0,-1,0))/DEG;
    items.push({ok:shoulder<=LIMITS.shoulderElevation[1]+.5,label:`${label}肩上抬`,detail:`${shoulder.toFixed(0)}° / ≤${LIMITS.shoulderElevation[1]}°`});
    const foot=P(`foot_${side}`),planted=side==='L'?c.plantL:c.plantR;
    if(planted){
      const target=toV((side==='L'?p.footL:p.footR).target);
      const slip=foot.distanceTo(target);
      items.push({ok:slip<.01,label:`${label}脚支撑`,detail:slip<.01?`锁定 · 残差 ${(slip*1000).toFixed(1)}mm`:`滑移 ${(slip*100).toFixed(1)}cm`});
    }
  }
  const com=estimateCoM(rig),support=supportPolygon(p,c);
  const comStable=c.plantL||c.plantR?insidePolygon(new Vector3(com.x,0,com.z),support):false;
  items.push({ok:comStable,label:'重心投影',detail:!c.plantL&&!c.plantR?'没有支撑脚':comStable?'在支撑多边形内':'在支撑多边形外'});
  const racketTip=racket?racket.localToWorld(new Vector3(0,.61,0)):new Vector3();
  return {items,com,comStable,support,racketTip};
}
