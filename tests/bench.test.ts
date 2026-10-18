import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {Object3D,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig,attachRacket,defaultDocument,sampleTimes,serializeDoc,solveWorkshop,
 validateDocShape,workshopMeta,WORKSHOP_REVISION,type WorkshopDoc} from '@human3d/motion-core';
import {buildBenchDoc,medianOf,p95Of,runSkipFlushExperiment,runSolveProfile,runStageLoop,runWholeCalls,summarize} from '../scripts/lib/bench.mts';

/* Contract tests for the workshop-pipeline bench library (issue #10 WP-A).
 * scripts/lib/bench.mts is the PURE measurement core behind the
 * scripts/bench-workshop.mts CLI — no node imports of its own, so vitest
 * exercises the same code the CLI ships. The CLI itself is NOT imported here
 * (it pulls node APIs and @human3d/server through createService).
 *
 * CI-safety rule: NOTHING in this file asserts a hard timing budget. Timings
 * are asserted only for shape (right arrays, right lengths), finiteness and
 * sign — plus ONE order-of-magnitude wiring check (frameAt ≈ buildModel +
 * frameFromModel within a ×3 band), which catches a mis-wired measurement,
 * never a slow machine. Runs stay tiny on purpose: fps 10, warmup 1, reps 2,
 * the 5-key/0.8s default document and small seeded bench docs.
 *
 * Contract assumptions written down for whoever runs this file against a
 * moved implementation (a failure here reads as impl-defect vs test-defect):
 *  - stats: empty input returns finite sentinels (the impl ships 0-filled
 *    values, not NaN/throw) — asserted as non-throw + finite, so the
 *    sentinel choice stays free.
 *  - runStageLoop pools per-sample timings under `perSample` (the ticket
 *    contract said `samples`) — both names are accepted. PR-B shape
 *    (assumed against the ticket; matches the parallel impl's bench.mts):
 *    repTotals splits the compiled stages {compileMotion,frameAtCompiled,
 *    solveEffectiveFrame,analyzePose} — compileMotion timed once per rep,
 *    the hoist IS the PR-B change; perSample's full-pool keys are
 *    {frameAtCompiled,solveEffectiveFrame,analyzePose} (len = reps×spr);
 *    the compat-path cross-checks {buildModel,frameFromModel,frameAt,
 *    samplePose} are stride-subset, so their arrays are asserted
 *    non-empty/≤, not exact.
 *  - samplesPerRep = sampleTimes(duration,fps).length + doc.keys.length —
 *    the capture grid PLUS authored key instants (capture() re-samples keys
 *    even when they coincide with a grid point).
 *  - runWholeCalls names the serialize stage `stringify` (the ticket
 *    contract said `serialize`) — either key satisfies the assertion, but
 *    one must exist.
 *  - rep-level totals are asserted > 0: they sum hundreds of real
 *    microseconds of work, so a zero is a wiring bug even under a coarse
 *    injected clock. Per-sample values are only asserted finite ≥ 0.
 *  - summarize returns {n,median,p95,min,max} — the ticket contract listed
 *    `mean`; it is deliberately NOT asserted (impl has min/max instead). */

let rig:HumanRig,racket:ReturnType<typeof attachRacket>;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
 racket=attachRacket(rig);
},30000);

const now=()=>performance.now();
/** The per-sample pool of a stage-loop result, tolerating both names the
 * ticket contract and the implementation use (`samples` / `perSample`). */
const perSampleOf=(r:unknown):Record<string,number[]>=>{
 const o=r as {perSample?:Record<string,number[]>;samples?:Record<string,number[]>};
 return o.perSample??o.samples??{};
};
/** Every entry finite and non-negative — the only universal timing law. */
const expectAllSane=(xs:number[],label:string)=>{
 for(const [i,v]of xs.entries()){
  expect(Number.isFinite(v),`${label}[${i}]`).toBe(true);
  expect(v,`${label}[${i}]`).toBeGreaterThanOrEqual(0);
 }
};

