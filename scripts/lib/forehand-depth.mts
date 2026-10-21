/**
 * Pure analysis for the forehand lower-body depth study.
 *
 * MediaPipe Pose Landmarker `worldLandmarks` put the pelvis midpoint at the
 * origin, with **+y pointing DOWN** and units in metres. An absolute hip
 * height therefore cannot be read off the landmark; only hip height above the
 * support foot can. That quantity is also the one the rig can reproduce, so
 * every figure below is expressed that way.
 *
 * The monocular world fit is noisy frame to frame (the model has no metric
 * scale anchor), so the estimator is deliberately conservative: frames are
 * flagged for low visibility, implausible leg-segment length and impossible
 * extension; the remaining frames are median-smoothed over ±0.3 s; and each
 * phase is summarised by a median (or a low percentile for the "deepest"
 * figure). Per-player depth targets quote the uncertainty band that remains
 * after that filtering.
 *
 * This module has no DOM dependency; it is imported by the browser extraction
 * page (through the bundled page code) and by the Node-side report script.
 */

/** Landmark indices used by the study (MediaPipe Pose, 33 points). */
export const LANDMARK = {
  leftShoulder: 11, rightShoulder: 12,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28, leftHeel: 29, rightHeel: 30,
  leftFootIndex: 31, rightFootIndex: 32,
};

/** Rest leg chain of the production rig (`upperleg01_R` → `foot_R`: 0.43746 m
 * thigh + 0.44522 m shank), used to convert the dimensionless hip-above-ankle
 * ratio into centimetres. The ratio's denominator is the same chain, so the
 * conversion is the rig's own geometry, not a body-size guess. */
export const RIG_LEG_LENGTH = 0.8827;

/** Support-side sampling window for the rolling median (seconds, half-width). */
export const SMOOTH_WINDOW_S = 0.3;
/** A frame whose support-leg chain differs from the player's median by more
 * than this fraction is a tracking scale error, not a crouch. */
export const LEG_LENGTH_TOLERANCE = 0.08;
/** Visibility below this marks the support leg as occluded. */
export const MIN_VISIBILITY = 0.3;
/** Image-space margin inside [0,1] that a landmark must clear for its world
 * coordinate to be trusted. MediaPipe keeps producing world coordinates for
 * clipped points by fitting the visible segment, so a foot that leaves the
 * image is still reported — with a plausible-looking ratio. Those frames are
 * not measurements of the leg and must be dropped. */
export const FRAME_MARGIN = 0.01;
/** Plausible range for hip-above-support-ankle over leg length. */
export const EXTENSION_RANGE = [0.5, 1.06];

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angleAt = (a, b, c) => {
  const u = {x: a.x - b.x, y: a.y - b.y, z: a.z - b.z};
  const v = {x: c.x - b.x, y: c.y - b.y, z: c.z - b.z};
  const cosine = (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z));
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
};
/** True when a normalized-image landmark lies outside the frame (MediaPipe
 * reports clipped points at the border, so the margin is small). */
const outsideFrame = (point) =>
  !point || !(point.x > -FRAME_MARGIN && point.x < 1 + FRAME_MARGIN &&
    point.y > -FRAME_MARGIN && point.y < 1 + FRAME_MARGIN);

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Nearest-rank percentile (p in [0,1]); the sample is small enough that
 * interpolation would suggest a precision the tracker does not have. */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** One frame of world landmarks → per-leg geometry, support side, and raw ratio.
 * Pass the matching normalized-image landmarks too: world coordinates are
 * extrapolated for points that left the frame, and only the image tells us. */
