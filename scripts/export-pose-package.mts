// Export a canonical pose package as a spec example / golden fixture.
// Usage: tsx scripts/export-pose-package.mts [actionId] [outFile]
import fs from 'node:fs';
import path from 'node:path';
import {createService,handleRequest} from '../src/server/service';
import {validatePosePackage} from '../src/server/validate';
import type {PosePackage} from '../src/core/pose-package';
const [id='idle',out=`spec/examples/${id}.pose.json`]=process.argv.slice(2);
const ctx=await createService(path.resolve('public'));
const res=handleRequest(ctx,'POST','/v1/motions',{action:{id,parameters:{}}},{});
if(res.status!==200){console.error(JSON.stringify(res.body));process.exit(1);}
const pkg=res.body as PosePackage;
const errors=validatePosePackage(pkg,ctx.manifest);
if(errors.length){console.error('VALIDATION FAILED',errors);process.exit(1);}
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(pkg));
const kb=(fs.statSync(out).size/1024).toFixed(0);
console.log(`${out} · ${kb}KB · ${pkg.timeline.count} frames × ${pkg.tracks.rotations.length} tracks · 0 errors`);
