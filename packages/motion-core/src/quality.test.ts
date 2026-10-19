import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from './rig';
import {attachRacket} from './racket';
import {motionFileById} from './motion-files';
import {solveWorkshop} from './pose-package';
import {WORKSHOP_REVISION,workshopMeta} from './protocol';
import {defaultDocument,type WorkshopDoc} from './document';
import {analyzeProbeFrames,formatProbeReport,probeDocument,stepAngles,PROBE_POINTS,PROBE_QUAT_BONES,
 type ProbeFrame,type ProbeReport} from './quality-probe';

/* Quality-probe smoke + structural tests (WP-C step 1: the probe graduates
 * from an ad-hoc script into packages/motion-core/src/quality-probe.ts). This commit
 * asserts only structural facts — the report exists, every field is finite,
 * the sampling grid honours the endpoint contract, and the probe measures the
 * REAL solve path (frame parity with solveWorkshop's package). Hard quality
 * gates land in a later commit once thresholds are calibrated; the baselines
 * below are measured through the probe and frozen into
 * evidence/quality-probe-*.json.
 *
 * Baseline @240fps (post-WP-C solver — tangent clamp κ=2 + hand-frame SO(3)
 * cubic active; the pre-fix record and measurements are in
 * docs/history/investigate.md WP-C). The hand squad removed the per-segment slerp's
 * C⁰ angular-velocity jumps at keys: forehand tip kicks 62→26 (the at-key
 * subset 44→9), defaultDocument's worst single-frame tip Δv 10.26→4.87 m/s
 * and wristStep at-key median 1.38°→0.17°. defaultDocument's kick COUNT is
 * floor-bound — a 0.8 s swing whose tip legitimately moves ~24 m/s leaves
 * |Δv|>0.1 m/s almost every frame.
 *
 * defaultDocument (5-key forehand seed, 0.8s, 193 frames):
 *   bones       wrist_R 31.2 rad/s @0.600 · lowerarm02_R peak 30.5 rad/s
 *               (channel-chain 'hand' peak 31.2 rad/s — shared key tangents
 *               carry real angular speed through keys instead of slerp's
 *               restart; still inside the 40 rad/s semantic gate)
 *   wristClamp  bend demand max 92.03° @0.600 · clamped 46/193f (23.8%)
 *               deficit max ~32° med ~13° · transitions @0.5625/0.7542
 *   wrist/tip   vmax 6.02 m/s @0.579 (191 kicks) · tip 24.19 m/s @0.596 (191 kicks)
 *               tip accelTop 1169 m/s² @0.563 keyΔ63ms (was 2463 @0.500 keyΔ0ms)
 *   root        maxStep 1.17mm @0.367 · maxV 0.282 m/s · maxA 4.46 m/s² @0.221
 *   ik          reachMax 92.7% @0.496 · arm/leg residuals ~0
 *   ground      sole minY 19.2mm both feet · penetration ~0
 *   wristStep   atKey med 0.17° (n=5) vs interior 1.47° (n=187) — key kink gone
 *   contact     @0.5s · tip speed 2.21 m/s
 *   spikes      root-accel-peak 4.46 m/s² (always-reported row)
 *
 * forehand envelope (49 keys, 5.2s, 1249 frames — evidence/quality-probe-forehand.json):
 *   bones       upperarm01_R/02_R 11.4 rad/s @2.163 · lowerarm01_R/02_R 10.5 @2.421
 *               wrist_R 5.9 rad/s @2.163
 *               kinks: upperarm01_R/02_R 2.7° ×4 @2.421 (keyΔ29ms)
 *   wristClamp  bend demand max 105.7° @1.808 · clamped 589/1249f (47%)
 *               deficit max ~46° med ~17° · 4 transitions @1.342/2.371/2.904/4.333
 *   wrist/tip   wrist vmax 1.60 m/s @2.104 (2 kicks) · tip 4.25 m/s @2.971 (26 kicks, 1 reversal)
 *   ik          arm_R residual 0.91cm @2.288 · reachMax 101.7% @2.288 · leg residual 0.00cm
 *   root        maxStep 0.52mm @2.100 · maxV 0.124 m/s · maxA 0.67 m/s² @1.958
 *   pelvis      shift 0–0 · saturated 0f      ground  sole minY 19.2mm · foot-depth 0
 *   wristStep   atKey med 0.21° (n=55) vs interior 0.21° (n=1193)
 *   chain(1.3–3.5s)  upperArm 11.4@2.163 → forearm 10.5@2.421 → hand 5.9@2.163
 *   contact     @2.55s · tip speed 1.01 m/s
 *   spikes      arm-reach-residual-R 0.91cm · root-accel-peak 0.67 m/s² */

