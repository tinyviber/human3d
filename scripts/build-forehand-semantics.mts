/**
 * Build evidence/forehand-semantics.json from existing depth study + 2D
 * landmarks (bootstrap), or merge a video re-extract over the top.
 *
 *   npx tsx scripts/build-forehand-semantics.mts [--write]
 *
 * Full video re-extract (preferred when overnight budget allows):
 *   npx tsx scripts/measure-forehand-semantics.mts --all --write
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {median} from './lib/forehand-depth.mts';
import {
  SEMANTICS_KIND, pushOffPitchFromExtension, stanceBoostForKnee,
  stanceMultiplierFromWidth, torsoArmFromOffSemantics,
} from './lib/forehand-semantics.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const depth = JSON.parse(fs.readFileSync(path.join(root, 'evidence/forehand-depth.json'), 'utf8'));
const landmarks = JSON.parse(fs.readFileSync(path.join(root, 'scripts/player-forehand-landmarks.json'), 'utf8'));

type Joint = {x: number; y: number; confidence: number};
type Frame2d = {time: number; joints: Record<string, Joint>};

const inner2d = (a: Joint, b: Joint, c: Joint) => {
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (n < 1e-9) return null;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n))) * 180 / Math.PI;
};

/** Map the 5 landmark frames → ready/takeback/contact/follow/recover. */
const PHASE_IDX = {ready: 0, takeback: 1, contact: 2, follow: 3, recover: 4} as const;


/** Pick the best off-arm reading across a set of frame indices.
 *  Prefers high-confidence near-straight elbows for the load window (video
 *  takeback is 136–179°); rejects <70° as likely L/R swap residue. */
function bestOffFrom2d(frames: Frame2d[], indices: number[], lefty: boolean, prefer: 'straight' | 'bent' = 'straight') {
  const offS = lefty ? 'rightShoulder' : 'leftShoulder';
  const offE = lefty ? 'rightElbow' : 'leftElbow';
  const offW = lefty ? 'rightWrist' : 'leftWrist';
  const hitS = lefty ? 'leftShoulder' : 'rightShoulder';
  type Cand = {offElbowDeg: number; offArmDir: {el: number; az: number}; offHandHeight: number; conf: number; time: number};
  const cands: Cand[] = [];
  for (const idx of indices) {
    const fr = frames[idx]; if (!fr) continue;
    const j = fr.joints;
    const conf = Math.min(j[offS]?.confidence ?? 0, j[offE]?.confidence ?? 0, j[offW]?.confidence ?? 0);
    if (conf < 0.35) continue;
    const elbow = inner2d(j[offS], j[offE], j[offW]);
    if (elbow == null || elbow < (prefer === 'bent' ? 35 : 70)) continue; // swap residue on load only
    if ((j[hitS]?.confidence ?? 0) < 0.3) continue;
    const dx = j[offW].x - j[offS].x;
    const dy = -(j[offW].y - j[offS].y);
    const outSign = (j[offS].x - j[hitS].x) >= 0 ? 1 : -1;
    const horiz = Math.max(Math.abs(dx), 1e-6);
    const el = Math.min(35, Math.max(-25, Math.atan2(dy, horiz) * 180 / Math.PI));
    const sh = Math.abs(j[offS].x - j[hitS].x) || 0.05;
    const az = Math.min(70, Math.max(-40, Math.atan2(dx * outSign, Math.max(0.05, sh * 0.55)) * 180 / Math.PI));
    const shoulderSpan = Math.abs((j.leftHip?.y ?? j[offS].y + 0.2) - j[offS].y) || 0.2;
    const offHandHeight = +(((-(j[offW].y - j[offS].y)) / shoulderSpan)).toFixed(3);
    cands.push({offElbowDeg: Math.round(elbow), offArmDir: {el: +el.toFixed(2), az: +az.toFixed(2)}, offHandHeight, conf, time: fr.time});
  }
  if (!cands.length) return {offElbowDeg: null, offArmDir: null, offHandHeight: null, flags: ['off-arm-unmeasured'] as string[]};
  cands.sort((a, b) => prefer === 'straight'
    ? (b.offElbowDeg - a.offElbowDeg) || (b.conf - a.conf)
    : (a.offElbowDeg - b.offElbowDeg) || (b.conf - a.conf));
  const best = cands[0];
  return {offElbowDeg: best.offElbowDeg, offArmDir: best.offArmDir, offHandHeight: best.offHandHeight, flags: [`off-from-2d@${best.time}`]};
}

