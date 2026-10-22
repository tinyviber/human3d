import {describe,expect,it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSemanticsReport, checkSemantics, loadOverrides, type SemanticsInputs} from './build-forehand-semantics.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(root, 'evidence/forehand-semantics.json');

/** The three inputs the builder reads, freshly from disk (each test may edit its copy). */
function readInputs(): SemanticsInputs {
  return {
    depth: JSON.parse(fs.readFileSync(path.join(root, 'evidence/forehand-depth.json'), 'utf8')),
    landmarks: JSON.parse(fs.readFileSync(path.join(root, 'scripts/player-forehand-landmarks.json'), 'utf8')),
    overrides: loadOverrides(path.join(root, 'evidence/forehand-semantic-overrides.json')),
  };
}

describe('forehand semantics file is checked against its inputs', () => {
  const committed = JSON.parse(fs.readFileSync(FILE, 'utf8'));

  it('matches a rebuild from the current depth study, 2D landmarks and overrides', () => {
    expect(checkSemantics(committed, buildSemanticsReport(readInputs(), committed.generated))).toEqual([]);
  });

  it('ignores the build date, and nothing else', () => {
    expect(checkSemantics(committed, buildSemanticsReport(readInputs(), '2000-01-01'))).toEqual([]);
  });

  it('is stale when an override (palm-roll data) changes', () => {
    const inputs = readInputs();
    const id = Object.keys(committed.profiles)[0];
    inputs.overrides = {...inputs.overrides, [id]: {racketHand: {source: 'stale-test'}}};
    const diffs = checkSemantics(committed, buildSemanticsReport(inputs, committed.generated));
    expect(diffs.some(d => d.includes(`${id}`) && d.includes('racketHand'))).toBe(true);
  });

  it('is stale when the depth study changes', () => {
    const inputs = readInputs();
    const id = Object.keys(committed.profiles)[0];
    inputs.depth.profiles[id].phases.takeback.frames = 0; // the phase is then unmeasurable
    expect(checkSemantics(committed, buildSemanticsReport(inputs, committed.generated)).length).toBeGreaterThan(0);
  });

  it('is stale when the 2D landmarks change', () => {
    const inputs = readInputs();
    for (const profile of Object.values(inputs.landmarks.profiles) as {frames: unknown[]}[]) profile.frames = [];
    expect(checkSemantics(committed, buildSemanticsReport(inputs, committed.generated)).length).toBeGreaterThan(0);
  });
});
