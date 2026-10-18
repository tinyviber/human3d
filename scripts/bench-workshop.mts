// Workshop-pipeline performance baseline CLI (issue #10 WP-A) — a thin shell
// over scripts/lib/bench.mts, which holds every measurement (pure, so vitest
// shares the implementation; learning[4]). Fixed rig, fixed seeds, fixed
// scenario matrix — a baseline is comparable ONLY against numbers produced by
// the same command on the same machine.
//
// Usage:
//   npx tsx scripts/bench-workshop.mts [--scenario <name|all>] [--fps 40,60,240]
//     [--warmup 2] [--reps 7] [--seed 1] [--out <file>]
//     [--report <file>] [--compare <old.json>] [--quick]
//   Outputs default to .out/<worktree>/<run>/bench-workshop/; --out-dir selects
//   another directory. Writes to tracked files require --update-evidence.
//   --quick = warmup 1, reps 2, fps 60, default-5k only (smoke).
//   --profile = solver-internal counters instead of the baseline sweep:
//   per-cell runSolveProfile (patch-instrumented flush/read/method counts)
//   → bench-solve-profile.json + printed table, in the same output directory.
//   --profile-skip-flush = --profile plus the flush-stub equivalence
//   experiment per cell (experiment-only label in the output).
//   --compare must point at a DIFFERENT file than --out: comparing the output
//   target against itself is vacuous and would clobber it, so the CLI refuses.
// For the post-gc heap trend run with GC exposed:
//   node --import tsx --expose-gc scripts/bench-workshop.mts --quick
//   (equivalently NODE_OPTIONS=--expose-gc npx tsx scripts/bench-workshop.mts)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {createService} from '@human3d/server';
import {attachRacket,workshopMeta,WORKSHOP_REVISION,type WorkshopDoc} from '@human3d/motion-core';
import {diffBaselines,formatProfileReport,formatReport,hotspotRanking,resolveBenchDoc,
 runSkipFlushExperiment,runSolveProfile,runStageLoop,runWholeCalls,SOLVE_PROFILE_DISCLOSURES,
 summarizeProfileCell,summarizeScenario,
 type BaselineFile,type BenchDocSpec,type SolveProfileFile} from './lib/bench.mts';
import {resolveOutputDir,assertTrackedWriteAllowed,ensureOutputDir,canonicalOutputTarget} from './lib/qa-output.mjs';

const root=process.cwd();
const output=resolveOutputDir('bench-workshop',process.argv.slice(2),root,process.env);
const cliArgs=output.args;

const arg=(k:string)=>{const i=cliArgs.indexOf(k);return i>=0?cliArgs[i+1]:undefined;};
const has=(k:string)=>cliArgs.includes(k);
const profile=has('--profile')||has('--profile-skip-flush');
const quick=has('--quick');
const seed=Number(arg('--seed')??1);
const warmup=quick?1:Number(arg('--warmup')??2);
const reps=quick?2:Number(arg('--reps')??7);
const fpsList=(quick?'60':arg('--fps')??'40,60,240').split(',').map(Number);
const outTarget=arg('--out')??path.join(output.dir,profile?'bench-solve-profile.json':'bench-workshop.json');
const reportTarget=arg('--report')??path.join(output.dir,'bench-workshop-report.md');
const comparePath=arg('--compare');
const canonicalDestinationIdentity=(target:string)=>canonicalOutputTarget(path.resolve(root,target));
assertTrackedWriteAllowed(outTarget,{root,updateEvidence:output.updateEvidence});
if(!profile){
 assertTrackedWriteAllowed(reportTarget,{root,updateEvidence:output.updateEvidence});
 if(canonicalDestinationIdentity(outTarget)===canonicalDestinationIdentity(reportTarget)){
  throw new Error('--out and --report resolve to the same destination');
 }
}
/* --compare must name a DIFFERENT file than --out. A same-path invocation
 * reads back the just-written file (a vacuous +0% diff) after destroying the
 * old baseline, so refuse before measurement and load the comparand first. */
