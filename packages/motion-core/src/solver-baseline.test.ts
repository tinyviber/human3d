import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from './rig';
import {DEG} from './kinematics';
import {frameAt} from './document';
import {solveEffectiveFrame} from './solver';
import {normalizeMotionFile} from './motion-file';

/* Change-detector baseline for the bundled workshop motions: the goldens in
 * spec/solver-baseline/ are captures of the production replay path itself —
 * envelope → normalizeMotionFile → frameAt → solveEffectiveFrame — taken by
 * scripts/recapture-solver-baseline.mts. This test pins the CURRENT solver's
 * output, and any future solve-semantics drift fails here.
 *
 * Replay is deterministic (property.test.ts asserts bitwise re-solve), so
 * the budget is pure platform-float margin: the golden IS this code path's
 * output. */
const TOL={quatDeg:.001,posMm:.001};
interface Golden{schema:string;id:string;times:number[];root:number[][];bones:string[];quats:number[][][]}

let rig:HumanRig;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
},30000);

describe('bundled motion solver baseline',()=>{
 for(const id of ['idle','reach','squat','ready','forehand']){
  it(`replays ${id} to the captured solver baseline`,()=>{
   const g=JSON.parse(fs.readFileSync(`spec/solver-baseline/${id}.golden.json`,'utf8')) as Golden;
   const doc=normalizeMotionFile(JSON.parse(fs.readFileSync(`assets/motions/${id}.json`,'utf8'))).document!;
   const origin=rig.rest.get('root')!;
   for(const [i,t] of g.times.entries()){
    solveEffectiveFrame(rig,frameAt(doc,t,origin));
    expect(rig.bone('root').position.distanceTo(new Vector3(...g.root[i] as [number,number,number]))*1000).toBeLessThan(TOL.posMm);
    g.bones.forEach((n,bi)=>
     expect(rig.bone(n).quaternion.angleTo(new Quaternion(...g.quats[i][bi] as [number,number,number,number]))/DEG)
      .toBeLessThan(TOL.quatDeg));
   }
  });
 }
});
