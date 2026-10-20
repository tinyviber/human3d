// Forehand arm choreography shared by the player-preset generator and the
// bundled 49-key forehand edit. Pure TS: three only as a math library, no
// node imports.
//
// Everything is authored in a TORSO frame built from the two solved shoulders
// so the arms follow the trunk turn and mirror exactly for a left-handed grip:
//   out   = unit(offShoulder − racketShoulder), flattened   (toward the off side)
//   up    = world +Y
//   front = out × up for a right-hander, up × out for a left-hander — the
//           net direction either way, so an anchor is the same pose on both
//           sides (the left-handed doc is the x-mirror of the right).
// Directions are written as (elevation above horizontal, azimuth from `front`
// toward `out`) in degrees — negative azimuth = the racket side.
//
// Racket arm. The shoulder drives the UPPER ARM down first and then
// diagonally up (its elevation is the choreography's main line); the forearm
// opens into the ball and folds after it:
//   takeback  the authored hand (target, pole, racket orientation) as is
//   drop      upper arm hanging down-back (−65°), forearm back, racket head
//             dropped below the hand — the bottom of the C
//   contact   the authored contact direction, arm straightened to
//             `contactReach` (≈23° elbow): the forearm catches up with the
//             upper arm through the ball
//   extend    still nearly straight, upper arm rising toward horizontal,
//             racket head already climbing
//   finish    upper arm ABOVE the shoulder line (+15°) pointing forward/across,
//             forearm folded (~85°) across to the off shoulder, racket near
//             vertical with the head above that shoulder
//   settle    the held finish (presets end here), a little lower
// Between two chain anchors the upper-arm and forearm directions slerp (chain
// space) and the elbow pole sits on the interpolated elbow's side of the
// shoulder→wrist chord: the two-bone solve reproduces the intended elbow and
// the hinge turns only as fast as the fold itself. A wrist-position chord lerp
// instead lets the solve pull the upper arm through the pec.
// Off arm:
//   guard    elbow out, ~80°, forearm across the front at chest height
//   tuck     pulled in close to the chest through contact
//   catch    hand on the racket throat as the racket arrives at the shoulder
//
// Stored hand values are world metres; `handFrames: pelvis` only changes how
// keys interpolate. Hand `forward` (fingers) must stay inside the solver's
// 59.8° wrist cone around the forearm, so every frame derives forward from
// the forearm direction. `normal` is the palm-facing direction (the racket
// handle sits 3 cm along +normal — see gripFrame). The racket head direction
// is forward × normal on the right hand and its negative on the left (the
// left racket mount is the x-mirror of the right one, and a mirrored cross
// product flips sign).
import {Matrix4,Quaternion,Vector3} from 'three';

export interface V3Like{x:number;y:number;z:number}
export interface HandLike{target:V3Like;pole:V3Like;forward:V3Like;normal:V3Like}
export interface ArmLengths{upper:number;fore:number}
export type Side='L'|'R';
export interface TorsoFrame{side:Side;racketShoulder:Vector3;offShoulder:Vector3;out:Vector3;up:Vector3;front:Vector3}
export interface ArmPose{target:Vector3;pole:Vector3;forward?:Vector3;normal?:Vector3}
/** Two-bone chain as directions plus the hand frame at its end. */
export interface ArmChain{upper:Vector3;fore:Vector3;forward:Vector3;normal:Vector3}
export interface RacketArmOptions{
 /** Shoulder→wrist distance at contact as a fraction of arm length (.95 ≈ 36° elbow, .98 ≈ 23°). */
 contactReach:number;
 /** Added to the finish/settle hand height (m); half of it to the elbow pole. */
 finishLift:number;
}
export const DEFAULT_RACKET_ARM:RacketArmOptions={contactReach:.98,finishLift:0};
/** Distance up the handle from the racket wrist to the throat the off hand cups. */
export const THROAT_ALONG_AXIS=.20;
/** Off-hand palm offset from the throat (m). */
export const CATCH_PALM_OFFSET=.08;
/** Cap on |finishLift| (m): above ~4 cm the folded forearm passes through the
 * head at the finish on the taller-finishing presets (measured 0.10–0.13 m
 * → 6–111 forearm/head crossing triangles; 0.04 → none), and a finish
 * dropped by 10 cm put the racket throat inside the off arm's minimum reach
 * (off elbow clamped at 145°). */