let rig:HumanRig,racket:ReturnType<typeof attachRacket>;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
 racket=attachRacket(rig);
},30000);

/** Collect every non-finite number anywhere in the report (frames included). */
const finiteProblems=(v:unknown,path:string,out:string[])=>{
 if(typeof v==='number'){if(!Number.isFinite(v))out.push(path);return;}
 if(Array.isArray(v)){v.forEach((x,i)=>finiteProblems(x,`${path}[${i}]`,out));return;}
 if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v))finiteProblems(x,`${path}.${k}`,out);return;}
 if(v!==null&&typeof v!=='string'&&typeof v!=='boolean'&&v!==undefined)out.push(`${path}(${String(v)})`);
};
const expectFinite=(r:ProbeReport)=>{const bad:string[]=[];finiteProblems(r,'report',bad);expect(bad).toEqual([]);};

describe('quality probe',()=>{
 it('produces a finite, correctly-gridded report on the default document',()=>{
  const doc=defaultDocument(rig.rest);
  const r=probeDocument(rig,doc,{fps:240,tip:racket});
  expectFinite(r);
  // Grid contract: 0.8s × 240fps = 192 steps +1, uniform, last t === duration.
  expect(r.frameCount).toBe(193);expect(r.frames.length).toBe(193);
  expect(r.frames[0].t).toBe(0);expect(r.frames[193-1].t).toBe(doc.duration);
  for(let i=0;i<r.frames.length;i++)expect(r.frames[i].t).toBeCloseTo(Math.min(doc.duration,i/240),12);
  // Capture coverage: every frame carries the tracked bones and points.
  for(const b of PROBE_QUAT_BONES)expect(r.frames[0].quat[b],b).toBeDefined();
  for(const p of PROBE_POINTS)expect(r.frames[0].pos[p],p).toBeDefined();
  // The seeded doc is planted throughout → one [0,duration] interval per foot.
  expect(r.supportIntervals).toEqual([{side:'L',from:0,to:.8},{side:'R',from:0,to:.8}]);
  expect(r.footSlip.map(s=>s.samples)).toEqual([193,193]);
  expect(r.bones.length).toBe(PROBE_QUAT_BONES.length);
  expect(r.chain.length).toBe(6);
  // Wrist-step split covers every inter-frame step exactly once.
  expect(r.wristStep.atKeyCount+r.wristStep.interiorCount).toBe(192);
  // Spikes arrive severity-sorted; every spike time lies inside the motion.
  for(let i=1;i<r.spikes.length;i++)expect(r.spikes[i].value).toBeLessThanOrEqual(r.spikes[i-1].value);
  for(const s of r.spikes){expect(s.t).toBeGreaterThanOrEqual(0);expect(s.t).toBeLessThanOrEqual(doc.duration);}
  // The contact-flagged key surfaces with a finite tip speed.
  expect(r.contact.time).toBe(doc.keys.filter(k=>k.constraints.contact).at(-1)!.time);
  expect(r.contact.tipSpeed).not.toBeNull();
  // The formatted report renders the same sections the calibration CLI prints.
  const text=formatProbeReport(r);
  expect(text).toContain(`${r.name} @ 240fps · 193 frames · 5 keys · 0.8s`);
  for(const sec of ['[1] foot slip','[2] 骨角速度 / 角加速度','[3] root','[5] IK','[6] 动力链','[7] wrist_R','[8] solver checks','严重度排序'])
   expect(text).toContain(sec);
 });
 it('measures vector angular acceleration on the exact partial-tail timestamps',()=>{
  const doc=defaultDocument(rig.rest);doc.duration=.83;doc.keys.at(-1)!.time=doc.duration;
  const sampled=probeDocument(rig,doc,{fps:37,tip:racket});
  const frames=JSON.parse(JSON.stringify(sampled.frames)) as ProbeFrame[];
  const angularVelocity=.4,angularAcceleration=1.7;
  for(const frame of frames){
   const angle=angularVelocity*frame.t+.5*angularAcceleration*frame.t*frame.t;
   const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),angle);
   frame.quat.root=[q.x,q.y,q.z,q.w];
  }
  const report=analyzeProbeFrames({doc,fps:37,frames,rest:rig.rest});
  const root=report.bones.find(b=>b.bone==='root')!;
  expect(frames.at(-1)!.t).toBe(doc.duration);
  expect(root.peakAlpha).toBeCloseTo(angularAcceleration,6);
  expect(root.alphaT).toBeGreaterThan(0);expect(root.alphaT).toBeLessThan(doc.duration);
 });
 it('produces a finite report on the bundled forehand envelope',()=>{
  const doc=motionFileById('forehand')!.document!;
  const r=probeDocument(rig,doc,{fps:240,tip:racket,name:'forehand',activeWindow:[1.3,3.5]});
  expectFinite(r);
  expect(r.frameCount).toBe(1249);
  expect(r.frames[1249-1].t).toBe(doc.duration);
  expect(r.activeWindow).toEqual([1.3,3.5]);
  // Chain peaks inside the active window must be reported inside it.
  for(const c of r.chain)expect(c.activePeak===0||(c.activeT>=1.3&&c.activeT<=3.5)).toBe(true);
  expect(r.contact.time).toBe(doc.keys.filter(k=>k.constraints.contact).at(-1)!.time);
  expect(formatProbeReport(r)).toContain('=== forehand @ 240fps · 1249 frames · 49 keys · 5.2s');
 });
 it('samples the real solve path — every frame agrees with the solveWorkshop package',()=>{
  // A doc whose duration is NOT a multiple of 1/fps exercises the non-integer
  // grid: the probe must land on the package's exact-endpoint timestamps.
  const docs:WorkshopDoc[]=[defaultDocument(rig.rest),motionFileById('forehand')!.document!];
  docs[0].duration=.83;
  for(const doc of docs){
   const fps=40;
   const meta=workshopMeta({motionId:'mot_probe-parity',manifestSHA256:'test-manifest',bones:rig.bones.size,
    actionId:'workshop-doc',revision:WORKSHOP_REVISION,definitionSHA256:'test-definition',
    documentName:doc.name,prop:doc.keys.some(k=>k.constraints.grip),loop:doc.loop,
    source:'quality.test',license:'test',requestFingerprint:'test',
    fps,duration:doc.duration,keys:doc.keys.length});
   const pkg=solveWorkshop(rig,doc,fps,meta);
   const rep=probeDocument(rig,doc,{fps,tip:racket});
   expect(rep.frameCount).toBe(pkg.timeline.count);
   expect(rep.frames[rep.frames.length-1].t).toBe(doc.duration);
   const tr=pkg.tracks.translation.values;
   const rotByBone=new Map(pkg.tracks.rotations.map(t=>[t.bone,t.values]));
   // Rebuild each frame's world rotation from the package's local tracks —
   // the package's own FK contract (rest local translations are identities,
   // so local-quat products reproduce the solved world orientations).
   const localQ=(name:string,i:number)=>{
    const v=rotByBone.get(name);
    return v?new Quaternion(v[i*4],v[i*4+1],v[i*4+2],v[i*4+3]):new Quaternion();
   };
   const worldQ=(name:string,i:number):Quaternion=>{
    const p=rig.bone(name).parent;
    const pq=p&&rig.bones.get(p.name)===p?worldQ(p.name,i):new Quaternion();
    return pq.multiply(localQ(name,i));
   };
   for(let i=0;i<pkg.timeline.count;i++){
    const f=rep.frames[i];
    expect(f.t).toBeCloseTo(pkg.timeline.timestamps[i],12);
    for(const [c,idx]of [[0,0],[1,1],[2,2]]as const)expect(f.root[c]).toBeCloseTo(tr[i*3+idx],10);
    for(const bone of ['root','wrist_R','lowerarm01_R','foot_L']){
     const got=new Quaternion(...f.quat[bone]);
     expect(worldQ(bone,i).angleTo(got),`${doc.id} ${bone} @${i}`).toBeLessThan(1e-5);
    }
   }
  }
 });
 it('fixes the quaternion hemisphere before measuring step angles',()=>{
  // Same rotation, flipped sign → step 0; then a real 90° turn → π/2.
  const h=Math.SQRT1_2;
  const steps=stepAngles([[0,0,0,1],[0,0,-0,-1],[0,0,h,h]]);
  expect(steps[0]).toBe(0);expect(steps[1]).toBe(0);expect(steps[2]).toBeCloseTo(Math.PI/2,9);
 });
 it('keeps the WP-C hand-squad kick reductions through the real solve path',()=>{
  // 前 per-segment slerp → 现 SO(3) cubic,同一份探针、同一台机器上量得:
  //   forehand  tip kicks 62 → 26(其中键时刻 ±20ms 内 44 → 9)
  //   default   tip kicks 191 → 191(0.8s 挥拍 tip ~24m/s,|Δv|>0.1 是物理下限,
  //             真正消失的是键时刻 C0:atKey 步长中位 1.38°→0.17°,最差单帧
  //             tip Δv 10.26→4.87 m/s, accelTop 2463→1169 m/s²)
  const fh=probeDocument(rig,motionFileById('forehand')!.document!,{fps:240,tip:racket,name:'forehand',activeWindow:[1.3,3.5]});
  expect(fh.tip!.kicks).toBeLessThan(40); // measured 26 (pre-squad 62)
  const d=probeDocument(rig,defaultDocument(rig.rest),{fps:240,tip:racket});
  expect(d.wristStep.atKeyMedian).toBeLessThan(d.wristStep.interiorMedian/2); // 0.17° vs 1.47° (was 1.38° vs 1.50°)
  expect(d.tip!.accelTop[0].a).toBeLessThan(1500); // measured 1169 (pre-squad 2463, at keyΔ0ms)
  expect(d.tip!.kicks).toBeLessThanOrEqual(191); // floor-bound: no regression
 });
});

