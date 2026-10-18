import fs from 'node:fs';import path from 'node:path';
import {createService} from '../../src/server/service';
import {attachRacket} from '../../src/core/racket';
import {normalizeDoc} from '../../src/workshop/document';
import {probeFrames} from '../../src/workshop/quality-probe';
import {rotateHandFrame} from '../../src/workshop/solver';
const ctx=await createService(path.resolve('public'));const racket=attachRacket(ctx.rig);
const base=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const c=JSON.parse(fs.readFileSync(process.argv[3],'utf8'))[0];
const d=normalizeDoc(JSON.parse(JSON.stringify(base)));
if(c.duration)d.duration=c.duration;
for(const k of d.keys){const p=c.keys[k.id]??c.keys[k.label];if(!p)continue;
 if(p.time!==undefined)k.time=p.time;
 for(const a of ['yaw','lean','chest','side'])if(p[a]!==undefined)k.pose[a]=p[a];
 if(p.root)k.pose.root={x:p.root[0],y:p.root[1],z:p.root[2]};
 if(p.handR)k.pose.handR.target={x:p.handR[0],y:p.handR[1],z:p.handR[2]};
 if(p.wrist){const[f,dv,t]=p.wrist;rotateHandFrame(k.pose.handR,'flex',f);rotateHandFrame(k.pose.handR,'dev',dv);rotateHandFrame(k.pose.handR,'twist',t);}}
d.keys.sort((a,b)=>a.time-b.time);
const frames=probeFrames(ctx.rig,d,240,racket);
let vmax=0,vt=0;frames.forEach((f,i)=>{if(i===0)return;const v=Math.hypot(f.tip[0]-frames[i-1].tip[0],f.tip[1]-frames[i-1].tip[1],f.tip[2]-frames[i-1].tip[2])*240;if(v>vmax){vmax=v;vt=f.t;}});
console.log('vmax',vmax.toFixed(2),'@',vt.toFixed(3));
for(const k of d.keys){const f=frames.reduce((a,b)=>Math.abs(b.t-k.time)<Math.abs(a.t-k.time)?b:a);
 const i=frames.indexOf(f);const v=i>0?Math.hypot(f.tip[0]-frames[i-1].tip[0],f.tip[1]-frames[i-1].tip[1],f.tip[2]-frames[i-1].tip[2])*240:0;
 console.log(k.id.padEnd(10),'t',k.time.toFixed(2),'tip',f.tip[0].toFixed(2),f.tip[1].toFixed(2),f.tip[2].toFixed(2),'v',v.toFixed(2));}
// top speed times
const vs=frames.map((f,i)=>i===0?0:Math.hypot(f.tip[0]-frames[i-1].tip[0],f.tip[1]-frames[i-1].tip[1],f.tip[2]-frames[i-1].tip[2])*240);
const top=vs.map((v,i)=>[v,frames[i].t]).sort((a,b)=>b[0]-a[0]).slice(0,12);
console.log('top v@t:',top.map(([v,t])=>v.toFixed(1)+'@'+t.toFixed(2)).join(' '));