export const MAX_FINISH_LIFT=.04;
/** Solver elbow limit (kinematics LIMITS.elbowFlexion[1]); pinned by the
 * pose-validity test through the real solve. */
const ELBOW_MAX_DEG=145;

const DEG=Math.PI/180;
const UP=new Vector3(0,1,0);
const v=(a:V3Like)=>new Vector3(a.x,a.y,a.z);
const round6=(n:number)=>Math.round(n*1e6)/1e6;
const store=(a:Vector3):V3Like=>({x:round6(a.x),y:round6(a.y),z:round6(a.z)});
/** Sign relating forward × normal to the racket head direction. */
export const axisSign=(side:Side)=>side==='R'?1:-1;

export function torsoFrame(side:Side,racketShoulder:V3Like,offShoulder:V3Like):TorsoFrame{
 const rs=v(racketShoulder),os=v(offShoulder);
 const out=os.clone().sub(rs);out.y=0;out.normalize();
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
const slerpDir=(a:Vector3,b:Vector3,w:number)=>a.clone().lerp(b,w).normalize();
/** Hand frame as a rotation: x = fingers, y = palm normal. */
function frameQuat(forward:Vector3,normal:Vector3){
 const f=forward.clone().normalize();const n=normal.clone().addScaledVector(f,-normal.dot(f)).normalize();
 return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(f,n,new Vector3().crossVectors(f,n)));
}
/** Rotate one hand frame into another at parameter w — a constant-rate
 * rotation. Lerping the forward/normal vectors instead collapses near the
 * mid-point when the frames differ by ~120° and the renormalised frame whips
 * through the gap (measured 28 rad/s on wrist_L against a 7 rad/s motion). */
function slerpFrame(f0:Vector3,n0:Vector3,f1:Vector3,n1:Vector3,w:number){
 const q=frameQuat(f0,n0).slerp(frameQuat(f1,n1),w);
 return {forward:new Vector3(1,0,0).applyQuaternion(q),normal:new Vector3(0,1,0).applyQuaternion(q)};
}

/** The racket axis (handle → head) a hand frame produces. */
export function handAxis(hand:Pick<HandLike,'forward'|'normal'>,side:Side){
 return new Vector3().crossVectors(v(hand.forward),v(hand.normal)).multiplyScalar(axisSign(side)).normalize();
}
/** Orthonormal hand frame that puts the racket head along `axis`, with the
 * fingers as close to `forwardHint` (normally the forearm direction) as the
 * axis allows. */
function frameFromAxis(axis:Vector3,forwardHint:Vector3,side:Side){
 const a=axis.clone().normalize();
 const forward=forwardHint.clone().addScaledVector(a,-forwardHint.dot(a)).normalize();
 const normal=new Vector3().crossVectors(a,forward).multiplyScalar(axisSign(side)).normalize();
 return {forward,normal};
}
/** Orthonormal hand frame from a finger direction and a palm hint. */
function frameFromForward(forward:Vector3,normalHint:Vector3){
 const f=forward.clone().normalize();
 return {forward:f,normal:normalHint.clone().addScaledVector(f,-normalHint.dot(f)).normalize()};
}
/** The solver's two-bone geometry (kinematics solveTwoBone): reach clamped to
 * [min at 145°, a+b], elbow on the pole's side ⟂ the chord. */
function twoBoneChain(S:Vector3,target:Vector3,pole:Vector3,arm:ArmLengths){
 const a=arm.upper,b=arm.fore;
 const dir=target.clone().sub(S);
 const minReach=Math.sqrt(a*a+b*b+2*a*b*Math.cos(ELBOW_MAX_DEG*DEG));
 const d=Math.max(minReach,Math.min(a+b-1e-6,dir.length()));dir.normalize();
 const bend=pole.clone().sub(S);bend.addScaledVector(dir,-bend.dot(dir));
 if(bend.lengthSq()<1e-10)bend.set(0,0,1).addScaledVector(dir,-dir.z);
 bend.normalize();
 const x=(a*a-b*b+d*d)/(2*d);
 const elbow=S.clone().addScaledVector(dir,x).addScaledVector(bend,Math.sqrt(Math.max(0,a*a-x*x)));
 return {upper:elbow.clone().sub(S).normalize(),fore:S.clone().addScaledVector(dir,d).sub(elbow).normalize()};
}
/** Pole direction that makes the two-bone solve reproduce `chain`'s elbow:
 * the elbow's component ⟂ the shoulder→wrist chord. Undefined (null) for a
 * straight arm. */
