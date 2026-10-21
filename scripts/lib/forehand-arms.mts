// Forehand arm choreography, expressed in the SOLVED TORSO frame so every
// player's trunk turn carries the same authored shapes.
//
// REFERENCE = the user's hand-authored workshop document
// (scripts/forehand-arm-reference.json). Only its 引拍1 / 引拍2 / 击球 racket and
// off arms are authored; the rest of that document is an untouched copy of the
// old generated preset and is NOT reference data. `readReference` solves the
// document on the production rig and turns each authored key into torso
// coefficients; the presets are then rebuilt from those coefficients.
//
// TORSO frame (solved from the two shoulders):
//   out   = unit(offShoulder − racketShoulder), flattened   (toward the off side)
//   up    = world +Y
//   front = out × up for a right-hander, up × out for a left-hander — the net
//           direction either way, so a left-handed document is the x-mirror.
//
// Why torso coefficients: the old generator copied the seed's WORLD-space wrist
// targets and then scaled each axis independently (reach/armHeight/depth). On a
// trunk turned further, that shears the arm and aims it at the wrong place —
// the source of the "twisted" presets. A torso coefficient set is invariant to
// the trunk turn and is only ever scaled UNIFORMLY about the shoulder, so the
// authored elbow angle and wrist direction relative to the shoulder survive.
//
// Hand frames: `forward` (fingers) is derived from the racket AXIS plus the
// forearm direction, never stored free-hand, so the solver's 59.8° wrist cone
// holds by construction and the stored axis is the rendered one. (The authored
// 引拍1 frame sits 79.5° off its forearm and is therefore clamped; only its
// axis is transferred.)
//
// The designed (non-authored) poses below — ready, extend, fold, finish,
// settle, guard/reach/catch — are DECLARED HERE as torso coefficients and were
// checked by rendering the presets; the authored keys are never re-specified.
import {Matrix4,Quaternion,Vector3} from 'three';

export interface V3Like{x:number;y:number;z:number}
export interface HandLike{target:V3Like;pole:V3Like;forward:V3Like;normal:V3Like}
export interface ArmLengths{upper:number;fore:number}
export type Side='L'|'R';
export interface TorsoFrame{side:Side;racketShoulder:Vector3;offShoulder:Vector3;out:Vector3;up:Vector3;front:Vector3}
export interface ArmPose{target:Vector3;pole:Vector3;forward:Vector3;normal:Vector3}
export interface ArmChain{upper:Vector3;fore:Vector3;forward:Vector3;normal:Vector3}
/** One arm shape in torso coordinates: `wrist` a unit direction from the
 * shoulder, `reach` its length as a fraction of the arm length (a shorter rig
 * keeps the same elbow angle), `hinge` the elbow side, `axis` the racket head
 * direction (ignored for the off arm). */
export interface TorsoArm{wrist:[number,number,number];reach:number;hinge:[number,number,number];axis:[number,number,number]}

const DEG=Math.PI/180;
const UP=new Vector3(0,1,0);
const v=(a:V3Like)=>new Vector3(a.x,a.y,a.z);
const round6=(n:number)=>Math.round(n*1e6)/1e6;
const store=(a:Vector3):V3Like=>({x:round6(a.x),y:round6(a.y),z:round6(a.z)});
/** Sign relating forward × normal to the racket head direction. */
export const axisSign=(side:Side)=>side==='R'?1:-1;
/** Solver elbow limit (kinematics LIMITS.elbowFlexion[1]); pinned by the
 * pose-validity test through the real solve. */
const ELBOW_MAX_DEG=145;

