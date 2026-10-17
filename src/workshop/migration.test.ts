import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from '../core/rig';
import {DEG} from '../core/kinematics';
import {frameAt} from './document';
import {solveEffectiveFrame} from './solver';
import {normalizeMotionFile} from '../core/motion-file';

/* Regression for the authored → workshop-motion migration. Goldens in
 * spec/migration/ were captured from the pre-deletion authoring pipeline;
 * the replay path is the production one (envelope → normalizeMotionFile →
 * frameAt → solveEffectiveFrame).
 *
 * Measured maxima at migration time (evidence/migration-report.txt):
 *   idle 0.00mm/0.00° · reach 0.50mm/0.71° · squat 1.80mm/0.41° · ready 0.00mm/0.00°
 *   forehand 2.44mm/4.03° — the quat outliers are isolated wrist_R/lowerarm02_R
 *   twist-split samples in the fastest palm-rotation stretch (ill-conditioned
 *   roll extraction in rig.hand), not trajectory error: p95 quat ≤0.01°.
 * Budgets below are graded to cover those measurements with margin. */
const TOL:Record<string,{quatDeg:number;posMm:number}>={
 idle:{quatDeg:1,posMm:5},reach:{quatDeg:1,posMm:5},squat:{quatDeg:1,posMm:5},
 ready:{quatDeg:1,posMm:5},forehand:{quatDeg:5,posMm:5},
};
interface Golden{schema:string;id:string;times:number[];root:number[][];bones:string[];quats:number[][][]}

let rig:HumanRig;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
},30000);

describe('authored motion migration',()=>{
 for(const id of Object.keys(TOL)){
  it(`replays ${id} within tolerance of the authored golden`,()=>{
   const g=JSON.parse(fs.readFileSync(`spec/migration/${id}.golden.json`,'utf8')) as Golden;
   const doc=normalizeMotionFile(JSON.parse(fs.readFileSync(`assets/motions/${id}.json`,'utf8'))).document!;
   const origin=rig.rest.get('root')!;
   for(const [i,t] of g.times.entries()){
    solveEffectiveFrame(rig,frameAt(doc,t,origin));
    expect(rig.bone('root').position.distanceTo(new Vector3(...g.root[i] as [number,number,number]))*1000).toBeLessThan(TOL[id].posMm);
    g.bones.forEach((n,bi)=>
     expect(rig.bone(n).quaternion.angleTo(new Quaternion(...g.quats[i][bi] as [number,number,number,number]))/DEG)
      .toBeLessThan(TOL[id].quatDeg));
   }
  });
 }
});