function hingeOf(chain:Pick<ArmChain,'upper'|'fore'>,arm:ArmLengths){
 const elbow=chain.upper.clone().multiplyScalar(arm.upper);
 const chord=elbow.clone().addScaledVector(chain.fore,arm.fore).normalize();
 const perp=elbow.addScaledVector(chord,-elbow.dot(chord));
 return perp.length()>.01?perp.normalize():null;
}
/** Chain → stored hand pose, with an optional vertical lift of the wrist. */
function chainPose(f:TorsoFrame,arm:ArmLengths,chain:ArmChain,fallbackHinge:Vector3|null,lift=0):ArmPose{
 const S=f.racketShoulder;
 const wrist=S.clone().addScaledVector(chain.upper,arm.upper).addScaledVector(chain.fore,arm.fore);
 const hinge=hingeOf(chain,arm)??fallbackHinge;
 if(!hinge)throw new Error('straight chain without a hinge fallback');
 wrist.y+=lift;
 return {target:wrist,pole:S.clone().addScaledVector(hinge,.45).add(new Vector3(0,lift*.5,0)),forward:chain.forward,normal:chain.normal};
}
/** Chain-space interpolation: the shoulder→wrist CHORD direction, the
 * hinge direction and the chord length (= elbow angle) each interpolate, and
 * the chain is rebuilt from them. Slerping the upper-arm and forearm
 * directions independently instead let the elbow pass THROUGH straight
 * between two bent anchors (68° → 16° → 23° drop → contact), where the hinge
 * is undefined and swung 156° in 50 ms (50–70 rad/s on the upper arm). */
function chainBetween(a:ArmChain,b:ArmChain,w:number,arm:ArmLengths):{chain:ArmChain;hinge:Vector3}{
 const O=new Vector3();
 const chord=(c:ArmChain)=>c.upper.clone().multiplyScalar(arm.upper).addScaledVector(c.fore,arm.fore);
 const ca=chord(a),cb=chord(b);
 const dir=slerpDir(ca.clone().normalize(),cb.clone().normalize(),w);
 const len=ca.length()+(cb.length()-ca.length())*w;
 const ha=hingeOf(a,arm),hb=hingeOf(b,arm);
 const hinge=(ha&&hb?slerpDir(ha,hb,w):(ha??hb??new Vector3(0,-1,0)).clone());
 hinge.addScaledVector(dir,-hinge.dot(dir));
 if(hinge.lengthSq()<1e-8)hinge.copy(ha??hb??new Vector3(0,-1,0));
 hinge.normalize();
 const bones=twoBoneChain(O,dir.clone().multiplyScalar(len),hinge.clone().multiplyScalar(.45),arm);
 return {chain:{...bones,...slerpFrame(a.forward,a.normal,b.forward,b.normal,w)},hinge};
}

export type RacketPhase='takeback'|'drop'|'contact'|'extend'|'finish'|'settle';
export type ChainPhase=RacketPhase;
interface ChainAnchor{upper:[number,number];fore:[number,number];axis:[number,number]}
/** Torso-frame anchors (elevation, azimuth) — see the header for the shapes. */
const RACKET_ANCHORS:Record<Exclude<ChainPhase,'takeback'|'contact'>,ChainAnchor>={
 // Bottom of the C: upper arm hanging down-back with the elbow out, forearm
 // hanging nearly vertical, racket head below the hand. The elbow stays
 // OUT/back of the chord (hinge 35° from the authored takeback hinge, 48°
 // from contact) — an earlier anchor with the forearm swept back put the
 // hinge 122° away and the solve flipped it through the drop
 // (100–120 rad/s on the upper arm on every preset).
 drop:{upper:[-55,-110],fore:[-80,-60],axis:[-70,-130]},
 extend:{upper:[-10,-15],fore:[15,-5],axis:[40,-60]},
 finish:{upper:[15,20],fore:[15,110],axis:[67,165]},
 settle:{upper:[5,15],fore:[5,115],axis:[58,163]},
};
/** `takeback` and `contact` are the authored hand solved by the two-bone
 * geometry (contact straightened to `contactReach`), so paths from / to
 * them start exactly where the authored keys are. */
