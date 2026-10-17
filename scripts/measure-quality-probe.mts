// Quality probe CLI — a thin shell over src/workshop/quality-probe.ts, which
// holds the single implementation of every metric (shared with vitest, so the
// measurements cannot drift; learning[4]). The probe samples a document at
// high fps through the REAL solve path (frameAt → solveEffectiveFrame →
// analyzePose, the same calls solveWorkshop makes) and measures what the
// 40 fps semantic gates cannot see: foot slip inside support intervals,
// per-frame solver discontinuities (pelvis correction, IK clamps, slerp
// segment changes, wrist bend clamp), ground penetration, kinetic-chain
// sequencing and wrist/tip trajectory smoothness.
//
// Usage: npx tsx scripts/measure-quality-probe.mts [fps=240] [motion=forehand|all]
// Writes evidence/quality-probe-<motion>.json next to the console report.
import fs from 'node:fs';
import path from 'node:path';
import {createService} from '../src/server/service';
import {motionFileById} from '../src/core/motion-files';
import {attachRacket} from '../src/core/racket';
import {formatProbeReport,probeDocument,probeFrames,stepAngles,type ProbeFrame} from '../src/workshop/quality-probe';

const fps=Number(process.argv[2]??240);
const which=process.argv[3]??'forehand';
const ctx=await createService(path.resolve('public'));
const racket=attachRacket(ctx.rig);
const ids=which==='all'?['forehand','squat','reach','ready','idle']:[which];
fs.mkdirSync('evidence',{recursive:true});
const summary:Record<string,unknown>={};
for(const id of ids){
 const mf=motionFileById(id);
 if(!mf?.document){console.log(`${id}: no workshop document`);continue;}
 const doc=mf.document;
 const r=probeDocument(ctx.rig,doc,{fps,tip:racket,name:id,
  // The forehand's kinetic-chain "active" window is the swing phase.
  activeWindow:id==='forehand'?[1.3,3.5]:undefined});
 console.log(formatProbeReport(r));
 /* Noise floor: a true C0 jump keeps the same per-step angle at any fps. */
 const alt=fps>60?60:fps*4;
 const fAlt=probeFrames(ctx.rig,doc,alt,racket);
 const dq=(frs:ProbeFrame[])=>Math.max(...stepAngles(frs.map(f=>f.quat['wrist_R'])));
 console.log(`\n  [噪声尺度] wrist_R 最大单帧转角: ${fps}fps ${(dq(r.frames)*180/Math.PI).toFixed(2)}° vs ${alt}fps ${(dq(fAlt)*180/Math.PI).toFixed(2)}° (真C0跳变不随dt缩放)`);
 summary[id]={fps,frames:r.frameCount,spikes:r.spikes,
  chain:r.chain.map(c=>({seg:c.seg,peakRadS:+c.peak.toFixed(2),t:c.t,relPeakRadS:+c.relPeak.toFixed(2),relT:c.relT})),
  clampTransitions:r.wristClamp.transitions,deficitMax:r.wristClamp.deficitMax,
  deficitFrames:r.wristClamp.deficitFrames,deficitMed:r.wristClamp.deficitMedian,
  tipSpeedAtContact:r.contact.tipSpeed,contactT:r.contact.time??-1,
  tipAccelTop:r.tip?.accelTop??[],wristAccelTop:r.wrist.accelTop,
  armReachResidual:r.ik.armResidualR,reachMax:r.ik.reachMax,
  rootMaxStep:r.root.maxStep,rootMaxV:r.root.maxV,rootMaxA:r.root.maxA,
  pelvisShiftRange:[r.pelvis.shiftMin,r.pelvis.shiftMax],pelvisShiftJump:[r.pelvis.maxJump,r.pelvis.jumpT],
  soleMinY:r.sole.minY};
 fs.writeFileSync(`evidence/quality-probe-${id}.json`,JSON.stringify({motion:id,fps,duration:doc.duration,keys:doc.keys.length,...summary[id]},null,1));
}
fs.writeFileSync('evidence/quality-probe-summary.json',JSON.stringify(summary,null,1));