export function readFrame(worldLandmarks, time, imageLandmarks) {
  const at = name => worldLandmarks[LANDMARK[name]];
  const onScreen = name => imageLandmarks ? !outsideFrame(imageLandmarks[LANDMARK[name]]) : true;
  const legs = {};
  for (const side of ['left', 'right']) {
    const hip = at(`${side}Hip`), knee = at(`${side}Knee`), ankle = at(`${side}Ankle`);
    const heel = at(`${side}Heel`), toe = at(`${side}FootIndex`);
    const chain = distance(hip, knee) + distance(knee, ankle);
    legs[side] = {
      chain,
      /** Metres from the ankle up to the hip (world +y is down, so this is a
       * sign flip, not an absolute height). */
      hipAboveAnkle: ankle.y - hip.y,
      kneeFlexion: 180 - angleAt(hip, knee, ankle),
      /** Only the three points the ratio is built from; the toes may leave the
       * frame without affecting a hip-above-ankle measurement. */
      visibility: Math.min(...[hip, knee, ankle].map(point => point?.visibility ?? 0)),
      inFrame: ['Hip', 'Knee', 'Ankle'].every(part => onScreen(`${side}${part}`)),
    };
  }
  // The lower ankle carries the load; ties resolve to the more visible side.
  const support = legs.left.hipAboveAnkle > legs.right.hipAboveAnkle ? 'left' : 'right';
  return {time, legs, support};
}

/**
 * Analyse one player's sampled frames.
 *
 * @param frames  `readFrame` rows for one source clip (any order, 0.1–0.2 s apart).
 * @param phases  named timestamps that label the swing: ready, takeback, contact, follow, recover.
 * @returns per-phase depth (cm below the standing reference), knee flexion, the
 *          standing reference, and the frames that were discarded as anomalous.
 *
 * Besides the five named phases, the four intermediate key instants the
 * generator places between them are measured too, using the same timing
 * fractions (`drop`, `foreSwing`, `extend`, `fold`), so every authored key can
 * take its lower-body height from the video instead of a shared template.
 */
