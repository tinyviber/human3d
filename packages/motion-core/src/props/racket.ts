import {BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, Quaternion, TubeGeometry, CatmullRomCurve3, Vector3, CylinderGeometry, TorusGeometry} from 'three';
import type {HumanRig} from '../rig';
import {gripFrame,type HandleGrip} from '../grip';

/** The tennis racket as a held prop (plugin). Everything racket-specific lives
 * here: the frame geometry, the handle the hand wraps (RACKET_HANDLE), the
 * string-bed tip (RACKET_TIP_LOCAL) and the wrist mount. The solver and the
 * hand-wrap code are prop-agnostic; the workshop imports the racket through
 * the props registry (props/index.ts). */
/** Handle the hand wraps: a 22 mm grip radius, centred 9 mm forward and 31 mm
 * normal of the palm frame. */
export const RACKET_HANDLE:HandleGrip={radius:.022,forward:.009,normal:.031};
/** Tip (string-bed centre) in the racket's local frame, metres along +Y. */
export const RACKET_TIP_LOCAL=new Vector3(0,.61,0);

/** Racket coordinates: +Y runs through the handle to the head; grip origin is
 * the center of the contact cylinder. Attachment is wrist-local, never world-follow. */
function createRacket(){
  const group=new Group();group.name='RacketGrip';
  const blue=new MeshStandardMaterial({color:0x294de1,metalness:.45,roughness:.3});
  const dark=new MeshStandardMaterial({color:0x172737,roughness:.85});
  const silver=new MeshStandardMaterial({color:0xc4d0d8,metalness:.65,roughness:.35});
  const handle=new Mesh(new CylinderGeometry(.016,.018,.145,8),dark);group.add(handle);
  const cap=new Mesh(new CylinderGeometry(.020,.020,.012,8),dark);cap.position.y=-.075;group.add(cap);
  for(let y=-.065;y<.07;y+=.012){const wrap=new Mesh(new TorusGeometry(.017,.0008,4,16),silver);wrap.rotation.x=Math.PI/2;wrap.position.y=y;group.add(wrap);}
  const shaft=new Mesh(new CylinderGeometry(.008,.010,.14,10),blue);shaft.position.y=.142;group.add(shaft);
  const ellipse=[];for(let i=0;i<=64;i++){const t=i/64*Math.PI*2;ellipse.push(new Vector3(Math.sin(t)*.128,.445+Math.cos(t)*.166,0));}
  const frame=new Mesh(new TubeGeometry(new CatmullRomCurve3(ellipse,true),96,.009,8,true),blue);group.add(frame);
  for(const sign of [-1,1]){const a=new Vector3(0,.205,0),b=new Vector3(sign*.087,.322,0),v=b.clone().sub(a);const throat=new Mesh(new CylinderGeometry(.006,.007,v.length(),8),blue);throat.position.copy(a).add(b).multiplyScalar(.5);throat.quaternion.setFromUnitVectors(new Vector3(0,1,0),v.normalize());group.add(throat);}
  const strings:number[]=[];
  for(let x=-.112;x<=.112;x+=.016){const dy=.159*Math.sqrt(1-x*x/(.121*.121));strings.push(x,.445-dy,0,x,.445+dy,0);}
  for(let y=-.144;y<=.144;y+=.016){const dx=.121*Math.sqrt(1-y*y/(.159*.159));strings.push(-dx,.445+y,0,dx,.445+y,0);}
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(strings,3));group.add(new LineSegments(g,new LineBasicMaterial({color:0x8f9caa,transparent:true,opacity:.7})));
  group.traverse(o=>{if(o instanceof Mesh){o.castShadow=true;o.receiveShadow=true;}});
  return group;
}
/** The racket's transform inside the right wrist's local frame, built from
 * the right palmar frame: +Y handle along the grip axis, string-bed normal
 * twisted onto the palmar forward (independent from wrist movement). */
function racketLocalTransform(rig:HumanRig){
  const frame=gripFrame(rig,'R',RACKET_HANDLE);
  const quaternion=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),frame.axis);
  const current=new Vector3(0,0,1).applyQuaternion(quaternion);
  const twist=Math.atan2(new Vector3().crossVectors(current,frame.forward).dot(frame.axis),current.dot(frame.forward));
  quaternion.premultiply(new Quaternion().setFromAxisAngle(frame.axis,twist));
  return {position:frame.center.clone(),quaternion};
}
/** (Re)mount a racket on the requested wrist. The left mount is the exact
 * x-mirror of the right transform — bilateral wrist local frames coincide
 * with world axes at rest, so negating position.x and the quaternion's y/z
 * is the true mirrored mount: the head exits on the left thumb side and the
 * string bed faces the mirrored-palm direction. Computing the same
 * construction from the LEFT grip frame would instead point +Y along the
 * left axis — the head on the pinky side, a 180°-flipped handle — which is
 * why the mount mirrors a canonical transform instead. */
export function mountRacket(rig:HumanRig,racket:Group,side:'L'|'R'='R'){
  const t=racketLocalTransform(rig);
  racket.position.copy(t.position);racket.quaternion.copy(t.quaternion);
  if(side==='L'){
    racket.position.x=-racket.position.x;
    racket.quaternion.set(racket.quaternion.x,-racket.quaternion.y,-racket.quaternion.z,racket.quaternion.w);
  }
  racket.removeFromParent();
  rig.bone(`wrist_${side}`).add(racket);
}
export function attachRacket(rig:HumanRig,side:'L'|'R'='R'){
  const racket=createRacket();mountRacket(rig,racket,side);return racket;
}
