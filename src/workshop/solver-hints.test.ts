import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {Euler,Quaternion} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from '../core/rig';
import {DEG} from '../core/kinematics';
import {blankDocument,frameAt} from './document';
import {solveEffectiveFrame} from './solver';

let rig:HumanRig;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
},30000);

describe('solver hints',()=>{
 it('raises the right shoulder girdle only when clavicleLift is set',()=>{
  const expectClavicle=(flag:boolean|undefined)=>{
   const doc=blankDocument(rig.rest,'抬肩','clavicle-hint');
   doc.clavicleLift=flag;
   const k=doc.keys[0];k.pose.handR.target.y=1.8;
   const f=frameAt(doc,0,rig.rest.get('root'));
   solveEffectiveFrame(rig,f);
   const lift=Math.max(0,(1.8-k.pose.root.y-1.1)/.62);
   const expected=new Quaternion().setFromEuler(new Euler(0,0,-lift*8*DEG,'YXZ'));
   return {got:rig.bone('clavicle_R').quaternion,expected};
  };
  // Enabled: the shoulder chain rotates ≈ −8°·lift on the clavicle (−5°·lift on shoulder01).
  const on=expectClavicle(true);
  expect(on.got.angleTo(on.expected)).toBeLessThan(.01*DEG);
  // Absent and explicitly false: the chain stays at rest either way.
  for(const flag of [undefined,false]as const){
   const off=expectClavicle(flag);
   expect(off.got.angleTo(new Quaternion())).toBeLessThan(1e-9);
  }
 });
});
