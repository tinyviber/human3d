/**
 * Thin wrapper around the bootstrap builder. It does NOT re-extract per-player semantics
 * from source video at >= 30 Hz: the 3D inputs are the depth study (evidence/forehand-depth.json)
 * and the 2D keyframes (scripts/player-forehand-landmarks.json). A worldLandmarks re-extract
 * would mirror scripts/measure-forehand-depth.mts with SAMPLE_HZ=30 and feed
 * scripts/lib/forehand-semantics.mts (readSemanticsFrame / analyzeSemantics); that path is not implemented.
 *
 *   npx tsx scripts/measure-forehand-semantics.mts --all [--write]
 *
 * Hand-authored palm-roll data lives in evidence/forehand-semantic-overrides.json (an input).
 */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
console.log('measure-forehand-semantics: running bootstrap builder (depth+2D).');
console.log('Not a 30 Hz worldLandmarks re-extract: this runs the bootstrap builder only (see the header comment).');
const r = spawnSync(process.execPath, ['--import','tsx', path.join(root,'scripts/build-forehand-semantics.mts'), ...(write?['--write']:[])], {
  cwd: root, stdio: 'inherit',
});
process.exit(r.status ?? 1);
