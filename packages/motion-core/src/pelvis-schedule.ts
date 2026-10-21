import {frameAtCompiled,type CompiledMotion} from './document';
import {measurePelvisCorrection} from './solver';
import {VALIDATION_LIMITS} from './validate';
import type {HumanRig} from './rig';

/** Fixed integration step. 120 Hz lands on every integer fps that divides 120
 * (1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 60) — the rates the
 * service actually samples — so a lookup at a package timestamp is exact. */
export const PELVIS_TRACK_STEP=1/120;
/** Speed and acceleration caps for the *correction* alone. Both sit under
 * VALIDATION_LIMITS (4 m/s, 40 m/s²) so the authored root motion keeps the
 * headroom the shipped motions were calibrated with. */
export const PELVIS_FOLLOW_SPEED=1.5;
export const PELVIS_FOLLOW_ACCEL=16;

export interface PelvisSchedule{
 /** True when the per-frame argmin already satisfies the validator's root
  * limits, so solvers must ignore `at` and keep the historical float path. */
 passthrough:boolean;
 /** Posterior shift (m) at document time t. Only meaningful when `passthrough` is false. */
 at(t:number):number;
}

/** Peak |speed| and |accel| of a scalar series, using the same finite
 * differences as `measurePackage` (speed over one step, accel over the span
 * of two steps). */
export function scalarPeaks(times:number[],values:number[]){
 let speed=0,accel=0;
 const vel:number[]=[];
 for(let i=1;i<times.length;i++){
  const dt=times[i]-times[i-1];
  if(!(dt>0))continue;
  const v=(values[i]-values[i-1])/dt;
  vel.push(v);
  if(Math.abs(v)>speed)speed=Math.abs(v);
 }
 for(let i=1;i<vel.length;i++){
  const dt=(times[i+1]-times[i-1])/2;
  if(!(dt>0))continue;
  const a=Math.abs(vel[i]-vel[i-1])/dt;
  if(a>accel)accel=a;
 }
 return {speed,accel};
}

/** Reject basin jumps. The dorsiflexion argmin can teleport to a distant
 * feasible shift while the open interval between them is not a reachable
 * pelvis motion — ramping across that gap drags a planted foot. Any sample
 * more than one speed-step away from the value currently held is ignored
 * until the argmin comes back. Smooth ramps under `maxSpeed` pass through. */
export function holdShift(times:number[],target:number[],maxSpeed=PELVIS_FOLLOW_SPEED):number[]{
 const out=new Array<number>(times.length);
 let held=target[0]??0;
 out[0]=held;
 for(let i=1;i<times.length;i++){
  const dt=Math.max(1e-6,times[i]-times[i-1]);
  const goal=target[i]??held;
  if(Math.abs(goal-held)<=maxSpeed*dt+1e-9)held=goal;
  out[i]=held;
 }
 return out;
}

/** Speed- and acceleration-limited follow of `target`. The first sample is
 * the target's first sample, so a document does not jump at t=0. No snap:
 * velocity only changes by at most `maxAccel * dt` per step, which keeps the
 * finite-difference acceleration inside the cap. */
export function followShift(times:number[],target:number[],maxSpeed=PELVIS_FOLLOW_SPEED,maxAccel=PELVIS_FOLLOW_ACCEL):number[]{
 const out=new Array<number>(times.length);
 let s=target[0]??0,v=0;
 out[0]=s;
 for(let i=1;i<times.length;i++){
  const dt=Math.max(1e-6,times[i]-times[i-1]);
  const goal=target[i]??s;
  const err=goal-s;
  const stop=Math.sqrt(Math.max(0,2*maxAccel*Math.abs(err)));
  const cap=Math.min(maxSpeed,stop);
  const vTarget=err===0?0:Math.max(-cap,Math.min(cap,err/dt));
  const dvMax=maxAccel*dt;
  v+=Math.max(-dvMax,Math.min(dvMax,vTarget-v));
  /* Keep the state inside the non-negative position envelope. A target can
   * drop to zero while the follower still has negative velocity; cap that
   * velocity by the discrete stopping distance so braking remains gradual. */
  const stopSpeed=Math.sqrt((maxAccel*dt)**2+2*maxAccel*Math.max(0,s))-maxAccel*dt;
  v=Math.max(v,-stopSpeed);
  s+=v*dt;
  out[i]=s;
 }
 return out;
}

