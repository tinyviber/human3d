// Measure the bundled workshop-motion envelopes and the default workshop
// document against the semantic limits in src/server/validate.ts. One line per
// motion; the calibration table in docs/validation.md comes from this output
// at 40 fps.
// Usage: tsx scripts/measure-motions.mts [fps=40]
import path from 'node:path';
import {createService,handleRequest} from '../src/server/service';
import {measurePackage,validatePosePackage} from '../src/server/validate';
import {defaultDocument,serializeDoc} from '../src/workshop/document';
import type {PosePackage} from '../src/core/pose-package';

const fps=Number(process.argv[2]??40);
const ctx=await createService(path.resolve('public'));
const bundled=['idle','reach','squat','ready','forehand'];
const requests:[string,unknown][]=[
  ...bundled.map(id=>[id,{action:{id,parameters:{}},sample:{fps}}] as [string,unknown]),
  ['workshop',{action:{id:'workshop-doc',parameters:{document:JSON.parse(serializeDoc(defaultDocument(ctx.rig.rest)))}},sample:{fps}}],
];

for(const [name,req] of requests){
  const res=handleRequest(ctx,'POST','/v1/motions',req,{});
  if(res.status!==200){console.log(`${name.padEnd(9)} HTTP ${res.status}`);continue;}
  const pkg=res.body as PosePackage;
  const m=measurePackage(pkg,ctx.manifest);
  const failures=validatePosePackage(pkg,ctx.manifest);
  const slip=m.slip?`${(m.slip.value*100).toFixed(2)} cm`:'n/a';
  console.log([
    name.padEnd(9),
    `ang ${m.angularSpeed.value.toFixed(2)} rad/s (${m.angularSpeed.at} @${m.angularSpeed.t.toFixed(2)} s)`,
    `root ${m.rootSpeed.value.toFixed(2)} m/s`,
    `acc ${m.rootAccel.value.toFixed(2)} m/s²`,
    `knee ${m.knee.value.toFixed(1)}°`,
    `elbow ${m.elbow.value.toFixed(1)}°`,
    `slip ${slip}`,
    failures.length?`FAIL ${failures.join('; ')}`:'PASS',
  ].join('  '));
}