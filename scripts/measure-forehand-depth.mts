/**
 * Measure forehand squat depth from the source videos with MediaPipe
 * `worldLandmarks`, through the same local browser tool used for visual
 * comparison (`research/forehand-retargeting/pose-debugger`).
 *
 *   npx tsx scripts/measure-forehand-depth.mts [--write] [--json]
 *
 * Sampling: 10 Hz over each selected window (±6 s around the profile's key
 * frames), analysed by `scripts/lib/forehand-depth.mts`. The report is written
 * to `evidence/forehand-depth.json` only with `--write` and only for profiles
 * whose video is present; without it the script prints and exits.
 *
 * The tool is research material: the model and browser stay in
 * `research/`, no h3d package imports them, and nothing here runs in CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {analyzePlayer, readFrame} from './lib/forehand-depth.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const debuggerRoot = path.join(root, 'research/forehand-retargeting/pose-debugger');
const videoRoot = path.join(root, 'research/forehand-retargeting/videos');
const landmarksPath = path.join(root, 'scripts/player-forehand-landmarks.json');
const evidencePath = path.join(root, 'evidence/forehand-depth.json');
const SAMPLE_HZ = 10;
const WINDOW_S = 6;

type Profile = {name: string; video: string; frames: {time: number}[]};
type Landmarks = {profiles: Record<string, Profile>};
type Sample = {time: number; landmarks: unknown[] | null; worldLandmarks: unknown[] | null};
type ExtractVideo = (file: File, times: number[]) => Promise<{duration: number; width: number; height: number; rows: Sample[]}>;
declare global {
  interface Window { __POSE_COMPARE__?: {extractVideo: ExtractVideo} }
}

const args = process.argv.slice(2);
const write = args.includes('--write');
const json = args.includes('--json');
const only = args.filter(arg => !arg.startsWith('--'));

/** Serve the research tool on an ephemeral port so parallel runs never collide. */
function startServer(): Promise<{port: number; stop: () => void}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: debuggerRoot,
      env: {...process.env, PORT: '0'},
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/127\.0\.0\.1:(\d+)/);
      if (match) resolve({port: Number(match[1]), stop: () => child.kill()});
    });
    child.on('exit', code => reject(new Error(`pose-debugger server exited (${code})`)));
  });
}

const landmarks = JSON.parse(fs.readFileSync(landmarksPath, 'utf8')) as Landmarks;
const profiles = Object.entries(landmarks.profiles)
  .filter(([id]) => !only.length || only.includes(id))
  .filter(([, profile]) => {
    const present = fs.existsSync(path.join(videoRoot, profile.video));
    if (!present) console.warn(`skip ${profile}: source video missing`);
    return present;
  });
if (!profiles.length) throw new Error(`no profiles selected (${only.join(', ') || 'all'})`);

const server = await startServer();
const browser = await chromium.launch({headless: true, channel: process.env.QA_BROWSER_CHANNEL || 'chrome'});
const reports: Record<string, unknown> = {};
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.waitForFunction(() => window.__POSE_COMPARE__?.extractVideo, {timeout: 120_000});
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('就绪'), {timeout: 120_000});

  for (const [id, profile] of profiles) {
    const frames = profile.frames.map(frame => frame.time).sort((a, b) => a - b);
    const first = Math.max(0, frames[0] - WINDOW_S);
    const last = frames.at(-1)! + WINDOW_S;
    const times: number[] = [];
    for (let time = first; time <= last + 1e-9; time += 1 / SAMPLE_HZ) times.push(Math.round(time * 1000) / 1000);
    for (const time of frames) if (!times.some(t => Math.abs(t - time) < 1e-6)) times.push(time);
    times.sort((a, b) => a - b);

    await page.setInputFiles('#referenceFile', path.join(videoRoot, profile.video));
    const result = await page.evaluate(async ({times}) => {
      const input = document.getElementById('referenceFile') as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) throw new Error('reference file not attached');
      return window.__POSE_COMPARE__.extractVideo(file, times) as Promise<{duration: number; width: number; height: number; rows: Sample[]}>;
    }, {times});

    const analysed = analyzePlayer(
      result.rows.filter(row => row.worldLandmarks).map(row => readFrame(row.worldLandmarks!, row.time, row.landmarks)),
      frames,
    );
    reports[id] = {
      name: profile.name, video: profile.video,
      source: {width: result.width, height: result.height, duration: Math.round(result.duration * 1000) / 1000},
      sample: {hz: SAMPLE_HZ, windowS: WINDOW_S, frames: result.rows.length, missingPose: result.rows.filter(row => !row.worldLandmarks).length},
      keyFrames: frames,
      ...analysed,
    };
    const take = analysed.phases.takeback as {depthCm: number; kneeFlexion: number} | null;
    const deep = analysed.phases.takebackDeep as {depthCm: number} | null;
    const standing = (analysed as {standing?: {time: number; hipAboveAnkleM: number; chainM: number; kneeFlexion: number; verticalDown: boolean; metres: boolean; upright: boolean} | null}).standing;
    if (standing && !(standing.verticalDown && standing.metres && standing.upright))
      throw new Error(`${id}: standing frame @${standing.time}s fails the unit/axis check (${JSON.stringify(standing)})`);
    const summary = analysed.measurable
      ? `takeback ${String(take?.depthCm).padStart(5)} cm (deepest ${String(deep?.depthCm).padStart(5)}) knee ${String(take?.kneeFlexion).padStart(3)}° usable ${analysed.usable}/${analysed.samples}; standing @${standing?.time}s hip ${standing?.hipAboveAnkleM} m above ankle, chain ${standing?.chainM} m, knee ${standing?.kneeFlexion}°`
      : `not measurable: ${analysed.samples} frames, all flagged (${Object.entries(analysed.flagCounts as Record<string, number>).map(([flag, count]) => `${flag} ${count}`).join(', ')})`;
    console.log(`${id.padEnd(34)} ${summary}`);
  }
  if (errors.length) throw new Error(`browser errors: ${errors.join('; ')}`);
} finally {
  await browser.close();
  server.stop();
}

const report = {
  schemaVersion: 1,
  kind: 'forehand-depth-study',
  method: 'MediaPipe Pose Landmarker Lite 1.1.1 worldLandmarks, 10 Hz, pelvis-relative hip height above the support ankle',
  units: {worldLandmarks: 'metres', verticalAxis: '+y points DOWN; hip height is measured as ankleY − hipY'},
  generated: new Date().toISOString().slice(0, 10),
  profiles: reports,
};
if (json) console.log(JSON.stringify(report, null, 1));
if (write) {
  fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`wrote ${path.relative(root, evidencePath)}`);
}