function racketChain(phase:ChainPhase,f:TorsoFrame,arm:ArmLengths,current:HandLike,opt:RacketArmOptions):ArmChain{
 const S=f.racketShoulder;
 if(phase==='takeback'||phase==='contact'){
  const len=arm.upper+arm.fore;
  const d=v(current.target).sub(S);
  const reach=phase==='contact'?opt.contactReach:Math.min(.99,d.length()/len);
  const target=S.clone().addScaledVector(d.normalize(),len*reach);
  const fw=v(current.forward).normalize(),nm=v(current.normal);nm.addScaledVector(fw,-nm.dot(fw)).normalize();
  return {...twoBoneChain(S,target,v(current.pole),arm),forward:fw,normal:nm};
 }
 const a=RACKET_ANCHORS[phase];
 const upper=sph(f,...a.upper),fore=sph(f,...a.fore);
 return {upper,fore,...frameFromAxis(sph(f,...a.axis),fore,f.side)};
}
const liftOf=(phase:ChainPhase,opt:RacketArmOptions)=>phase==='finish'||phase==='settle'?Math.max(-MAX_FINISH_LIFT,Math.min(MAX_FINISH_LIFT,opt.finishLift)):0;

/** The racket arm at one phase. `takeback` is the authored hand unchanged;
 * `contact` keeps the authored wrist direction, pole and racket orientation
 * and straightens the arm toward it; the others are the chain anchors above. */
export function racketArm(phase:RacketPhase,f:TorsoFrame,arm:ArmLengths,current:HandLike,opt:RacketArmOptions=DEFAULT_RACKET_ARM):ArmPose{
 const S=f.racketShoulder;
 if(phase==='takeback')return {target:v(current.target),pole:v(current.pole)};
 if(phase==='contact'){
  const len=arm.upper+arm.fore;
  return {target:S.clone().addScaledVector(v(current.target).sub(S).normalize(),len*opt.contactReach),pole:v(current.pole)};
 }
 const chain=racketChain(phase,f,arm,current,opt);
 return chainPose(f,arm,chain,null,liftOf(phase,opt));
}
/** Chain-space interpolation between two phases at parameter w. */
export function racketPath(from:ChainPhase,to:ChainPhase,w:number,f:TorsoFrame,arm:ArmLengths,current:HandLike,opt:RacketArmOptions=DEFAULT_RACKET_ARM):ArmPose{
 const a=racketChain(from,f,arm,current,opt),b=racketChain(to,f,arm,current,opt);
 const {chain,hinge}=chainBetween(a,b,w,arm);
 return chainPose(f,arm,chain,hinge,liftOf(from,opt)+(liftOf(to,opt)-liftOf(from,opt))*w);
}
/** Approach into contact at parameter w: the authored hand (the bottom of
 * the C — its direction, pole and racket orientation are kept) with the arm
 * straightened from its authored reach to `contactReach`. Only the reach
 * changes, so the authored timing through the drop is preserved. */
export function racketApproach(f:TorsoFrame,arm:ArmLengths,current:HandLike,w:number,opt:RacketArmOptions=DEFAULT_RACKET_ARM):ArmPose{
 const S=f.racketShoulder,len=arm.upper+arm.fore;
 const d=v(current.target).sub(S);
 const reach0=Math.min(.99,d.length()/len);
 return {target:S.clone().addScaledVector(d.normalize(),len*(reach0+(opt.contactReach-reach0)*w)),pole:v(current.pole)};
}

export type OffPhase='guard'|'tuck'|'catch';
/** Two-bone pose from torso-frame upper-arm and forearm directions, pole on
 * the shoulder→elbow line past the elbow. */
