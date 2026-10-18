// Recapture spec/solver-baseline/*.golden.json from the CURRENT solver output.
//
// The goldens pin the production replay path — the same frameAt →
// solveEffectiveFrame calls solver-baseline.test.ts makes — so any future
// solve-semantics drift shows up as a golden diff instead of silently
// shipping. Keep the golden's own instant grid so pre/post files stay
// comparable.
//
// Rerunnable: npx tsx scripts/recapture-solver-baseline.mts
import fs from 'node:fs';
import path from 'node:path';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from '@human3d/motion-core';
import {motionFileById} from '@human3d/motion-core';
import {frameAt} from '@human3d/motion-core';
import {solveEffectiveFrame} from '@human3d/motion-core';
import type {RigInfo} from '@human3d/motion-core';
import {resolveOutputDir,assertTrackedWriteAllowed,ensureOutputDir} from './lib/qa-output.mjs';

const root=process.cwd();
const output=resolveOutputDir('recapture-solver-baseline',process.argv.slice(2),root,process.env);
if(output.args.length)throw new Error(`unexpected baseline arguments: ${output.args.join(' ')}`);
const updateTrackedDefaults=output.updateEvidence&&!process.argv.some(arg=>arg==='--out-dir'||arg.startsWith('--out-dir='));

const IDS=['idle','reach','squat','ready','forehand'];
const assetDir=path.resolve('public');
const glb=fs.readFileSync(path.join(assetDir,'models/human.glb'));
const rigJson=fs.readFileSync(path.join(assetDir,'models/rig.json'));
const gltf=await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const rig=new HumanRig(gltf.scene,JSON.parse(rigJson.toString('utf8')) as RigInfo);
const bones=[...rig.bones.keys()];
const origin=rig.rest.get('root')!;
const goldenDir=path.resolve('spec/solver-baseline');
const destinationDir=updateTrackedDefaults?goldenDir:output.dir;
ensureOutputDir(destinationDir,{root});

interface GoldenFile{schema:string;id:string;times:number[];root:number[][];bones:string[];quats:number[][][]}
for(const id of IDS){
 const sourceFile=path.join(goldenDir,`${id}.golden.json`);
 const file=assertTrackedWriteAllowed(path.join(destinationDir,`${id}.golden.json`),{root,updateEvidence:output.updateEvidence});
 // Keep the golden's own instant grid so pre/post files stay comparable.
 const old=JSON.parse(fs.readFileSync(sourceFile,'utf8')) as GoldenFile;
 const doc=motionFileById(id)!.document!;
 const root:number[][]=[],quats:number[][][]=[];
 for(const t of old.times){
  solveEffectiveFrame(rig,frameAt(doc,t,origin));
  root.push(rig.bone('root').position.toArray());
  quats.push(bones.map(n=>rig.bone(n).quaternion.toArray() as number[]));
 }
 const next:GoldenFile={schema:old.schema,id,times:old.times,root,bones,quats};
 fs.writeFileSync(file,JSON.stringify(next,null,2)+'\n');
 console.log(`${id}: recaptured ${old.times.length} instants × ${bones.length} bones from the current solver`);
}
