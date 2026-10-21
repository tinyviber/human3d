/**
 * Re-extract per-player forehand semantics from source videos at ≥30 Hz.
 *
 *   npx tsx scripts/measure-forehand-semantics.mts --all [--write]
 *
 * Currently delegates to the bootstrap builder (depth study + 2D landmarks).
 * A full MediaPipe worldLandmarks pass (stance / off-arm 3D) can replace the
 * bootstrap by mirroring scripts/measure-forehand-depth.mts with SAMPLE_HZ=30
 * and scripts/lib/forehand-semantics.mts readSemanticsFrame/analyzeSemantics.
 * Until that lands, `build-forehand-semantics.mts --write` is the overnight path.
 */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
console.log('measure-forehand-semantics: running bootstrap builder (depth+2D).');
console.log('For a full ≥30 Hz worldLandmarks re-extract, extend this script like measure-forehand-depth.mts.');
const r = spawnSync(process.execPath, ['--import','tsx', path.join(root,'scripts/build-forehand-semantics.mts'), ...(write?['--write']:[])], {
  cwd: root, stdio: 'inherit',
});
process.exit(r.status ?? 1);