export function torsoFrame(side:Side,racketShoulder:V3Like,offShoulder:V3Like):TorsoFrame{
 const rs=v(racketShoulder),os=v(offShoulder);
 const out=os.clone().sub(rs);out.y=0;
 if(out.lengthSq()<1e-12)out.set(side==='R'?1:-1,0,0);
 out.normalize();
 const front=side==='R'?new Vector3().crossVectors(out,UP):new Vector3().crossVectors(UP,out);
 return {side,racketShoulder:rs,offShoulder:os,out,up:UP.clone(),front:front.normalize()};
}
/** World vector from torso-frame coefficients (out, up, front). */
export function torsoVec(f:TorsoFrame,o:number,u:number,fr:number){
 return f.out.clone().multiplyScalar(o).addScaledVector(f.up,u).addScaledVector(f.front,fr);
}
const torsoDir=(f:TorsoFrame,o:number,u:number,fr:number)=>torsoVec(f,o,u,fr).normalize();
/** Unit direction from elevation above horizontal and azimuth from `front`
 * toward `out` (degrees). */
export function sph(f:TorsoFrame,elevDeg:number,azDeg:number){
 const e=elevDeg*DEG,a=azDeg*DEG;
 return torsoVec(f,Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)).normalize();
}
/** Torso-frame direction as (elevation, azimuth) degrees — the same convention
 * sph() consumes, for reading a rendered pose back into an anchor. */
export function sphOf(f:TorsoFrame,d:Vector3){
 const u=d.clone().normalize();
 return {el:+((Math.asin(Math.max(-1,Math.min(1,u.y)))*180)/Math.PI).toFixed(2),
  az:+((Math.atan2(u.dot(f.out),u.dot(f.front))*180)/Math.PI).toFixed(2)};
}
const tuple=(f:TorsoFrame,d:Vector3):[number,number,number]=>[d.dot(f.out),d.dot(f.up),d.dot(f.front)];

/** Two-bone lengths of one side on the rest rig. */
export function armLengths(rig:{rest:ReadonlyMap<string,Vector3>},s:Side):ArmLengths{
 const upper=rig.rest.get(`upperarm01_${s}`)!.distanceTo(rig.rest.get(`lowerarm01_${s}`)!);
 const fore=rig.rest.get(`lowerarm01_${s}`)!.distanceTo(rig.rest.get(`wrist_${s}`)!);
 return {upper,fore};
}
/** Shoulder→wrist length of one side on the rest rig. */
export function armLength(rig:{rest:ReadonlyMap<string,Vector3>},s:Side):number{
 const {upper,fore}=armLengths(rig,s);return upper+fore;
}
/** The racket axis (handle → head) a stored hand frame produces. */
export function handAxis(hand:Pick<HandLike,'forward'|'normal'>,side:Side){
 return new Vector3().crossVectors(v(hand.forward),v(hand.normal)).multiplyScalar(axisSign(side)).normalize();
}
/** Interpolate two torso-frame anchors before placing them on a sampled trunk.
 * This adds a real solved key when a fast chest turn would otherwise make the
 * pelvis-frame hand interpolator drag a long straight off arm through the
 * chest. Directions slerp; reach alone uses a scalar lerp. */
export function interpolateTorsoArm(a:TorsoArm,b:TorsoArm,w:number):TorsoArm{
 const unit=(x:[number,number,number],y:[number,number,number]):[number,number,number]=>{
  const from=new Vector3(...x).normalize(),to=new Vector3(...y).normalize();
  const dot=Math.max(-1,Math.min(1,from.dot(to)));
  if(dot>0.9995)return [
   from.x+(to.x-from.x)*w,from.y+(to.y-from.y)*w,from.z+(to.z-from.z)*w,
  ].map(n=>n/Math.hypot(from.x+(to.x-from.x)*w,from.y+(to.y-from.y)*w,from.z+(to.z-from.z)*w)) as [number,number,number];
  const theta=Math.acos(dot),sin=Math.sin(theta),wa=Math.sin((1-w)*theta)/sin,wb=Math.sin(w*theta)/sin;
  return [from.x*wa+to.x*wb,from.y*wa+to.y*wb,from.z*wa+to.z*wb];
 };
 return {wrist:unit(a.wrist,b.wrist),hinge:unit(a.hinge,b.hinge),axis:unit(a.axis,b.axis),reach:a.reach+(b.reach-a.reach)*w};
}

