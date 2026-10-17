import {BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, Quaternion, TubeGeometry, CatmullRomCurve3, Vector3, CylinderGeometry, TorusGeometry} from 'three';
import type {HumanRig} from './rig';
import {handFrame} from './hand-frame';
import {frameRotation} from './kinematics';
/** Racket coordinates: +Y runs through the handle to the head; grip origin is
 * the center of the contact cylinder. Attachment is wrist-local, never world-follow. */
export function createRacket(){
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
export function gripFrame(rig:HumanRig){
  const wrist=rig.rest.get('wrist_R')!;
  const {forward,normal,flexionAxis:axis}=handFrame(rig.rest,'R');
  const base=rig.rest.get('finger3-1_R')!.clone().add(rig.rest.get('finger4-1_R')!).multiplyScalar(.5);
  return {forward,normal,axis,center:base.sub(wrist).addScaledVector(forward,.009).addScaledVector(normal,.031)};
}
export function attachRacket(rig:HumanRig){
  const racket=createRacket(),frame=gripFrame(rig);
  racket.position.copy(frame.center);racket.quaternion.setFromUnitVectors(new Vector3(0,1,0),frame.axis);
  // Rotate the string bed about its long axis, independent from wrist movement.
  const faceNormal=frame.forward;
  const current=new Vector3(0,0,1).applyQuaternion(racket.quaternion);
  const twist=Math.atan2(new Vector3().crossVectors(current,faceNormal).dot(frame.axis),current.dot(faceNormal));
  racket.quaternion.premultiply(new Quaternion().setFromAxisAngle(frame.axis,twist));
  rig.bone('wrist_R').add(racket);return racket;
}
/** Circumscribed phalanx segments: each bone approaches a tangent to the
 * grip cylinder plus a 5mm finger pad allowance. No random per-frame angles. */
export function applyGrip(rig:HumanRig,amount=1){
  const {axis,normal,forward,center}=gripFrame(rig);
  const wrist=rig.bone('wrist_R'),wq=wrist.getWorldQuaternion(new Quaternion());
  const contactRadius=.022;
  for(let finger=1;finger<=5;finger++){
    let previousDirection:Vector3|undefined;
    const winding=finger===1?-1:1;
    for(let joint=1;joint<=3;joint++){
      const name=`finger${finger}-${joint}_R`,bone=rig.bone(name);
      const origin=wrist.worldToLocal(rig.point(name)).sub(center);
      const x=origin.dot(forward),y=origin.dot(normal),distance=Math.hypot(x,y);
      const theta=Math.atan2(y,x),alpha=Math.acos(Math.min(1,contactRadius/Math.max(contactRadius,distance)));
      const tangent=theta+winding*alpha;
      let dx=contactRadius*Math.cos(tangent)-x,dy=contactRadius*Math.sin(tangent)-y;
      if(Math.hypot(dx,dy)<1e-8){dx=-Math.sin(theta)*winding;dy=Math.cos(theta)*winding;}
      let desired=forward.clone().multiplyScalar(dx).addScaledVector(normal,dy).normalize();
      if(previousDirection){const limit=(joint===3?75:100)*Math.PI/180,angle=previousDirection.angleTo(desired);if(angle>limit){const turn=new Quaternion().setFromUnitVectors(previousDirection,desired);turn.slerp(new Quaternion(),1-limit/angle);desired=previousDirection.clone().applyQuaternion(turn);}}
      previousDirection=desired.clone();
      const bi=rig.info.bones.find(b=>b.name===name)!;
      const restDir=new Vector3().fromArray(bi.tail).sub(rig.rest.get(name)!);
      const target=wq.clone().multiply(frameRotation(restDir,axis,desired,axis));
      const current=bone.getWorldQuaternion(new Quaternion());
      current.slerp(target,amount);rig.worldRotation(name,current);
    }
  }
  rig.model.updateMatrixWorld(true);
}
