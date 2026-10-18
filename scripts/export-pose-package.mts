// Export a canonical pose package into isolated scratch output by default.
// Usage: tsx scripts/export-pose-package.mts [actionId] [outFile]
// Pass --out-dir <dir> to select output location; tracked writes require
// --update-evidence. The default idle output is compared byte-for-byte with
// spec/examples/idle.pose.json.
import fs from 'node:fs';
import path from 'node:path';
import {createService,handleRequest} from '@human3d/server';
import {validatePosePackage} from '@human3d/motion-core';
import type {PosePackage} from '@human3d/motion-core';
import {resolveOutputDir,assertTrackedWriteAllowed,ensureOutputDir} from './lib/qa-output.mjs';
const root=process.cwd();
const output=resolveOutputDir('export-pose-package',process.argv.slice(2),root,process.env);
const [id='idle',requestedOut]=output.args;
const target=requestedOut??path.join(output.dir,`${id}.pose.json`);
assertTrackedWriteAllowed(target,{root,updateEvidence:output.updateEvidence});
const ctx=await createService(path.resolve('public'));
const res=handleRequest(ctx,'POST','/v1/motions',{action:{id,parameters:{}}},{});
if(res.status!==200){console.error(JSON.stringify(res.body));process.exit(1);}
const pkg=res.body as PosePackage;
const errors=validatePosePackage(pkg,ctx.manifest);
if(errors.length){console.error('VALIDATION FAILED',errors);process.exit(1);}
ensureOutputDir(path.dirname(target),{root});
const out=assertTrackedWriteAllowed(target,{root,updateEvidence:output.updateEvidence});
fs.writeFileSync(out,JSON.stringify(pkg));
if(id==='idle'&&!output.updateEvidence){
 const expected=fs.readFileSync(path.resolve(root,'spec/examples/idle.pose.json'));
 const generated=fs.readFileSync(out);
 if(!generated.equals(expected)){
  console.error(`generated idle package differs byte-for-byte from spec/examples/idle.pose.json (scratch output: ${out})`);
  process.exitCode=1;
 }
}
const kb=(fs.statSync(out).size/1024).toFixed(0);
console.log(`${out} · ${kb}KB · ${pkg.timeline.count} frames × ${pkg.tracks.rotations.length} tracks · 0 errors`);
