// Measure every bundled racket motion through the production replay path
// (envelope → normalizeMotionFile → frameAt → solveEffectiveFrame) and report
// the arm plausibility figures a bad task-space retarget breaks: elbow
// flexion against the 145° solver clamp, wrist-target reach and residual,
// wrist-cone clamp demand, and arm–torso surface crossings on the skinned
// mesh (PoseValidityChecker). One line per motion; `--json` prints the rows.
// Usage: npx tsx scripts/measure-player-forehands.mts [samples=24] [--json]
import fs from 'node:fs';
import path from 'node:path';
import {Vector3} from 'three';
import type {SkinnedMesh} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig,MOTION_FILES,frameAt,solveEffectiveFrame,angleAt,DEG,LIMITS,WRIST_BEND_LIMIT_DEG} from '@human3d/motion-core';
import type {RigInfo} from '@human3d/motion-core';
import {PoseValidityChecker} from '../apps/web/src/lab/pose-validity';

const args=process.argv.slice(2);
const json=args.includes('--json');
const samples=Number(args.find(a=>/^\d+$/.test(a))??24);
const assetDir=path.resolve('public');
const glb=fs.readFileSync(path.join(assetDir,'models/human.glb'));
const gltf=await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync(path.join(assetDir,'models/rig.json'),'utf8')) as RigInfo);
let mesh:SkinnedMesh|undefined;rig.model.traverse(o=>{if((o as SkinnedMesh).isSkinnedMesh)mesh=o as SkinnedMesh;});
if(!mesh)throw new Error('production skinned mesh not found');
const checker=new PoseValidityChecker(mesh,rig);
const origin=rig.rest.get('root')!;
const armLength=(side:'L'|'R')=>rig.rest.get(`upperarm01_${side}`)!.distanceTo(rig.rest.get(`lowerarm01_${side}`)!)+rig.rest.get(`lowerarm01_${side}`)!.distanceTo(rig.rest.get(`wrist_${side}`)!);

type Sides<T>=Record<'L'|'R',T>;
interface Row{id:string;frames:number;elbowMax:Sides<number>;elbowClamped:Sides<number>;reachMin:Sides<number>;residualMax:Sides<number>;wristClamped:Sides<number>;crossings:Sides<number>;crossTimes:Sides<number[]>;shoulderDirFail:Sides<number>;indeterminate:number;worst:Sides<{t:number;elbow:number}>}
const rows:Row[]=[];
const racket=MOTION_FILES.filter(f=>f.kind==='workshop-motion'&&f.capabilities?.prop?.kind==='racket');
for(const file of racket){
 const doc=file.document!;
 const times=new Set<number>();
 for(let i=0;i<=samples;i++)times.add(+(doc.duration*i/samples).toFixed(6));
 for(const k of doc.keys)times.add(k.time);
 const row:Row={id:file.id,frames:0,elbowMax:{L:0,R:0},elbowClamped:{L:0,R:0},reachMin:{L:Infinity,R:Infinity},residualMax:{L:0,R:0},wristClamped:{L:0,R:0},crossings:{L:0,R:0},crossTimes:{L:[],R:[]},shoulderDirFail:{L:0,R:0},indeterminate:0,worst:{L:{t:0,elbow:0},R:{t:0,elbow:0}}};
 for(const t of [...times].sort((a,b)=>a-b)){
  const frame=frameAt(doc,t,origin);
  solveEffectiveFrame(rig,frame);
  row.frames++;
  for(const side of ['L','R'] as const){
   const s=rig.point(`upperarm01_${side}`),e=rig.point(`lowerarm01_${side}`),w=rig.point(`wrist_${side}`);
   const hand=side==='L'?frame.pose.handL:frame.pose.handR;
   const target=new Vector3(hand.target.x,hand.target.y,hand.target.z);
   const flexion=angleAt(s,e,w);
   if(flexion>row.elbowMax[side]){row.elbowMax[side]=flexion;row.worst[side]={t,elbow:flexion};}
   if(flexion>=LIMITS.elbowFlexion[1]-.5)row.elbowClamped[side]++;
   row.reachMin[side]=Math.min(row.reachMin[side],s.distanceTo(target)/armLength(side));
   row.residualMax[side]=Math.max(row.residualMax[side],w.distanceTo(target));
   const forearm=w.clone().sub(e).normalize(),forward=new Vector3(hand.forward.x,hand.forward.y,hand.forward.z).normalize();
   if(forearm.angleTo(forward)/DEG>WRIST_BEND_LIMIT_DEG+1e-6)row.wristClamped[side]++;
  }
  const report=checker.inspect();
  for(const hit of report.intersections)if(hit.count>0){row.crossings[hit.side]++;row.crossTimes[hit.side].push(+t.toFixed(3));}
  for(const check of report.checks)if(!check.ok&&check.code.startsWith('shoulder-direction-'))row.shoulderDirFail[check.code.endsWith('L')?'L':'R']++;
  if(report.status==='indeterminate')row.indeterminate++;
 }
 rows.push(row);
 if(!json){
  const f=(n:number)=>n.toFixed(0).padStart(3);
  const ct=(side:'L'|'R')=>row.crossTimes[side].length?` [${row.crossTimes[side].slice(0,6).join(',')}${row.crossTimes[side].length>6?',…':''}]`:'';
  console.log([
   row.id.padEnd(40),
   `frames ${row.frames}`,
   `elbowMax R ${row.elbowMax.R.toFixed(1)}° (t=${row.worst.R.t.toFixed(2)}) L ${row.elbowMax.L.toFixed(1)}°`,
   `atClamp R ${f(row.elbowClamped.R)} L ${f(row.elbowClamped.L)}`,
   `reachMin R ${row.reachMin.R.toFixed(2)} L ${row.reachMin.L.toFixed(2)}`,
   `residMax R ${(row.residualMax.R*1000).toFixed(0)}mm L ${(row.residualMax.L*1000).toFixed(0)}mm`,
   `wristClamp R ${f(row.wristClamped.R)} L ${f(row.wristClamped.L)}`,
   `armTorsoCross R ${f(row.crossings.R)}${ct('R')} L ${f(row.crossings.L)}${ct('L')}`,
   `shoulderDirFail R ${f(row.shoulderDirFail.R)} L ${f(row.shoulderDirFail.L)}`,
   `indet ${f(row.indeterminate)}`,
  ].join('  '));
 }
}
if(json)console.log(JSON.stringify(rows,null,1));
