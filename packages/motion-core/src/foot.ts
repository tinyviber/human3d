import {Euler,Quaternion,Vector3} from 'three';
import {DEG} from './kinematics';

export type Side='L'|'R';

/** Foot geometry from the rest rig: the ankle joint (foot_X) and every toe
 * joint, expressed as offsets from the ankle. The rest-standing sole plane
 * (lowest rest toe point) is the reference for lift and clearance. */
export interface FootGeometry{side:Side;names:string[];offsets:Vector3[];groundY:number}
export function footGeometry(rest:ReadonlyMap<string,Vector3>,side:Side):FootGeometry{
  const ankle=rest.get(`foot_${side}`);
  if(!ankle)throw new Error(`rest pose has no foot_${side}`);
  const names=[...rest.keys()].filter(n=>n===`foot_${side}`||(n.startsWith('toe')&&n.endsWith(`_${side}`)));
  return {side,names,offsets:names.map(n=>rest.get(n)!.clone().sub(ankle)),groundY:Math.min(...names.map(n=>rest.get(n)!.y))};
}
/** Foot orientation from the pose's pitch/yaw in degrees — same Euler order the solver uses. */
export function footRotation(yaw:number,pitch:number){return new Quaternion().setFromEuler(new Euler(pitch*DEG,yaw*DEG,0,'YXZ'));}
/** Lowest foot point relative to the ankle (metres, negative = below the ankle). */
export function soleOffset(g:FootGeometry,yaw:number,pitch:number){
  const q=footRotation(yaw,pitch);
  return Math.min(...g.offsets.map(o=>o.clone().applyQuaternion(q).y));
}
/** Sole height above the rest-standing sole plane: 0 at rest. This is the
 * quantity the lift handle edits, so the handle and the check measure the
 * same thing (the sole, not the ankle). */
export function footLift(g:FootGeometry,ankleY:number,yaw:number,pitch:number){
  return ankleY+soleOffset(g,yaw,pitch)-g.groundY;
}
/** Ankle height that places the sole `lift` metres above the rest sole plane. */
export function ankleYForLift(g:FootGeometry,lift:number,yaw:number,pitch:number){
  return lift+g.groundY-soleOffset(g,yaw,pitch);
}
/** Depth of the lowest solved foot point below the rest sole plane (0 when clear). */
export function footDepth(g:FootGeometry,lowestY:number){return Math.max(0,g.groundY-lowestY);}
export const FOOT_CLEARANCE_M=.02;