export function analyzePlayer(frames, phases) {
  const rows = [...frames].sort((a, b) => a.time - b.time);
  const supportChain = side => median(rows.filter(row => row.support === side).map(row => row.legs[side].chain));
  const reference = {left: supportChain('left'), right: supportChain('right')};

  for (const row of rows) {
    const leg = row.legs[row.support];
    row.ratio = leg.hipAboveAnkle / leg.chain;
    row.kneeFlexion = leg.kneeFlexion;
    row.flags = [];
    if (!leg.inFrame) row.flags.push('off-frame');
    if (leg.visibility < MIN_VISIBILITY) row.flags.push('visibility');
    const medianChain = reference[row.support];
    if (!medianChain || Math.abs(leg.chain - medianChain) / medianChain > LEG_LENGTH_TOLERANCE) row.flags.push('leg-length');
    if (!(row.ratio >= EXTENSION_RANGE[0] && row.ratio <= EXTENSION_RANGE[1])) row.flags.push('extension');
  }
  // A single-frame tracking jump: the hip height snaps away from both
  // neighbours. Caught after the raw flags so a jump is not smoothed in.
  for (let i = 1; i < rows.length - 1; i++) {
    const before = rows[i - 1], after = rows[i + 1];
    const neighbours = (before.legs[before.support].hipAboveAnkle + after.legs[after.support].hipAboveAnkle) / 2;
    if (Math.abs(rows[i].legs[rows[i].support].hipAboveAnkle - neighbours) > 0.05) rows[i].flags.push('tracking-jump');
  }
  for (const row of rows) {
    const window = rows.filter(other => !other.flags.length && Math.abs(other.time - row.time) <= SMOOTH_WINDOW_S + 1e-9);
    row.smoothedRatio = median(window.map(other => other.ratio));
    row.smoothedKnee = median(window.map(other => other.kneeFlexion));
  }
  // Smoothing fills a value for every row with nearby clean neighbours, but
  // flagged source frames are not observations. Keep them out of every
  // statistic and minimum-frame count even when an interpolated value exists.
  const usable = rows.filter(row => !row.flags.length && row.smoothedRatio != null);
  if (!usable.length) {
    return {
      standingRatio: null, samples: rows.length, usable: 0, flagged: rows.length,
      flagCounts: countFlags(rows), measurable: false,
      phases: {ready: null, takeback: null, takebackDeep: null, contact: null, follow: null, recover: null},
      peakKneeFlexion: null,
      frames: rows.map(exportRow),
    };
  }

  // Standing reference: the tallest 5 % of usable frames. Frames are dropped
  // rather than averaged so one over-lifted outlier cannot raise the baseline.
  const standingRatio = percentile(usable.map(row => row.smoothedRatio), 0.95);
  const standing = standingCheck(rows.filter(row => !row.flags.length), standingRatio);
  const depthCm = ratio => ratio == null ? null : Math.round((standingRatio - ratio) * RIG_LEG_LENGTH * 1000) / 10;

  const within = (from, to) => usable.filter(row => row.time >= from - 1e-9 && row.time <= to + 1e-9);
  const summary = (from, to, pick) => {
    const window = within(from, to);
    if (window.length < 3) return null;
    const ratio = pick(window.map(row => row.smoothedRatio));
    return {
      from: +from.toFixed(3), to: +to.toFixed(3), frames: window.length,
      ratio: Math.round(ratio * 10000) / 10000,
      depthCm: depthCm(ratio),
      kneeFlexion: Math.round(median(window.map(row => row.smoothedKnee))),
    };
  };
  const mid = (from, to) => summary(from, to, median);
  const deep = (from, to) => summary(from, to, values => percentile(values, 0.10));

  const [ready, takeback, contact, follow, recover] = phases;
  /** Key fractions inside the swing, matching the generator's own placement
   * (`buildDoc`): 落拍 at 45 % of 引拍→击球, 前挥 at 35 % of 落拍→击球,
   * 延伸 at 36 % and 折肘 at 70 % of 击球→随挥. */
  const drop = takeback + (contact - takeback) * 0.45;
  const foreSwing = drop + (contact - drop) * 0.35;
  const extend = contact + (follow - contact) * 0.36;
  const fold = contact + (follow - contact) * 0.70;
  return {
    standingRatio: Math.round(standingRatio * 10000) / 10000,
    standing,
    samples: rows.length,
    usable: usable.length,
    flagged: rows.length - usable.length,
    measurable: true,
    flagCounts: countFlags(rows),
    phases: {
      ready: mid(ready - 0.4, ready + 0.4),
      takeback: mid(takeback - 0.35, takeback + 0.35),
      takebackDeep: deep(ready - 0.2, contact - 0.15),
      contact: mid(contact - 0.3, contact + 0.3),
      follow: mid(follow - 0.4, follow + 0.4),
      recover: mid(recover - 0.4, recover + 0.4),
    },
    /** The eight preset keys (templates use 0.16–0.20 s half-windows; keys
     * closer than that to a named phase borrow its value instead). */
    keys: {
      ready: mid(ready - 0.4, ready + 0.4),
      takeback: mid(takeback - 0.35, takeback + 0.35),
      drop: mid(drop - 0.18, drop + 0.18),
      foreSwing: mid(foreSwing - 0.16, foreSwing + 0.16),
      contact: mid(contact - 0.3, contact + 0.3),
      extend: mid(extend - 0.18, extend + 0.18),
      fold: mid(fold - 0.18, fold + 0.18),
      follow: mid(follow - 0.4, follow + 0.4),
      recover: mid(recover - 0.4, recover + 0.4),
    },
    /** Peak knee flexion across the load (ready → contact). */
    peakKneeFlexion: Math.round(percentile(within(ready - 0.2, contact).map(row => row.smoothedKnee), 0.98)),
    frames: rows.map(exportRow),
  };
}

/** Unit and axis check on the clip's most upright unflagged frame (the raw
 * frame closest to the standing reference). If +y were not down, hip-above-
 * ankle would be negative; if units were not metres, an upright leg's chain
 * would not be adult-sized and the knee would not read near-straight. */
export const STANDING_CHAIN_RANGE = [0.6, 1.1];
export const STANDING_MAX_KNEE = 35;
export function standingCheck(clean, standingRatio) {
  if (!clean.length) return null;
  const frame = clean.reduce((best, row) =>
    Math.abs(row.ratio - standingRatio) < Math.abs(best.ratio - standingRatio) ? row : best);
  const leg = frame.legs[frame.support];
  return {
    time: frame.time,
    hipAboveAnkleM: Math.round(leg.hipAboveAnkle * 1000) / 1000,
    chainM: Math.round(leg.chain * 1000) / 1000,
    kneeFlexion: Math.round(leg.kneeFlexion),
    verticalDown: leg.hipAboveAnkle > 0,
    metres: leg.chain >= STANDING_CHAIN_RANGE[0] && leg.chain <= STANDING_CHAIN_RANGE[1],
    upright: leg.kneeFlexion <= STANDING_MAX_KNEE,
  };
}

