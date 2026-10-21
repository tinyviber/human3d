/* Lightweight real-rig timing for the 120 Hz pelvis schedule.
 * Run: npx tsx scripts/bench-pelvis-schedule.mts
 * Values are machine-specific and intended for before/after comparison on
 * the same checkout host. `dragEndMs` measures schedule rebuild + the first
 * resumed solve; browser paint and React work are outside this measurement. */
import fs from 'node:fs';
import {execSync} from 'node:child_process';
import {Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig,buildPelvisSchedule,compileMotion,defaultDocument,frameAtCompiled,solveEffectiveFrame,type WorkshopDoc} from '@human3d/motion-core';

const model=fs.readFileSync('public/models/human.glb');
const gltf=await new GLTFLoader().parseAsync(model.buffer.slice(model.byteOffset,model.byteOffset+model.byteLength),'');
const rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
const now=()=>performance.now();
const median=(xs:number[])=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const docFor=(duration:number):WorkshopDoc=>{
 const doc=defaultDocument(rig.rest),scale=duration/doc.duration;
 doc.duration=duration;
 for(const key of doc.keys)key.time*=scale;
 return doc;
};
const build=(doc:WorkshopDoc)=>{
 const t=now(),compiled=compileMotion(doc,rig.rest.get('root')??new Vector3()),schedule=buildPelvisSchedule(rig,compiled);
 return {elapsed:now()-t,compiled,schedule};
};

const rows:{duration:number;firstBuildMs:number;editRebuildMs:number;dragEndMs:number;reps:number}[]=[];
for(const duration of [1,5,10]){
 const first:number[]=[],edit:number[]=[],dragEnd:number[]=[];
 for(let i=0;i<5;i++){
  const doc=docFor(duration);
  if(i===0)build(doc); // JIT warm-up on the same real document path
  const a=build(doc);first.push(a.elapsed);
  doc.keys[Math.floor(doc.keys.length/2)].pose.root.z+=.001;
  const t=now(),compiled=compileMotion(doc,rig.rest.get('root')??new Vector3()),schedule=buildPelvisSchedule(rig,compiled);
  edit.push(now()-t);
  const frame=frameAtCompiled(compiled,Math.min(duration,.5));
  solveEffectiveFrame(rig,frame,schedule.passthrough?undefined:schedule.at(Math.min(duration,.5)));
  dragEnd.push(now()-t);
 }
 rows.push({duration,firstBuildMs:+median(first).toFixed(2),editRebuildMs:+median(edit).toFixed(2),dragEndMs:+median(dragEnd).toFixed(2),reps:first.length});
}
const commit=execSync('git rev-parse --short HEAD',{stdio:['ignore','pipe','ignore']}).toString().trim();
const dirty=execSync('git status --porcelain',{stdio:['ignore','pipe','ignore']}).toString().trim().length>0;
console.log(JSON.stringify({commit,dirty,node:process.version,platform:process.platform,rows},null,2));
