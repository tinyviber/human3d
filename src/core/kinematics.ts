import {Matrix4, Quaternion, Vector3, MathUtils} from 'three';
export const DEG = Math.PI / 180;
export const LIMITS = {
  hipFlexion: [-20, 120], kneeFlexion: [0, 135], ankleFlexion: [-40, 20],
  elbowFlexion: [0, 145], shoulderElevation: [0, 165], wristFlexion: [-60, 60],
  fingerMCP: [0, 85], fingerPIP: [0, 100], fingerDIP: [0, 75],
} as const;
export function clampJoint(name: keyof typeof LIMITS, degrees: number) {
  return MathUtils.clamp(degrees, LIMITS[name][0], LIMITS[name][1]);
}
/** Constant-length two-bone geometry, with a pole vector and a flexion limit.
 * Same root / mid / tip / target / hint model as Unity Animation Rigging TwoBoneIK.
 * Engineering rig coordinates, not ISB clinical Euler angles. */
export function solveTwoBone(root: Vector3, target: Vector3, pole: Vector3, a: number, b: number, maxFlex=145) {
  const direction = target.clone().sub(root);
  const minReach = Math.sqrt(a*a+b*b+2*a*b*Math.cos(maxFlex*DEG));
  const d = MathUtils.clamp(direction.length(), minReach, a+b-1e-6);
  if (direction.lengthSq()<1e-12) direction.set(0,-1,0);
  direction.normalize();
  const end = root.clone().addScaledVector(direction,d);
  const bend = pole.clone().sub(root).addScaledVector(direction,-pole.clone().sub(root).dot(direction));
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