describe('forehand-study fixture — WP-C acceptance quality gates',()=>{
 /* The UI-authored five-key forehand study in
  * spec/examples/forehand-study.request.json (ledger: forehand-study.md).
  * Gates below are hard assertions on the shared probe; threshold comments
  * record the value measured on THIS fixture @240fps and the ×1.25 ceiling /
  * ÷1.25 floor rule the ticket requires (measured values in
  * evidence/forehand-study/rounds.jsonl tag `final-240`, 60fps corroboration
  * in tag `final-60`).
  *
  * 验收边界：本 fixture 只证几何/平滑/接触约束达标，不证明符合真实网球
  * 正手运动学——已知残余（tip kick、峰领先触球、近端→远端时序）的口径
  * 与容差在 spec/examples/forehand-study.md「验收边界」一节写明。 */
 const study=()=>JSON.parse(fs.readFileSync('spec/examples/forehand-study.request.json','utf8'))
  .action.parameters.document as WorkshopDoc;
 it('holds every hard physical invariant at 240fps',()=>{
  const r=probeDocument(rig,study(),{fps:240,tip:racket,name:'forehand-study'});
  expectFinite(r);
  // Structure: 5 keys, one contact flag, both feet planted the whole time.
  expect(r.keyCount).toBe(5);
  expect(r.supportIntervals).toEqual([{side:'L',from:0,to:2},{side:'R',from:0,to:2}]);
  expect(r.contact.time).toBe(1.15);
  // Wrist clamp: demand stays inside the 59.8° limit and the clamp never
  // fires. Measured 48.2° @0.787s → gate 55° keeps ~14% margin below limit.
  expect(r.wristClamp.clampedFrames).toBe(0);
  expect(r.wristClamp.maxBend).toBeLessThan(55);
  // IK/ground exactness — all measured residuals are ~1e-16 (solver exact);
  // the 1 mm gate only absorbs float noise.
  expect(r.ik.armResidual.v).toBeLessThan(0.003);   // budget <3mm, measured 0
  expect(r.ik.legResidual.v).toBeLessThan(0.003);    // measured 0
  expect(r.ik.reachMax.r).toBeLessThan(1);           // measured 94.3% — never saturated
  for(const s of r.footSlip)expect(s.maxResidual).toBeLessThan(1e-3); // measured ~4e-16
  expect(r.sole.penetration.L).toBeLessThan(1e-6);
  expect(r.sole.penetration.R).toBeLessThan(1e-6);
  // Ankle dorsiflexion is the binding constraint the pelvis-shift correction
  // enforces at the 20° limit — it may sit ON the limit, never over.
  expect(r.solverChecks['ankle-dorsiflexion-L'].v).toBeLessThanOrEqual(20.1); // measured 19.6
  expect(r.solverChecks['ankle-dorsiflexion-R'].v).toBeLessThanOrEqual(20.1); // measured 20.0
  expect(r.pelvis.saturatedFrames).toBe(0);
  // Root stays quiet: measured maxA 12.56 m/s² → ceiling 16 (×1.25 → 15.7 → 16);
  // measured maxStep 1.27 mm → 1.6 mm.
  expect(r.root.maxA).toBeLessThan(16);
  expect(r.root.maxStep).toBeLessThan(1.6e-3);
 });
 it('shows a fast contact-zone racket tip — the forehand actually whips',()=>{
  const r=probeDocument(rig,study(),{fps:240,tip:racket,name:'forehand-study'});
  // Speed floors (÷1.25 of measured, rounded): tip at the contact key
  // measured 3.79 m/s → floor 3.0; overall peak measured 8.94 m/s → floor 7.0.
  // The idle package's ~1 m/s at contact is the anti-example this rules out.
  expect(r.contact.tipSpeed!).toBeGreaterThan(3.0);
  expect(r.tip!.vmax).toBeGreaterThan(7.0);
  // The peak belongs to the swing, not a stray frame: measured vpeakT 0.983 s
  // vs contact key 1.15 s (peak leads contact 0.17 s — the racket decelerates
  // into the hit, as a real forehand does). Gate |Δt| ≤ 0.25 s.
  expect(Math.abs(r.tip!.vpeakT-r.contact.time!)).toBeLessThanOrEqual(0.25);
  // Kick ceilings: measured tip 136 → 170, wrist 7 → 9 (×1.25, rounded up).
  // tip kicks are the documented residual of a genuine 9 m/s whip — see the
  // ledger; the gate exists to catch regressions, not to claim kicks are zero.
  expect(r.tip!.kicks).toBeLessThanOrEqual(170);
  expect(r.wrist.kicks).toBeLessThanOrEqual(9);
  // Kinetic chain: proximal segments peak before the distal forearm
  // (pelvis 0.971 s · trunk 0.971 s → forearm 1.212 s; the hand's 0.988 s
  // interleave is recorded in the ledger, not gated).
  const peak=(seg:string)=>r.chain.find(c=>c.seg===seg)!.relT;
  expect(peak('pelvis')).toBeLessThanOrEqual(peak('forearm')+0.05);
  expect(peak('trunk')).toBeLessThanOrEqual(peak('forearm')+0.05);
 });
 it('agrees with itself at 60fps — gates are not sampling-rate artifacts',()=>{
  const r=probeDocument(rig,study(),{fps:60,tip:racket,name:'forehand-study'});
  expectFinite(r);
  expect(r.frameCount).toBe(121); // 2 s × 60 + 1
  expect(r.wristClamp.clampedFrames).toBe(0);
  expect(r.wristClamp.maxBend).toBeLessThan(55);
  expect(r.ik.armResidual.v).toBeLessThan(0.003);
  for(const s of r.footSlip)expect(s.maxResidual).toBeLessThan(1e-3);
  expect(r.contact.tipSpeed!).toBeGreaterThan(3.0); // measured 4.04 @60fps
  expect(r.tip!.vmax).toBeGreaterThan(7.0);         // measured 8.91 @60fps
 });
});
