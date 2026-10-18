import {Bone, Object3D, Quaternion, Vector3, Euler} from 'three';
import {frameRotation,solveTwoBone,forearmTwist,DEG,WRIST_BEND_LIMIT_DEG} from './kinematics';
import {handFrame} from './hand-frame';
import type {RigInfo} from './types';
export interface FingerJointPose {mcp:number;pip:number;dip:number;abduction?:number}
export interface ThumbJointPose {cmcFlexion:number;cmcOpposition:number;mcp:number;ip:number}
export interface HandJointPose {thumb:ThumbJointPose;fingers:Record<2|3|4|5,FingerJointPose>}
/** Convert physical MyoSim thumb angles to the MakeHuman skin pivots.
 * The CMC, MCP, and IP local axes are mirrored. The visible thumb's distal
 * phalanx is also shorter than the MyoSim segment, so its flexion is amplified
 * 3.25x to preserve contact with the index phalanx through the punch's fist hold. This
 * is a mesh retarget calibration, not an anatomical angle equivalence. */
export function mapMyoSimThumbToSkin(pose:ThumbJointPose):ThumbJointPose{
  return {cmcFlexion:-pose.cmcFlexion,cmcOpposition:pose.cmcOpposition,mcp:-pose.mcp,ip:-pose.ip*3.25};
}
/* ---- scratch registers (issue #10 PR-C, eval MAJOR-2 rule) --------------
 * Per-method regs; a reg is never live across a call into a function that
 * also uses scratch. Callees here (point/worldRotation/frameRotation/
 * solveTwoBone/forearmTwist/handFrame/three.js methods) allocate their own
 * temps and never touch these. Values that escape — point() results,
 * frameRotation() outputs, solveTwoBone's {mid,end} — stay FRESH allocations. */
const _rotEuler=new Euler();
const _wrParent=new Quaternion();
const _limbA=new Vector3(),_limbB=new Vector3(),_limbNormal=new Vector3(),
      _limbD0=new Vector3(),_limbD1=new Vector3(),_limbN=new Vector3();
const _handDes=new Vector3(),_handDes2=new Vector3(),_handRestAxis=new Vector3(),
      _handRelV=new Vector3(),_handAim=new Quaternion(),_handForearmQ=new Quaternion(),
      _handRel=new Quaternion();
const _QIDENT=new Quaternion(); /* immutable identity — slerp target arg only */
/** Major-bone parent→child segment table for line-skeleton overlays. The lab's
 * debug skeleton and the workshop's onion-skin ghosts draw from this one list,
 * so the bone filter can never drift between the two renderers. */
