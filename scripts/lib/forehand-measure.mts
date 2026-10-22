import crypto from 'node:crypto';
import {Quaternion,Vector3} from 'three';
import {
 frameAt,measurePackage,probeDocument,solveEffectiveFrame,solveWorkshop,validatePosePackage,workshopMeta,
 type HumanRig,type WorkshopDoc,
} from '@human3d/motion-core';
import type {ServiceContext} from '../../apps/server/src/service';

/** Measurements shared by the forehand generator (scripts/generate-player-forehands.mts),
 * its freshness check and the Issue #17 contract test (scripts/forehand-depth.test.ts).
 * One definition each, so the generator's gates and the test's gates cannot drift
 * apart. Every function resets the rig it is given. */

/** Rest leg geometry in the study's units. Depth (cm) is the hip height above the
 * lower ankle relative to the standing rest, as the depth study defines it. */
export interface LegRest{chain:number;ratio:number}
export function legRest(rig:HumanRig):LegRest{
 const rest=rig.rest;
 const chain=rest.get('upperleg01_L')!.distanceTo(rest.get('lowerleg01_L')!)+rest.get('lowerleg01_L')!.distanceTo(rest.get('foot_L')!);
 const ratio=((rest.get('upperleg01_L')!.y+rest.get('upperleg01_R')!.y)/2-rest.get('foot_L')!.y)/chain;
 return {chain,ratio};
}

/** Solved hip depth (cm below the standing rest) at `time`, and how far the farther
 * foot misses its target (m) measured from the hip BEFORE the solver's posterior
 * correction — a leg that only reaches after pulling the pelvis back is out of reach. */
export function solvedDepth(rig:HumanRig,doc:WorkshopDoc,time:number,legs:LegRest):{depth:number;miss:number}{
 const frame=frameAt(doc,time,rig.rest.get('root')!);
 rig.reset();
 const {pelvisShift}=solveEffectiveFrame(rig,frame);
 let ratio=-Infinity,miss=-Infinity;
 for(const side of ['L','R'] as const){
  const hip=rig.point(`upperleg01_${side}`),target=(side==='L'?frame.pose.footL:frame.pose.footR).target;
  ratio=Math.max(ratio,(hip.y-rig.point(`foot_${side}`).y)/legs.chain);
  const gap=Math.hypot(hip.x-target.x,hip.y-target.y,hip.z+pelvisShift-target.z)-legs.chain;
  miss=Math.max(miss,gap);
 }
 return {depth:(legs.ratio-ratio)*legs.chain*100,miss};
}

/** Worst rear-ankle dorsiflexion (deg, + = toes up on the shank line) over an even
 * grid of `samples` points, with the time and side where it occurs. */
export function peakDorsiflexion(rig:HumanRig,doc:WorkshopDoc,samples=240):{peak:number;time:number;side:'L'|'R'}{
 let peak=-Infinity,time=0,side:'L'|'R'='R';
 for(let i=0;i<samples;i++){
  const t=i/samples*doc.duration;
  rig.reset();solveEffectiveFrame(rig,frameAt(doc,t,rig.rest.get('root')!));rig.model.updateMatrixWorld(true);
  for(const s of ['L','R'] as const){
   const shank=rig.point(`foot_${s}`).sub(rig.point(`lowerleg01_${s}`)).applyQuaternion(rig.bone(`foot_${s}`).getWorldQuaternion(new Quaternion()).invert());
   const dorsi=Math.atan2(-shank.z,-shank.y)*180/Math.PI;
   if(dorsi>peak){peak=dorsi;time=t;side=s;}
  }
 }
 return {peak,time,side};
}

/** Sample times the wrist check uses: every key, plus 17 evenly spaced points. */
export const wristSampleTimes=(doc:WorkshopDoc)=>[...doc.keys.map(k=>k.time),...Array.from({length:17},(_,i)=>i/16*doc.duration)];

/** Solved wrist distance from its hand target (m) at `time`, per hand. */
export function wristMiss(rig:HumanRig,doc:WorkshopDoc,time:number):{L:number;R:number}{
 rig.reset();
 const frame=frameAt(doc,time,rig.rest.get('root')!);
 solveEffectiveFrame(rig,frame);
 const miss={L:0,R:0};
 for(const s of ['L','R'] as const){
  const h=(s==='L'?frame.pose.handL:frame.pose.handR).target;
  miss[s]=rig.point(`wrist_${s}`).distanceTo(new Vector3(h.x,h.y,h.z));
 }
 return miss;
}

/** Peak root acceleration (m/s²) and where it occurs, from the 240 Hz quality probe.
 * The service serves at most 60 Hz, so this is an engineering measure of solver
 * smoothness at plant rather than a served-limit check. */
export function probeRootAccel(rig:HumanRig,doc:WorkshopDoc,fps=240):{maxA:number;accelT:number}{
 const r=probeDocument(rig,doc,{fps});
 return {maxA:r.root.maxA,accelT:r.root.accelT};
}

export interface ServiceVerdict{fps:number;schema:boolean;rejected:string[];rootAccel:number;slip:number}

/** The service's own gates for one document at one rate (apps/server solveMotion):
 * solveWorkshop → published schema → semantic validator. Measured root acceleration
 * and slip are read only when both structural gates pass; otherwise they are +∞ so
 * a rejected candidate can never pass a margin gate. */
export function serviceVerdict(ctx:ServiceContext,actionId:string,doc:WorkshopDoc,fps:number,phases:{time:number;label:string}[]):ServiceVerdict{
 // Schema-shaped identifiers (mot_<16 hex>, 64-hex digests). They label the candidate only;
 // the solve does not depend on them.
 const hex=(text:string)=>crypto.createHash('sha256').update(text).digest('hex');
 const meta=workshopMeta({motionId:`mot_${hex(`${actionId}@${fps}`).slice(0,16)}`,manifestSHA256:ctx.manifest.manifestSHA256,bones:ctx.manifest.bones.length,
  actionId,revision:'candidate',definitionSHA256:hex(JSON.stringify(doc)),prop:doc.keys.some(k=>k.constraints?.grip),loop:doc.loop,gripSide:doc.gripSide,
  source:'motion-file',license:'candidate',requestFingerprint:hex(`${actionId}@${fps}`),fps,duration:doc.duration,keys:doc.keys.length,notes:[]});
 const pkg=solveWorkshop(ctx.rig,doc,fps,meta,phases);
 const schema=!!ctx.contract.posePackage(pkg);
 const rejected=schema?validatePosePackage(pkg,ctx.manifest):['schema'];
 if(!schema||rejected.length)return {fps,schema,rejected,rootAccel:Infinity,slip:Infinity};
 const m=measurePackage(pkg,ctx.manifest);
 return {fps,schema,rejected,rootAccel:m.rootAccel.value,slip:m.slip?.value??0};
}
