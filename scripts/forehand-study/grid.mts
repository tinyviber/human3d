// Offline design sweep for the study doc: mutate a base doc's key times +
// pose channels (the SAME fields the UI sliders/drags write), probe each
// candidate, and rank by (kicks, bend margin, contact tip speed). Preview
// only — the shipped doc is produced through the real UI afterwards.
import fs from 'node:fs';
import path from 'node:path';
import {createService} from '../../src/server/service';
import {attachRacket} from '../../src/core/racket';
import {normalizeDoc} from '../../src/workshop/document';
import {probeDocument} from '../../src/workshop/quality-probe';
import {rotateHandFrame} from '../../src/workshop/solver';

const ctx=await createService(path.resolve('public'));
const racket=attachRacket(ctx.rig);

interface KeyPatch{time?:number;root?:[number,number,number];yaw?:number;lean?:number;chest?:number;side?:number;
 handR?:[number,number,number];handL?:[number,number,number];wrist?:[number,number,number]}
interface Candidate{name:string;duration?:number;keys:Record<string,KeyPatch>}
function apply(base:any,c:Candidate){
 const d=normalizeDoc(JSON.parse(JSON.stringify(base)));
 if(c.duration)d.duration=c.duration;
 for(const k of d.keys){
  const p=c.keys[k.id]??c.keys[k.label];if(!p)continue;
  if(p.time!==undefined)k.time=p.time;
  for(const a of ['yaw','lean','chest','side']as const)if(p[a]!==undefined)(k.pose as any)[a]=p[a];
  if(p.root)k.pose.root={x:p.root[0],y:p.root[1],z:p.root[2]};
  for(const h of ['handR','handL']as const)if(p[h])k.pose[h].target={x:p[h]![0],y:p[h]![1],z:p[h]![2]};
  if(p.wrist){const [f,dv,t]=p.wrist;rotateHandFrame(k.pose.handR,'flex',f);rotateHandFrame(k.pose.handR,'dev',dv);rotateHandFrame(k.pose.handR,'twist',t);}
 }
 d.keys.sort((a,b)=>a.time-b.time);
 return d;
}
const base=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const candidates:Candidate[]=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
for(const c of candidates){
 const d=apply(base,c);
 const r=probeDocument(ctx.rig,d,{fps:240,tip:racket,name:c.name,
  activeWindow:[d.keys.find(k=>/引拍/.test(k.label))?.time??0,d.keys.find(k=>/随挥/.test(k.label))?.time??d.duration]});
 const bend=r.wristClamp.maxBend;
 console.log(`${c.name.padEnd(22)} bend ${bend.toFixed(1).padStart(5)} clamp ${r.wristClamp.clampedFrames} | kicks tip ${r.tip!.kicks} wrist ${r.wrist.kicks} | `+
  `tip@contact ${r.contact.tipSpeed?.toFixed(2)} vmax ${r.tip!.vmax.toFixed(1)} | slip ${(Math.max(...r.footSlip.map(s=>s.maxResidual))*1000).toFixed(1)}mm `+
  `reach ${(r.ik.armResidualR.v*1000).toFixed(1)}mm rMax ${(r.ik.reachMax.r*100).toFixed(0)}% | rootA ${r.root.maxA.toFixed(0)} dorsi ${Math.max(r.solverChecks['ankle-dorsiflexion-L']?.v??0,r.solverChecks['ankle-dorsiflexion-R']?.v??0).toFixed(1)} fd ${((r.solverChecks['foot-depth-L']?.v??0)*100).toFixed(1)}cm`);
}