export function skeletonSegments(info:RigInfo){
  const major=info.bones.filter(b=>/^(root|pelvis_|spine|neck|head$|clavicle_|shoulder|upperarm|lowerarm|wrist_|metacarpal|finger|upperleg|lowerleg|foot_|toe)/.test(b.name));
  const out:{name:string;parent:string}[]=[];
  for(const b of major)if(b.parent)out.push({name:b.name,parent:b.parent});
  return out;
}
export class HumanRig {
  bones=new Map<string,Bone>();rest=new Map<string,Vector3>();restLocal=new Map<string,Vector3>();
  /** Open world-sync batch depth — see batch()/syncWorld(). */
  private worldBatch=0;
  constructor(public model:Object3D,public info:RigInfo){
    model.traverse(o=>{if((o as Bone).isBone)this.bones.set(o.name,o as Bone)});
    for(const b of info.bones){this.rest.set(b.name,new Vector3().fromArray(b.head));const bone=this.bones.get(b.name);if(!bone)throw new Error(`Missing bone ${b.name}`);this.restLocal.set(b.name,bone.position.clone());}
  }
  /** Run `fn` with the full-tree world-matrix flush deferred to a single
   * model.updateMatrixWorld(true) when the OUTERMOST batch exits. Inside a
   * batch every rig world read (point/getWorldQuaternion/localToWorld/
   * worldToLocal) self-updates its own ancestor chain via
   * updateWorldMatrix(true,false) — the same compose/multiply arithmetic
   * the flush runs — so intermediate flushes only rewrote state that no
   * solve-path read ever sees (empirical: --profile-skip-flush replays a
   * whole solve sweep to identical outputs with every flush stubbed).
   * CONTRACT: callers must not mutate transforms on ancestors of rig.model
   * between solves — ancestor-scoped reads above model are the only case
   * where a scoped read could differ from a full-tree flush. */
  batch<T>(fn:()=>T):T{
    this.worldBatch++;
    try{return fn();}
    finally{if(--this.worldBatch===0)this.model.updateMatrixWorld(true);}
  }
  /** Flush world matrices unless a batch is open (same contract as batch).
   * Outside a batch this is the same immediate model.updateMatrixWorld(true)
   * the call sites always issued, so cold paths keep identical behaviour;
   * inside a batch the single batch-exit flush covers it. */
  syncWorld(){if(this.worldBatch===0)this.model.updateMatrixWorld(true);}
  bone(n:string){const b=this.bones.get(n);if(!b)throw new Error(`Unknown bone ${n}`);return b;}
  point(n:string){return this.bone(n).getWorldPosition(new Vector3());}
  /** point() with a caller-owned target — same self-updating ancestor walk
   * (getWorldPosition→updateWorldMatrix(true,false)), safe inside a batch.
   * `out` is returned; callers must not retain it across another pointInto. */
  pointInto(n:string,out:Vector3){return this.bone(n).getWorldPosition(out);}
  /** World position of bone `n` written into `out`, read straight from the
   * already-flushed matrixWorld — the cheap path for post-solve readers that
   * know the tree is current (solvePose's batch-end flush, or any out-of-
   * batch rig write which flushes immediately). Dev guard: inside an open
   * batch the intermediate world matrices are deliberately stale — reads
   * there must go through point() which self-updates its ancestor chain.
   * Callers that may hold an unflushed write should syncWorld() first. */
  worldPointInto(n:string,out:Vector3){
    if(this.worldBatch!==0)throw new Error(`worldPointInto('${n}') inside an open world batch — matrixWorld is stale by design; use point() or wait for the batch to exit`);
    return out.setFromMatrixPosition(this.bone(n).matrixWorld);
  }
  reset(){for(const [n,b]of this.bones){b.quaternion.identity();b.position.copy(this.restLocal.get(n)!);b.scale.set(1,1,1);}this.syncWorld();}
  rotate(n:string,x=0,y=0,z=0){this.bone(n).quaternion.setFromEuler(_rotEuler.set(x*DEG,y*DEG,z*DEG,'YXZ'));this.syncWorld();}
  worldRotation(n:string,q:Quaternion){const b=this.bone(n);const p=b.parent!.getWorldQuaternion(_wrParent);b.quaternion.copy(p.invert().multiply(q));this.syncWorld();}
  /** Split authored twist bones retain their local rest transform; only joint roots rotate. */
  limb(side:'L'|'R',kind:'arm'|'leg',target:Vector3,pole:Vector3){
    const u=kind==='arm'?`upperarm01_${side}`:`upperleg01_${side}`;
    const l=kind==='arm'?`lowerarm01_${side}`:`lowerleg01_${side}`;
    const e=kind==='arm'?`wrist_${side}`:`foot_${side}`;
    const r0=this.rest.get(u)!,r1=this.rest.get(l)!,r2=this.rest.get(e)!;
    const a=_limbA.copy(r1).sub(r0),b=_limbB.copy(r2).sub(r1),normal=_limbNormal.crossVectors(a,b).normalize();
    const pu=this.point(u);
    const solved=solveTwoBone(pu,target,pole,a.length(),b.length(),kind==='arm'?145:135);
    const d0=_limbD0.copy(solved.mid).sub(pu),d1=_limbD1.copy(solved.end).sub(solved.mid);
    const n=_limbN.crossVectors(d0,d1).normalize();
    if(n.lengthSq()<.1)n.copy(normal);
    this.worldRotation(u,frameRotation(a,normal,d0,n));
    this.worldRotation(l,frameRotation(b,normal,d1,n));
    return solved;
  }
  /** Two-bone retarget for external world-space landmarks. Correct the world
   * swing from the segment's current direction instead of assuming the source
   * model's local rest axes match the target skeleton's axes. */
  limbToWorldTargets(side:'L'|'R',kind:'arm'|'leg',target:Vector3,pole:Vector3){
    const u=kind==='arm'?`upperarm01_${side}`:`upperleg01_${side}`;
    const l=kind==='arm'?`lowerarm01_${side}`:`lowerleg01_${side}`;
    const e=kind==='arm'?`wrist_${side}`:`foot_${side}`;
    const r0=this.rest.get(u)!,r1=this.rest.get(l)!,r2=this.rest.get(e)!;
    const a=r1.clone().sub(r0).length(),b=r2.clone().sub(r1).length();
    const root=this.point(u),solved=solveTwoBone(root,target,pole,a,b,kind==='arm'?145:135);
    const align=(bone:string,from:string,to:string,desired:Vector3)=>{
      this.syncWorld();
      const current=this.point(to).sub(this.point(from)).normalize();
      const world=this.bone(bone).getWorldQuaternion(new Quaternion());
      world.premultiply(new Quaternion().setFromUnitVectors(current,desired.clone().normalize()));
      this.worldRotation(bone,world);
    };
    align(u,u,l,solved.mid.clone().sub(root));
    align(l,l,e,solved.end.clone().sub(solved.mid));
    return solved;
  }
  hand(side:'L'|'R',forward:Vector3,palmNormal:Vector3){
    const {forward:f,normal}=handFrame(this.rest,side);
    const forearm=this.point(`wrist_${side}`).sub(this.point(`lowerarm01_${side}`)).normalize();
    let desired=_handDes.copy(forward).normalize();
    const bend=forearm.angleTo(desired);
    if(bend>WRIST_BEND_LIMIT_DEG*DEG){_handAim.setFromUnitVectors(forearm,desired);_handAim.slerp(_QIDENT,1-WRIST_BEND_LIMIT_DEG*DEG/bend);desired=_handDes2.copy(forearm).applyQuaternion(_handAim);}
    const targetQ=frameRotation(f,normal,desired,palmNormal);
    // Share pronation with the distal forearm twist bone to avoid wrist-only twist.
    // The twist is the swing-twist angle of the hand relative to the forearm about
    // the forearm axis: the wrist keeps the swing, so the split is well-posed for
    // every palm direction the bend clamp allows and changes continuously with the
    // target. A single-axis roll from the palm normal has no value when that normal
    // runs parallel to the forearm, and the twist bone then jumps.
    const restAxis=_handRestAxis.copy(this.rest.get(`wrist_${side}`)!).sub(this.rest.get(`lowerarm01_${side}`)!).normalize();
    const forearmQ=this.bone(`lowerarm01_${side}`).getWorldQuaternion(_handForearmQ);
    const rel=_handRel.copy(forearmQ).invert().multiply(targetQ);
    const roll=Math.atan2(Math.sin(2*Math.atan2(restAxis.dot(_handRelV.set(rel.x,rel.y,rel.z)),rel.w)),Math.cos(2*Math.atan2(restAxis.dot(_handRelV),rel.w)));
    this.bone(`lowerarm02_${side}`).quaternion.setFromAxisAngle(restAxis,forearmTwist(roll));
    this.syncWorld();
    this.worldRotation(`wrist_${side}`,targetQ);
  }
  relaxHand(side:'L'|'R'){
    const {flexionAxis}=handFrame(this.rest,side);
    for(let finger=2;finger<=5;finger++)for(let joint=1;joint<=3;joint++){
      this.bone(`finger${finger}-${joint}_${side}`).quaternion.setFromAxisAngle(flexionAxis,[12,16,8][joint-1]*DEG);
    }
    this.syncWorld();
  }
  /** Apply joint-angle targets to the continuous skin rig. Angles are radians
   * from the MyoSim wrist, thumb CMC/MCP/IP, and finger MCP/PIP/DIP coordinates.
   * Flexion is applied at each visible phalanx; thumb opposition is separated
   * from thumb flexion so a fist closes across the palm rather than pointing. */
  articulateHand(side:'L'|'R',pose:HandJointPose){
    const {normal,flexionAxis}=handFrame(this.rest,side);
    const rotate=(axis:Vector3,angle:number)=>new Quaternion().setFromAxisAngle(axis,angle);
    const thumb=pose.thumb;
    this.bone(`finger1-1_${side}`).quaternion.copy(rotate(normal,thumb.cmcOpposition).multiply(rotate(flexionAxis,thumb.cmcFlexion)));
    this.bone(`finger1-2_${side}`).quaternion.copy(rotate(flexionAxis,thumb.mcp));
    this.bone(`finger1-3_${side}`).quaternion.copy(rotate(flexionAxis,thumb.ip));
    for(const digit of [2,3,4,5] as const){
      const joints=pose.fingers[digit];
      this.bone(`finger${digit}-1_${side}`).quaternion.copy(rotate(normal,joints.abduction??0).multiply(rotate(flexionAxis,joints.mcp)));
      this.bone(`finger${digit}-2_${side}`).quaternion.copy(rotate(flexionAxis,joints.pip));
      this.bone(`finger${digit}-3_${side}`).quaternion.copy(rotate(flexionAxis,joints.dip));
    }
    this.syncWorld();
  }
}