/* ---------- reference reading ---------- */
export interface ReferenceArms{racket:TorsoArm;off:TorsoArm}
/** Solve the hand-authored reference document on `rig` and return the torso
 * coefficients of the named keys. The document's own solved trunk at each key
 * defines its torso frame, so what comes back is the isolated arm shape. */
export function readReference(
 rig:{rest:ReadonlyMap<string,Vector3>;point(name:string):Vector3},
 ref:{gripSide?:Side;keys:{time:number;label:string;pose:{handL:HandLike;handR:HandLike}}[]},
 labels:string[],
 solveFrame:(ref:unknown,time:number)=>void,
):Record<string,ReferenceArms>{
 const side:Side=ref.gripSide==='L'?'L':'R',off:Side=side==='L'?'R':'L';
 const arms:{L:number;R:number}={L:armLength(rig,'L'),R:armLength(rig,'R')};
 const out:Record<string,ReferenceArms>={};
 for(const label of labels){
  const key=ref.keys.find(k=>k.label===label);
  if(!key)throw new Error(`reference document has no key labelled ${label}`);
  solveFrame(ref,key.time);
  const f=torsoFrame(side,rig.point(`upperarm01_${side}`),rig.point(`upperarm01_${off}`));
  const read=(s:Side):TorsoArm=>{
   const S=rig.point(`upperarm01_${s}`),E=rig.point(`lowerarm01_${s}`),W=rig.point(`wrist_${s}`);
   const hand=s==='R'?key.pose.handR:key.pose.handL;
   const chord=W.clone().sub(S),dir=chord.clone().normalize();
   const elbowOff=E.clone().sub(S);
   const hinge=elbowOff.clone().addScaledVector(dir,-elbowOff.dot(dir));
   return {wrist:tuple(f,dir),reach:chord.length()/arms[s],
    hinge:hinge.length()>1e-9?tuple(f,hinge.normalize()):tuple(f,dir),
    axis:tuple(f,handAxis(hand,s))};
  };
  out[label]={racket:read(side),off:read(off)};
 }
 return out;
}

/* ---------- hand frame ---------- */
function frameQuat(forward:Vector3,normal:Vector3){
 const f=forward.clone().normalize();const n=normal.clone().addScaledVector(f,-normal.dot(f)).normalize();
 return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(f,n,new Vector3().crossVectors(f,n)));
}
/** Rotate one hand frame into another at parameter w — a constant-rate
 * rotation. Lerping the directions instead collapses near a ~120° pair and
 * whips the renormalised frame through the gap. */
function slerpFrame(f0:Vector3,n0:Vector3,f1:Vector3,n1:Vector3,w:number){
 const q=frameQuat(f0,n0).slerp(frameQuat(f1,n1),w);
 return {forward:new Vector3(1,0,0).applyQuaternion(q),normal:new Vector3(0,1,0).applyQuaternion(q)};
}
/** Orthonormal hand frame that puts the racket head along `axis`, with the
 * fingers as close to `forwardHint` (the forearm direction) as the axis
 * allows. The wrist bend this produces is |90° − ∠(axis, forearm)|, so an axis
 * that is not nearly collinear with the forearm lands inside the solver's
 * 59.8° cone. */
export function frameFromAxis(axis:Vector3,forwardHint:Vector3,side:Side){
 const a=axis.clone().normalize();
 let forward=forwardHint.clone().addScaledVector(a,-forwardHint.dot(a));
 if(forward.lengthSq()<1e-9)forward=a.clone().cross(new Vector3(0,1,0));
 forward.normalize();
 const normal=new Vector3().crossVectors(a,forward).multiplyScalar(axisSign(side)).normalize();
 return {forward,normal};
}

