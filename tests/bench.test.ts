import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig,attachRacket,defaultDocument,sampleTimes,serializeDoc,solveWorkshop,
 validateDocShape,workshopMeta,WORKSHOP_REVISION,type WorkshopDoc} from '@human3d/motion-core';
import {buildBenchDoc,medianOf,p95Of,runStageLoop,runWholeCalls,summarize} from '../scripts/lib/bench.mts';

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