/* ---- preset depth targets ------------------------------------------------
 * Shared by the preset generator and its regression test, so the test checks
 * the generated presets against the same derivation, not a copy of it. */

/** A phase summary with fewer than 3 usable frames is not a measurement. */
export function phaseDepth(phase) {
  return phase && phase.frames >= 3 ? phase.depthCm : null;
}
/** Median of the contact / follow / recover phases over every measurable
 * profile: the fallback when one player's window was lost (feet off-frame). */
export function phaseMedians(study) {
  return Object.fromEntries(['contact', 'follow', 'recover'].map(name => {
    const values = Object.values(study.profiles).filter(p => p.measurable)
      .map(p => phaseDepth(p.phases[name])).filter(v => v != null).map(v => Math.max(0, v));
    return [name, median(values) ?? 0];
  }));
}
/** Generator key labels, in order, matching the timing fractions below. */
export const PRESET_KEYS = ['准备', '引拍', '落拍', '前挥', '击球', '延伸', '折肘', '随挥', '恢复'];
/**
 * Per-key depth targets (cm) for one preset, or null when the clip cannot be
 * measured. The five named phases are the study's robust medians (0.6–0.8 s
 * windows); the four intermediate keys are interpolated between them with the
 * generator's own timing fractions, because a ±0.2 s window on a fast swing
 * is too short for a per-key figure to survive the off-frame and
 * support-switch filters (those medians swing from −0.4× to +2× the takeback
 * across players).
 *
 * Every key clamps to [0, takeback]: a negative median only means the stance
 * read taller than the standing reference, and a phase deeper than the load
 * (Khachanov's 17.8 cm split-step landing at 准备, Alcaraz's 14.6 cm contact
 * with the feet at the image edge) is not modelled. A lost phase window takes
 * the cross-player median for that phase, never the takeback: inheriting the
 * load kept the whole finish crouched and overshot the rear ankle at the
 * follow-through release.
 */
export function depthTargets(profile, medians) {
  if (!profile?.measurable) return null;
  const phase = name => phaseDepth(profile.phases[name]);
  const takeback = phase('takeback');
  if (takeback == null) return null;
  const load = Math.max(0, takeback);
  const fallback = [];
  const clamp = (name, otherwise) => {
    const value = phase(name);
    if (value == null) fallback.push(name);
    return Math.min(load, Math.max(0, value ?? otherwise));
  };
  const ready = clamp('ready', load);
  const contact = clamp('contact', medians.contact);
  const follow = clamp('follow', medians.follow);
  const recover = clamp('recover', medians.recover);
  const lerp = (from, to, u) => from + (to - from) * u;
  // 落拍 is 45 % of 引拍→击球, 前挥 35 % of 落拍→击球, 延伸 36 % and 折肘 70 % of 击球→随挥.
  const targets = [
    ready, load, lerp(load, contact, 0.45), lerp(load, contact, 0.45 + 0.55 * 0.35),
    contact, lerp(contact, follow, 0.36), lerp(contact, follow, 0.70), follow, recover,
  ];
  return {targets, takeback, fallback};
}

function countFlags(rows) {
  return rows.reduce((counts, row) => {
    for (const flag of row.flags) counts[flag] = (counts[flag] ?? 0) + 1;
    return counts;
  }, {});
}

function exportRow(row) {
  return {
    time: row.time, support: row.support,
    ratio: Math.round(row.ratio * 10000) / 10000,
    hipAboveAnkle: Math.round(row.legs[row.support].hipAboveAnkle * 10000) / 10000,
    kneeFlexion: Math.round(row.kneeFlexion),
    visibility: Math.round(row.legs[row.support].visibility * 100) / 100,
    flags: row.flags,
    smoothedRatio: row.smoothedRatio == null ? null : Math.round(row.smoothedRatio * 10000) / 10000,
  };
}
