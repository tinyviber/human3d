import {Bone, Object3D, Quaternion, Vector3, Euler} from 'three';
import {frameRotation,solveTwoBone,DEG} from './kinematics';
import {handFrame} from './hand-frame';
import type {RigInfo,Pose} from './types';
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
export class HumanRig {
  bones=new Map<string,Bone>();rest=new Map<string,Vector3>();restLocal=new Map<string,Vector3>();
  constructor(public model:Object3D,public info:RigInfo){
    model.traverse(o=>{if((o as Bone).isBone)this.bones.set(o.name,o as Bone)});
    for(const b of info.bones){this.rest.set(b.name,new Vector3().fromArray(b.head));const bone=this.bones.get(b.name);if(!bone)throw new Error(`Missing bone ${b.name}`);this.restLocal.set(b.name,bone.position.clone());}
  }
  bone(n:string){const b=this.bones.get(n);if(!b)throw new Error(`Unknown bone ${n}`);return b;}
  point(n:string){return this.bone(n).getWorldPosition(new Vector3());}
  reset(){for(const [n,b]of this.bones){b.quaternion.identity();b.position.copy(this.restLocal.get(n)!);b.scale.set(1,1,1);}this.model.updateMatrixWorld(true);}
  rotate(n:string,x=0,y=0,z=0){this.bone(n).quaternion.setFromEuler(new Euler(x*DEG,y*DEG,z*DEG,'YXZ'));this.model.updateMatrixWorld(true);}
  worldRotation(n:string,q:Quaternion){const b=this.bone(n);const p=b.parent!.getWorldQuaternion(new Quaternion());b.quaternion.copy(p.invert().multiply(q));this.model.updateMatrixWorld(true);}
  /** Split authored twist bones retain their local rest transform; only joint roots rotate. */
  limb(side:'L'|'R',kind:'arm'|'leg',target:Vector3,pole:Vector3){
    const u=kind==='arm'?`upperarm01_${side}`:`upperleg01_${side}`;
    const l=kind==='arm'?`lowerarm01_${side}`:`lowerleg01_${side}`;
    const e=kind==='arm'?`wrist_${side}`:`foot_${side}`;
    const r0=this.rest.get(u)!,r1=this.rest.get(l)!,r2=this.rest.get(e)!;
    const a=r1.clone().sub(r0),b=r2.clone().sub(r1),normal=new Vector3().crossVectors(a,b).normalize();
    const solved=solveTwoBone(this.point(u),target,pole,a.length(),b.length(),kind==='arm'?145:135);
    const d0=solved.mid.clone().sub(this.point(u)),d1=solved.end.clone().sub(solved.mid);
    const n=new Vector3().crossVectors(d0,d1).normalize();
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
      this.model.updateMatrixWorld(true);
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
    let desired=forward.clone().normalize();
    const bend=forearm.angleTo(desired);
    if(bend>59.8*DEG){const aim=new Quaternion().setFromUnitVectors(forearm,desired);aim.slerp(new Quaternion(),1-59.8*DEG/bend);desired=forearm.clone().applyQuaternion(aim);}
    // Share pronation with the distal forearm twist bone to avoid wrist-only twist.
    const forearmBone=this.bone(`lowerarm01_${side}`);
    const oldNormal=normal.clone().applyQuaternion(forearmBone.getWorldQuaternion(new Quaternion()));
    const project=(v:Vector3)=>v.clone().addScaledVector(forearm,-v.dot(forearm)).normalize();
    const a=project(oldNormal),b=project(palmNormal);
    const roll=Math.atan2(new Vector3().crossVectors(a,b).dot(forearm),a.dot(b));
    const restAxis=this.rest.get(`wrist_${side}`)!.clone().sub(this.rest.get(`lowerarm01_${side}`)!).normalize();
    this.bone(`lowerarm02_${side}`).quaternion.setFromAxisAngle(restAxis,Math.max(-80*DEG,Math.min(80*DEG,roll))*.65);
    this.model.updateMatrixWorld(true);
    this.worldRotation(`wrist_${side}`,frameRotation(f,normal,desired,palmNormal));
  }
  relaxHand(side:'L'|'R'){
    const {flexionAxis}=handFrame(this.rest,side);
    for(let finger=2;finger<=5;finger++)for(let joint=1;joint<=3;joint++){
      this.bone(`finger${finger}-${joint}_${side}`).quaternion.setFromAxisAngle(flexionAxis,[12,16,8][joint-1]*DEG);
    }
    this.model.updateMatrixWorld(true);
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
    this.model.updateMatrixWorld(true);
  }
  snapshot():Pose{return {root:this.bone('root').position.clone(),rotations:new Map([...this.bones].map(([n,b])=>[n,b.quaternion.clone()]))};}
}