/* ---------- two-bone geometry (mirrors kinematics.solveTwoBone) ---------- */
function minReachOf(arm:ArmLengths){
 return Math.sqrt(arm.upper*arm.upper+arm.fore*arm.fore+2*arm.upper*arm.fore*Math.cos(ELBOW_MAX_DEG*DEG));
}
/** Upper-arm and forearm directions for a target, with the elbow on `hinge`. */
function twoBone(S:Vector3,target:Vector3,hinge:Vector3,arm:ArmLengths){
 const a=arm.upper,b=arm.fore;
 const dir=target.clone().sub(S);
 const d=Math.max(minReachOf(arm),Math.min(a+b-1e-6,dir.length()));
 dir.normalize();
 const bend=hinge.clone().addScaledVector(dir,-hinge.dot(dir));
 if(bend.lengthSq()<1e-10)bend.set(0,0,1).addScaledVector(dir,-dir.z);
 bend.normalize();
 const x=(a*a-b*b+d*d)/(2*d);
 const elbow=S.clone().addScaledVector(dir,x).addScaledVector(bend,Math.sqrt(Math.max(0,a*a-x*x)));
 return {upper:elbow.clone().sub(S).normalize(),fore:S.clone().addScaledVector(dir,d).sub(elbow).normalize(),elbow,d};
}
/** Pole direction that makes the solve reproduce `chain`'s elbow: the elbow's
 * component ⟂ the shoulder→wrist chord. Null for a straight arm. */
function hingeOf(chain:Pick<ArmChain,'upper'|'fore'>,arm:ArmLengths){
 const elbow=chain.upper.clone().multiplyScalar(arm.upper);
 const chord=elbow.clone().addScaledVector(chain.fore,arm.fore).normalize();
 const perp=elbow.addScaledVector(chord,-elbow.dot(chord));
 return perp.length()>.01?perp.normalize():null;
}

/* ---------- placement ---------- */
/** Racket arm from torso coefficients. `reachScale` scales the whole arm
 * uniformly about the shoulder (never per axis) and `lift` raises the wrist. */
export function placeRacketArm(f:TorsoFrame,arm:ArmLengths,c:TorsoArm,opts:{reachScale?:number;lift?:number}={}):ArmPose{
 const S=f.racketShoulder,lift=opts.lift??0,scale=opts.reachScale??1;
 const target=S.clone().addScaledVector(torsoDir(f,...c.wrist),c.reach*(arm.upper+arm.fore)*scale);
 target.y+=lift;
 const hinge=torsoDir(f,...c.hinge);
 const bones=twoBone(S,target,hinge,arm);
 const {forward,normal}=frameFromAxis(torsoDir(f,...c.axis),bones.fore,f.side);
 const wrist=S.clone().addScaledVector(bones.upper,arm.upper).addScaledVector(bones.fore,arm.fore);
 wrist.y+=lift;
 return {target:wrist,pole:S.clone().addScaledVector(hinge,.45).add(new Vector3(0,lift*.5,0)),forward,normal};
}
/** Off arm from torso coefficients; the off hand's fingers follow its own
 * forearm (there is no racket on that side). */
export function placeOffArm(f:TorsoFrame,arm:ArmLengths,S:Vector3,c:TorsoArm,lift=0):ArmPose{
 const target=S.clone().addScaledVector(torsoDir(f,...c.wrist),c.reach*(arm.upper+arm.fore));
 target.y+=lift;
 const hinge=torsoDir(f,...c.hinge);
 const bones=twoBone(S,target,hinge,arm);
 return {target,pole:S.clone().addScaledVector(hinge,.45),...handFrameAlong(bones.fore,hinge)};
}
/** Hand frame whose fingers follow `dir` (zero wrist bend) with the palm normal
 * in the bend plane. The OFF arm carries no racket, so its hand follows the
 * forearm; frameFromAxis cannot express that (axis == hint degenerates to a
 * 90° wrist) and the solver clamped it. */
export function handFrameAlong(dir:Vector3,hinge:Vector3){
 const forward=dir.clone().normalize();
 let normal=hinge.clone().addScaledVector(forward,-hinge.dot(forward));
 if(normal.lengthSq()<1e-9)normal.crossVectors(forward,UP);
 if(normal.lengthSq()<1e-9)normal.set(0,0,1);
 return {forward,normal:normal.normalize()};
}

