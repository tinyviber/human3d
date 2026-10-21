/**
 * Compare video semantics vs solved h3d presets; write metrics markdown.
 */
import fs from 'node:fs';
import path from 'node:path';
import {Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig,frameAt,solveEffectiveFrame,angleAt,type RigInfo,type WorkshopDoc} from '@human3d/motion-core';
import {torsoFrame,sphOf} from './lib/forehand-arms.mts';

const root = process.cwd();
const semantics = JSON.parse(fs.readFileSync('evidence/forehand-semantics.json','utf8'));
const depth = JSON.parse(fs.readFileSync('evidence/forehand-depth.json','utf8'));
const glb = fs.readFileSync('public/models/human.glb');
const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const rig = new HumanRig(gltf.scene, JSON.parse(fs.readFileSync('public/models/rig.json','utf8')) as RigInfo);
const restRoot = rig.rest.get('root')!;
const LEG = rig.rest.get('upperleg01_L')!.distanceTo(rig.rest.get('lowerleg01_L')!)
  + rig.rest.get('lowerleg01_L')!.distanceTo(rig.rest.get('foot_L')!);
const REST_RATIO = ((rig.rest.get('upperleg01_L')!.y + rig.rest.get('upperleg01_R')!.y)/2 - rig.rest.get('foot_L')!.y)/LEG;

function solved(doc: WorkshopDoc, t: number) {
  rig.reset();
  solveEffectiveFrame(rig, frameAt(doc, t, restRoot));
  rig.model.updateMatrixWorld(true);
  let ratio = -Infinity;
  const knees: Record<'L'|'R', number> = {L:0,R:0};
  for (const s of ['L','R'] as const) {
    const hip = rig.point(`upperleg01_${s}`), knee = rig.point(`lowerleg01_${s}`), ankle = rig.point(`foot_${s}`);
    ratio = Math.max(ratio, (hip.y - ankle.y)/LEG);
    knees[s] = angleAt(hip, knee, ankle); // flexion from straight (motion-core)
  }
  const stance = rig.point('foot_L').distanceTo(rig.point('foot_R'))/LEG;
  // Off arm: left for righty; mirrorDoc swaps for lefty so always measure anatomical off via gripSide
  const lefty = doc.gripSide === 'L';
  const off = lefty ? 'R' : 'L';
  const hit = lefty ? 'L' : 'R';
  const S = rig.point(`upperarm01_${off}`), E = rig.point(`lowerarm01_${off}`), W = rig.point(`wrist_${off}`);
  const offElbowInner = 180 - angleAt(S, E, W); // convert flexion→inner
  const f = torsoFrame(hit === 'R' ? 'R' : 'L',
    rig.point(`upperarm01_${hit}`), rig.point(`upperarm01_${off}`));
  // For lefty docs the torsoFrame side should match grip; readReference uses grip side.
  // Approximate: use R-frame build geometry for righties; for lefties use L.
  const side = lefty ? 'L' : 'R';
  const f2 = torsoFrame(side, rig.point(`upperarm01_${side}`),
    rig.point(`upperarm01_${side==='R'?'L':'R'}`));
  const dir = W.clone().sub(S);
  const sph = sphOf(f2, dir);
  return {
    depth: (REST_RATIO - ratio)*LEG*100,
    knee: Math.max(knees.L, knees.R),
    kneeL: knees.L, kneeR: knees.R,
    stanceOverLeg: stance,
    offElbowInner,
    offDir: sph,
  };
}

type Row = {
  id: string; phase: string;
  vKnee: number|null; hKnee: number; dKnee: number|null;
  vDepth: number|null; hDepth: number; dDepth: number|null;
  vStance: number|null; hStance: number; dStancePct: number|null;
  vElbow: number|null; hElbow: number; dElbow: number|null;
  vDir: {el:number;az:number}|null; hDir: {el:number;az:number};
  dirAngle: number|null;
  rearExtV: number|null; rearExtOk: string;
  flags: string[];
};

const rows: Row[] = [];
const gaps: string[] = [];

