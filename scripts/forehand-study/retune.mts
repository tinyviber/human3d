// Greedy per-key wrist-delta retune: for each key, scan flex/dev/twist deltas
// on a coarse grid, keep the combo minimizing max wrist bend over the probe.
import fs from 'node:fs';import path from 'node:path';
import {createService} from '../../src/server/service';
import {attachRacket} from '../../src/core/racket';
import {normalizeDoc} from '../../src/workshop/document';
import {probeDocument} from '../../src/workshop/quality-probe';
import {rotateHandFrame} from '../../src/workshop/solver';
const ctx=await createService(path.resolve('public'));const racket=attachRacket(ctx.rig);
const base=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const cand=JSON.parse(fs.readFileSync(process.argv[3],'utf8'))[0];
function build(wristMap:Record<string,[number,number,number]>){
 const d=normalizeDoc(JSON.parse(JSON.stringify(base)));
 if(cand.duration)d.duration=cand.duration;
 for(const k of d.keys){const p=cand.keys[k.id]??cand.keys[k.label];if(!p)continue;
  if(p.time!==undefined)k.time=p.time;
  for(const a of ['yaw','lean','chest','side'])if((p as any)[a]!==undefined)(k.pose as any)[a]=(p as any)[a];
  if(p.root)k.pose.root={x:p.root[0],y:p.root[1],z:p.root[2]};
  if(p.handR)k.pose.handR.target={x:(p as any).handR[0],y:(p as any).handR[1],z:(p as any).handR[2]};
  const w=wristMap[k.id];if(w){const[f,dv,t]=w;rotateHandFrame(k.pose.handR,'flex',f);rotateHandFrame(k.pose.handR,'dev',dv);rotateHandFrame(k.pose.handR,'twist',t);}}
 d.keys.sort((a,b)=>a.time-b.time);return d;
}
// start from candidate's wrist deltas
const wrist:Record<string,[number,number,number]>={};
for(const k of base.keys){const p=cand.keys[k.id]??cand.keys[k.label];wrist[k.id]=p?.wrist?[...p.wrist]:[0,0,0];}
function score(d:any){const r=probeDocument(ctx.rig,d,{fps:240,tip:racket,name:'x'});
 // hard gate: zero clamped frames & bend inside the limit; then prefer a fast
 // contact-zone tip (speed is the quality goal, bend margin is the constraint).
 if(r.wristClamp.clampedFrames>0)return 1e5+r.wristClamp.clampedFrames;
 return r.wristClamp.maxBend-(r.contact.tipSpeed??0)*4-r.tip.vmax;}
let best=Number.POSITIVE_INFINITY;let d0=build(wrist);best=score(d0);
console.log('start bend',best.toFixed(1));
const FLEX=[-30,-20,-10,0,10,20,30],DEV=[-20,-10,0,10,20],TW=[-20,0,20];
for(let round=0;round<3;round++){
 for(const k of base.keys){
  let cur=wrist[k.id],bestLocal=best,bestCombo=cur;
  for(const f of FLEX)for(const dv of DEV)for(const t of TW){
   wrist[k.id]=[f,dv,t];const d=build(wrist);const b=score(d);
   if(b<bestLocal-0.3){bestLocal=b;bestCombo=[f,dv,t];}
  }
  wrist[k.id]=bestCombo;best=bestLocal;
 }
 console.log('round',round,'bend',best.toFixed(1),JSON.stringify(wrist));
}
const d=build(wrist);
fs.writeFileSync(process.argv[4],JSON.stringify(d,null,2));
const r=probeDocument(ctx.rig,d,{fps:240,tip:racket,name:'final'});
console.log('final bend',r.wristClamp.maxBend.toFixed(1),'clamped',r.wristClamp.clampedFrames,'kicks',r.tip.kicks,'wrist',r.wrist.kicks,'contactTip',r.contact.tipSpeed?.toFixed(2),'vmax',r.tip.vmax.toFixed(2),'reach',(r.ik.armResidualR.v*1000).toFixed(1),'rMax',(r.ik.reachMax.r*100).toFixed(0),'slip',Math.max(...r.footSlip.map(s=>s.maxResidual)).toFixed(4),'fd',r.solverChecks['foot-depth-L']?.v,r.solverChecks['foot-depth-R']?.v);
