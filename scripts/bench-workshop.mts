// Workshop-pipeline performance baseline CLI (issue #10 WP-A) — a thin shell
// over scripts/lib/bench.mts, which holds every measurement (pure, so vitest
// shares the implementation; learning[4]). Fixed rig, fixed seeds, fixed
// scenario matrix — a baseline is comparable ONLY against numbers produced by
// the same command on the same machine.
//
// Usage:
//   npx tsx scripts/bench-workshop.mts [--scenario <name|all>] [--fps 40,60,240]
//     [--warmup 2] [--reps 7] [--seed 1] [--out evidence/bench-workshop.json]
//     [--report evidence/bench-workshop-report.md] [--compare <old.json>] [--quick]
//   --quick = warmup 1, reps 2, fps 60, default-5k only (smoke).
//   --compare must point at a DIFFERENT file than --out: comparing the output
//   target against itself is vacuous and would clobber the old baseline, so
//   the CLI refuses it.
// For the post-gc heap trend run with GC exposed:
//   node --import tsx --expose-gc scripts/bench-workshop.mts --quick
//   (equivalently NODE_OPTIONS=--expose-gc npx tsx scripts/bench-workshop.mts)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {createService} from '@human3d/server';
import {attachRacket,workshopMeta,WORKSHOP_REVISION,type WorkshopDoc} from '@human3d/motion-core';
import {diffBaselines,formatReport,hotspotRanking,resolveBenchDoc,runStageLoop,runWholeCalls,
 summarizeScenario,type BaselineFile,type BenchDocSpec} from './lib/bench.mts';

const arg=(k:string)=>{const i=process.argv.indexOf(k);return i>=0?process.argv[i+1]:undefined;};
const has=(k:string)=>process.argv.includes(k);
const quick=has('--quick');
const seed=Number(arg('--seed')??1);
const warmup=quick?1:Number(arg('--warmup')??2);
const reps=quick?2:Number(arg('--reps')??7);
const fpsList=(quick?'60':arg('--fps')??'40,60,240').split(',').map(Number);
const out=arg('--out')??'evidence/bench-workshop.json';
const reportPath=arg('--report')??'evidence/bench-workshop-report.md';
const comparePath=arg('--compare');
/* --compare must name a DIFFERENT file than --out: the default --out IS the
 * committed baseline, so a same-path invocation reads back the just-written
 * file (a vacuous +0% diff) after destroying the old baseline. Refuse before
 * any measurement, and read the comparand into memory before writing --out. */
if(comparePath&&path.resolve(out)===path.resolve(comparePath)){
 console.error(`--compare '${comparePath}' resolves to the --out target — comparing a baseline to itself is vacuous and would clobber it; pass a different --out or --compare file.`);
 process.exit(2);
}
const compareBaseline=comparePath?JSON.parse(fs.readFileSync(comparePath,'utf8')) as BaselineFile:undefined;

/** The scenario matrix: two real shipped documents plus seeded re-keyed
 * documents across the key-count/duration grid. k20-d5-nib is the
 * inbetweens:false draw — it prices the flat constraintsAt+unflattenPose
 * branch of frameAt instead of the Hermite path. */
const SCENARIOS:BenchDocSpec[]=[
 {name:'default-5k',builder:'defaultDocument'},
 {name:'forehand-49k',builder:'motionFile',motionId:'forehand'},
 {name:'k5-d2',builder:'bench',keys:5,duration:2},
 {name:'k5-d5',builder:'bench',keys:5,duration:5},
 {name:'k20-d2',builder:'bench',keys:20,duration:2},
 {name:'k20-d5',builder:'bench',keys:20,duration:5},
 {name:'k20-d5-nib',builder:'bench',keys:20,duration:5,inbetweens:false},
 {name:'k100-d2',builder:'bench',keys:100,duration:2},
 {name:'k100-d5',builder:'bench',keys:100,duration:5},
];
const wanted=quick?'default-5k':arg('--scenario')??'all';
const specs=SCENARIOS.filter(s=>wanted==='all'||wanted.split(',').includes(s.name));
if(!specs.length){console.error(`no scenario matches '${wanted}' — choices: all, ${SCENARIOS.map(s=>s.name).join(', ')}`);process.exit(2);}

