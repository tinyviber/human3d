import {Vector3} from 'three';

/** Palmar (skin-facing) frame, rather than a same-handed cross product on both
 * mirrored hands. Cross products are axial vectors: reflection reverses their
 * handedness, so the left palm needs the opposite sign. */
export function handFrame(rest:ReadonlyMap<string,Vector3>,side:'L'|'R'){
  const wrist=rest.get(`wrist_${side}`)!;
  const index=rest.get(`finger2-1_${side}`)!,pinky=rest.get(`finger5-1_${side}`)!;
  const forward=rest.get(`finger3-1_${side}`)!.clone().sub(wrist).normalize();
  const normal=new Vector3().crossVectors(index.clone().sub(pinky),forward).normalize();
  if(side==='L')normal.negate();
  const flexionAxis=new Vector3().crossVectors(forward,normal).normalize();
  return {forward,normal,flexionAxis};
}
