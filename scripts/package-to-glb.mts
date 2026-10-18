// Convert a delivered pose package (.pose.json) into a binary glTF (.glb) —
// the same converter and exporter the workshop button uses, driven from Node.
// Usage: npx tsx scripts/package-to-glb.mts <in.pose.json> [out.glb]
// Output defaults to isolated .out scratch; tracked writes require --update-evidence.
import fs from 'node:fs';
import path from 'node:path';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {Bone} from 'three';
import {posePackageToClip,exportGlb} from '@human3d/motion-core/glb';
import {checkPosePackageShape} from '@human3d/motion-core';
import {installFileReaderShim} from './lib/filereader-shim.mts';
import type {PosePackage} from '@human3d/motion-core';
import {resolveOutputDir,assertTrackedWriteAllowed,ensureOutputDir} from './lib/qa-output.mjs';

const root=process.cwd();
const output=resolveOutputDir('package-to-glb',process.argv.slice(2),root,process.env);
const [input,requestedOut]=output.args;
if(!input){console.error('usage: npx tsx scripts/package-to-glb.mts <in.pose.json> [out.glb]');process.exit(1);}
// Default output is isolated in .out; an explicit tracked target needs opt-in.
const defaultName=path.basename(input).replace(/\.pose\.json$|\.json$/i,'')+'.glb';
const target=requestedOut??path.join(output.dir,defaultName);
assertTrackedWriteAllowed(target,{root,updateEvidence:output.updateEvidence});
const pkg=JSON.parse(fs.readFileSync(input,'utf8')) as PosePackage;
installFileReaderShim(); // GLTFExporter's binary path reads Blobs via FileReader
// Clean parse of the shipped model — never a live rig (editor state would
// bake into node TRS). The package carries bone-local channels only.
const bytes=fs.readFileSync(path.resolve('public/models/human.glb'));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
// Same structural gate the lab decoder runs, bound to this rig's bone set —
// a malformed package (or one naming bones the rig doesn't have) fails here
// with readable problems instead of producing a garbage GLB.
const validBones=new Set<string>();
gltf.scene.traverse(o=>{if((o as Bone).isBone)validBones.add(o.name);});
const problems=checkPosePackageShape(pkg,validBones);
if(problems.length){console.error(`INVALID PACKAGE ${input}:`);for(const p of problems)console.error(' ·',p);process.exit(1);}
const glb=await exportGlb(gltf.scene,posePackageToClip(pkg));
ensureOutputDir(path.dirname(target),{root,updateEvidence:output.updateEvidence});
const out=assertTrackedWriteAllowed(target,{root,updateEvidence:output.updateEvidence});
fs.writeFileSync(out,Buffer.from(glb));
const kb=(glb.byteLength/1024).toFixed(0);
console.log(`${out} · ${kb}KB · ${pkg.timeline.count} frames × ${pkg.tracks.rotations.length+1} tracks · id ${pkg.id}`);