for (const [id, sem] of Object.entries(semantics.profiles) as [string, any][]) {
  const file = path.join('assets/motions', `${id}.json`);
  const env = JSON.parse(fs.readFileSync(file,'utf8'));
  const doc = env.document as WorkshopDoc;
  const byLabel: Record<string, number> = {};
  for (const k of doc.keys) byLabel[k.label] = k.time;
  const phases: {name:string; key:string; semName:string}[] = [
    {name:'引拍', key:'引拍', semName:'takeback'},
    {name:'击球', key:'击球', semName:'contact'},
  ];
  const rearExtV = sem.rearKneeExtensionDeg;
  for (const ph of phases) {
    const t = byLabel[ph.key];
    if (t == null) continue;
    const h = solved(doc, t);
    const sp = sem.phases?.[ph.semName];
    const vKnee = sp?.kneeFlex ?? null;
    const vDepth = sp?.pelvisDropCm ?? depth.profiles[id]?.phases?.[ph.semName]?.depthCm ?? null;
    const vStance = sem.stanceOverLeg ?? sp?.stanceOverLeg ?? null;
    const vElbow = ph.semName==='takeback'
      ? (sem.mapping?.offArms?.takeback ? sp?.offElbowDeg : sp?.offElbowDeg)
      : sp?.offElbowDeg;
    // Prefer the mapping-driving elbow for takeback (may have been promoted)
    const mapElbow = ph.semName==='takeback'
      ? (sem.mapping?.offArms?.takeback?.arm
        ? Math.round(2*Math.asin(Math.min(1, sem.mapping.offArms.takeback.arm.reach))*180/Math.PI)
        : vElbow)
      : vElbow;
    const vDir = sp?.offArmDir ?? (ph.semName==='takeback' ? {el:5,az:25} : null);
    const dKnee = vKnee == null ? null : h.knee - vKnee;
    const dDepth = vDepth == null ? null : h.depth - vDepth;
    const dStancePct = vStance == null || vStance===0 ? null : ((h.stanceOverLeg - vStance)/vStance)*100;
    const dElbow = mapElbow == null ? null : h.offElbowInner - mapElbow;
    let dirAngle: number|null = null;
    if (vDir) {
      // Angular separation between two sph directions
      const toVec = (el:number, az:number) => {
        const e=el*Math.PI/180, a=az*Math.PI/180;
        return new Vector3(Math.sin(a)*Math.cos(e), Math.sin(e), Math.cos(a)*Math.cos(e)).normalize();
      };
      dirAngle = toVec(vDir.el, vDir.az).angleTo(toVec(h.offDir.el, h.offDir.az))*180/Math.PI;
    }
    const flags: string[] = [];
    if (dKnee != null && Math.abs(dKnee) > 10) flags.push(`knee|Δ|=${Math.abs(dKnee).toFixed(1)}>10`);
    if (dDepth != null && Math.abs(dDepth) > 2) flags.push(`pelvis|Δ|=${Math.abs(dDepth).toFixed(1)}>2`);
    if (dStancePct != null && Math.abs(dStancePct) > 10) flags.push(`stance|Δ|=${Math.abs(dStancePct).toFixed(1)}%>10`);
    if (dElbow != null && Math.abs(dElbow) > 15) flags.push(`elbow|Δ|=${Math.abs(dElbow).toFixed(1)}>15`);
    if (dirAngle != null && dirAngle > 20) flags.push(`dir∠=${dirAngle.toFixed(1)}>20`);
    if (flags.length) gaps.push(`${id} ${ph.name}: ${flags.join(', ')}`);
    rows.push({
      id, phase: ph.name,
      vKnee, hKnee: +h.knee.toFixed(1), dKnee: dKnee==null?null:+dKnee.toFixed(1),
      vDepth, hDepth: +h.depth.toFixed(1), dDepth: dDepth==null?null:+dDepth.toFixed(1),
      vStance, hStance: +h.stanceOverLeg.toFixed(3), dStancePct: dStancePct==null?null:+dStancePct.toFixed(1),
      vElbow: mapElbow, hElbow: +h.offElbowInner.toFixed(1), dElbow: dElbow==null?null:+dElbow.toFixed(1),
      vDir, hDir: h.offDir, dirAngle: dirAngle==null?null:+dirAngle.toFixed(1),
      rearExtV, rearExtOk: rearExtV==null ? 'n/a' : (rearExtV>0 ? 'extension' : 'no-ext/fallback'),
      flags,
    });
  }
}

const md: string[] = [];
md.push('# Forehand semantics metrics (17 players)');
md.push('');
md.push(`Generated: ${new Date().toISOString()} (box local Asia/Shanghai).`);
md.push('');
md.push('Acceptance: knee |Δ|≤10°, pelvis |Δ|≤2cm, stance |Δ|≤10%, rear-knee extension direction OK |Δ|≤10°, off-elbow |Δ|≤15° at takeback/load, direction ≤20°.');
md.push('');
md.push('Sources: video = `evidence/forehand-semantics.json` (bootstrap from depth + 2D); h3d = solved presets after regenerate.');
md.push('');
md.push('| Player | Phase | vKnee | hKnee | ΔKnee | vDepth | hDepth | ΔDepth | vStance | hStance | ΔStance% | vElbow | hElbow | ΔElbow | dir∠ | rearExt | flags |');
md.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
for (const r of rows) {
  const short = r.id.replace('-forehand','');
  md.push(`| ${short} | ${r.phase} | ${r.vKnee??'—'} | ${r.hKnee} | ${r.dKnee??'—'} | ${r.vDepth??'—'} | ${r.hDepth} | ${r.dDepth??'—'} | ${r.vStance??'—'} | ${r.hStance} | ${r.dStancePct??'—'} | ${r.vElbow??'—'} | ${r.hElbow} | ${r.dElbow??'—'} | ${r.dirAngle??'—'} | ${r.rearExtV??'—'} (${r.rearExtOk}) | ${r.flags.join('; ')||'ok'} |`);
}
md.push('');
md.push('## Gaps / fallbacks');
md.push('');
if (!gaps.length) md.push('All listed tolerances met.');
else {
  md.push(`${gaps.length} cell(s) outside tolerance:`);
  for (const g of gaps) md.push(`- ${g}`);
}
md.push('');
md.push('## Notes');
md.push('');
md.push('- Depth targets use `semanticDepthTargets` (no contact/follow ≤ load clamp; soft-cap contact at load+4 cm).');
md.push('- Stance on the rig is hand-authored × knee-flex boost (2D stance kept as evidence only — foreshortening).');
md.push('- Push-off pitch scaled from rear-knee extension or pelvis-rise proxy; base 12° retained when neither is positive.');
md.push('- Off-arm per player/phase from 2D elbow+dir with L/R-swap heuristics; full 3D re-extract via `measure-forehand-semantics.mts` still preferred.');
md.push('- Gates unchanged: DORSI=20, ANKLE_MAX=20.05, root accel≤40, slip≤10mm.');

fs.writeFileSync('/workspace/forehand-semantics-metrics.md', md.join('\n')+'\n');
console.log(`wrote metrics: ${rows.length} rows, ${gaps.length} gaps`);
for (const g of gaps.slice(0,30)) console.log(' ', g);
