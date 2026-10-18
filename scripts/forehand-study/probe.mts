// WP-C forehand-study iteration helper: probe a WorkshopDoc JSON (bare doc or
// a wrapped motion request) through the REAL solve path and print the shared
// quality report plus a one-line machine summary. Same probe implementation as
// src/workshop/quality.test.ts — a second copy would drift (learning[4]).
//
// Usage:
//   npx tsx scripts/forehand-study/probe.mts <doc-or-request.json> [fps=240] [--record <tag>]
// `--record` appends the summary row to evidence/forehand-study/rounds.jsonl so
// the human ledger can quote before/after numbers per editing round.
import fs from 'node:fs';
import path from 'node:path';
import {createService} from '../../src/server/service';
import {attachRacket} from '../../src/core/racket';
import {normalizeDoc,sortedKeys} from '../../src/workshop/document';
import {rotateHandFrame} from '../../src/workshop/solver';
import {formatProbeReport,probeDocument,type ProbeReport} from '../../src/workshop/quality-probe';

const file=process.argv[2];
const fps=Number(process.argv[3]??240);
const recordIdx=process.argv.indexOf('--record');
const recordTag=recordIdx>0?process.argv[recordIdx+1]:undefined;
const applyIdx=process.argv.indexOf('--apply');
const raw=JSON.parse(fs.readFileSync(file,'utf8'));
const doc=normalizeDoc(raw.action?.parameters?.document??raw.document??raw);
/* --apply '{"<keyId|label>":{"flex":d,"dev":d,"twist":d,"L":{...}}}' — preview
 * wrist-slider edits through the exact rotateHandFrame the panel calls. */
if(applyIdx>0){
 const spec=JSON.parse(process.argv[applyIdx+1]);
 for(const [kid,d]of Object.entries(spec)as[string,Record<string,number>][]){
  const k=doc.keys.find(x=>x.id===kid||x.label===kid)!;
  for(const side of ['R','L']as const){
   const s=d[side]??d;
   for(const ax of ['flex','dev','twist']as const)if(typeof s[ax]==='number')rotateHandFrame(side==='L'?k.pose.handL:k.pose.handR,ax,s[ax]);
  }
 }
}
const ctx=await createService(path.resolve('public'));
const racket=attachRacket(ctx.rig);

/* Active window = 引拍→随挥 key span (the forward swing). */
const keys=sortedKeys(doc);
const at=(re:RegExp,fallback:number)=>keys.find(k=>re.test(k.label))?.time??fallback;
const activeWindow:[number,number]=[at(/引拍/,0),at(/随挥/,doc.duration)];

const r=probeDocument(ctx.rig,doc,{fps,tip:racket,name:doc.name||doc.id,activeWindow});
console.log(formatProbeReport(r));

const chainOrder=r.chain.map(c=>`${c.seg}@${c.relT.toFixed(3)}s`).join(' ');
const summary={
 tag:recordTag,fps,name:r.name,duration:r.duration,keys:r.keyCount,keyTimes:r.keyTimes,
 wristBendMax:+r.wristClamp.maxBend.toFixed(2),wristBendT:r.wristClamp.maxBendT,clamped:r.wristClamp.clampedFrames,
 clampTransitions:r.wristClamp.transitions.map(t=>+t.toFixed(3)),
 armResidMM:+(r.ik.armResidualR.v*1000).toFixed(2),armResidT:r.ik.armResidualR.t,reachMax:+r.ik.reachMax.r.toFixed(3),
 legResidMM:+(r.ik.legResidual.v*1000).toFixed(2),
 slipMaxMM:+Math.max(0,...r.footSlip.map(s=>s.maxResidual*1000)).toFixed(3),
 footDepthL:+(r.solverChecks['foot-depth-L']?.v??0).toFixed(4),footDepthR:+(r.solverChecks['foot-depth-R']?.v??0).toFixed(4),
 solePenMM:+(Math.max(r.sole.penetration.L,r.sole.penetration.R)*1000).toFixed(3),
 dorsiL:+(r.solverChecks['ankle-dorsiflexion-L']?.v??0).toFixed(1),dorsiR:+(r.solverChecks['ankle-dorsiflexion-R']?.v??0).toFixed(1),
 tipVmax:+ (r.tip?.vmax??0).toFixed(2),tipVpeakT:r.tip?.vpeakT,tipKicks:r.tip?.kicks,wristKicks:r.wrist.kicks,
 tipAccelTop:r.tip?.accelTop.slice(0,3).map(a=>({a:+a.a.toFixed(0),dv:+a.dv.toFixed(2),t:a.t})),
 wristVmax:+r.wrist.vmax.toFixed(2),
 contactT:r.contact.time,contactTipSpeed:r.contact.tipSpeed==null?null:+r.contact.tipSpeed.toFixed(2),
 rootMaxA:+r.root.maxA.toFixed(2),rootMaxV:+r.root.maxV.toFixed(3),pelvisShiftMM:+(r.pelvis.shiftMax*1000).toFixed(1),
 pelvisJumpMM:+(r.pelvis.maxJump*1000).toFixed(2),saturated:r.pelvis.saturatedFrames,
 chain:r.chain.map(c=>({seg:c.seg,relPeak:+c.relPeak.toFixed(1),relT:+c.relT.toFixed(3)})),
 chainOrder,
 handTargetAccel:+r.handTargetAccel.a.toFixed(0),wristStepAtKeyDeg:+(r.wristStep.atKeyMedian/Math.PI*180).toFixed(3),
 comMax:+(r.solverChecks['com-support']?.v??0).toFixed(3),
 angularTop:r.bones.slice(0,4).map(b=>`${b.bone} ${b.peakW.toFixed(1)}rad/s@${b.peakT.toFixed(2)}`),
 kinks:r.kinked.slice(0,6).map(k=>`${k.bone} x${k.kink.toFixed(0)} @${k.kinkT.toFixed(2)}`),
};
console.log('STUDY_JSON '+JSON.stringify(summary));
if(recordTag){
 fs.mkdirSync('evidence/forehand-study',{recursive:true});
 fs.appendFileSync('evidence/forehand-study/rounds.jsonl',JSON.stringify(summary)+'\n');
}