if(comparePath&&canonicalDestinationIdentity(outTarget)===canonicalDestinationIdentity(comparePath)){
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

/* Numbers bind to code state: HEAD alone says nothing about a dirty tree.
 * 'unknown' porcelain means git could not certify clean — record dirty. */
const run:BaselineFile['run']={command,commit:git('git rev-parse HEAD'),
 dirty:porcelain==='unknown'?true:porcelain.length>0,
 date:new Date().toISOString(),
 env:{node:process.version,platform:os.platform(),arch:os.arch(),
  cpu:os.cpus()[0]?.model??'?',cores:os.cpus().length,totalMemGB:+(os.totalmem()/2**30).toFixed(1),
  three:pkgVersion('three'),tsx:pkgVersion('tsx')},
 params:{seed,warmup,reps,gc:gcFn?'available':'unavailable'}};

/* --profile / --profile-skip-flush: solver-internal counters instead of the
 * baseline sweep — per-cell runSolveProfile (patch-instrumented flush/read/
 * method counts on the real solveEffectiveFrame) + the optional flush-stub
 * equivalence experiment → bench-solve-profile.json + table. */
if(profile){
 const skipFlush=has('--profile-skip-flush');

 const cells:SolveProfileFile['scenarios']=[];
 for(const spec0 of specs){
  const spec={...spec0,seed:spec0.builder==='bench'?spec0.seed??seed:undefined};
  const doc=resolveBenchDoc(spec,ctx.rig.rest);
  for(const fps of fpsList){
   const pr=runSolveProfile({rig:ctx.rig,doc,fps,now,warmup,reps,heapUsed:()=>process.memoryUsage().heapUsed});
   const exp=skipFlush?runSkipFlushExperiment(ctx.rig,doc,fps):undefined;
   cells.push(summarizeProfileCell(spec,fps,pr,exp));
   const c=cells[cells.length-1];
   console.log(`${spec.name}@${fps}fps · ${c.solves} solves · umw.topLevel ${c.umw.topLevelPerSolve.median}/solve · nodeVisits ${c.umw.nodeVisitsPerSolve.median}/solve · solve med ${(c.solveUsInstrumented.median/1000).toFixed(3)}ms 插桩${exp?` · skip-flush ${exp.identical?'IDENTICAL':'MISMATCH'}(${exp.stubCalls}×)`:''}`);
  }
 }
 const file:SolveProfileFile={bench:'solve-profile',version:1,run,disclosures:[...SOLVE_PROFILE_DISCLOSURES],scenarios:cells};
 ensureOutputDir(path.dirname(outTarget),{root});
  const profileOut=assertTrackedWriteAllowed(outTarget,{root,updateEvidence:output.updateEvidence});
 fs.writeFileSync(profileOut,JSON.stringify(file,null,1)+'\n');
 console.log('\n'+formatProfileReport(file));
 console.log(`\nwrote ${profileOut}`);
 if(cells.some(c=>c.skipFlush&&!c.skipFlush.identical)){
  console.error('\nskip-flush experiment FAILED — outputs differ with flushes stubbed; the byte-identical claim does not hold');
  process.exit(1);
 }
 process.exit(0);
}

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
 run,
 scenarios,
 hotspots:hotspotRanking(scenarios),
};

let report=formatReport(baseline);
if(compareBaseline)report+=`\n\n${diffBaselines(compareBaseline,baseline)}`;
ensureOutputDir(path.dirname(outTarget),{root});
const preflightOut=assertTrackedWriteAllowed(outTarget,{root,updateEvidence:output.updateEvidence});
ensureOutputDir(path.dirname(reportTarget),{root});
const preflightReportPath=assertTrackedWriteAllowed(reportTarget,{root,updateEvidence:output.updateEvidence});
if(canonicalDestinationIdentity(preflightOut)===canonicalDestinationIdentity(preflightReportPath))
 throw new Error('--out and --report resolve to the same destination');
ensureOutputDir(path.dirname(outTarget),{root});
const baselineOut=assertTrackedWriteAllowed(outTarget,{root,updateEvidence:output.updateEvidence});
if(canonicalDestinationIdentity(baselineOut)===canonicalDestinationIdentity(preflightReportPath))
 throw new Error('--out and --report resolve to the same destination');
fs.writeFileSync(baselineOut,JSON.stringify(baseline,null,1)+'\n');


ensureOutputDir(path.dirname(reportTarget),{root});
const finalReportPath=assertTrackedWriteAllowed(reportTarget,{root,updateEvidence:output.updateEvidence});
if(canonicalDestinationIdentity(baselineOut)===canonicalDestinationIdentity(finalReportPath))
 throw new Error('--out and --report resolve to the same destination');
fs.writeFileSync(finalReportPath,report+'\n');
console.log(`\nwrote ${baselineOut} + ${finalReportPath}${gcFn?'':'  (gc unavailable — rerun with NODE_OPTIONS=--expose-gc for heap trend)'}`);
