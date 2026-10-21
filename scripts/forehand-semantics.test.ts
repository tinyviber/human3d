import {describe,expect,it} from 'vitest';
import fs from 'node:fs';
import {
  analyzeSemantics, detectSwap, landmarkTorsoFrame, pushOffPitchFromExtension,
  readSemanticsFrame, SEMANTICS_KIND, semanticDepthTargets, sphOfDir,
  stanceBoostForKnee, stanceMultiplierFromWidth, torsoArmFromOffSemantics,
  toEng,
} from './lib/forehand-semantics.mts';
import {LANDMARK, phaseMedians} from './lib/forehand-depth.mts';

/** Synthetic MediaPipe world row: pelvis-centred, +y DOWN, metres. */
function pose(opts: {
  hipToAnkle?: number;
  kneeForward?: number;
  stance?: number;
  offElbowInner?: number;
  offReach?: number;
  offElevDeg?: number;
  swap?: boolean;
  offFrame?: boolean;
} = {}) {
  const hipToAnkle = opts.hipToAnkle ?? 0.8;
  const kneeForward = opts.kneeForward ?? 0;
  const stance = opts.stance ?? 0.4;
  const world = Array.from({length: 33}, () => ({x: 0, y: 0, z: 0, visibility: 1}));
  const image = Array.from({length: 33}, () => ({x: 0.5, y: 0.5, visibility: 1}));
  // Legs: left at +x/2, right at -x/2 in image/world x
  for (const [hip, knee, ankle, x] of [[23, 25, 27, stance / 2], [24, 26, 28, -stance / 2]] as const) {
    world[hip] = {x, y: 0, z: 0, visibility: 1};
    world[knee] = {x, y: hipToAnkle / 2, z: -kneeForward, visibility: 1};
    world[ankle] = {x, y: hipToAnkle, z: 0, visibility: 1};
    image[hip] = {x: 0.5 + x, y: 0.4, visibility: 1};
    image[knee] = {x: 0.5 + x, y: 0.6, visibility: 1};
    image[ankle] = {x: 0.5 + x, y: 0.8, visibility: 1};
    if (opts.offFrame) image[ankle] = {x: 0.5, y: 1.2, visibility: 1};
  }
  // Shoulders
  world[11] = {x: 0.15, y: -0.4, z: 0, visibility: 1}; // left
  world[12] = {x: -0.15, y: -0.4, z: 0, visibility: 1}; // right
  image[11] = {x: 0.55, y: 0.25, visibility: 1};
  image[12] = {x: 0.45, y: 0.25, visibility: 1};
  // Off arm (left): elbow angle via placing elbow off the shoulder→wrist chord
  const offInner = opts.offElbowInner ?? 160;
  const reach = opts.offReach ?? 0.55;
  const elev = (opts.offElevDeg ?? 5) * Math.PI / 180;
  // MediaPipe +y down: "up" in eng is -y in MP. Shoulder at y=-0.4.
  const shoulder = world[11];
  const wrist = {
    x: shoulder.x + Math.sin(0.3) * reach * Math.cos(elev),
    y: shoulder.y - Math.sin(elev) * reach, // -y in MP = up in eng
    z: shoulder.z - Math.cos(0.3) * reach * Math.cos(elev),
    visibility: 1,
  };
  // Place elbow so inner angle ≈ offInner (approx on the plane)
  const mid = {
    x: (shoulder.x + wrist.x) / 2,
    y: (shoulder.y + wrist.y) / 2,
    z: (shoulder.z + wrist.z) / 2,
  };
  // Bend amount: larger bend → elbow further from chord
  const bend = Math.sin((180 - offInner) * Math.PI / 360) * 0.25;
  world[13] = {x: mid.x, y: mid.y + bend, z: mid.z + bend, visibility: 1}; // left elbow
  world[15] = wrist; // left wrist
  image[13] = {x: 0.58, y: 0.35, visibility: 1};
  image[15] = {x: 0.60, y: 0.30, visibility: 1};
  // Right arm stubs
  world[14] = {x: -0.2, y: -0.2, z: 0, visibility: 1};
  world[16] = {x: -0.25, y: -0.1, z: 0, visibility: 1};
  image[14] = {x: 0.42, y: 0.35, visibility: 1};
  image[16] = {x: 0.40, y: 0.40, visibility: 1};

  if (opts.swap) {
    // Swap left/right in image ankles vs shoulders to trigger detectSwap
    const tmpA = image[27]; image[27] = image[28]; image[28] = tmpA;
  }
  return {world, image};
}

