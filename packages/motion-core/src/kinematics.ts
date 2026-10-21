import {Matrix4, Quaternion, Vector3, MathUtils} from 'three';
export const DEG = Math.PI / 180;
/** Wrist bend clamp applied inside HumanRig.hand() (deg): forearm→hand
 * directions beyond this are slerped back onto the limit cone. One named
 * constant so the solver's clamp and the quality probe's clamp-demand metric
 * can never drift apart. */
export const WRIST_BEND_LIMIT_DEG = 59.8;
export const LIMITS = {
  hipFlexion: [-20, 120], kneeFlexion: [0, 135], ankleFlexion: [-40, 20],
  elbowFlexion: [0, 145], shoulderElevation: [0, 165], wristFlexion: [-60, 60],
  fingerMCP: [0, 85], fingerPIP: [0, 100], fingerDIP: [0, 75],
} as const;
/** Forearm twist share (rad) for a palm roll (rad). 65% of the roll up to ±80°,
 * then a cosine ease to 0 at ±180°. The mapping is odd and continuous across the
 * atan2 wrap at ±π (both ends map to 0): a hard clamp would jump ±52° there, and
 * the wrist bone would pop with it. The wrist carries whatever the twist bone does not. */
export function forearmTwist(roll:number){
 const limit=80*DEG,share=.65,cap=share*limit,a=Math.min(Math.abs(roll),Math.PI);
 const g=a<=limit?share*a:cap*Math.cos(Math.PI/2*(a-limit)/(Math.PI-limit));
 return Math.sign(roll)*g;
}
export function clampJoint(name: keyof typeof LIMITS, degrees: number) {
  return MathUtils.clamp(degrees, LIMITS[name][0], LIMITS[name][1]);
}
/* ---- scratch registers (issue #10 PR-C, eval MAJOR-2 rule) --------------
 * Module-level temps for the hot pure-math paths. The invariant: a scratch
 * reg is NEVER live across a call into a function that also uses scratch —
 * each reg below is written and consumed inside a single expression/loop
 * body, and no callee (three.js methods, MathUtils, refineMin/refineEdge)
 * touches them. Returned values stay FRESH allocations: solveTwoBone's
 * mid/end and frameRotation's quaternion are owned by callers. */
const _tbDir=new Vector3(),_tbBend=new Vector3(),_tbPole=new Vector3();
/** Constant-length two-bone geometry, with a pole vector and a flexion limit.
 * Same root / mid / tip / target / hint model as Unity Animation Rigging TwoBoneIK.
 * Engineering rig coordinates, not ISB clinical Euler angles. */
export function solveTwoBone(root: Vector3, target: Vector3, pole: Vector3, a: number, b: number, maxFlex=145) {
  const direction = _tbDir.copy(target).sub(root);
  const minReach = Math.max(1e-6,Math.sqrt(a*a+b*b+2*a*b*Math.cos(maxFlex*DEG)));
  const d = MathUtils.clamp(direction.length(), minReach, a+b-1e-6);
  if (direction.lengthSq()<1e-12) direction.set(0,-1,0);
  direction.normalize();
  const end = root.clone().addScaledVector(direction,d);
  const bend = _tbBend.copy(pole).sub(root).addScaledVector(direction,-_tbPole.copy(pole).sub(root).dot(direction));
  if (bend.lengthSq()<1e-10) bend.set(0,0,1).addScaledVector(direction,-direction.z);
  if (bend.lengthSq()<1e-10) bend.set(1,0,0);
  bend.normalize();
  const x = (a*a-b*b+d*d)/(2*d);
  const mid = root.clone().addScaledVector(direction,x).addScaledVector(bend,Math.sqrt(Math.max(0,a*a-x*x)));
  const flexion = Math.acos(MathUtils.clamp((d*d-a*a-b*b)/(2*a*b),-1,1))/DEG;
  return {mid,end,flexion,residual:end.distanceTo(target)};
}
export function frameRotation(restDirection: Vector3, restNormal: Vector3, direction: Vector3, normal: Vector3) {
  const basis=(d:Vector3,n:Vector3)=>{
    const y=d.clone().normalize();
    const z=n.clone().addScaledVector(y,-n.dot(y)).normalize();
    const x=new Vector3().crossVectors(y,z).normalize();
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,z));
  };
  return basis(direction,normal).multiply(basis(restDirection,restNormal).invert()).normalize();
}
/** FK shoulder -> elbow chain. The elbow rotates about its calibrated hinge,
 * so shoulder motion carries the forearm without independently twisting it.
 * The hinge reference is anatomical, not a left/right mirrored palm normal. */
