/**
 * Forehand semantic layer: named per-player / per-phase quantities measured
 * from MediaPipe Pose worldLandmarks (+ image landmarks for visibility), then
 * mapped onto the workshop rig by the preset generator.
 *
 * Quantities (engineering Y-up after the MediaPipe +y-down flip):
 *   kneeFlexL/R°          flexion from straight (0 = straight)
 *   pelvisDropCm          hip-above-ankle drop below the standing reference
 *   stanceWidth/legLength ankle-to-ankle / median support-leg chain
 *   rearKneeExtensionDeg  rear-leg (racket-side) takeback→contact extension
 *   offElbowDeg           off-arm INNER elbow angle (180 = straight) — video convention
 *   offArmDir             {el, az} of shoulder→wrist in the torso frame (sph)
 *   offHandHeight         wrist height above off shoulder (shoulder units)
 *
 * This module is DOM-free and has no Three dependency so unit tests stay light.
 * `torsoFrame` / `sphOf` are reimplemented for the landmark point cloud (same
 * conventions as scripts/lib/forehand-arms.mts).
 */
import {
  EXTENSION_RANGE, FRAME_MARGIN, LANDMARK, LEG_LENGTH_TOLERANCE, MIN_TAKEBACK_CM, MIN_VISIBILITY,
  PRESET_KEYS, RIG_LEG_LENGTH, median, percentile, phaseDepth,
} from './forehand-depth.mts';

export const SEMANTICS_KIND = 'forehand-semantics-study';
/** Pose landmark indices beyond the depth study's leg set. */
const ARM_LANDMARK = {
  ...LANDMARK,
  leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
} as const;

export const MIN_CONFIDENCE = 0.5;
/** Generator key labels, matching forehand-depth PRESET_KEYS. */
export const SEMANTIC_PHASES = [
  'ready', 'takeback', 'drop', 'foreSwing', 'contact', 'extend', 'fold', 'follow', 'recover',
] as const;
export type SemanticPhase = typeof SEMANTIC_PHASES[number];

export type Side = 'L' | 'R';
export type Point = {x: number; y: number; z: number; visibility?: number};
export type ImagePoint = {x: number; y: number; visibility?: number};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Inner angle at b (degrees). 180 = straight. */
const innerAngle = (a: Point, b: Point, c: Point) => {
  const u = {x: a.x - b.x, y: a.y - b.y, z: a.z - b.z};
  const v = {x: c.x - b.x, y: c.y - b.y, z: c.z - b.z};
  const cosine = (u.x * v.x + u.y * v.y + u.z * v.z)
    / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z));
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
};
const outsideFrame = (point?: ImagePoint | null) =>
  !point || !(point.x > -FRAME_MARGIN && point.x < 1 + FRAME_MARGIN
    && point.y > -FRAME_MARGIN && point.y < 1 + FRAME_MARGIN);

/** MediaPipe world (+y DOWN, metres, pelvis-centred) → engineering (+y UP). */
export function toEng(p: Point): Point {
  return {x: p.x, y: -p.y, z: -p.z, visibility: p.visibility};
}

/** Torso frame matching forehand-arms.mts (right-handed build; lefties mirror later). */
export function landmarkTorsoFrame(racketShoulder: Point, offShoulder: Point) {
  const out = {x: offShoulder.x - racketShoulder.x, y: 0, z: offShoulder.z - racketShoulder.z};
  const outLen = Math.hypot(out.x, out.z) || 1e-9;
  out.x /= outLen; out.z /= outLen;
  const up = {x: 0, y: 1, z: 0};
  // front = out × up for a right-hander
  const front = {x: out.y * up.z - out.z * up.y, y: out.z * up.x - out.x * up.z, z: out.x * up.y - out.y * up.x};
  const fLen = Math.hypot(front.x, front.y, front.z) || 1e-9;
  front.x /= fLen; front.y /= fLen; front.z /= fLen;
  return {out, up, front, racketShoulder, offShoulder};
}
export function sphOfDir(f: {out: Point; up: Point; front: Point}, d: Point) {
  const len = Math.hypot(d.x, d.y, d.z) || 1e-9;
  const u = {x: d.x / len, y: d.y / len, z: d.z / len};
  const el = Math.asin(Math.max(-1, Math.min(1, u.y))) * 180 / Math.PI;
  const az = Math.atan2(
    u.x * f.out.x + u.y * f.out.y + u.z * f.out.z,
    u.x * f.front.x + u.y * f.front.y + u.z * f.front.z,
  ) * 180 / Math.PI;
  return {el: +el.toFixed(2), az: +az.toFixed(2)};
}