describe('bench stats helpers',()=>{
 it('computes the repo-convention upper-middle median',()=>{
  expect(medianOf([3,1,2])).toBe(2);
  // Upper middle s[floor(n/2)] — NOT the mean of the two middle values (2.5).
  expect(medianOf([1,2,3,4])).toBe(3);
  expect(medianOf([7])).toBe(7);
 });
 it('computes nearest-rank p95',()=>{
  expect(p95Of([1,2,3,4,5,6,7,8,9,10])).toBe(10);      // ceil(.95·10)=10 → last
  expect(p95Of(Array.from({length:20},(_,i)=>i+1))).toBe(19); // ceil(.95·20)=19 → 19th
  expect(p95Of([4])).toBe(4);
 });
 it('does not mutate its input',()=>{
  const a=[5,1,4,2,3];
  medianOf(a);p95Of(a);summarize(a);
  expect(a).toEqual([5,1,4,2,3]);
 });
 it('summarize reports n/median/p95/min/max over one sorted copy',()=>{
  const s=summarize([4,1,3,2]);
  expect(s.n).toBe(4);expect(s.median).toBe(3);expect(s.p95).toBe(4);
  expect(s.min).toBe(1);expect(s.max).toBe(4);
 });
 it('tolerates the empty array without throwing',()=>{
  // Assumption (documented, deliberately loose): impl ships finite
  // sentinels rather than NaN/throw — pinned as finite, not a value.
  expect(()=>medianOf([])).not.toThrow();
  expect(Number.isFinite(medianOf([]))).toBe(true);
  expect(Number.isFinite(p95Of([]))).toBe(true);
  const s=summarize([]);
  expect(s.n).toBe(0);
  for(const v of Object.values(s))expect(Number.isFinite(v)).toBe(true);
 });
});

describe('sampleTimes capture grid',()=>{
 it('lays a uniform 1/fps grid whose last instant is exactly duration',()=>{
  const ts=sampleTimes(1,30);
  expect(ts.length).toBe(31);                 // 30 full steps + t=0
  expect(ts[0]).toBe(0);
  expect(ts.at(-1)).toBe(1);                  // exact — the package reproduces the terminal pose
  for(let i=0;i<ts.length;i++)expect(ts[i]).toBeCloseTo(i/30,12);
 });
 it('appends the exact end when duration×fps is non-integer',()=>{
  /* Grid contract (pose-package.ts capture): uniform k/fps instants plus a
   * terminal partial interval — 1.05s @30fps gives 0…31/30 then 1.05. */
  const ts=sampleTimes(1.05,30);
  expect(ts.length).toBe(33);                 // instants 0…31/30 (32) + exact tail 1.05
  expect(ts[0]).toBe(0);
  expect(ts.at(-1)).toBe(1.05);
  expect(ts.at(-2)).toBeCloseTo(31/30,12);
  for(let i=1;i<ts.length-1;i++)expect(ts[i]-ts[i-1]).toBeCloseTo(1/30,12);
  const tail=ts.at(-1)!-ts.at(-2)!;
  expect(tail).toBeGreaterThan(0);
  expect(tail).toBeLessThan(1/30);            // the only sub-step interval
 });
 it('is strictly increasing on a sub-second document',()=>{
  const ts=sampleTimes(.8,10);
  expect(ts.length).toBe(9);
  expect(ts.at(-1)).toBe(.8);
  for(let i=1;i<ts.length;i++)expect(ts[i]).toBeGreaterThan(ts[i-1]);
 });
});

describe('buildBenchDoc',()=>{
 const spec={keys:6,duration:1.5,seed:7};
 it('builds a valid re-keyed doc on the requested grid',()=>{
  const doc=buildBenchDoc(spec,rig.rest);
  expect(doc.keys.length).toBe(6);
  expect(doc.duration).toBe(1.5);
  expect(doc.inbetweens).toBe(true);
  expect(doc.loop).toBe(false);
  expect(validateDocShape(doc)).toEqual([]);
  // bkN ids and key times t_i = i·duration/(keys−1), strictly increasing.
  expect(doc.keys.map(k=>k.id)).toEqual(['bk0','bk1','bk2','bk3','bk4','bk5']);
  expect(doc.keys[0].time).toBe(0);
  expect(doc.keys[doc.keys.length-1].time).toBeCloseTo(spec.duration,12);
  for(let i=0;i<doc.keys.length;i++)expect(doc.keys[i].time).toBeCloseTo(i*spec.duration/(spec.keys-1),12);
  for(let i=1;i<doc.keys.length;i++)expect(doc.keys[i].time).toBeGreaterThan(doc.keys[i-1].time);
 });
 it('is deterministic per seed — identical serializeDoc output',()=>{
  const a=buildBenchDoc(spec,rig.rest),b=buildBenchDoc(spec,rig.rest);
  expect(serializeDoc(a)).toBe(serializeDoc(b));
 });
 it('changes the document with the seed',()=>{
  const a=buildBenchDoc(spec,rig.rest),b=buildBenchDoc({...spec,seed:8},rig.rest);
  expect(serializeDoc(a)).not.toBe(serializeDoc(b));
 });
 it('honours inbetweens:false (the nib scenario)',()=>{
  const doc=buildBenchDoc({keys:4,duration:1,seed:3,inbetweens:false},rig.rest);
  expect(doc.inbetweens).toBe(false);
  expect(doc.keys.length).toBe(4);
  expect(validateDocShape(doc)).toEqual([]);
 });
});