/** Chain-space interpolation between two arm poses. The shoulder→wrist chord
 * direction, the hinge direction and the chord length (the elbow angle) each
 * interpolate and the chain is rebuilt from them. Slerping upper arm and
 * forearm independently instead lets the elbow pass THROUGH straight between
 * two bent anchors, where the hinge is undefined and flips. */
export function interpolateArms(a:ArmPose,b:ArmPose,w:number,f:TorsoFrame,arm:ArmLengths):ArmPose{
 const S=f.racketShoulder;
 const chainOf=(p:ArmPose)=>{
  const chord=p.target.clone().sub(S);
  const dir=chord.clone().normalize();
  const hinge=p.pole.clone().sub(S);hinge.addScaledVector(dir,-hinge.dot(dir));
  if(hinge.lengthSq()<1e-10)hinge.copy(f.front);
  return {dir,hinge:hinge.normalize(),len:chord.length()};
 };
 const A=chainOf(a),B=chainOf(b);
 const dir=A.dir.clone().lerp(B.dir,w);if(dir.lengthSq()<1e-9)dir.copy(B.dir);dir.normalize();
 const hinge=A.hinge.clone().lerp(B.hinge,w);if(hinge.lengthSq()<1e-9)hinge.copy(A.hinge);hinge.normalize();
 const len=A.len+(B.len-A.len)*w;
 const target=S.clone().addScaledVector(dir,len);
 const bones=twoBone(S,target,hinge,arm);
 const frame=slerpFrame(a.forward,a.normal,b.forward,b.normal,w);
 return {target,pole:S.clone().addScaledVector(hinge,.45),...frame};
}

/* ---------- designed anchors (not reference data) ---------- */
/** A relaxed ready pose: racket in front of the hip with the head up, off hand
 * just in front of the chest. Kept close to the 引拍1 shapes so the
 * ready → takeback move is a short continuous sweep. */
export const READY_RACKET:TorsoArm={wrist:[-0.30,-0.34,0.89],reach:.80,hinge:[-0.55,-0.30,-0.78],axis:[0.03,0.94,0.34]};
/** After the ball: still nearly straight, upper arm rising, racket head
 * climbing. Reads as the continuation of the authored 击球 shape. */
export const EXTEND_RACKET:TorsoArm={wrist:[-0.06,0.02,0.998],reach:.98,hinge:[-0.30,-0.72,0.62],axis:[-0.75,0.55,0.36]};
/** Half-way into the fold: elbow bending in front of the chest. */
export const FOLD_RACKET:TorsoArm={wrist:[0.20,0.16,0.97],reach:.86,hinge:[-0.55,-0.62,0.56],axis:[0.18,0.95,0.25]};
/** Finish: forearm folded to the off shoulder, racket near vertical with the
 * head above that shoulder. */
export const FINISH_RACKET:TorsoArm={wrist:[0.52,0.30,0.80],reach:.80,hinge:[-0.35,-0.55,0.76],axis:[0.05,0.97,-0.24]};
/** The held finish, settled a little lower. */
export const SETTLE_RACKET:TorsoArm={wrist:[0.55,0.10,0.83],reach:.72,hinge:[-0.30,-0.70,0.65],axis:[0.08,0.95,-0.30]};

/** Off arm: guard in front of the chest — the authored 引拍1 off shape, then
 * reach across toward the ball as the trunk opens (the 引拍2/击球 shape). */
export const OFF_GUARD:TorsoArm={wrist:[0.06,-0.32,0.95],reach:.55,hinge:[0.62,-0.55,-0.56],axis:[0.45,0.10,0.89]};
export const OFF_REACH:TorsoArm={wrist:[-0.35,-0.20,0.92],reach:.96,hinge:[0.55,-0.83,0.06],axis:[0.40,0.10,0.91]};
/** Mid-swing bridge only: tuck the ball-pointing off arm slightly, with the
 * elbow kept outside the chest. The user-authored endpoint stays unchanged. */
