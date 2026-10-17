// Convert a delivered pose package (.pose.json) into a binary glTF (.glb) —
// the same converter and exporter the workshop button uses, driven from Node.
// Usage: npx tsx scripts/package-to-glb.mts <in.pose.json> [out.glb]
import fs from 'node:fs';
import path from 'node:path';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {posePackageToClip,exportGlb} from '../src/core/glb-export';
import {checkPosePackageShape} from '../src/core/motion-source';
import {installFileReaderShim} from './lib/filereader-shim.mts';
import type {PosePackage} from '../src/core/pose-package';

const [input,out=input?input.replace(/\.pose\.json$/i,'')+'.glb':'']=process.argv.slice(2);
if(!input){console.error('usage: npx tsx scripts/package-to-glb.mts <in.pose.json> [out.glb]');process.exit(1);}
const pkg=JSON.parse(fs.readFileSync(input,'utf8')) as PosePackage;
// Same structural gate the lab decoder runs — a malformed package fails here
// with readable problems instead of producing a garbage GLB.
const problems=checkPosePackageShape(pkg);
if(problems.length){console.error(`INVALID PACKAGE ${input}:`);for(const p of problems)console.error(' ·',p);process.exit(1);}
installFileReaderShim(); // GLTFExporter's binary path reads Blobs via FileReader
// Clean parse of the shipped model — never a live rig (editor state would
// bake into node TRS). The package carries bone-local channels only.
const bytes=fs.readFileSync(path.resolve('public/models/human.glb'));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const glb=await exportGlb(gltf.scene,posePackageToClip(pkg));
fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});
fs.writeFileSync(out,Buffer.from(glb));
const kb=(glb.byteLength/1024).toFixed(0);
console.log(`${out} · ${kb}KB · ${pkg.timeline.count} frames × ${pkg.tracks.rotations.length+1} tracks · id ${pkg.id}`);