describe('bench smoke — real solve path on the default document @10fps',()=>{
 const fps=10,warmup=1,reps=2;
 // The workshopMeta call pattern of quality.test.ts / measure-quality-probe.mts.
 const meta=(doc:WorkshopDoc)=>workshopMeta({motionId:'mot_bench-test',
  manifestSHA256:'test-manifest',bones:rig.bones.size,
  actionId:'workshop-doc',revision:WORKSHOP_REVISION,definitionSHA256:'test-definition',
  documentName:doc.name,prop:doc.keys.some(k=>k.constraints.grip),loop:doc.loop,
  source:'bench.test',license:'test',requestFingerprint:'test',
  fps,duration:doc.duration,keys:doc.keys.length});

 it('runStageLoop measures every known stage on the sampler grid',()=>{
  const doc=defaultDocument(rig.rest);
  const sl=runStageLoop({rig,doc,fps,warmup,reps,now});
  // The sampled instants = capture grid + authored key times (impl contract).
  const grid=sampleTimes(doc.duration,fps).length+doc.keys.length;
  const spr=(sl as {samplesPerRep?:number}).samplesPerRep??grid;
  expect(spr).toBe(grid);
  const ps=perSampleOf(sl);
  expect(Object.keys(ps).length,'a per-sample pool must exist').toBeGreaterThan(0);
  // The PR-B compiled pipeline pools every measured sample: reps×samplesPerRep.
  for(const k of ['frameAtCompiled','solveEffectiveFrame','analyzePose']){
   expect(ps[k],`perSample.${k}`).toBeInstanceOf(Array);
   expect(ps[k].length,`perSample.${k}.length`).toBe(reps*spr);
   expectAllSane(ps[k],`perSample.${k}`);
  }
  // Compat-path cross-checks are stride-subset — present, sane, never
  // longer than the pooled stages.
  for(const k of ['buildModel','frameFromModel','frameAt','samplePose']){
   expect(ps[k],`perSample.${k}`).toBeInstanceOf(Array);
   expect(ps[k].length,`perSample.${k}.length`).toBeGreaterThan(0);
   expect(ps[k].length,`perSample.${k}.length`).toBeLessThanOrEqual(reps*spr);
   expectAllSane(ps[k],`perSample.${k}`);
  }
  // Rep totals exist for the compiled stages; each sums real work → positive.
  const rt=(sl as {repTotals?:Record<string,number[]>}).repTotals??{};
  for(const k of ['compileMotion','frameAtCompiled','solveEffectiveFrame','analyzePose']){
   expect(rt[k],`repTotals.${k}`).toBeInstanceOf(Array);
   expect(rt[k].length,`repTotals.${k}.length`).toBe(reps);
   for(const v of rt[k]){
    expect(Number.isFinite(v),`repTotals.${k}`).toBe(true);
    expect(v,`repTotals.${k}`).toBeGreaterThan(0);
   }
  }
 });
 it('runWholeCalls measures rep totals for the whole calls',()=>{
  const doc=defaultDocument(rig.rest);
  const wc=runWholeCalls({rig,doc,fps,reps,warmup,now,meta:meta(doc),tip:racket});
  const totals=wc.totals as Record<string,number[]|undefined>;
  for(const k of ['solveWorkshop','probeFrames','analyzeProbeFrames','probeDocument']){
   const xs=totals[k];
   expect(xs,`totals.${k}`).toBeInstanceOf(Array);
   expect(xs!.length,`totals.${k}.length`).toBe(reps);
   for(const v of xs!){
    expect(Number.isFinite(v),`totals.${k}`).toBe(true);
    expect(v,`totals.${k}`).toBeGreaterThan(0);
   }
  }
  // The serialize stage is `stringify` in the impl, `serialize` in the
  // ticket contract — one must exist; sub-rep work stays ≥0.
  const ser=totals.stringify??totals.serialize;
  expect(ser,'a serialize/stringify stage must exist').toBeInstanceOf(Array);
  expect(ser!.length).toBe(reps);
  expectAllSane(ser!,'totals.stringify');
  expect(wc.pkgBytes,'the last rep produced a serialized package').toBeGreaterThan(0);
 });
 it('solveWorkshop lands on the package grid contract',()=>{
  const doc=defaultDocument(rig.rest);
  const pkg=solveWorkshop(rig,doc,fps,meta(doc));
  // The protocol invariant: the package reproduces the terminal pose.
  expect(pkg.timeline.timestamps.at(-1)).toBe(doc.duration);
  expect(pkg.timeline.count).toBe(pkg.timeline.timestamps.length);
  expect(pkg.timeline.fps).toBe(fps);
  expect(pkg.timeline.count).toBe(sampleTimes(doc.duration,fps).length);
  expect(pkg.tracks.translation.values.length).toBe(3*pkg.timeline.count);
 });
});