export interface SemanticsFrame {
  time: number;
  kneeFlexL: number | null;
  kneeFlexR: number | null;
  hipAboveAnkle: number | null;
  ratio: number | null;
  stanceWidth: number | null;
  legLength: number | null;
  stanceOverLeg: number | null;
  offElbowDeg: number | null;       // INNER, 180 = straight
  offArmDir: {el: number; az: number} | null;
  offHandHeight: number | null;     // wrist.y - shoulder.y (engineering)
  support: 'left' | 'right' | null;
  flags: string[];
  swapped?: boolean;
}

function legOf(world: Point[], image: ImagePoint[] | undefined, side: 'left' | 'right') {
  const hip = world[ARM_LANDMARK[`${side}Hip` as keyof typeof ARM_LANDMARK]];
  const knee = world[ARM_LANDMARK[`${side}Knee` as keyof typeof ARM_LANDMARK]];
  const ankle = world[ARM_LANDMARK[`${side}Ankle` as keyof typeof ARM_LANDMARK]];
  const onScreen = (name: keyof typeof ARM_LANDMARK) =>
    image ? !outsideFrame(image[ARM_LANDMARK[name]]) : true;
  const chain = distance(hip, knee) + distance(knee, ankle);
  const engHip = toEng(hip), engAnkle = toEng(ankle);
  return {
    chain,
    hipAboveAnkle: engHip.y - engAnkle.y, // +y up
    kneeFlexion: 180 - innerAngle(hip, knee, ankle), // 0 = straight
    visibility: Math.min(hip?.visibility ?? 0, knee?.visibility ?? 0, ankle?.visibility ?? 0),
    inFrame: (['Hip', 'Knee', 'Ankle'] as const).every(part =>
      onScreen(`${side}${part}` as keyof typeof ARM_LANDMARK)),
    hip, knee, ankle,
  };
}

/**
 * Detect a left/right landmark swap: when the "left" ankle sits clearly on the
 * right of the "right" ankle in image space (and vice versa) while both are
 * visible, MediaPipe has flipped the person. We correct by swapping sides.
 *
 * NOTE / LIMITATION: Tennis cross-over steps (交叉步) or closed stances may place
 * the lead ankle on the opposite side of the rear ankle in 2D image coordinates,
 * causing detectSwap to falsely trigger and invert anatomical left and right.
 * Callers on dynamic leg footwork sequences should consider temporal continuity
 * or 3D depth rather than single-frame 2D x ordering alone.
 */
export function detectSwap(image?: ImagePoint[] | null): boolean {
  if (!image) return false;
  const lA = image[ARM_LANDMARK.leftAnkle], rA = image[ARM_LANDMARK.rightAnkle];
  const lS = image[ARM_LANDMARK.leftShoulder], rS = image[ARM_LANDMARK.rightShoulder];
  if (outsideFrame(lA) || outsideFrame(rA) || outsideFrame(lS) || outsideFrame(rS)) return false;
  // Image x grows right; anatomically left shoulder has smaller x when facing camera,
  // but side-on clips reverse this. Prefer ankle ordering consistency with shoulders.
  const shoulderOrder = lS.x - rS.x;
  const ankleOrder = lA.x - rA.x;
  return shoulderOrder * ankleOrder < 0 && Math.abs(ankleOrder) > 0.02;
}