function offFrom2d(frames: Frame2d[], phase: keyof typeof PHASE_IDX, lefty: boolean) {
  // Use each phase's own frame strictly — no cross-stage pollution!
  const prefer = (phase === 'contact' || phase === 'follow' || phase === 'recover') ? 'bent' : 'straight';
  return bestOffFrom2d(frames, [PHASE_IDX[phase]], lefty, prefer);
}

function stanceFrom2d(frames: Frame2d[], phase: keyof typeof PHASE_IDX) {
  const fr = frames[PHASE_IDX[phase]];
  if (!fr) return null;
  const j = fr.joints;
  const need = ['leftAnkle', 'rightAnkle', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee'];
  if (need.some(n => (j[n]?.confidence ?? 0) < 0.3)) return null;
  const sw = Math.hypot(j.leftAnkle.x - j.rightAnkle.x, j.leftAnkle.y - j.rightAnkle.y);
  const leg = (side: 'left' | 'right') =>
    Math.hypot(j[`${side}Hip`].x - j[`${side}Knee`].x, j[`${side}Hip`].y - j[`${side}Knee`].y)
    + Math.hypot(j[`${side}Knee`].x - j[`${side}Ankle`].x, j[`${side}Knee`].y - j[`${side}Ankle`].y);
  const chain = (leg('left') + leg('right')) / 2;
  if (!(chain > 1e-6)) return null;
  const ratio = sw / chain;
  // 2D foreshortening compresses stance; reject extremes.
  if (!(ratio > 0.12 && ratio < 1.1)) return null;
  return +ratio.toFixed(4);
}

const handStance: Record<string, number> = {
  'novak-djokovic-forehand': 1.14, 'roger-federer-forehand': 1.02, 'carlos-alcaraz-forehand': 1.12,
  'alexander-zverev-forehand': 1.06, 'daniil-medvedev-forehand': 1.1, 'ben-shelton-forehand': 1.1,
  'alexander-bublik-forehand': 1.01, 'frances-tiafoe-forehand': 1.15, 'holger-rune-forehand': 1.07,
  'alex-de-minaur-forehand': 1.01, 'alejandro-davidovich-fokina-forehand': 1.16,
  'flavio-cobolli-forehand': 1.05, 'marin-cilic-forehand': 1.08, 'karen-khachanov-forehand': 1.14,
  'jakub-mensik-forehand': 1.11, 'ignacio-buse-forehand': 1.04, 'felix-auger-aliassime-forehand': 1.12,
};

const profiles: Record<string, unknown> = {};
for (const [id, depthProf] of Object.entries(depth.profiles) as [string, any][]) {
  const lm = landmarks.profiles[id];
  const lefty = id.includes('shelton');
  const frames: Frame2d[] = lm?.frames ?? [];
  const fallback: string[] = ['bootstrap-from-depth-and-2d'];
  const phaseOut: Record<string, unknown> = {};
  for (const name of ['ready', 'takeback', 'contact', 'follow', 'recover'] as const) {
    const d = depthProf.phases?.[name];
    const off = offFrom2d(frames, name, lefty);
    const stance2d = stanceFrom2d(frames, name);
    if (!d || d.frames < 3) {
      phaseOut[name] = null;
      fallback.push(`${name}-depth`);
      continue;
    }
    // Per-side knee measurement from 3D depth study frames:
    // When support === 'left', f.kneeFlexion is left knee. When support === 'right', it is right knee.
    const phaseFrames = (depthProf.frames || []).filter(
      (f: any) => f.time >= d.from - 1e-6 && f.time <= d.to + 1e-6 && (!f.flags || f.flags.length === 0)
    );
    const leftKnees = phaseFrames.filter((f: any) => f.support === 'left').map((f: any) => f.kneeFlexion);
    const rightKnees = phaseFrames.filter((f: any) => f.support === 'right').map((f: any) => f.kneeFlexion);
    const kneeFlexL = leftKnees.length >= 2 ? Math.round(median(leftKnees)) : null;
    const kneeFlexR = rightKnees.length >= 2 ? Math.round(median(rightKnees)) : null;
    const kneeFlex = (kneeFlexL != null && kneeFlexR != null)
      ? Math.max(kneeFlexL, kneeFlexR)
      : (kneeFlexL ?? kneeFlexR ?? d.kneeFlexion ?? null);

    phaseOut[name] = {
      from: d.from, to: d.to, frames: d.frames,
      kneeFlexL,
      kneeFlexR,
      kneeFlex,
      pelvisDropCm: d.depthCm ?? null,
      stanceOverLeg: stance2d,
      offElbowDeg: off.offElbowDeg,
      offArmDir: off.offArmDir,
      offHandHeight: off.offHandHeight,
      fallback: [
        ...(stance2d == null ? ['stance-2d'] : []),
        ...(kneeFlexL == null ? ['knee-flex-L-unmeasured'] : []),
        ...(kneeFlexR == null ? ['knee-flex-R-unmeasured'] : []),
        ...off.flags,
      ],
      source: 'depth+2d-bootstrap',
    };
  }
  // Intermediate keys: borrow neighbours (generator interpolates depth; semantics for off-arm).
  const borrow = (a: string, b: string, w: number) => {
    const A = phaseOut[a] as any, B = phaseOut[b] as any;
    if (!A && !B) return null;
    if (!A) return B; if (!B) return A;
    const lerp = (x: number | null, y: number | null) =>
      x == null ? y : y == null ? x : Math.round((x + (y - x) * w) * 10) / 10;
    return {
      from: A.to, to: B.from, frames: Math.min(A.frames, B.frames),
      kneeFlexL: lerp(A.kneeFlexL, B.kneeFlexL),
      kneeFlexR: lerp(A.kneeFlexR, B.kneeFlexR),
      kneeFlex: lerp(A.kneeFlex, B.kneeFlex),
      pelvisDropCm: lerp(A.pelvisDropCm, B.pelvisDropCm),
      stanceOverLeg: A.stanceOverLeg ?? B.stanceOverLeg,
      offElbowDeg: lerp(A.offElbowDeg, B.offElbowDeg),
      offArmDir: A.offArmDir && B.offArmDir ? {
        el: +(A.offArmDir.el + (B.offArmDir.el - A.offArmDir.el) * w).toFixed(2),
        az: +(A.offArmDir.az + (B.offArmDir.az - A.offArmDir.az) * w).toFixed(2),
      } : (A.offArmDir ?? B.offArmDir),
      offHandHeight: lerp(A.offHandHeight, B.offHandHeight),
      fallback: ['interpolated'],
      source: 'interpolated',
    };
  };
  phaseOut.drop = borrow('takeback', 'contact', 0.45);
  phaseOut.foreSwing = borrow('takeback', 'contact', 0.45 + 0.55 * 0.35);
  phaseOut.extend = borrow('contact', 'follow', 0.36);
  phaseOut.fold = borrow('contact', 'follow', 0.70);

  const tb = phaseOut.takeback as any;
  const ct = phaseOut.contact = phaseOut.contact as any;
  // Rear leg is strictly the racket side: right leg for righty, left leg for lefty.
  // Both takeback and contact MUST be measured on this same rear leg side.
  const rearSide = lefty ? 'left' : 'right';
  const tbRear = rearSide === 'left' ? tb?.kneeFlexL : tb?.kneeFlexR;
  const ctRear = rearSide === 'left' ? ct?.kneeFlexL : ct?.kneeFlexR;
  const rearKneeExtensionDeg = (tbRear != null && ctRear != null)
    ? Math.round(tbRear - ctRear)
    : null;
  if (rearKneeExtensionDeg == null) fallback.push('rearKneeExtension');

  // Stance: 2D ankle ratios are heavily foreshortened — keep them as evidence
  // only. Drive the rig stance from the hand-authored fallback × knee boost so
  // deeper video knees get a wider base without trusting a single 2D frame.
  const stanceOverLeg = tb?.stanceOverLeg ?? (phaseOut.ready as any)?.stanceOverLeg ?? null;
  const hand = handStance[id] ?? 1.1;
  // Extension-at-depth: contact depth within 1 cm of (floored) takeback depth
  // but contact knee ≥8° straighter → need wide stance to shed knee flex.
  const tbDepth = tb?.pelvisDropCm, ctDepth = ct?.pelvisDropCm;
  const loadFloor = Math.max(8, tbDepth ?? 0); // MIN_TAKEBACK_CM
  const extensionNeedsWideStance = (
    tb?.kneeFlex != null && ct?.kneeFlex != null
    && ct.kneeFlex < tb.kneeFlex - 3
    && ctDepth != null
    && Math.abs(ctDepth - loadFloor) <= 1.5
  );
  const stanceBoost = stanceBoostForKnee(tb?.kneeFlex, {
    contactKneeFlex: ct?.kneeFlex,
    extensionNeedsWideStance,
  });
  const stanceMap = stanceMultiplierFromWidth(null, hand); // force hand fallback
  // Cap raised so deep-squat / extension-at-depth players can clear |Δknee|≤10.
  let stance = Math.min(1.58, Math.max(0.95, hand * stanceBoost));
  // Extension-at-depth needs the wide end of the band even when hand×boost is mid.
  if (extensionNeedsWideStance) stance = Math.min(1.58, Math.max(stance, 1.56));
  const pelvisRise = (tb?.pelvisDropCm != null && ct?.pelvisDropCm != null)
    ? tb.pelvisDropCm - ct.pelvisDropCm : null;
  const push = pushOffPitchFromExtension(rearKneeExtensionDeg, {pelvisRiseCm: pelvisRise});

  // Materialise off-arm torso coeffs for takeback / drop / contact.
  const offFallback = {
    takeback: {wrist: [0.15, 0.05, 0.99] as [number, number, number], reach: 0.96,
      hinge: [0.75, -0.55, 0.35] as [number, number, number], axis: [0.4, 0.1, 0.9] as [number, number, number]},
    drop: {wrist: [-0.20, -0.05, 0.98] as [number, number, number], reach: 0.94,
      hinge: [0.75, -0.55, 0.35] as [number, number, number], axis: [0.4, 0.1, 0.9] as [number, number, number]},
    contact: {wrist: [-0.30, -0.15, 0.94] as [number, number, number], reach: 0.80,
      hinge: [0.85, -0.40, 0.25] as [number, number, number], axis: [0.35, 0.08, 0.93] as [number, number, number]},
  };
  // Prefer near-straight takeback when 2d is missing (video consensus 136–179°).
  let takeOffElbow = tb?.offElbowDeg ?? 155;
  let takeOffDir = tb?.offArmDir ?? {el: 5, az: 25};

  // Video consensus at takeback is near-straight (136–179°). A 2D reading
  // below 120° is almost always occlusion/swap noise — lift to the floor.
  // Also force an *outward* direction: az≤10 (or negative) with a near-straight
  // reach drives the wrist through the chest (Medvedev/ADF pose-validity).
  if (takeOffElbow < 120) {
    takeOffElbow = 150;
    takeOffDir = {
      el: Math.max(takeOffDir?.el ?? 0, 5),
      az: (takeOffDir?.az ?? 0) > 10 ? takeOffDir.az : 25,
    };
    fallback.push('takeback-off-straight-floor');
  }
  // Sanitize cross-body takeback dirs even when elbow was already "straight"
  // enough to skip the floor (Alcaraz az≈−2 with reach 0.97 grazes ribs).
  if (takeOffDir && takeOffDir.az < 10) {
    takeOffDir = {el: Math.max(takeOffDir.el, 0), az: 25};
    fallback.push('takeback-off-outward-dir');
  }
  const dropPhase = phaseOut.drop as any;
  const dropOffElbow = dropPhase?.offElbowDeg ?? takeOffElbow;
  const dropOffDir = dropPhase?.offArmDir ?? takeOffDir;
  // Contact: retract when video shows bent; otherwise a mild tuck from takeback.
  let contactOffElbow = ct?.offElbowDeg ?? Math.min(takeOffElbow, 110);
  let contactOffDir = ct?.offArmDir ?? {el: -10, az: -15};
  if (contactOffElbow >= takeOffElbow - 5 && takeOffElbow >= 130) {
    // Same straight reading reused — force a tuck so we don't stay extended.
    contactOffElbow = Math.min(110, takeOffElbow - 40);
    contactOffDir = {el: -8, az: -10};
    fallback.push('contact-off-tuck-heuristic');
  }

  const offArms = {
    takeback: torsoArmFromOffSemantics(takeOffDir, takeOffElbow, offFallback.takeback),
    drop: torsoArmFromOffSemantics(dropOffDir, dropOffElbow, offFallback.drop),
    contact: torsoArmFromOffSemantics(contactOffDir, contactOffElbow, offFallback.contact),
  };

  profiles[id] = {
    name: depthProf.name, video: depthProf.video, lefty,
    measurable: !!depthProf.measurable,
    source: 'bootstrap-depth-2d',
    standingRatio: depthProf.standingRatio ?? null,
    samples: depthProf.samples ?? 0,
    usable: depthProf.usable ?? 0,
    flagged: depthProf.flagged ?? 0,
    phases: phaseOut,
    rearKneeExtensionDeg,
    stanceOverLeg,
    peakKneeFlexion: depthProf.peakKneeFlexion ?? tb?.kneeFlex ?? null,
    mapping: {
      stance: +stance.toFixed(3),
      stanceSource: 'hand-times-knee-boost',
      stanceBoost,
      handStanceFallback: hand,
      pushOffPitch: push.pitch,
      pushOffScale: push.scale,
      pushOffSource: push.source,
      pushOffFlag: push.flag,
      offArms: {
        takeback: {reach: offArms.takeback.arm.reach, source: offArms.takeback.source, flag: offArms.takeback.flag, arm: offArms.takeback.arm},
        drop: {reach: offArms.drop.arm.reach, source: offArms.drop.source, flag: offArms.drop.flag, arm: offArms.drop.arm},
        contact: {reach: offArms.contact.arm.reach, source: offArms.contact.source, flag: offArms.contact.flag, arm: offArms.contact.arm},
      },
    },
    fallback,
  };
}

const report = {
  schemaVersion: 1,
  kind: SEMANTICS_KIND,
  method: 'bootstrap from evidence/forehand-depth.json phases + scripts/player-forehand-landmarks.json 2D (confidence≥0.45, L/R-swap heuristic); full 3D re-extract via measure-forehand-semantics.mts preferred',
  generated: new Date().toISOString().slice(0, 10),
  profiles,
};
const outPath = path.join(root, 'evidence/forehand-semantics.json');
if (write) {
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`wrote ${path.relative(root, outPath)} (${Object.keys(profiles).length} profiles)`);
} else {
  console.log(JSON.stringify({kind: report.kind, players: Object.keys(profiles).length, sample: profiles['felix-auger-aliassime-forehand']}, null, 2));
}