function offChain(S:Vector3,f:TorsoFrame,arm:ArmLengths,upper:[number,number,number],fore:[number,number,number]){
 const u=torsoDir(f,...upper),fo=torsoDir(f,...fore);
 const elbow=S.clone().addScaledVector(u,arm.upper);
 return {wrist:elbow.clone().addScaledVector(fo,arm.fore),pole:S.clone().addScaledVector(u,arm.upper*1.8),fore:fo};
}
export function offArm(phase:OffPhase,f:TorsoFrame,arm:ArmLengths,racket?:{wrist:Vector3;axis:Vector3}):ArmPose{
 const S=f.offShoulder;
 // Off-side coefficients: −out = toward the racket side (across the chest).
 if(phase==='guard'){
  // Upper arm forward/down with the elbow out to the side, forearm across
  // and forward at chest height (elbow ≈80°): the hand shields in front of
  // the trunk, fingers toward the ball side, palm facing the ball. The elbow
  // must stay OUT: with it tucked forward the ready→guard interpolation
  // drags the upper arm through the pec (measured 11/41 crossing samples →
  // 0). Palm forward rather than down keeps the pronation from the palm-up
  // ready hand near 90° instead of ~130°.
  const c=offChain(S,f,arm,[.35,-.40,.85],[-.70,.30,.65]);
  return {target:c.wrist,pole:c.pole,...frameFromForward(c.fore,torsoDir(f,.25,-.15,.95))};
 }
 if(phase==='tuck'){
  const c=offChain(S,f,arm,[.10,-.80,.59],[-.85,.30,.43]);
  return {target:c.wrist,pole:c.pole,...frameFromForward(c.fore,torsoDir(f,.20,-.90,.40))};
 }
 if(!racket)throw new Error('catch needs the racket wrist and axis');
 const throat=racket.wrist.clone().addScaledVector(racket.axis,THROAT_ALONG_AXIS);
 // The off hand comes from its own side/front; the palm faces the shaft.
 const normal=torsoDir(f,-.85,0,-.50);
 const target=throat.clone().addScaledVector(normal,-CATCH_PALM_OFFSET);
 // Keep the hand reachable without folding the elbow past ~120°.
 const reach=target.clone().sub(S),minReach=.5*(arm.upper+arm.fore);
 if(reach.length()<minReach)target.copy(S).addScaledVector(reach.normalize(),minReach);
 return {target,pole:S.clone().addScaledVector(torsoDir(f,.35,-.80,.50),.45),...frameFromForward(racket.axis.clone().addScaledVector(normal,-racket.axis.dot(normal)),normal)};
}
/** tuck → catch at parameter w for the off arm. */
export function offReach(f:TorsoFrame,arm:ArmLengths,racket:{wrist:Vector3;axis:Vector3},w:number):ArmPose{
 return offTransition(f,offArm('tuck',f,arm),offArm('catch',f,arm,racket),w);
}
/** Any off-arm transition at parameter w with the elbow pole swung out and
 * down through the middle: with lerped poles the upper arm crossed the chest
 * half-way between keys on 16/17 presets. */
export function offTransition(f:TorsoFrame,from:ArmPose,to:ArmPose,w:number):ArmPose{
 const pose=lerpPose(from,to,w);
 pose.pole=f.offShoulder.clone().addScaledVector(torsoDir(f,.55,-.70,.45),.45).lerp(pose.pole,Math.abs(2*w-1));
 return pose;
}

/** Lerp two poses (positions and, when both carry one, frames). */
export function lerpPose(a:ArmPose,b:ArmPose,w:number):ArmPose{
 const out:ArmPose={target:a.target.clone().lerp(b.target,w),pole:a.pole.clone().lerp(b.pole,w)};
 if(a.forward&&b.forward&&a.normal&&b.normal)Object.assign(out,slerpFrame(a.forward,a.normal,b.forward,b.normal,w));
 return out;
}
/** Blend a stored hand toward `pose` by weight w (0 keeps the hand, 1 replaces
 * it). Positions lerp; the hand frame rotates (slerp) from `from` — by
 * default the hand's own stored frame. Across a ramp of KEYS pass one fixed
 * `from` (the frame at the ramp's start key): the stored frames differ a
 * little per key, and when the target frame is ~150° away those small
 * differences put consecutive keys on different sides of the rotation
 * (measured as a 90° palm flip between two keys 0.1 s apart). A pose without
 * a frame leaves the stored frame untouched. */
export function blendHand(hand:HandLike,pose:ArmPose,w:number,from?:Pick<HandLike,'forward'|'normal'>){
 if(w<=0)return;
 hand.target=store(v(hand.target).lerp(pose.target,w));
 hand.pole=store(v(hand.pole).lerp(pose.pole,w));
 if(!pose.forward||!pose.normal)return;
 const f0=from??hand;
 const {forward,normal}=slerpFrame(v(f0.forward),v(f0.normal),pose.forward,pose.normal,w);
 hand.forward=store(forward);hand.normal=store(normal);
}