export function hingedArmRotations(restUpper:Vector3,restForearm:Vector3,upperDirection:Vector3,hingeReference:Vector3,elbowFlexion:number){
  const restHinge=new Vector3().crossVectors(restUpper,restForearm).normalize();
  const upper=upperDirection.clone().normalize();
  const hinge=hingeReference.clone().addScaledVector(upper,-hingeReference.dot(upper)).normalize();
  const shoulder=frameRotation(restUpper,restHinge,upper,hinge);
  const flexion=clampJoint('elbowFlexion',elbowFlexion);
  const correction=flexion*DEG-restUpper.angleTo(restForearm);
  const elbow=shoulder.clone().multiply(new Quaternion().setFromAxisAngle(restHinge,correction));
  return {shoulder,elbow,hinge,flexion};
}
export function smoothstep(t:number){return t*t*(3-2*t);}
export function angleAt(a:Vector3,b:Vector3,c:Vector3){return 180-a.clone().sub(b).angleTo(c.clone().sub(b))/DEG;}

/** One leg as seen by the pelvis correction: hip and ankle target in world
 * space, pole, segment lengths, the foot's world rotation, and the leg's
 * support weight (1 = planted, 0 = free swing, fractional during a transition). */
export interface DorsiLeg{hip:Vector3;target:Vector3;pole:Vector3;upper:number;lower:number;footQ:Quaternion;weight:number}
/** Search-path scratch: `_dh` replicates `l.hip.clone().add(new Vector3(0,0,-s))`
 * — the literal `x+0`/`y+0` terms keep the exact float op sequence Vector3.add
 * performed (a `-0` component would survive `copy` but not the original add).
 * Written and consumed inside one expression per call; `legDorsiflexion`
 * passes it as solveTwoBone's `root` — solveTwoBone only READS it and never
 * touches this reg (MAJOR-2). */
const _dh=new Vector3(),_shank=new Vector3(),_fq=new Quaternion();
/** Ankle dorsiflexion (degrees) of a solved leg when the hip is shifted posteriorly by `bias` metres. */
function legDorsiflexion(l:DorsiLeg,bias=0){
  const s=solveTwoBone(_dh.set(l.hip.x+0,l.hip.y+0,l.hip.z-bias),l.target,l.pole,l.upper,l.lower,135);
  const shank=_shank.copy(s.end).sub(s.mid).applyQuaternion(_fq.copy(l.footQ).invert());
  return Math.atan2(-shank.z,-shank.y)/DEG;
}
export interface PelvisCorrection{shift:number;saturated:boolean;worstDorsiflexion:number}
/** Minimise a function on [a,b] by golden-section search: used to refine the
 * grid minimum of the fallback branches below. */
function refineMin(f:(s:number)=>number,a:number,b:number,iterations=24){
  const g=(Math.sqrt(5)-1)/2;let lo=a,hi=b;
  let c=hi-g*(hi-lo),d=lo+g*(hi-lo),fc=f(c),fd=f(d);
  for(let i=0;i<iterations;i++){
    if(fc<fd){hi=d;d=c;fd=fc;c=hi-g*(hi-lo);fc=f(c);}
    else{lo=c;c=d;fc=fd;d=lo+g*(hi-lo);fd=f(d);}
  }
  return (lo+hi)/2;
}
/** Bisection on a monotone predicate: `ok` is false at `lo`, true at `hi`. */
function refineEdge(ok:(s:number)=>boolean,lo:number,hi:number,iterations=10){
  for(let i=0;i<iterations;i++){const mid=(lo+hi)/2;if(ok(mid))hi=mid;else lo=mid;}
  return hi;
}
/** Smallest posterior shift in [0,maxShift] that brings the ankle target within
 * leg reach. When no shift in range does (posterior shift can also move the
 * target away from the hip), the shift that gets closest is returned instead of
 * jumping to the cap: a jump there moved the pelvis 15 cm for a 3 mm excess. */
function legShiftForReach(l:DorsiLeg,maxShift:number,step=.005){
  const reach=l.upper+l.lower-1e-4;
  const dist=(s:number)=>_dh.set(l.hip.x+0,l.hip.y+0,l.hip.z-s).distanceTo(l.target);
  if(dist(0)<=reach)return 0;
  let best=0,bestDist=dist(0);
  for(let s=step;s<=maxShift+1e-9;s+=step){
    if(dist(s)<=reach)return refineEdge(x=>dist(x)<=reach,s-step,s);
    if(dist(s)<bestDist){bestDist=dist(s);best=s;}
  }
  return refineMin(dist,Math.max(0,best-step),Math.min(maxShift,best+step));
}
/** Smallest posterior shift that brings one leg to `limit` degrees of
 * dorsiflexion. The search starts at the reach shift. Dorsiflexion comes from
 * the same two-bone solve the rig uses, which clamps an out-of-reach target to
 * the reach sphere, so the search stays continuous as a target crosses reach.
 * `ok` is false when the limit is not met in range, or the target is out of
 * reach at the chosen shift; the caller reports that as saturation. */