const gcFn=(globalThis as {gc?:()=>void}).gc;
const now=()=>performance.now();
const pkgVersion=(name:string)=>{try{return (JSON.parse(fs.readFileSync(path.resolve(`node_modules/${name}/package.json`),'utf8')) as {version:string}).version;}catch{return '?';}};
const git=(cmd:string)=>{try{return execSync(cmd,{stdio:['ignore','pipe','ignore']}).toString().trim();}catch{return 'unknown';}};
const argv=process.argv.slice(2).join(' ');
const command=[gcFn?'node --import tsx --expose-gc scripts/bench-workshop.mts':'NODE_OPTIONS=--expose-gc npx tsx scripts/bench-workshop.mts',argv].filter(Boolean).join(' ');
const porcelain=git('git status --porcelain');

const ctx=await createService(path.resolve('public'));
const racket=attachRacket(ctx.rig);
const meta=(doc:WorkshopDoc,fps:number)=>workshopMeta({motionId:`mot_bench`,manifestSHA256:ctx.manifest.manifestSHA256,bones:ctx.manifest.bones.length,
 actionId:'workshop-doc',revision:WORKSHOP_REVISION,definitionSHA256:'bench-workshop',
 documentName:doc.name,prop:doc.keys.some(k=>k.constraints?.grip),loop:doc.loop,gripSide:doc.gripSide,
 source:'bench-workshop CLI',license:'bench-generated; no rights asserted',requestFingerprint:'bench',
 fps,duration:doc.duration,keys:doc.keys.length,
 notes:['kinematic solve only — no dynamics validation']});

const scenarios:BaselineFile['scenarios']=[];
for(const spec0 of specs){
 const spec={...spec0,seed:spec0.builder==='bench'?spec0.seed??seed:undefined};
 const doc=resolveBenchDoc(spec,ctx.rig.rest);
 for(const fps of fpsList){
  const t0=now();
  const sl=runStageLoop({rig:ctx.rig,doc,fps,warmup,reps,now});
  const wc=runWholeCalls({rig:ctx.rig,doc,fps,warmup,reps,now,meta:meta(doc,fps),tip:racket,
   mem:{heapUsed:()=>process.memoryUsage().heapUsed,gc:gcFn}});
  const s=summarizeScenario(spec,doc,fps,sl,wc);
  scenarios.push(s);
  console.log(`${s.name}@${fps}fps · ${s.samples} samples · solveWorkshop ${(s.stages.solveWorkshop.median/1000).toFixed(1)}ms · hotspots solve ${s.rollup.solve.sharePct}% sample ${s.rollup.sample.sharePct}% compile ${s.rollup.compile.sharePct}% (${((now()-t0)/1000).toFixed(1)}s)`);
 }
}

const baseline:BaselineFile={
 bench:'workshop-pipeline',version:1,
 run:{command,commit:git('git rev-parse HEAD'),
  /* Numbers bind to code state: HEAD alone says nothing about a dirty tree.
   * 'unknown' porcelain means git could not certify clean — record dirty. */
  dirty:porcelain==='unknown'?true:porcelain.length>0,
  date:new Date().toISOString(),
  env:{node:process.version,platform:os.platform(),arch:os.arch(),
   cpu:os.cpus()[0]?.model??'?',cores:os.cpus().length,totalMemGB:+(os.totalmem()/2**30).toFixed(1),
   three:pkgVersion('three'),tsx:pkgVersion('tsx')},
  params:{seed,warmup,reps,gc:gcFn?'available':'unavailable'}},
 scenarios,
 hotspots:hotspotRanking(scenarios),
};

fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(baseline,null,1)+'\n');
let report=formatReport(baseline);
if(compareBaseline)report+=`\n\n${diffBaselines(compareBaseline,baseline)}`;
fs.mkdirSync(path.dirname(reportPath),{recursive:true});
fs.writeFileSync(reportPath,report+'\n');
console.log(`\nwrote ${out} + ${reportPath}${gcFn?'':'  (gc unavailable — rerun with NODE_OPTIONS=--expose-gc for heap trend)'}`);
