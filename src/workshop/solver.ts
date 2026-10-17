import {Quaternion,Vector3,MathUtils} from 'three';
import {HumanRig} from '../core/rig';
import {blendGrip} from '../core/racket';
import {DEG,LIMITS,angleAt,pelvisDorsiCorrection,solveTwoBone,type DorsiLeg} from '../core/kinematics';
import type {EffectiveFrame,PoseParams,KeyConstraints,SupportWeights} from './document';
import {toV} from './document';
import {FOOT_CLEARANCE_M,footDepth,footGeometry,footRotation,type Side} from './foot';

/** Kinematic stage of the pipeline: task-space pose → skeleton, with joint
 * limits and foot contacts enforced geometrically. This replaces forward
 * dynamics for authoring — muscle control stays a later stage. */
export const DORSI_LIMIT_DEG=20;

export interface SolveState{support?:SupportWeights;gripAmount?:number;clavicleLift?:boolean}
export interface SolveReport{pelvisShift:number;pelvisSaturated:boolean}

/** Solve one frame. `state` carries the interpolated support weights and grip
 * amount from the document sampler; without it the discrete constraint flags
 * are used (weight 1 when planted, grip 1 when gripping). */
export function solvePose(rig:HumanRig,p:PoseParams,c:KeyConstraints,state:SolveState={}):SolveReport{
  rig.reset();
  const root=rig.bone('root'),origin=rig.rest.get('root')!;
  root.position.copy(origin).add(new Vector3(
    MathUtils.clamp(p.root.x,-.6,.6),
    MathUtils.clamp(p.root.y,-.55,.35),
    MathUtils.clamp(p.root.z,-.6,.6)));
  rig.rotate('root',0,p.yaw,0);
  for(const n of ['spine05','spine04','spine03','spine02','spine01'])rig.rotate(n,p.lean/5,p.chest/5,p.side/5);
  rig.rotate('neck01',-p.lean*.22,-p.chest*.15,-p.side*.2);rig.rotate('neck02',-p.lean*.22,0,0);rig.rotate('head',-p.lean*.12,0,0);

  const support=state.support??{L:c.plantL?1:0,R:c.plantR?1:0};
  const gripAmount=state.gripAmount??(c.grip?1:0);
  const legs=(['L','R'] as const).map(side=>{
    const f=side==='L'?p.footL:p.footR;
    return {side,target:toV(f.target),pole:toV(f.pole),footQ:footRotation(f.yaw,f.pitch),
      a:rig.rest.get(`upperleg01_${side}`)!.distanceTo(rig.rest.get(`lowerleg01_${side}`)!),
      b:rig.rest.get(`lowerleg01_${side}`)!.distanceTo(rig.rest.get(`foot_${side}`)!)};
  });
  // Posterior pelvis correction against ankle dorsiflexion. Each leg is
  // weighted by its support, so a foot leaving the ground releases the
  // correction continuously instead of flipping the whole pelvis by 15 cm.
  const dorsiLegs:DorsiLeg[]=legs.map(l=>({hip:rig.point(`upperleg01_${l.side}`),target:l.target,pole:l.pole,
    upper:l.a,lower:l.b,footQ:l.footQ,weight:support[l.side]}));
  const correction=pelvisDorsiCorrection(dorsiLegs,DORSI_LIMIT_DEG,.15);
  if(correction.shift>0){root.position.z-=correction.shift;rig.model.updateMatrixWorld(true);}
  for(const l of legs){rig.limb(l.side,'leg',l.target,l.pole);rig.worldRotation(`foot_${l.side}`,l.footQ);}

  // Clavicle assist (doc flag): the right shoulder girdle rides up with a high
  // hand target — the authored reach behaviour. `target.y − p.root.y` recovers
  // the control-space height the authored formula used (world y minus root y).
  if(state.clavicleLift){
    const lift=Math.max(0,(toV(p.handR.target).y-p.root.y-1.1)/.62);
    rig.rotate('clavicle_R',0,0,-lift*8);rig.rotate('shoulder01_R',0,0,-lift*5);
    rig.model.updateMatrixWorld(true);
  }
  rig.limb('R','arm',toV(p.handR.target),toV(p.handR.pole));
  rig.limb('L','arm',toV(p.handL.target),toV(p.handL.pole));
  rig.hand('R',toV(p.handR.forward).normalize(),toV(p.handR.normal).normalize());
  rig.hand('L',toV(p.handL.forward).normalize(),toV(p.handL.normal).normalize());
  // Grip ramp: relaxed fingers blend toward the wrap grip; amount 1 is the full grip.
  blendGrip(rig,gripAmount);
  rig.relaxHand('L');
  rig.model.updateMatrixWorld(true);
  return {pelvisShift:correction.shift,pelvisSaturated:correction.saturated};
}

/** The single solve entry for a sampled document frame: support fades, the
 * grip ramp and the clavicle assist all come from the frame, never re-derived. */
export function solveEffectiveFrame(rig:HumanRig,f:EffectiveFrame){
  return solvePose(rig,f.pose,f.constraints,{support:f.support,gripAmount:f.gripAmount,clavicleLift:f.clavicleLift});
}

/** Ankle dorsiflexion (degrees) of the solved rig, from the shank direction
 * in the foot's own frame. Measured on the rig, not on the target geometry. */
