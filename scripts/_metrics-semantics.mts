/**
 * Compare video semantics vs solved h3d presets; write metrics markdown.
 *
 * Three categories, each with its own denominator and only the checks it actually runs:
 *   1. solver validity (motion level): production replay scan (PoseValidityChecker, clamps,
 *      residuals) plus the receipt's served 40/60 Hz gates and peak ankle. Definite results only.
 *   2. rig target error (cell level): solved rig vs the generator's engineered targets.
 *   3. video reconstruction (cell level, 3D only): depth and knee vs the 3D depth study.
 *      2D keyframe quantities (stance ratio, off-elbow angle, arm direction) are diagnostics, not gated.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig,frameAt,solveEffectiveFrame,angleAt,type RigInfo,type WorkshopDoc} from '@human3d/motion-core';
import {torsoFrame,sphOf} from './lib/forehand-arms.mts';
import {semanticDepthTargets} from './lib/forehand-semantics.mts';
import {phaseMedians, MIN_TAKEBACK_CM} from './lib/forehand-depth.mts';
import {GATES} from './lib/forehand-gates.mts';

const root = process.cwd();
const outArg = process.env.METRICS_OUT ?? process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
const outPath = outArg ? path.resolve(outArg) : path.join(root, 'docs/reports/forehand-semantics-metrics.md');

const semantics = JSON.parse(fs.readFileSync('evidence/forehand-semantics.json','utf8'));
const depth = JSON.parse(fs.readFileSync('evidence/forehand-depth.json','utf8'));
const medians = phaseMedians(depth);
const glb = fs.readFileSync('public/models/human.glb');
const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const rig = new HumanRig(gltf.scene, JSON.parse(fs.readFileSync('public/models/rig.json','utf8')) as RigInfo);
const restRoot = rig.rest.get('root')!;
const LEG = rig.rest.get('upperleg01_L')!.distanceTo(rig.rest.get('lowerleg01_L')!)
  + rig.rest.get('lowerleg01_L')!.distanceTo(rig.rest.get('foot_L')!);
const REST_RATIO_FIXED = (
  ((rig.rest.get('upperleg01_L')!.y + rig.rest.get('upperleg01_R')!.y) / 2)
  - rig.rest.get('foot_L')!.y
) / LEG;

function solved(doc: WorkshopDoc, t: number) {
  rig.reset();
  solveEffectiveFrame(rig, frameAt(doc, t, restRoot));
  rig.model.updateMatrixWorld(true);
  let ratio = -Infinity;
  const knees: Record<'L'|'R', number> = {L:0,R:0};
  for (const s of ['L','R'] as const) {
    const hip = rig.point(`upperleg01_${s}`), knee = rig.point(`lowerleg01_${s}`), ankle = rig.point(`foot_${s}`);
    ratio = Math.max(ratio, (hip.y - ankle.y)/LEG);
    knees[s] = angleAt(hip, knee, ankle);
  }
  const stance = rig.point('foot_L').distanceTo(rig.point('foot_R'))/LEG;
  const lefty = doc.gripSide === 'L';
  const off = lefty ? 'R' : 'L';
  const S = rig.point(`upperarm01_${off}`), E = rig.point(`lowerarm01_${off}`), W = rig.point(`wrist_${off}`);
  const offElbowInner = 180 - angleAt(S, E, W);
  const side = lefty ? 'L' : 'R';
  const f2 = torsoFrame(side, rig.point(`upperarm01_${side}`),
    rig.point(`upperarm01_${side==='R'?'L':'R'}`));
  const dir = W.clone().sub(S);
  const sph = sphOf(f2, dir);
  return {
    depth: (REST_RATIO_FIXED - ratio)*LEG*100,
    knee: Math.max(knees.L, knees.R),
    kneeL: knees.L, kneeR: knees.R,
    stanceOverLeg: stance,
    offElbowInner,
    offDir: sph,
  };
}

const toVec = (el: number, az: number) => {
  const e = el * Math.PI / 180, a = az * Math.PI / 180;
  return new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).normalize();
};

type Row = {
  id: string; phase: string;
  // Category 1 is motion-level: see solverRows.
  // Category 2: Rig Target Tracking
  targetDepth: number | null;
  dDepthTgt: number | null;
  depthFloored: boolean;
  depthCapped: boolean;
  kneeTarget: number | null;
  dKneeTgt: number | null;
  mapElbow: number | null;
  dElbowTgt: number | null;
  dirAngleTgt: number | null;
  rigTargetOk: boolean;
  rigTargetGaps: string[];
  // Category 3: Raw Video Reconstruction
  vDepthRaw: number | null;
  dDepthRaw: number | null;
  vKneeRaw: number | null;
  dKneeRaw: number | null;
  vStanceRaw: number | null;
  dStanceRawPct: number | null;
  vElbowRaw: number | null;
  dElbowRaw: number | null;
  vDirRaw: {el: number; az: number} | null;
  dirAngleRaw: number | null;
  rearExtV: number | null;
  videoReconOk: boolean;
  videoReconGaps: string[];
  diag2dGaps: string[];
  // Solved values
  hDepth: number;
  hKnee: number;
  hStance: number;
  hElbow: number;
  hDir: {el: number; az: number};
};

const rows: Row[] = [];

for (const [id, sem] of Object.entries(semantics.profiles) as [string, any][]) {
  const file = path.join('assets/motions', `${id}.json`);
  const env = JSON.parse(fs.readFileSync(file,'utf8'));
  const doc = env.document as WorkshopDoc;
  const byLabel: Record<string, number> = {};
  for (const k of doc.keys) byLabel[k.label] = k.time;
  const phases: {name:string; key:string; semName:string; targetIdx: number}[] = [
    {name:'引拍', key:'引拍', semName:'takeback', targetIdx: 1},
    {name:'击球', key:'击球', semName:'contact', targetIdx: 4},
  ];
  const rearExtV = sem.rearKneeExtensionDeg;
  const depthProf = depth.profiles[id];
  const depthT = depthProf ? semanticDepthTargets(depthProf, medians) : null;

  for (const ph of phases) {
    const t = byLabel[ph.key];
    if (t == null) continue;
    const h = solved(doc, t);
    const sp = sem.phases?.[ph.semName];

    // Raw video observations
    const vKneeRaw = sp?.kneeFlex ?? null;
    const vDepthRaw = sp?.pelvisDropCm ?? depthProf?.phases?.[ph.semName]?.depthCm ?? null;
    const vStanceRaw = sp?.stanceOverLeg ?? sem.stanceOverLeg ?? null;
    const vElbowRaw = sp?.offElbowDeg ?? null;
    const vDirRaw = sp?.offArmDir ?? null;

    // Rig engineering targets (floored/capped)
    const targetDepth = depthT ? depthT.targets[ph.targetIdx] : null;
    const depthFloored = !!(depthT?.floored && ph.semName === 'takeback');
    const depthCapped = !!(depthT?.capped?.includes('contact') && ph.semName === 'contact');

    let kneeTarget = vKneeRaw;
    if (depthFloored && vKneeRaw != null) {
      kneeTarget = 45; // floored squat lands in ~40-50° band on this rig
    }
    const mapArm = ph.semName === 'takeback' ? sem.mapping?.offArms?.takeback?.arm
      : ph.semName === 'contact' ? sem.mapping?.offArms?.contact?.arm
      : null;
    const mapElbow = mapArm
      ? Math.round(2 * Math.asin(Math.min(1, mapArm.reach)) * 180 / Math.PI)
      : sp?.offElbowDeg;

    let vDirTgt: {el: number; az: number} | null = sp?.offArmDir ?? (ph.semName === 'takeback' ? {el: 5, az: 25} : null);
    if (mapArm?.wrist) {
      const [ox, uy, fz] = mapArm.wrist as [number, number, number];
      const el = Math.asin(Math.max(-1, Math.min(1, uy))) * 180 / Math.PI;
      const az = Math.atan2(ox, fz) * 180 / Math.PI;
      vDirTgt = {el: +el.toFixed(2), az: +az.toFixed(2)};
    }

    // Category 1 (solver validity) is motion-level; see solverRows.

    // 2. Category 2: Rig Target Tracking Error
    const rigTargetGaps: string[] = [];
    const dDepthTgt = targetDepth != null ? h.depth - targetDepth : null;
    if (dDepthTgt != null && Math.abs(dDepthTgt) > 2) {
      rigTargetGaps.push(`depth|Δ|=${Math.abs(dDepthTgt).toFixed(1)}>2cm vs target (${targetDepth}cm)`);
    }
    const dKneeTgt = kneeTarget != null ? h.knee - kneeTarget : null;
    if (dKneeTgt != null && Math.abs(dKneeTgt) > 10) {
      rigTargetGaps.push(`knee|Δ|=${Math.abs(dKneeTgt).toFixed(1)}>10° vs target (${kneeTarget}°)`);
    }
    const dElbowTgt = mapElbow != null ? h.offElbowInner - mapElbow : null;
    if (dElbowTgt != null && Math.abs(dElbowTgt) > 15) {
      rigTargetGaps.push(`elbow|Δ|=${Math.abs(dElbowTgt).toFixed(1)}>15° vs target (${mapElbow}°)`);
    }
    let dirAngleTgt: number | null = null;
    if (vDirTgt) {
      dirAngleTgt = toVec(vDirTgt.el, vDirTgt.az).angleTo(toVec(h.offDir.el, h.offDir.az)) * 180 / Math.PI;
      if (dirAngleTgt > 20) {
        rigTargetGaps.push(`dir∠=${dirAngleTgt.toFixed(1)}>20° vs target dir`);
      }
    }
    const rigTargetOk = rigTargetGaps.length === 0;

    // 3. Category 3 (3D only): depth and knee are 3D-vs-3D; stance, elbow and direction are 2D diagnostics.
    const videoReconGaps: string[] = [];
    const dDepthRaw = vDepthRaw != null ? h.depth - vDepthRaw : null;
    if (dDepthRaw != null && Math.abs(dDepthRaw) > 2) {
      videoReconGaps.push(`depth|Δ|=${Math.abs(dDepthRaw).toFixed(1)}>2cm vs 3D depth study (${vDepthRaw}cm)`);
    }
    const dKneeRaw = vKneeRaw != null ? h.knee - vKneeRaw : null;
    if (dKneeRaw != null && Math.abs(dKneeRaw) > 10) {
      videoReconGaps.push(`knee|Δ|=${Math.abs(dKneeRaw).toFixed(1)}>10° vs 3D depth study (${vKneeRaw}°)`);
    }
    const diag2dGaps: string[] = [];
    const dStanceRawPct = (vStanceRaw != null && vStanceRaw > 0)
      ? ((h.stanceOverLeg - vStanceRaw) / vStanceRaw) * 100
      : null;
    if (dStanceRawPct != null && Math.abs(dStanceRawPct) > 10) {
      diag2dGaps.push(`stance|Δ|=${Math.abs(dStanceRawPct).toFixed(1)}% vs 2D stance`);
    }
    const dElbowRaw = vElbowRaw != null ? h.offElbowInner - vElbowRaw : null;
    if (dElbowRaw != null && Math.abs(dElbowRaw) > 15) {
      diag2dGaps.push(`elbow|Δ|=${Math.abs(dElbowRaw).toFixed(1)}>15° vs 2D keyframe (${vElbowRaw}°)`);
    }
    let dirAngleRaw: number | null = null;
    if (vDirRaw) {
      dirAngleRaw = toVec(vDirRaw.el, vDirRaw.az).angleTo(toVec(h.offDir.el, h.offDir.az)) * 180 / Math.PI;
      if (dirAngleRaw > 20) {
        diag2dGaps.push(`dir∠=${dirAngleRaw.toFixed(1)}>20° vs 2D keyframe dir`);
      }
    }
    const videoReconOk = videoReconGaps.length === 0;

    rows.push({
      id, phase: ph.name,
      targetDepth: targetDepth == null ? null : +targetDepth.toFixed(1),
      dDepthTgt: dDepthTgt == null ? null : +dDepthTgt.toFixed(1),
      depthFloored, depthCapped,
      kneeTarget: kneeTarget == null ? null : +kneeTarget.toFixed(1),
      dKneeTgt: dKneeTgt == null ? null : +dKneeTgt.toFixed(1),
      mapElbow: mapElbow == null ? null : mapElbow,
      dElbowTgt: dElbowTgt == null ? null : +dElbowTgt.toFixed(1),
      dirAngleTgt: dirAngleTgt == null ? null : +dirAngleTgt.toFixed(1),
      rigTargetOk, rigTargetGaps,
      vDepthRaw: vDepthRaw == null ? null : +vDepthRaw.toFixed(1),
      dDepthRaw: dDepthRaw == null ? null : +dDepthRaw.toFixed(1),
      vKneeRaw: vKneeRaw == null ? null : +vKneeRaw.toFixed(1),
      dKneeRaw: dKneeRaw == null ? null : +dKneeRaw.toFixed(1),
      vStanceRaw: vStanceRaw == null ? null : +vStanceRaw.toFixed(3),
      dStanceRawPct: dStanceRawPct == null ? null : +dStanceRawPct.toFixed(1),
      vElbowRaw: vElbowRaw == null ? null : +vElbowRaw.toFixed(1),
      dElbowRaw: dElbowRaw == null ? null : +dElbowRaw.toFixed(1),
      vDirRaw,
      dirAngleRaw: dirAngleRaw == null ? null : +dirAngleRaw.toFixed(1),
      rearExtV,
      videoReconOk, videoReconGaps, diag2dGaps,
      hDepth: +h.depth.toFixed(1),
      hKnee: +h.knee.toFixed(1),
      hStance: +h.stanceOverLeg.toFixed(3),
      hElbow: +h.offElbowInner.toFixed(1),
      hDir: h.offDir,
    });
  }
}

const totalCells = rows.length;
const rigTargetPassCells = rows.filter(r => r.rigTargetOk).length;
const videoReconPassCells = rows.filter(r => r.videoReconOk).length;
const rigTargetPassRate = totalCells ? (100 * rigTargetPassCells / totalCells) : 0;
const videoReconPassRate = totalCells ? (100 * videoReconPassCells / totalCells) : 0;

// Category 1: solver validity, motion level. Checks run on the production replay path: the dense
// scan (solve, then PoseValidityChecker on the skinned mesh) and the generator receipt, which holds
// the served 40/60 Hz verdicts and the 240-sample peak ankle. Only definite results count; indeterminate
// arm–torso samples are disclosed rather than counted as crossings or as clean.
type ScanRow = {
  id: string; frames: number;
  elbowMax: {L: number; R: number}; elbowClamped: {L: number; R: number};
  residualMax: {L: number; R: number}; wristClamped: {L: number; R: number};
  crossings: {L: number; R: number}; shoulderDirFail: {L: number; R: number};
  indeterminate: number;
};
const scan = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/measure-player-forehands.mts', '16', '--json'],
  {cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
if (scan.status !== 0) throw new Error(`measure-player-forehands failed: ${scan.stderr}`);
const scanRows = JSON.parse(scan.stdout) as ScanRow[];
const scanById = new Map(scanRows.map(r => [r.id, r] as const));
const receipt = JSON.parse(fs.readFileSync('evidence/forehand-presets.json', 'utf8'));
const sideSum = (o: {L: number; R: number}) => o.L + o.R;
const solverRows = Object.keys(receipt.presets).map(id => {
  const s = scanById.get(id);
  if (!s) throw new Error(`no dense-scan row for ${id}`);
  const rec = receipt.presets[id];
  const residMm = Math.max(s.residualMax.L, s.residualMax.R) * 1000;
  const gaps: string[] = [];
  if (sideSum(s.elbowClamped)) gaps.push(`elbow clamp ${sideSum(s.elbowClamped)} samples`);
  if (sideSum(s.wristClamped)) gaps.push(`wrist-cone clamp ${sideSum(s.wristClamped)} samples`);
  if (sideSum(s.crossings)) gaps.push(`definite arm–torso crossings ${sideSum(s.crossings)}`);
  if (sideSum(s.shoulderDirFail)) gaps.push(`shoulder direction ${sideSum(s.shoulderDirFail)} samples`);
  if (residMm > GATES.wristMaxM * 1000) gaps.push(`wrist residual ${residMm.toFixed(2)} mm`);
  if (rec.ankleDeg > GATES.ankleMaxDeg) gaps.push(`ankle ${rec.ankleDeg}°`);
  for (const fps of GATES.rates) {
    const v = rec.service[String(fps)];
    if (!(v.rootAccel <= GATES.rootAccelMax)) gaps.push(`${fps} Hz root accel ${v.rootAccel}`);
    if (!(v.slipMm <= GATES.slipMaxM * 1000)) gaps.push(`${fps} Hz slip ${v.slipMm} mm`);
  }
  return {
    id, frames: s.frames, elbowMax: Math.max(s.elbowMax.L, s.elbowMax.R),
    clamped: sideSum(s.elbowClamped), wristClamped: sideSum(s.wristClamped),
    crossings: sideSum(s.crossings), shoulderDirFail: sideSum(s.shoulderDirFail),
    residMm, indeterminate: s.indeterminate, ankleDeg: rec.ankleDeg,
    root40: rec.service['40'].rootAccel, root60: rec.service['60'].rootAccel, slip40: rec.service['40'].slipMm,
    probeRoot: rec.probe240.rootAccel, ok: gaps.length === 0, gaps,
  };
});
const builtins = scanRows.filter(r => !(r.id in receipt.presets));
const solverPassCells = solverRows.filter(r => r.ok).length;
const solverTotal = solverRows.length;
const solverPassRate = solverTotal ? (100 * solverPassCells / solverTotal) : 0;
const indetFrames = solverRows.reduce((a, r) => a + r.indeterminate, 0);
const framesTotal = solverRows.reduce((a, r) => a + r.frames, 0);
const indetMin = Math.min(...solverRows.map(r => r.indeterminate));
const indetMax = Math.max(...solverRows.map(r => r.indeterminate));
const probeOver = solverRows.filter(r => r.probeRoot > GATES.rootAccelMax).length;
const probeMax = Math.max(...solverRows.map(r => r.probeRoot));
const nanCells = rows.filter(r => [r.hDepth, r.hKnee, r.hStance, r.hElbow].some(v => Number.isNaN(v))).length;
const diag2dCells = rows.filter(r => r.diag2dGaps.length > 0).length;

const md: string[] = [];
md.push('# Forehand Semantics Metrics (17 Players)');
md.push('');
md.push(`Generated: ${new Date().toISOString()} (box).`);
md.push('');
md.push('## Acceptance Summary (three categories, separate denominators)');
md.push('');
md.push('Each category passes only on the checks it actually runs.');
md.push(`1. **Solver Validity** (motion level, ${solverTotal} presets): **${solverPassCells}/${solverTotal}** pass the definite checks: elbow clamp, wrist-cone clamp, definite arm–torso crossing, shoulder direction, wrist residual ≤ ${GATES.wristMaxM * 1000} mm, ankle ≤ ${GATES.ankleMaxDeg}°, served 40/60 Hz root acceleration ≤ ${GATES.rootAccelMax} m/s² and slip ≤ ${GATES.slipMaxM * 1000} mm.`);
md.push(`   - **Not a clean pass:** ${indetFrames} of ${framesTotal} sampled frames are indeterminate (mixed shoulder/axilla skin meets the torso; ${indetMin}–${indetMax} per motion). The checker does not classify them, so this table makes no zero-contact claim for those frames.`);
md.push(`   - **Open risk, not a pass:** at the 240 Hz engineering probe, which the service never serves, ${probeOver}/${solverTotal} presets exceed ${GATES.rootAccelMax} m/s² (max ${probeMax.toFixed(1)}). Passing at 40/60 Hz does not establish smooth motion.`);
md.push(`2. **Rig Target Tracking Error** (cell level, ${totalCells} cells): **${rigTargetPassCells}/${totalCells}** pass. Solved rig vs the generator's own targets: this checks that the solver tracks what the generator asked for, not video truth.`);
md.push(`3. **Video Reconstruction Error** (3D only, ${totalCells} cells): **${videoReconPassCells}/${totalCells}** pass. Depth ≤ 2 cm and knee ≤ 10° against the 3D depth study (MediaPipe worldLandmarks).`);
md.push(`   - 2D keyframe quantities (stance ratio, off-elbow angle, arm direction) are **not gated**. The video is an uncalibrated, mixed-camera compilation, so 2D values cannot be compared with 3D rig angles. They are shown as diagnostics; ${diag2dCells}/${totalCells} cells exceed the old 2D thresholds.`);
md.push('   - The earlier basis, which included 2D criteria, gave 2/34 (5.9%). It mixed coordinate spaces and is withdrawn.');
md.push('');
md.push(`NaN in solved kinematics: ${nanCells}/${totalCells} cells.`);
md.push('');
md.push('### Engineering floors that shape the numbers');
md.push('1. **MIN_TAKEBACK_CM=8 floor**: Video MediaPipe for shallow-crouch players (e.g. Federer 5.1 cm, Cilic 4.8 cm, Tiafoe 6.1 cm) measured shallow crouching. The generator floors takeback depth to 8 cm for an athletic squat, so depth and knee diverge from raw video by design.');
md.push('2. **Heel-lift floor, 18°**: the contact heel pitch is max(semantic estimate, 18°). Every preset is bound by the floor (semantic estimates 6.6–8.4° where measured, 12° where not), so the heel lift is an engineering compensation, not a video measurement.');
md.push('3. **Off-arm clearance cap**: the off-arm reach is capped at 0.97 and directed outward to avoid chest penetration.');
md.push('');
md.push('---');
md.push('');
md.push('## 1. Category 1: Solver Validity (motion level)');
md.push('');
md.push('Source: `scripts/measure-player-forehands.mts 16 --json` (production replay: `frameAt` → `solveEffectiveFrame` → `PoseValidityChecker` on the skinned mesh; 16 uniform samples plus every key), and `evidence/forehand-presets.json` (served 40/60 Hz verdicts, 240-sample peak ankle). Indeterminate samples are shown, not counted as pass.');
md.push('');
md.push('| Player | Samples | Elbow max (°) | Elbow clamp | Wrist-cone clamp | Arm–torso crossing (definite) | Indeterminate | Shoulder dir | Wrist residual (mm) | Ankle peak (°) | Root acc 40 / 60 Hz (m/s²) | Slip 40 Hz (mm) | 240 Hz probe (m/s², open) | Status (definite checks) | Gaps |');
md.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---|');
for (const r of solverRows) {
  const probe = r.probeRoot > GATES.rootAccelMax ? `${r.probeRoot} (>36)` : `${r.probeRoot}`;
  md.push(`| ${r.id.replace('-forehand', '')} | ${r.frames} | ${r.elbowMax.toFixed(1)} | ${r.clamped} | ${r.wristClamped} | ${r.crossings} | ${r.indeterminate} | ${r.shoulderDirFail} | ${r.residMm.toFixed(2)} | ${r.ankleDeg} | ${r.root40} / ${r.root60} | ${r.slip40} | ${probe} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.gaps.length ? r.gaps.join('; ') : 'ok'} |`);
}
md.push('');
md.push(`**Solver Validity (definite checks): ${solverPassCells}/${solverTotal} (${solverPassRate.toFixed(1)}%)**`);
md.push('');
md.push(`Built-in motions in the same scan (not presets; not changed by this work): ${builtins.map(r => `${r.id}: ${sideSum(r.wristClamped)} wrist-cone clamp, ${sideSum(r.crossings)} definite crossings, ${r.indeterminate} indeterminate`).join('; ')}.`);
md.push('');
md.push('---');
md.push('');
md.push('## 2. Category 2: Rig Target Tracking Error');
md.push('');
md.push('Acceptance tolerances:');
md.push('- Pelvis depth: |Δ| ≤ 2.0 cm vs floored/capped target');
md.push('- Knee flexion: |Δ| ≤ 10.0° vs target (45° band for floored squat)');
md.push('- Off-arm elbow: |Δ| ≤ 15.0° vs mapping target');
md.push('- Off-arm direction: ∠ ≤ 20.0° vs outward mapping vector');
md.push('');
md.push(`**Rig Target Tracking Pass Rate: ${rigTargetPassCells}/${totalCells} (${rigTargetPassRate.toFixed(1)}%)**`);
md.push('');
md.push('| Player | Phase | hDepth | tgtDepth | ΔDepth | hKnee | tgtKnee | ΔKnee | hElbow | mapElbow | ΔElbow | dir∠ | Status | Gaps |');
md.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---|');
for (const r of rows) {
  const short = r.id.replace('-forehand','');
  const dD = r.dDepthTgt != null ? (r.dDepthTgt > 0 ? `+${r.dDepthTgt}` : `${r.dDepthTgt}`) : '—';
  const dK = r.dKneeTgt != null ? (r.dKneeTgt > 0 ? `+${r.dKneeTgt}` : `${r.dKneeTgt}`) : '—';
  const dE = r.dElbowTgt != null ? (r.dElbowTgt > 0 ? `+${r.dElbowTgt}` : `${r.dElbowTgt}`) : '—';
  const gaps = r.rigTargetGaps.length ? r.rigTargetGaps.join('; ') : 'ok';
  md.push(`| ${short} | ${r.phase} | ${r.hDepth} | ${r.targetDepth??'—'}${r.depthFloored?'*':''}${r.depthCapped?'†':''} | ${dD} | ${r.hKnee} | ${r.kneeTarget??'—'} | ${dK} | ${r.hElbow} | ${r.mapElbow??'—'} | ${dE} | ${r.dirAngleTgt??'—'} | ${r.rigTargetOk ? 'PASS' : 'FAIL'} | ${gaps} |`);
}
md.push('');
md.push('\\* floored depth target (MIN_TAKEBACK_CM=8). † soft-capped contact depth.');
md.push('');
if (rows.some(r => !r.rigTargetOk)) {
  md.push('### Rig Target Discrepancies');
  for (const r of rows.filter(r => !r.rigTargetOk)) {
    md.push(`- **${r.id} (${r.phase})**: ${r.rigTargetGaps.join('; ')}`);
  }
  md.push('');
}
md.push('---');
md.push('');
md.push('## 3. Category 3: Video Reconstruction (3D only)');
md.push('');
md.push('Gated (3D vs 3D): pelvis depth |Δ| ≤ 2.0 cm and knee flexion |Δ| ≤ 10.0° against the 3D depth study (`evidence/forehand-depth.json`, MediaPipe worldLandmarks, pelvis-relative, 10 Hz).');
md.push('Diagnostics only (not gated): 2D keyframe stance ratio, off-elbow angle and arm direction (`evidence/forehand-semantics.json`). The video is an uncalibrated mixed-camera compilation, so these cannot be compared with 3D rig angles.');
md.push('');
md.push(`**Video Reconstruction Pass Rate (3D): ${videoReconPassCells}/${totalCells} (${videoReconPassRate.toFixed(1)}%)**`);
md.push('');
md.push('| Player | Phase | hDepth | vDepth (3D) | ΔDepth | hKnee | vKnee (3D) | ΔKnee | Status | Gaps (3D) | 2D diagnostics (not gated) |');
md.push('|---|---|---:|---:|---:|---:|---:|---:|:---:|---|---|');
const signed = (v: number | null) => v == null ? '—' : (v > 0 ? `+${v}` : `${v}`);
for (const r of rows) {
  const short = r.id.replace('-forehand', '');
  const gaps3d = r.videoReconGaps.length ? r.videoReconGaps.join('; ') : 'ok';
  const diag = r.diag2dGaps.length ? r.diag2dGaps.join('; ') : '—';
  md.push(`| ${short} | ${r.phase} | ${r.hDepth} | ${r.vDepthRaw ?? '—'} | ${signed(r.dDepthRaw)} | ${r.hKnee} | ${r.vKneeRaw ?? '—'} | ${signed(r.dKneeRaw)} | ${r.videoReconOk ? 'PASS' : 'GAP'} | ${gaps3d} | ${diag} |`);
}
md.push('');
md.push('### Notable 3D divergences');
for (const r of rows.filter(r => !r.videoReconOk)) {
  md.push(`- **${r.id} (${r.phase})**: ${r.videoReconGaps.join('; ')}`);
}
md.push('');
fs.mkdirSync(path.dirname(outPath), {recursive: true});
fs.writeFileSync(outPath, md.join('\n') + '\n');
console.log(`wrote metrics to ${path.relative(root, outPath)}`);
console.log(`  1. Solver validity (motion): ${solverPassCells}/${solverTotal} (${solverPassRate.toFixed(1)}%)`);
console.log(`  2. Rig target tracking:   ${rigTargetPassCells}/${totalCells} (${rigTargetPassRate.toFixed(1)}%)`);
console.log(`  3. Video reconstruction (3D): ${videoReconPassCells}/${totalCells} (${videoReconPassRate.toFixed(1)}%)`);