function swappedWorld(world: Point[]): Point[] {
  const out = world.slice();
  const pairs: [number, number][] = [
    [ARM_LANDMARK.leftShoulder, ARM_LANDMARK.rightShoulder],
    [ARM_LANDMARK.leftHip, ARM_LANDMARK.rightHip],
    [ARM_LANDMARK.leftKnee, ARM_LANDMARK.rightKnee],
    [ARM_LANDMARK.leftAnkle, ARM_LANDMARK.rightAnkle],
    [ARM_LANDMARK.leftHeel, ARM_LANDMARK.rightHeel],
    [ARM_LANDMARK.leftFootIndex, ARM_LANDMARK.rightFootIndex],
    [ARM_LANDMARK.leftElbow, ARM_LANDMARK.rightElbow],
    [ARM_LANDMARK.leftWrist, ARM_LANDMARK.rightWrist],
  ];
  for (const [a, b] of pairs) {
    const tmp = out[a]; out[a] = out[b]; out[b] = tmp;
  }
  return out;
}
function swappedImage(image: ImagePoint[]): ImagePoint[] {
  const out = image.slice();
  const pairs: [number, number][] = [
    [ARM_LANDMARK.leftShoulder, ARM_LANDMARK.rightShoulder],
    [ARM_LANDMARK.leftHip, ARM_LANDMARK.rightHip],
    [ARM_LANDMARK.leftKnee, ARM_LANDMARK.rightKnee],
    [ARM_LANDMARK.leftAnkle, ARM_LANDMARK.rightAnkle],
    [ARM_LANDMARK.leftHeel, ARM_LANDMARK.rightHeel],
    [ARM_LANDMARK.leftFootIndex, ARM_LANDMARK.rightFootIndex],
    [ARM_LANDMARK.leftElbow, ARM_LANDMARK.rightElbow],
    [ARM_LANDMARK.leftWrist, ARM_LANDMARK.rightWrist],
  ];
  for (const [a, b] of pairs) {
    const tmp = out[a]; out[a] = out[b]; out[b] = tmp;
  }
  return out;
}

export function readSemanticsFrame(
  worldLandmarks: Point[],
  time: number,
  imageLandmarks?: ImagePoint[] | null,
  opts: {lefty?: boolean; minConfidence?: number} = {},
): SemanticsFrame {
  const minConf = opts.minConfidence ?? MIN_CONFIDENCE;
  const lefty = opts.lefty === true;
  let world = worldLandmarks;
  let image = imageLandmarks ?? undefined;
  let swapped = false;
  if (detectSwap(image)) {
    world = swappedWorld(world);
    if (image) image = swappedImage(image);
    swapped = true;
  }
  const left = legOf(world, image, 'left');
  const right = legOf(world, image, 'right');
  const flags: string[] = [];
  if (swapped) flags.push('lr-swap-corrected');

  const support = left.hipAboveAnkle >= right.hipAboveAnkle ? 'left' : 'right';
  const supportLeg = support === 'left' ? left : right;
  if (!supportLeg.inFrame) flags.push('off-frame');
  if (supportLeg.visibility < MIN_VISIBILITY) flags.push('visibility');

  const legLength = (left.chain + right.chain) / 2;
  const stanceWidth = distance(left.ankle, right.ankle);
  const stanceOverLeg = legLength > 1e-6 ? stanceWidth / legLength : null;
  const ratio = supportLeg.chain > 1e-6 ? supportLeg.hipAboveAnkle / supportLeg.chain : null;
  if (ratio == null || !(ratio >= EXTENSION_RANGE[0] && ratio <= EXTENSION_RANGE[1])) flags.push('extension');

  // Off arm: left for right-hander, right for lefty (mirrored build still measures the video side).
  const offSide = lefty ? 'right' : 'left';
  const hitSide = lefty ? 'left' : 'right';
  const offS = world[ARM_LANDMARK[`${offSide}Shoulder` as keyof typeof ARM_LANDMARK]];
  const offE = world[ARM_LANDMARK[`${offSide}Elbow` as keyof typeof ARM_LANDMARK]];
  const offW = world[ARM_LANDMARK[`${offSide}Wrist` as keyof typeof ARM_LANDMARK]];
  const hitS = world[ARM_LANDMARK[`${hitSide}Shoulder` as keyof typeof ARM_LANDMARK]];
  const offVis = Math.min(offS?.visibility ?? 0, offE?.visibility ?? 0, offW?.visibility ?? 0);
  let offElbowDeg: number | null = null;
  let offArmDir: {el: number; az: number} | null = null;
  let offHandHeight: number | null = null;
  if (offVis >= minConf
    && (!image || (!outsideFrame(image[ARM_LANDMARK[`${offSide}Shoulder` as keyof typeof ARM_LANDMARK]])
      && !outsideFrame(image[ARM_LANDMARK[`${offSide}Wrist` as keyof typeof ARM_LANDMARK]])))) {
    offElbowDeg = +innerAngle(offS, offE, offW).toFixed(1);
    const engOffS = toEng(offS), engOffW = toEng(offW), engHitS = toEng(hitS);
    // Torso frame for a RIGHT-handed build (generator mirrors lefties at the end).
    const racketS = lefty ? engOffS : engHitS;
    const offShoulder = lefty ? engHitS : engOffS;
    const frame = landmarkTorsoFrame(racketS, offShoulder);
    const dir = {x: engOffW.x - engOffS.x, y: engOffW.y - engOffS.y, z: engOffW.z - engOffS.z};
    offArmDir = sphOfDir(frame, dir);
    const shoulderWidth = Math.hypot(engOffS.x - engHitS.x, engOffS.z - engHitS.z) || 1;
    offHandHeight = +((engOffW.y - engOffS.y) / shoulderWidth).toFixed(3);
  } else {
    flags.push('off-arm-low-conf');
  }

  return {
    time,
    kneeFlexL: left.inFrame && left.visibility >= MIN_VISIBILITY ? Math.round(left.kneeFlexion) : null,
    kneeFlexR: right.inFrame && right.visibility >= MIN_VISIBILITY ? Math.round(right.kneeFlexion) : null,
    hipAboveAnkle: supportLeg.hipAboveAnkle,
    ratio,
    stanceWidth,
    legLength,
    stanceOverLeg: stanceOverLeg == null ? null : +stanceOverLeg.toFixed(4),
    offElbowDeg,
    offArmDir,
    offHandHeight,
    support,
    flags,
    swapped,
  };
}