describe('stage wiring cross-check',()=>{
 it('frameAt ≈ buildModel + frameFromModel within a ×3 sanity band',()=>{
  /* Wiring check, not a perf gate: frameAt IS buildModel∘frameFromModel
   * (document.ts), so its cross-check median must sit inside a generous
   * band of the split stages' medians — catches a mis-bracketed or
   * double-built measurement, never a slow machine. */
  const doc=defaultDocument(rig.rest);
  const sl=runStageLoop({rig,doc,fps:10,warmup:1,reps:2,now});
  const ps=perSampleOf(sl);
  // Presence first — a missing stage must fail loudly, not fall through to
  // a vacuous 0 ≤ 3·0 comparison.
  expect(ps.buildModel?.length&&ps.frameFromModel?.length&&ps.frameAt?.length,
   'frameAt/buildModel/frameFromModel cross-check arrays present').toBeTruthy();
  const parts=medianOf(ps.buildModel)+medianOf(ps.frameFromModel);
  const whole=medianOf(ps.frameAt);
  expect(whole).toBeLessThanOrEqual(3*parts);
  expect(whole).toBeGreaterThanOrEqual(parts/3);
 });
});

/* ---- solve-internal profile (issue #10 PR-C) ------------------------------
 * runSolveProfile prototype-patches Object3D + HumanRig INSIDE the measured
 * window and restores in finally — the assertions below are written against
 * the landed impl's SolveProfileResult (bench.mts: samplesPerRep, solves,
 * solveUs, umwTopLevelPerSolve, umwNodeVisitsPerSolve, umwByMethod,
 * scopedReads, rigMethods, attributedUsPerSolve, residualUs,
 * pelvisDorsiCorrectionUs, heapDeltaBytes).
 *
 * IMPORTANT — counts are pinned, not ranged like timings: the counters are
 * deterministic (no clock noise), so an exact/tight pin is the honest bar and
 * a drift means the batch contract moved, not a slow machine.
 *
 * Post-C1 numbers (evidence/bench-solve-profile.json, default-5k):
 *  - the ~44 pre-C1 flush sites (reset 1 + rotate 9 + worldRotation 27 +
 *    hand 2 + relaxHand 2 + grip/final ≈ 44 syncWorld CALLS per solve) all
 *    survive as calls — solvePose wraps the whole solve in rig.batch(), so
 *    the counters see exactly ONE forced model.updateMatrixWorld(true) per
 *    solve: the batch-exit flush, attributed to 'batch' in umwByMethod.
 *    (The task contract's umw.topLevel ∈ [40,50] described the PRE-C1 count;
 *    the landed impl already batches, so the same ≈44 is pinned on
 *    rigMethods.syncWorld.calls/solve and topLevel is pinned at 1.)
 *  - umwNodeVisitsPerSolve ≈186 — every node visited once by that flush
 *    (163 bones + racket subtree + scene nodes). */