/** Follow a closed target loop and remove the accumulated start/end drift with
 * a zero-slope cubic correction. The correction is spread over the full cycle
 * so it does not create a velocity or acceleration impulse at the seam. */
export function followLoopShift(times:number[],target:number[],maxSpeed=PELVIS_FOLLOW_SPEED,maxAccel=PELVIS_FOLLOW_ACCEL):number[]{
 const shifts=followShift(times,target,maxSpeed,maxAccel);
 if(shifts.length<2)return shifts;
 const duration=times[times.length-1]-times[0];
 if(!(duration>0))return shifts;
 const drift=shifts[shifts.length-1]-shifts[0];
 const closed=shifts.map((shift,i)=>{
  const u=(times[i]-times[0])/duration;
  const smooth=u*u*(3-2*u);
  return Math.max(0,shift-drift*smooth);
 });
 const peaks=scalarPeaks(times,closed);
 const dtBefore=times[times.length-1]-times[times.length-2];
 const dtAfter=times[1]-times[0];
 if(dtBefore>0&&dtAfter>0){
  const vBefore=(closed[closed.length-1]-closed[closed.length-2])/dtBefore;
  const vAfter=(closed[1]-closed[0])/dtAfter;
  peaks.accel=Math.max(peaks.accel,Math.abs(vAfter-vBefore)/((dtBefore+dtAfter)/2));
 }
 /* The endpoint correction can use more of the limits on short loops. Scale
  * its excursion around the loop's non-negative starting value until both
  * the ordinary and wraparound finite differences remain within the caps. */
 const scale=Math.min(1,maxSpeed/Math.max(peaks.speed,1e-12),maxAccel/Math.max(peaks.accel,1e-12));
 const base=shifts[0];
 return closed.map(value=>Math.max(0,base+(value-base)*scale));
}

/** Sample count of the pelvis track for a document of `duration` seconds. */
export function pelvisSampleCount(duration:number){return trackTimes(duration).length;}

function trackTimes(duration:number){
 const times=[0];
 for(let t=PELVIS_TRACK_STEP;t<duration-1e-9;t+=PELVIS_TRACK_STEP)times.push(t);
 if(times[times.length-1]!==duration)times.push(duration);
 return times;
}

/** Posterior-shift schedule for one compiled document. Pure in (rig rest,
 * compiled motion): the same instant always yields the same shift, at any
 * sample rate. Admissible documents report `passthrough` and must be solved
 * without an override — that is what keeps shipped trajectories byte-identical
 * apart from the solver revision. */
export function buildPelvisSchedule(rig:HumanRig,compiled:CompiledMotion):PelvisSchedule{
 const times=trackTimes(compiled.duration);
 const desired=times.map(t=>{
  const f=frameAtCompiled(compiled,t);
  return measurePelvisCorrection(rig,f.pose,f.constraints,{
   support:f.support,gripAmount:f.gripAmount,clavicleLift:f.clavicleLift,gripSide:f.gripSide,
  }).shift;
 });
 const peaks=scalarPeaks(times,desired);
 const passthrough=peaks.speed<=VALIDATION_LIMITS.rootSpeedMPerS&&peaks.accel<=VALIDATION_LIMITS.rootAccelMPerS2;
 // Hold first, so a basin teleport is never a ramp the foot has to cross,
 // then acceleration-limit whatever continuous change remains.
 let shifts=desired;
 if(!passthrough){
  const held=holdShift(times,desired);
  shifts=compiled.loop?followLoopShift(times,held):followShift(times,held);
 }
 const duration=compiled.duration;
 const at=(t:number)=>{
  const x=Math.max(0,Math.min(duration,t));
  let lo=0,hi=times.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(times[mid]<=x)lo=mid;else hi=mid;}
  const span=times[hi]-times[lo];
  if(!(span>0))return shifts[lo];
  const u=(x-times[lo])/span;
  return shifts[lo]+(shifts[hi]-shifts[lo])*u;
 };
 return {passthrough,at};
}
