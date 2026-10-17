import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {Quaternion} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from '../core/rig';
import {attachRacket} from '../core/racket';
import {motionFileById} from '../core/motion-files';
import {solveWorkshop} from '../core/pose-package';
import {WORKSHOP_REVISION,workshopMeta} from '../core/protocol';
import {defaultDocument,type WorkshopDoc} from './document';
import {formatProbeReport,probeDocument,stepAngles,PROBE_POINTS,PROBE_QUAT_BONES,type ProbeReport} from './quality-probe';

/* Quality-probe smoke + structural tests (WP-C step 1: the probe graduates
 * from an ad-hoc script into src/workshop/quality-probe.ts). This commit
 * asserts only structural facts — the report exists, every field is finite,
 * the sampling grid honours the endpoint contract, and the probe measures the
 * REAL solve path (frame parity with solveWorkshop's package). Hard quality
 * gates land in a later commit once thresholds are calibrated; the measured
 * baselines below are the before-fix record and are also frozen into
 * evidence/quality-probe-*.json.
 *
 * Baseline @240fps (this commit's solver, measured through the probe):
 *
 * defaultDocument (5-key forehand seed, 0.8s, 193 frames):
 *   bones       wrist_R 22.07 rad/s @0.600 · lowerarm02_R peak 24.50 rad/s
 *   wristClamp  bend demand max 87.7° @0.600 · clamped 48/193f (25%)
 *               deficit max 27.9° med 14.1° · transitions @0.558/0.763
 *   wrist/tip   vmax 5.90 m/s @0.733 (191 kicks) · tip 18.60 m/s @0.596 (191 kicks, 2 reversals)
 *   root        maxStep 1.10mm @0.383 · maxV 0.264 m/s · maxA 4.02 m/s² @0.008
 *   ik          reachMax 94.0% @0.475 · arm/leg residuals ~0 (<1e-15)
 *   ground      sole minY 19.21mm both feet · penetration ~0
 *   wristStep   atKey med 1.38° (n=5) vs interior 1.50° (n=187) — no key kink
 *   contact     @0.5s · tip speed 4.45 m/s
 *   spikes      root-accel-peak 4.02 m/s² (always-reported row)
 *
 * forehand envelope (49 keys, 5.2s, 1249 frames — evidence/quality-probe-forehand.json):
 *   bones       lowerarm01_R 10.5 rad/s @2.421 · wrist_R 5.4 rad/s @3.004
 *               kinks: upperarm01_R/02_R 2.2° ×4 @2.421 (keyΔ29ms)
 *   wristClamp  bend demand max 105.3° @1.817 · clamped 590/1249f (47%)
 *               deficit max ~45° med ~17° · 4 transitions @1.342/2.371/2.904/4.338
 *   wrist/tip   wrist vmax 1.60 m/s (2 kicks) · tip 4.23 m/s @3.004 (62 kicks, 1 reversal 31°@2.55)
 *   ik          arm_R residual 0.91cm @2.288 · reachMax 101.7% @2.288 · leg residual 0.00cm
 *   root        maxStep 0.52mm @2.100 · maxV 0.124 m/s · maxA 0.667 m/s² @1.958
 *   pelvis      shift 0–0 · saturated 0f      ground  sole minY 19.2mm · foot-depth 0
 *   wristStep   atKey med 0.21° (n=55) vs interior 0.21° (n=1193)
 *   chain(1.3–3.5s)  upperArm 9.0@2.163 → forearm 10.5@2.421 → hand 5.4@3.004
 *   contact     @2.55s · tip speed 0.98 m/s
 *   spikes      arm-reach-residual-R 0.91cm · root-accel-peak 0.667 m/s² */

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
  for(const sec of ['[1] foot slip','[2] 骨角速度','[3] root','[5] IK','[6] 动力链','[7] wrist_R','[8] solver checks','严重度排序'])
   expect(text).toContain(sec);
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
});