describe('solve profile (issue #10 PR-C)',()=>{
 const fps=10,reps=2;
 /* rig is assigned by the file-level beforeAll — describe bodies run at
  * collection time, BEFORE hooks, so rig.rest is touched only inside the
  * its via this helper (the file's lazy-rig convention: every sibling
  * describe dereferences rig inside it() callbacks). */
 const scenario=()=>{
  const doc=defaultDocument(rig.rest);
  return {doc,spr:sampleTimes(doc.duration,fps).length+doc.keys.length};
 };
 const profiled=['reset','rotate','worldRotation','limb','limbToWorldTargets','hand',
  'relaxHand','articulateHand','point','bone','batch','syncWorld','worldPointInto']as const;
 it('counts exactly one batch-exit full-tree flush per solve',()=>{
  const {doc,spr}=scenario();
  const pr=runSolveProfile({rig,doc,fps,now,warmup:0,reps});
  expect(pr.samplesPerRep).toBe(spr);
  expect(pr.solves).toBe(spr*reps);
  expect(pr.umwTopLevelPerSolve.length).toBe(pr.solves);
  expect(pr.umwNodeVisitsPerSolve.length).toBe(pr.solves);
  for(let i=0;i<pr.solves;i++){
   // Pre-C1 this counter read ~44 (one forced flush per syncWorld call
   // site); C1 defers every one of them to the single flush at batch exit.
   expect(pr.umwTopLevelPerSolve[i],`umwTopLevelPerSolve[${i}]`).toBe(1);
   const v=pr.umwNodeVisitsPerSolve[i];
   expect(Number.isInteger(v),`umwNodeVisitsPerSolve[${i}]`).toBe(true);
   expect(v,`umwNodeVisitsPerSolve[${i}]`).toBeGreaterThan(pr.umwTopLevelPerSolve[i]*100); // ≈186 nodes/flush
   expect(v,`umwNodeVisitsPerSolve[${i}]`).toBeLessThan(1000); // sanity cap ≈ tree size
   expect(Number.isInteger(pr.umwTopLevelPerSolve[i]),`umwTopLevelPerSolve[${i}]`).toBe(true);
  }
  // Attribution is complete AND lands entirely on 'batch' — the only
  // remaining flush site. A flush escaping attribution (or a second site)
  // shifts these totals.
  const agg=Object.values(pr.umwByMethod).reduce((s,m)=>({t:s.t+m.topLevel,v:s.v+m.nodeVisits}),{t:0,v:0});
  expect(agg.t,'Σ umwByMethod.topLevel').toBe(pr.solves);
  expect(agg.v,'Σ umwByMethod.nodeVisits').toBe(pr.umwNodeVisitsPerSolve.reduce((a,b)=>a+b,0));
  expect(pr.umwByMethod.batch?.topLevel,'umwByMethod.batch.topLevel').toBe(pr.solves);
 });
 it('counts scoped reads and profiled rig methods as non-negative integers',()=>{
  const {doc,spr}=scenario();
  const pr=runSolveProfile({rig,doc,fps,now,warmup:0,reps});
  for(const k of ['updateWorldMatrix','getWorldPosition','getWorldQuaternion','localToWorld','worldToLocal']as const){
   const c=pr.scopedReads[k]; // required key — a rename must fail here, not fall through
   expect(c,`scopedReads.${k}`).toBeDefined();
   expect(Number.isInteger(c),`scopedReads.${k}`).toBe(true);
   expect(c,`scopedReads.${k}`).toBeGreaterThanOrEqual(0);
  }
  // Inside the batch every world read self-updates its ancestor chain —
  // updateWorldMatrix dominates (≈10³/solve on this rig).
  expect(pr.scopedReads.updateWorldMatrix,'scopedReads.updateWorldMatrix').toBeGreaterThan(pr.solves*10);
  for(const n of profiled){
   const m=pr.rigMethods[n];
   expect(m,`rigMethods.${n}`).toBeDefined();
   expect(Number.isInteger(m!.calls),`rigMethods.${n}.calls`).toBe(true);
   expect(m!.calls,`rigMethods.${n}.calls`).toBeGreaterThanOrEqual(0);
   expect(Number.isFinite(m!.us),`rigMethods.${n}.us`).toBe(true);
   expect(m!.us,`rigMethods.${n}.us`).toBeGreaterThanOrEqual(0);
  }
  // The batch contract in counts: ONE batch per solve; the ~44 pre-C1
  // flush sites survive as deferred syncWorld calls.
  expect(pr.rigMethods.batch!.calls,'rigMethods.batch.calls').toBe(pr.solves);
  const swPerSolve=pr.rigMethods.syncWorld!.calls/pr.solves;
  expect(swPerSolve,'syncWorld calls/solve ≈ pre-C1 flush sites').toBeGreaterThanOrEqual(40);
  expect(swPerSolve,'syncWorld calls/solve ≈ pre-C1 flush sites').toBeLessThanOrEqual(50);
  // Timing/aggregate fields: shape only — residualUs legitimately goes
  // negative (instrumented brackets inflate solveUs; see impl disclosures).
  expect(pr.solveUs.length).toBe(pr.solves);
  expectAllSane(pr.solveUs,'solveUs');
  expect(Number.isFinite(pr.attributedUsPerSolve)).toBe(true);
  expect(pr.attributedUsPerSolve).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(pr.residualUs)).toBe(true);
  // The pelvisDorsiCorrection preamble replica runs once per instant
  // (unpatched, after restore) — not per solve.
  expect(pr.pelvisDorsiCorrectionUs.length).toBe(spr);
  expectAllSane(pr.pelvisDorsiCorrectionUs,'pelvisDorsiCorrectionUs');
  // No heapUsed injected → contractually no deltas.
  expect(pr.heapDeltaBytes).toEqual([]);
 });
 it('restores every patched prototype — no leaked instrumentation',()=>{
  const {doc}=scenario();
  const O3=Object3D.prototype;
  const o3Keys=['updateMatrixWorld','updateWorldMatrix','getWorldPosition','getWorldQuaternion','localToWorld','worldToLocal']as const;
  const o3Before=o3Keys.map(k=>O3[k]),rigBefore=profiled.map(k=>HumanRig.prototype[k]);
  runSolveProfile({rig,doc,fps,now,warmup:0,reps:1});
  o3Keys.forEach((k,i)=>expect(O3[k],`Object3D.prototype.${k}`).toBe(o3Before[i]));
  profiled.forEach((k,i)=>expect(HumanRig.prototype[k],`HumanRig.prototype.${k}`).toBe(rigBefore[i]));
 });
 it('restores prototypes even when the run throws inside the patched window',()=>{
  const orig=Object3D.prototype.updateMatrixWorld;
  let calls=0;
  /* now() #1 is the pre-solve bracket of the first measured pass (warmup:0
   * → already patched). Each profiled rig method brackets itself with 2
   * now() calls, so #5 lands inside the batch body — the throw propagates
   * through solvePose's rig.batch finally (depth unwind + exit flush) and
   * through runSolveProfile's try/finally with patches live. */
  const bomb=()=>{if(++calls===5)throw new Error('injected clock failure');return performance.now();};
  expect(()=>runSolveProfile({rig,doc:scenario().doc,fps,now:bomb,warmup:0,reps:1})).toThrow('injected clock failure');
  expect(Object3D.prototype.updateMatrixWorld).toBe(orig);
  // The rig's batch depth unwound through the failure — worldPointInto's
  // open-batch dev guard no longer fires.
  expect(()=>rig.worldPointInto('head',new Vector3())).not.toThrow();
 });
 it('runSkipFlushExperiment proves the deferred flushes are write-only',()=>{
  /* The experiment behind the batch change: stub model.updateMatrixWorld
   * to a counting no-op, replay the sampled sweep, and compare the state
   * the flushes could have influenced (every local quaternion +
   * root.position + rig.point() world reads — all local or self-updating,
   * .matrixWorld never read). Deterministic → pinned exactly. */
  const {doc,spr}=scenario();
  const r=runSkipFlushExperiment(rig,doc,fps);
  expect(r.solves).toBe(spr);
  expect(r.stubCalls).toBe(spr); // one stubbed batch-exit flush per solve
  expect(r.scalarsPerSolve).toBe(rig.bones.size*7+3); // quat4 + point3 per bone + root.position
  expect(r.compared).toBe(r.solves*r.scalarsPerSolve);
  expect(r.firstMismatch).toBeUndefined();
  expect(r.identical).toBe(true);
  // The own-property stub is removed afterwards — model falls back to the
  // (by then restored) prototype method.
  expect(Object.prototype.hasOwnProperty.call(rig.model,'updateMatrixWorld')).toBe(false);
 });
});
