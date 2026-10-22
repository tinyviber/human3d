import {describe,expect,it} from 'vitest';
import {compareWithDisk,generate} from './generate-player-forehands.mts';

/** The 17 committed forehand presets are a pure function of the generator and its
 * inputs (scripts/generate-player-forehands.mts, scripts/lib/forehand-*.mts,
 * evidence/, spec/examples/, public/models/). This test regenerates them in memory,
 * enforces the gates on the bytes that would be written, and checks that the committed
 * assets and evidence/forehand-presets.json are exactly what a fresh run produces.
 * Fix a failure with `npm run forehand:generate` (or `--rebaseline` for an intended
 * ratchet increase), never by editing an asset by hand. */
describe('forehand presets: fail-closed generation and freshness',()=>{
 it('passes every gate on the bytes it would write and matches the committed assets and receipt',async()=>{
  const gen=await generate();
  expect(gen.failures).toEqual([]);
  expect(compareWithDisk(gen)).toEqual([]);
  expect(gen.presets).toHaveLength(17);
 },600000);
});