export function ankleDorsiflexion(rig:HumanRig,side:Side){
  const shank=rig.point(`foot_${side}`).sub(rig.point(`lowerleg01_${side}`));
  const q=rig.bone(`foot_${side}`).getWorldQuaternion(new Quaternion()).invert();
  const local=shank.applyQuaternion(q);
  return Math.atan2(-local.z,-local.y)/DEG;
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

/** One check. `ok` is decided from `value` against `limit` in `unit`; the
 * label and detail stay human-readable, the rest is machine-readable. */
export interface CheckItem{code:string;ok:boolean;label:string;detail:string;value:number|null;limit:number|null;unit:string}
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
/** Distance from a ground-plane point to a convex polygon (0 inside). */
export function distanceToPolygon(p:Vector3,poly:Vector3[]){
  if(poly.length<3)return Infinity;
  let min=Infinity,inside=true;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    const e=new Vector3().subVectors(b,a),d=new Vector3().subVectors(p,a);
    const u=MathUtils.clamp(d.dot(e)/e.lengthSq(),0,1);
    min=Math.min(min,a.clone().addScaledVector(e,u).distanceTo(p));
    if((b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x)<0)inside=false;
  }
  return inside?0:min;
}
export function insidePolygon(p:Vector3,poly:Vector3[],margin=.02){
  return poly.length>=3&&distanceToPolygon(p,poly)<=margin;
}

/** Tolerance on limit comparisons: solver residue, not a physical allowance. */
const NUMERIC_EPS=1e-3;
/** Per-side limit checks measured on the solved rig: joint flexion limits,
 * ankle dorsiflexion and sole depth. Independent of which feet are planted,
 * so the package builder can reuse them for keyframed motions too. */
export function limitItems(rig:HumanRig):CheckItem[]{
  const items:CheckItem[]=[];
  const P=(n:string)=>rig.point(n);
  const deg=(code:string,label:string,value:number,limit:number,ok=value<=limit+NUMERIC_EPS):CheckItem=>
    ({code,ok,label,detail:`${value.toFixed(0)}° / ≤${limit}°`,value,limit,unit:'deg'});
  for(const side of ['L','R']as const){
    const label=side==='L'?'左':'右';
    const knee=angleAt(P(`upperleg01_${side}`),P(`lowerleg01_${side}`),P(`foot_${side}`));
    items.push({...deg(`knee-flexion-${side}`,`${label}膝屈曲`,knee,LIMITS.kneeFlexion[1])});
    const elbow=angleAt(P(`upperarm01_${side}`),P(`lowerarm01_${side}`),P(`wrist_${side}`));
    items.push({...deg(`elbow-flexion-${side}`,`${label}肘屈曲`,elbow,LIMITS.elbowFlexion[1])});
    const shoulder=P(`lowerarm01_${side}`).sub(P(`upperarm01_${side}`)).angleTo(new Vector3(0,-1,0))/DEG;
    items.push({...deg(`shoulder-elevation-${side}`,`${label}肩上抬`,shoulder,LIMITS.shoulderElevation[1])});
    const dorsi=ankleDorsiflexion(rig,side);
    items.push({...deg(`ankle-dorsiflexion-${side}`,`${label}踝背屈`,dorsi,DORSI_LIMIT_DEG)});
    const geo=footGeometry(rig.rest,side);
    const lowest=Math.min(...geo.names.map(n=>P(n).y));
    const depth=footDepth(geo,lowest);
    items.push({code:`foot-depth-${side}`,ok:depth<=FOOT_CLEARANCE_M+NUMERIC_EPS,label:`${label}脚入地`,
      detail:depth<=FOOT_CLEARANCE_M?`脚底最低点高于地面平面 · 入地 ${(depth*1000).toFixed(1)}mm`:`脚底入地 ${(depth*100).toFixed(1)}cm`,
      value:depth,limit:FOOT_CLEARANCE_M,unit:'m'});
  }
  return items;
}
export function analyzePose(rig:HumanRig,p:PoseParams,c:KeyConstraints,racket?:{localToWorld(v:Vector3):Vector3}):Analysis{
  const items:CheckItem[]=[];
  const P=(n:string)=>rig.point(n);
  const limits=limitItems(rig);
  for(const side of ['L','R']as const){
    items.push(...limits.filter(it=>it.code.endsWith(`-${side}`)));
    const planted=side==='L'?c.plantL:c.plantR;
    if(planted){
      const target=toV((side==='L'?p.footL:p.footR).target);
      const slip=P(`foot_${side}`).distanceTo(target);
      const label=side==='L'?'左':'右';
      items.push({code:`support-slip-${side}`,ok:slip<.01,label:`${label}脚支撑`,
        detail:slip<.01?`锁定 · 残差 ${(slip*1000).toFixed(1)}mm`:`滑移 ${(slip*100).toFixed(1)}cm`,value:slip,limit:.01,unit:'m'});
    }
  }
  const com=estimateCoM(rig),support=supportPolygon(p,c);
  const planted=c.plantL||c.plantR;
  const dist=planted?distanceToPolygon(new Vector3(com.x,0,com.z),support):null;
  const comStable=planted?(dist as number)<=.02:false;
  items.push({code:'com-support',ok:comStable,label:'重心投影',
    detail:!planted?'没有支撑脚':comStable?'在支撑多边形内':`距支撑多边形 ${((dist as number)*100).toFixed(1)}cm`,
    value:dist,limit:.02,unit:'m'});
  const racketTip=racket?racket.localToWorld(new Vector3(0,.61,0)):new Vector3();
  return {items,com,comStable,support,racketTip};
}