export const OFF_SWING:TorsoArm={wrist:[-0.30,-0.18,0.94],reach:.80,hinge:[0.90,-0.38,0.18],axis:[0.35,0.08,0.93]};
export function offGuard(f:TorsoFrame,arm:ArmLengths):ArmPose{return placeOffArm(f,arm,f.offShoulder,OFF_GUARD);}
export function offReach(f:TorsoFrame,arm:ArmLengths,c:TorsoArm=OFF_REACH):ArmPose{return placeOffArm(f,arm,f.offShoulder,c);}

/** Distance up the handle from the racket wrist to the throat the off hand cups. */
export const THROAT_ALONG_AXIS=.20;
/** Off-hand palm offset from the throat (m). */
export const CATCH_PALM_OFFSET=.075;
/** Off hand on the racket throat: the palm faces the shaft and the elbow stays
 * out on the off side. */
export function offCatch(f:TorsoFrame,arm:ArmLengths,racket:{wrist:Vector3;axis:Vector3}):ArmPose{
 const S=f.offShoulder;
 const throat=racket.wrist.clone().addScaledVector(racket.axis,THROAT_ALONG_AXIS);
 const palm=torsoDir(f,-.80,0,-.60);
 let target=throat.clone().addScaledVector(palm,-CATCH_PALM_OFFSET);
 // Keep the catch inside the solved arm's reach envelope: below the minimum the
 // elbow would have to fold past the clamp, above the maximum the hand simply
 // cannot touch the throat. Both would leave an IK residual on a touch that is
 // supposed to be a touch.
 const reach=target.clone().sub(S),minReach=.45*(arm.upper+arm.fore),maxReach=.97*(arm.upper+arm.fore);
 if(reach.length()<minReach)target.copy(S).addScaledVector(reach.normalize(),minReach);
 else if(reach.length()>maxReach)target.copy(S).addScaledVector(reach.normalize(),maxReach);
 const hinge=torsoDir(f,.30,-.88,.35);
 const bones=twoBone(S,target,hinge,arm);
 return {target,pole:S.clone().addScaledVector(hinge,.45),...handFrameAlong(bones.fore,hinge)};
}
/** Any off-arm transition at parameter w with the elbow pole swung out and down
 * through the middle: with lerped poles the upper arm crossed the chest
 * half-way between keys. */
export function offTransition(f:TorsoFrame,from:ArmPose,to:ArmPose,w:number):ArmPose{
 const pose=blendArm(from,to,w);
 pose.pole=f.offShoulder.clone().addScaledVector(torsoDir(f,.55,-.70,.45),.45).lerp(pose.pole,Math.abs(2*w-1));
 return pose;
}
/** Position lerp, hand frame slerp. */
export function blendArm(a:ArmPose,b:ArmPose,w:number):ArmPose{
 const fr=slerpFrame(a.forward,a.normal,b.forward,b.normal,w);
 return {target:a.target.clone().lerp(b.target,w),pole:a.pole.clone().lerp(b.pole,w),...fr};
}
/** Blend a stored hand toward `pose` by weight w (0 keeps the hand, 1 replaces
 * it). Positions lerp; the frame rotates from a fixed `from` when a ramp of keys
 * is blended, so per-key frame differences cannot put consecutive keys on
 * different rotation hemispheres. */
export function blendHand(hand:HandLike,pose:ArmPose,w:number,from?:Pick<HandLike,'forward'|'normal'>){
 if(w<=0)return;
 hand.target=store(v(hand.target).lerp(pose.target,w));
 hand.pole=store(v(hand.pole).lerp(pose.pole,w));
 const f0=from??hand;
 const fr=slerpFrame(v(f0.forward),v(f0.normal),pose.forward,pose.normal,w);
 hand.forward=store(fr.forward);hand.normal=store(fr.normal);
}
/** Copy an arm pose into a stored hand. */
export function setHand(hand:HandLike,pose:ArmPose){
 hand.target=store(pose.target);hand.pole=store(pose.pole);
 hand.forward=store(pose.forward);hand.normal=store(pose.normal);
}
export const toV3=v;