describe('forehand semantics (pure analysis)', () => {
  it('flips MediaPipe +y-down into engineering +y-up', () => {
    expect(toEng({x: 1, y: 2, z: 3})).toEqual({x: 1, y: -2, z: -3, visibility: undefined});
  });

  it('reads knee flex, stance, pelvis ratio and off-arm direction from a frame', () => {
    const rows = [];
    for (let i = 0; i < 20; i++) {
      const p = pose({hipToAnkle: 0.7, kneeForward: 0.15, stance: 0.5, offElbowInner: 160, offElevDeg: 10});
      rows.push(readSemanticsFrame(p.world, i * 0.1, p.image));
    }
    const report = analyzeSemantics(rows, [0.2, 0.6, 1.0, 1.4, 1.8]);
    expect(report.measurable).toBe(true);
    expect(report.phases.takeback?.stanceOverLeg).toBeGreaterThan(0.3);
    expect(report.phases.takeback?.offElbowDeg).toBeGreaterThan(100);
    expect(report.phases.takeback?.offArmDir).not.toBeNull();
    expect(report.stanceOverLeg).toBeGreaterThan(0.3);
  });

  it('flags off-frame feet and does not treat them as usable', () => {
    const rows = [];
    for (let i = 0; i < 20; i++) {
      const p = pose({offFrame: i >= 8 && i <= 12});
      rows.push(readSemanticsFrame(p.world, i * 0.1, p.image));
    }
    const report = analyzeSemantics(rows, [0.2, 0.6, 1.0, 1.4, 1.8]);
    expect(report.flagCounts['off-frame']).toBe(5);
    expect(report.usable).toBe(15);
  });

  it('detects a left/right image swap', () => {
    const p = pose({swap: true});
    expect(detectSwap(p.image)).toBe(true);
    const row = readSemanticsFrame(p.world, 0, p.image);
    expect(row.flags).toContain('lr-swap-corrected');
  });

  it('maps stance width to a clamped generator multiplier', () => {
    const ok = stanceMultiplierFromWidth(0.5, 1.1);
    expect(ok.source).toBe('measured');
    expect(ok.stance).toBeGreaterThan(1);
    const bad = stanceMultiplierFromWidth(0.05, 1.1);
    expect(bad.source).toBe('fallback');
    expect(bad.stance).toBe(1.1);
  });

  it('boosts stance for deep video knees and leaves shallow ones alone', () => {
    expect(stanceBoostForKnee(52)).toBeGreaterThan(1.2);
    expect(stanceBoostForKnee(18)).toBe(1);
    // Deep contact (Alcaraz) should push boost at least as high as takeback alone.
    expect(stanceBoostForKnee(52, {contactKneeFlex: 70})).toBeGreaterThanOrEqual(stanceBoostForKnee(52));
    // Extension-at-depth (Zverev): flag requests max wide stance to shed knee flex.
    expect(stanceBoostForKnee(42, {contactKneeFlex: 30, extensionNeedsWideStance: true})).toBe(1.4);
  });

  it('scales push-off from rear-knee extension and pelvis-rise fallback', () => {
    const ext = pushOffPitchFromExtension(25);
    expect(ext.pitch).toBe(12);
    expect(ext.source).toBe('measured');
    const rise = pushOffPitchFromExtension(-4, {pelvisRiseCm: 8});
    expect(rise.source).toBe('measured');
    expect(rise.flag).toBe('push-from-pelvis-rise');
    expect(rise.pitch).toBe(12);
    const miss = pushOffPitchFromExtension(null);
    expect(miss.source).toBe('fallback');
    expect(miss.pitch).toBe(12);
  });

  it('builds a near-straight off-arm TorsoArm from elev/az + inner elbow', () => {
    const {arm, source} = torsoArmFromOffSemantics({el: 5, az: 25}, 160);
    expect(source).toBe('measured');
    expect(arm.reach).toBeGreaterThan(0.9);
    // sph round-trip: wrist coeffs should match elev/az direction
    const f = landmarkTorsoFrame({x: -0.2, y: 1.4, z: 0}, {x: 0.2, y: 1.4, z: 0});
    const d = {
      x: f.out.x * arm.wrist[0] + f.up.x * arm.wrist[1] + f.front.x * arm.wrist[2],
      y: f.out.y * arm.wrist[0] + f.up.y * arm.wrist[1] + f.front.y * arm.wrist[2],
      z: f.out.z * arm.wrist[0] + f.up.z * arm.wrist[1] + f.front.z * arm.wrist[2],
    };
    const sph = sphOfDir(f, d);
    expect(Math.abs(sph.el - 5)).toBeLessThan(1);
    expect(Math.abs(sph.az - 25)).toBeLessThan(1);
  });

  it('drops the contact≤load clamp and soft-caps only extreme deepenings', () => {
    const deep = {
      measurable: true,
      phases: {
        ready: {depthCm: 6, frames: 9},
        takeback: {depthCm: 5, frames: 7},
        contact: {depthCm: 14.6, frames: 7},
        follow: {depthCm: 4, frames: 5},
        recover: {depthCm: 2, frames: 5},
      },
    };
    const r = semanticDepthTargets(deep, {contact: 3, follow: 2.5, recover: 2})!;
    // takeback floored to 8; contact soft-capped to 8+4=12 (not clamped to 8)
    expect(r.takeback).toBe(8);
    expect(r.targets[4]).toBe(12);
    expect(r.capped).toContain('contact');
    expect(r.targets[4]).toBeGreaterThan(r.takeback);
  });
});

describe('forehand semantics evidence', () => {
  it('ships a 17-player study the generator can consume', () => {
    const study = JSON.parse(fs.readFileSync('evidence/forehand-semantics.json', 'utf8'));
    expect(study.kind).toBe(SEMANTICS_KIND);
    expect(Object.keys(study.profiles)).toHaveLength(17);
    for (const [id, profile] of Object.entries(study.profiles) as [string, any][]) {
      expect(profile.mapping?.stance, id).toBeGreaterThan(0.9);
      expect(profile.mapping?.pushOffPitch, id).toBeGreaterThanOrEqual(6);
      expect(profile.mapping?.offArms?.takeback?.arm?.reach, id).toBeGreaterThan(0.4);
    }
  });

  it('derives semantic depth targets for every measurable depth profile', () => {
    const depth = JSON.parse(fs.readFileSync('evidence/forehand-depth.json', 'utf8'));
    const medians = phaseMedians(depth);
    for (const id of Object.keys(depth.profiles)) {
      const r = semanticDepthTargets(depth.profiles[id], medians);
      expect(r, id).not.toBeNull();
      expect(r!.targets).toHaveLength(9);
    }
  });
});