function legShiftForLimit(l:DorsiLeg,limit:number,maxShift:number,step=.005){
  const reach=l.upper+l.lower-1e-4;
  const reachOk=(s:number)=>_dh.set(l.hip.x+0,l.hip.y+0,l.hip.z-s).distanceTo(l.target)<=reach;
  const dorsi=(s:number)=>legDorsiflexion(l,s);
  const compliant=(s:number)=>dorsi(s)<=limit;
  const start=legShiftForReach(l,maxShift,step);
  if(compliant(start))return {shift:start,ok:reachOk(start)};
  for(let s=start+step;s<=maxShift+1e-9;s+=step){
    if(!compliant(s))continue;
    const shift=refineEdge(compliant,s-step,s);
    return {shift,ok:reachOk(shift)};
  }
  // Limit not met anywhere in range: the least-dorsiflexion shift, reported as saturated.
  let best=start,bestValue=dorsi(start);
  for(let s=start+step;s<=maxShift+1e-9;s+=step){const v=dorsi(s);if(v<bestValue){bestValue=v;best=s;}}
  return {shift:refineMin(dorsi,Math.max(start,best-step),Math.min(maxShift,best+step)),ok:false};
}
/** Largest posterior shift (metres) that keeps one leg's ankle target within
 * reach. The hip moves along −z, so |hip − s·ẑ − target|² ≤ reach² is a
 * quadratic in s whose upper root is c + √D, with c = (hip − target).z and
 * D = c² − |hip − target|² + reach². Infinity when the target is out of reach
 * at every shift (the leg's own check reports that) or is reachable only with
 * the pelvis forward of its rest position: no bound on the shift can protect
 * such a leg. */
function legReachCap(l:DorsiLeg){
  const reach=l.upper+l.lower-1e-4;
  const ux=l.hip.x-l.target.x,uy=l.hip.y-l.target.y,uz=l.hip.z-l.target.z;
  const disc=uz*uz-(ux*ux+uy*uy+uz*uz)+reach*reach;
  if(disc<0)return Infinity;
  const upper=uz+Math.sqrt(disc);
  return upper<0?Infinity:upper;
}
/** Posterior pelvis shift (metres) keeping every weighted leg at or below
 * `limit` degrees of dorsiflexion. Each leg is solved on its own and the
 * results combine as max(weight·shift), so a leg fading into or out of
 * support moves the pelvis continuously instead of jumping when the support
 * set changes. A weighted leg's ankle target also caps the shift at the point
 * where it leaves reach, so a planted foot keeps its place and the dorsiflexion
 * limit gives way instead of pulling the foot out of reach. The cap relaxes
 * linearly with the weight fading out, so it moves continuously too.
 * `saturated` reports a weighted leg that is out of reach or above `limit` at
 * the applied shift; callers surface it as a failed check, not a silent clamp. */
export function pelvisDorsiCorrection(legs:DorsiLeg[],limit=20,maxShift=.15):PelvisCorrection{
  let shift=0,saturated=false,worst=-Infinity,cap=Infinity;
  for(const l of legs){
    if(l.weight<=0)continue;
    worst=Math.max(worst,legDorsiflexion(l,0));
    const r=legShiftForLimit(l,limit,maxShift);
    if(!r.ok)saturated=true;
    shift=Math.max(shift,l.weight*r.shift);
    const reachCap=legReachCap(l);
    if(reachCap<Infinity)cap=Math.min(cap,reachCap+(1-Math.min(1,l.weight))*maxShift);
  }
  const applied=Math.min(shift,cap);
  if(applied<shift){
    // Conflict: the limit asks for more shift than a weighted leg's reach allows.
    for(const l of legs){
      if(l.weight<=0)continue;
      const reach=l.upper+l.lower-1e-4;
      if(_dh.set(l.hip.x+0,l.hip.y+0,l.hip.z-applied).distanceTo(l.target)>reach||legDorsiflexion(l,applied)>limit)saturated=true;
    }
  }
  return {shift:applied,saturated,worstDorsiflexion:worst};
}