export interface PhaseSemantics {
  from: number; to: number; frames: number;
  kneeFlexL: number | null;
  kneeFlexR: number | null;
  kneeFlex: number | null;          // more-bent side
  pelvisDropCm: number | null;
  stanceOverLeg: number | null;
  offElbowDeg: number | null;
  offArmDir: {el: number; az: number} | null;
  offHandHeight: number | null;
  fallback: string[];
}

export interface PlayerSemantics {
  measurable: boolean;
  standingRatio: number | null;
  samples: number;
  usable: number;
  flagged: number;
  flagCounts: Record<string, number>;
  phases: Partial<Record<SemanticPhase | 'takebackDeep', PhaseSemantics | null>>;
  rearKneeExtensionDeg: number | null;
  stanceOverLeg: number | null;     // takeback median (primary stance target)
  peakKneeFlexion: number | null;
  fallback: string[];
  frames?: SemanticsFrame[];
}

function countFlags(rows: SemanticsFrame[]) {
  return rows.reduce((counts, row) => {
    for (const flag of row.flags) counts[flag] = (counts[flag] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
}

/**
 * Analyse one player's sampled semantics frames. `phases` are the five named
 * key-frame times [ready, takeback, contact, follow, recover] — same contract
 * as forehand-depth.analyzePlayer.
 */
export function analyzeSemantics(
  frames: SemanticsFrame[],
  phases: number[],
  opts: {referenceLegLength?: number; lefty?: boolean} = {},
): PlayerSemantics {
  const rows = [...frames].sort((a, b) => a.time - b.time);
  // Per-side median chain for length-tolerance filtering.
  const chains = rows.map(r => r.legLength).filter((v): v is number => v != null && v > 0);
  const refChain = opts.referenceLegLength ?? median(chains);
  for (const row of rows) {
    if (refChain && row.legLength != null
      && Math.abs(row.legLength - refChain) / refChain > LEG_LENGTH_TOLERANCE) {
      if (!row.flags.includes('leg-length')) row.flags.push('leg-length');
    }
  }
  const usable = rows.filter(row =>
    !row.flags.includes('off-frame')
    && !row.flags.includes('visibility')
    && !row.flags.includes('leg-length')
    && !row.flags.includes('extension')
    && row.ratio != null);
  if (!usable.length) {
    return {
      measurable: false, standingRatio: null, samples: rows.length, usable: 0,
      flagged: rows.length, flagCounts: countFlags(rows), phases: {},
      rearKneeExtensionDeg: null, stanceOverLeg: null, peakKneeFlexion: null,
      fallback: ['unmeasurable'], frames: rows,
    };
  }
  const standingRatio = percentile(usable.map(r => r.ratio!), 0.95)!;
  const depthCm = (ratio: number | null) =>
    ratio == null ? null : Math.round((standingRatio - ratio) * RIG_LEG_LENGTH * 1000) / 10;

  const within = (from: number, to: number) =>
    usable.filter(r => r.time >= from - 1e-9 && r.time <= to + 1e-9);

  const summarize = (from: number, to: number): PhaseSemantics | null => {
    const window = within(from, to);
    if (window.length < 3) return null;
    const kneeL = median(window.map(r => r.kneeFlexL).filter((v): v is number => v != null));
    const kneeR = median(window.map(r => r.kneeFlexR).filter((v): v is number => v != null));
    const kneeFlex = kneeL == null ? kneeR : kneeR == null ? kneeL : Math.max(kneeL, kneeR);
    const ratios = window.map(r => r.ratio!).filter(v => v != null);
    const ratio = median(ratios);
    const stance = median(window.map(r => r.stanceOverLeg).filter((v): v is number => v != null));
    const offElbow = median(window.map(r => r.offElbowDeg).filter((v): v is number => v != null));
    const offHeights = window.map(r => r.offHandHeight).filter((v): v is number => v != null);
    const dirs = window.map(r => r.offArmDir).filter((v): v is {el: number; az: number} => v != null);
    let offArmDir: {el: number; az: number} | null = null;
    if (dirs.length >= 2) {
      offArmDir = {
        el: +median(dirs.map(d => d.el))!.toFixed(2),
        az: +median(dirs.map(d => d.az))!.toFixed(2),
      };
    } else if (dirs.length === 1) offArmDir = dirs[0];
    const fallback: string[] = [];
    if (offElbow == null) fallback.push('offElbow');
    if (offArmDir == null) fallback.push('offArmDir');
    if (stance == null) fallback.push('stance');
    return {
      from: +from.toFixed(3), to: +to.toFixed(3), frames: window.length,
      kneeFlexL: kneeL == null ? null : Math.round(kneeL),
      kneeFlexR: kneeR == null ? null : Math.round(kneeR),
      kneeFlex: kneeFlex == null ? null : Math.round(kneeFlex),
      pelvisDropCm: depthCm(ratio),
      stanceOverLeg: stance == null ? null : +stance.toFixed(4),
      offElbowDeg: offElbow == null ? null : Math.round(offElbow),
      offArmDir,
      offHandHeight: offHeights.length ? +median(offHeights)!.toFixed(3) : null,
      fallback,
    };
  };

  const [ready, takeback, contact, follow, recover] = phases;
  const drop = takeback + (contact - takeback) * 0.45;
  const foreSwing = drop + (contact - drop) * 0.35;
  const extend = contact + (follow - contact) * 0.36;
  const fold = contact + (follow - contact) * 0.70;

  const phaseMap: PlayerSemantics['phases'] = {
    ready: summarize(ready - 0.4, ready + 0.4),
    takeback: summarize(takeback - 0.35, takeback + 0.35),
    takebackDeep: summarize(ready - 0.2, contact - 0.15),
    drop: summarize(drop - 0.18, drop + 0.18),
    foreSwing: summarize(foreSwing - 0.16, foreSwing + 0.16),
    contact: summarize(contact - 0.3, contact + 0.3),
    extend: summarize(extend - 0.18, extend + 0.18),
    fold: summarize(fold - 0.18, fold + 0.18),
    follow: summarize(follow - 0.4, follow + 0.4),
    recover: summarize(recover - 0.4, recover + 0.4),
  };

  // Rear-knee extension: racket-side knee flex drop from takeback → contact.
  // Righty rear = R; lefty rear = L (after swap correction the landmark sides
  // are anatomical). Always measure the SAME rear leg on both takeback and contact.
  const tb = phaseMap.takeback, ct = phaseMap.contact;
  let rearKneeExtensionDeg: number | null = null;
  const rearSideKey = opts.lefty ? 'kneeFlexL' : 'kneeFlexR';
  const tbRear = tb ? tb[rearSideKey] : null;
  const ctRear = ct ? ct[rearSideKey] : null;
  if (tbRear != null && ctRear != null) {
    rearKneeExtensionDeg = Math.round(tbRear - ctRear);
  }

  const stanceOverLeg = tb?.stanceOverLeg
    ?? phaseMap.ready?.stanceOverLeg
    ?? median(usable.map(r => r.stanceOverLeg).filter((v): v is number => v != null));

  const peakKnee = percentile(
    within(ready - 0.2, contact).map(r => Math.max(r.kneeFlexL ?? 0, r.kneeFlexR ?? 0)),
    0.98,
  );

  const fallback: string[] = [];
  if (!tb) fallback.push('takeback');
  if (!ct) fallback.push('contact');
  if (stanceOverLeg == null) fallback.push('stance');
  if (rearKneeExtensionDeg == null) fallback.push('rearKneeExtension');

  return {
    measurable: true,
    standingRatio: Math.round(standingRatio * 10000) / 10000,
    samples: rows.length,
    usable: usable.length,
    flagged: rows.length - usable.length,
    flagCounts: countFlags(rows),
    phases: phaseMap,
    rearKneeExtensionDeg,
    stanceOverLeg: stanceOverLeg == null ? null : +Number(stanceOverLeg).toFixed(4),
    peakKneeFlexion: peakKnee == null ? null : Math.round(peakKnee),
    fallback,
  };
}

/* ---- mapping onto the rig ------------------------------------------------ */

/** Rest foot half-width on the seed (m) / rig leg chain — matches generate-player-forehands. */
export const SEED_STANCE_WIDTH = 0.4;
export const SEED_STANCE_OVER_LEG = SEED_STANCE_WIDTH / RIG_LEG_LENGTH; // ≈ 0.453

/**
 * Convert a measured stanceWidth/legLength into the generator's `stance`
 * multiplier (seed foot x * stance). Clamped so a bad measurement cannot yank
 * feet under the pelvis or past the split-step extreme.
 */
export function stanceMultiplierFromWidth(
  stanceOverLeg: number | null | undefined,
  fallbackStance: number,
): {stance: number; source: 'measured' | 'fallback'; flag?: string} {
  if (stanceOverLeg == null || !(stanceOverLeg > 0.15 && stanceOverLeg < 1.2)) {
    return {stance: fallbackStance, source: 'fallback', flag: 'stance-out-of-range'};
  }
  const raw = stanceOverLeg / SEED_STANCE_OVER_LEG;
  // Keep within a band around the authored fallback so ankle/slip gates survive.
  const lo = Math.max(0.85, fallbackStance * 0.85);
  const hi = Math.min(1.55, fallbackStance * 1.55);
  const stance = Math.min(hi, Math.max(lo, raw));
  return {
    stance: Math.round(stance * 1000) / 1000,
    source: 'measured',
    flag: Math.abs(stance - raw) > 1e-9 ? 'stance-clamped-to-band' : undefined,
  };
}

/** Reference rear-knee extension (°) that corresponds to the stock 12° heel. */
export const PUSH_OFF_REF_EXTENSION_DEG = 25;
export const PUSH_OFF_BASE_PITCH = 12;

/**
 * Scale the stock heel-raise pitch by the player's measured rear-knee extension.
 * Direction must be extension (positive); a negative reading falls back to the
 * base pitch with a flag rather than inverting the push-off.
 */
export function pushOffPitchFromExtension(
  rearKneeExtensionDeg: number | null | undefined,
  opts: {pelvisRiseCm?: number | null} = {},
): {pitch: number; scale: number; source: 'measured' | 'fallback'; flag?: string} {
  let extension = rearKneeExtensionDeg;
  let flag: string | undefined;
  // When the support-side knee metric shows no extension (common: weight
  // shifts to the lead leg so "support" is no longer the rear), fall back to
  // pelvis rise takeback→contact as a proxy for the push-off.
  if (!(extension != null && extension > 0)) {
    const rise = opts.pelvisRiseCm;
    if (rise != null && rise > 1) {
      // ~8 cm rise ≈ reference 25° extension.
      extension = rise * (PUSH_OFF_REF_EXTENSION_DEG / 8);
      flag = 'push-from-pelvis-rise';
    } else {
      return {pitch: PUSH_OFF_BASE_PITCH, scale: 1, source: 'fallback',
        flag: rearKneeExtensionDeg != null && rearKneeExtensionDeg <= 0
          ? 'rear-knee-no-extension' : 'rear-knee-missing'};
    }
  }
  const scale = Math.min(1.4, Math.max(0.55, extension! / PUSH_OFF_REF_EXTENSION_DEG));
  const pitch = Math.round(PUSH_OFF_BASE_PITCH * scale * 10) / 10;
  return {pitch, scale: +scale.toFixed(3), source: 'measured', flag};
}

/**
 * Build a TorsoArm for the off hand from measured direction + inner elbow angle.
 * `reach` is derived from the inner elbow (180 = straight → reach ≈ 1).
 * Hinge points out-and-down so the elbow stays outside the chest.
 */
export function torsoArmFromOffSemantics(
  dir: {el: number; az: number} | null | undefined,
  offElbowDeg: number | null | undefined,
  fallback?: {wrist: [number, number, number]; reach: number; hinge: [number, number, number]; axis: [number, number, number]},
): {arm: {wrist: [number, number, number]; reach: number; hinge: [number, number, number]; axis: [number, number, number]}; source: 'measured' | 'fallback'; flag?: string} {
  if (!dir || offElbowDeg == null) {
    if (!fallback) throw new Error('off-arm semantics missing and no fallback provided');
    return {arm: fallback, source: 'fallback', flag: 'off-arm-unmeasured'};
  }
  // Clamp elbow to a solvable band (solver flexion ≤ 145° ⇒ inner ≥ 35°).
  const elbow = Math.min(175, Math.max(40, offElbowDeg));
  // Law of cosines on S-E-W with equal bones: reach = SW/(a+b) = sin(inner/2).
  const reachClamped = Math.min(0.99, Math.max(0.48, Math.sin((elbow * Math.PI / 180) / 2)));

  const el = dir.el * Math.PI / 180, az = dir.az * Math.PI / 180;
  // wrist unit in torso (out, up, front) — same as sph() in forehand-arms.mts
  const wrist: [number, number, number] = [
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  ];
  const n = Math.hypot(...wrist) || 1;
  wrist[0] /= n; wrist[1] /= n; wrist[2] /= n;
  // Hinge: out and down, with a touch of front so the elbow clears the ribs.
  const hinge: [number, number, number] = [0.75, -0.55, 0.35];
  const hN = Math.hypot(...hinge);
  hinge[0] /= hN; hinge[1] /= hN; hinge[2] /= hN;
  const axis: [number, number, number] = [0.4, 0.1, 0.9];
  const aN = Math.hypot(...axis);
  axis[0] /= aN; axis[1] /= aN; axis[2] /= aN;
  return {
    arm: {wrist, reach: +reachClamped.toFixed(4), hinge, axis},
    source: 'measured',
    flag: elbow !== offElbowDeg ? 'off-elbow-clamped' : undefined,
  };
}

/* ---- depth targets without the contact/follow≤load clamp ---------------- */

/**
 * Like forehand-depth.depthTargets, but contact / follow / recover use the
 * measured values instead of Math.min(load, …). Takeback still has the
 * MIN_TAKEBACK_CM floor. When a measured contact is far deeper than the
 * (floored) load, we soft-cap and record a fallback rather than blow the
 * ankle / accel gates.
 */
export function semanticDepthTargets(
  profile: {measurable?: boolean; phases?: Record<string, {depthCm?: number; frames?: number} | null>} | null | undefined,
  medians: {contact: number; follow: number; recover: number},
  opts: {maxContactAboveLoadCm?: number} = {},
): {targets: number[]; takeback: number; measuredTakeback: number; floored: boolean; fallback: string[]; capped: string[]} | null {
  if (!profile?.measurable) return null;
  const phase = (name: string) => phaseDepth(profile.phases?.[name] ?? null);
  const takeback = phase('takeback');
  if (takeback == null) return null;
  const measuredLoad = Math.max(0, takeback);
  const load = Math.max(MIN_TAKEBACK_CM, measuredLoad);
  const fallback: string[] = [];
  const capped: string[] = [];
  const read = (name: string, otherwise: number) => {
    const value = phase(name);
    if (value == null) { fallback.push(name); return Math.max(0, otherwise); }
    return Math.max(0, value);
  };
  const ready = Math.min(load, read('ready', load)); // ready still ≤ load (prep)
  let contact = read('contact', medians.contact);
  let follow = read('follow', medians.follow);
  let recover = read('recover', medians.recover);
  // Soft-cap contact that is wildly deeper than the load (Alcaraz 14.6 vs 8):
  // keep some of the measured deepen but not enough to guarantee ankle fail.
  const maxAbove = opts.maxContactAboveLoadCm ?? 4;
  if (contact > load + maxAbove) {
    contact = load + maxAbove;
    capped.push('contact');
  }
  // Recover-rise cap (same as depthTargets) to protect lead-foot slip.
  const MAX_RECOVER_RISE_CM = 3.5;
  if (follow - recover > MAX_RECOVER_RISE_CM) recover = follow - MAX_RECOVER_RISE_CM;
  // When takeback was floored, keep a mild release floor so the stance can still reach.
  if (load > measuredLoad + 1e-9) {
    const releaseFloor = Math.max(3, Math.min(load * 0.4, load));
    if (follow < releaseFloor) { follow = releaseFloor; capped.push('follow-release-floor'); }
    if (recover < Math.min(releaseFloor, load * 0.2)) {
      recover = Math.min(releaseFloor, load * 0.2);
      capped.push('recover-release-floor');
    }
  }
  const lerp = (from: number, to: number, u: number) => from + (to - from) * u;
  const targets = [
    ready, load,
    lerp(load, contact, 0.45),
    lerp(load, contact, 0.45 + 0.55 * 0.35),
    contact,
    lerp(contact, follow, 0.36),
    lerp(contact, follow, 0.70),
    follow, recover,
  ];
  if (targets.length !== PRESET_KEYS.length) throw new Error('semantic depth target arity mismatch');
  return {targets, takeback: load, measuredTakeback: measuredLoad, floored: load > measuredLoad + 1e-9, fallback, capped};
}

/**
 * Knee-flexion second target: given desired knee flex at takeback (and optional
 * contact), nudge the stance multiplier so the geometric squat gets deeper
 * knees. Purely advisory for the generator — returns a multiplicative boost
 * in [1, 1.40].
 *
 * Empirically (Felix): video knee ~52°, h3d at stance 1.12 ≈ 25–30° ≈ half.
 * Boost ≈ videoKnee / max(h3dEstimate, 1) capped.
 *
 * Deep-squat players (contact ≥ takeback) use the deeper knee so takeback AND
 * contact stay within ~10°. Extension players (contact ≪ takeback at similar
 * depth) blend toward contact so the constant-stance squat is not over-bent
 * at contact (Zverev/Medvedev/Buse).
 */
export function stanceBoostForKnee(
  videoKneeFlex: number | null | undefined,
  opts: {
    assumedH3dKneeAtFallback?: number;
    contactKneeFlex?: number | null;
    /** When contact depth ≈ takeback depth but contact knee is much straighter,
     *  this rig needs a *wider* base (not narrower) to shed knee flexion. */
    extensionNeedsWideStance?: boolean;
  } = {},
): number {
  const ct = opts.contactKneeFlex;
  let knee = videoKneeFlex;
  if (knee == null || knee < 20) {
    if (ct != null && ct >= 20) knee = ct;
    else return 1;
  }
  // Prefer the deeper of takeback/contact for deep-squat players (Alcaraz/Felix).
  if (ct != null && ct > knee) knee = ct;
  const assumed = opts.assumedH3dKneeAtFallback ?? 28;
  // Extension-at-depth (Zverev/Medvedev/Buse): video contact knee is straighter
  // at similar pelvis drop. On this rig a wider stance reduces knee flex at a
  // fixed depth, so push boost toward the cap rather than blending down.
  if (opts.extensionNeedsWideStance && ct != null && videoKneeFlex != null && ct < videoKneeFlex - 2) {
    const boost = 1.40; // max — widest safe base
    return boost;
  }
  const raw = knee / assumed;
  // Stronger compensation than v5 (0.55→0.65) and higher cap (1.35→1.40) so
  // Felix/Alcaraz takeback+contact knees clear |Δ|≤10 without relying on 2D stance.
  const boost = 1 + (Math.min(1.85, Math.max(1, raw)) - 1) * 0.65;
  return Math.round(Math.min(1.40, boost) * 1000) / 1000;
}
