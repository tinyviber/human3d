// Per-key diagnostics for the forehand-study session: solve each key instant
// through the real path and report the quantities the wrist/reach edits aim
// at — forearm direction, authored hand frame, wrist bend demand, arm reach,
// and the racket tip position (with/without a candidate delta applied to the
// stored hand frame, so slider edits can be previewed before driving the UI).
import fs from 'node:fs';
import path from 'node:path';
import {Quaternion,Vector3} from 'three';
import {createService} from '../../src/server/service';
import {attachRacket} from '../../src/core/racket';
import {normalizeDoc,frameAt,toV,sortedKeys} from '../../src/workshop/document';
import {solveEffectiveFrame,rotateHandFrame} from '../../src/workshop/solver';
import {DEG} from '../../src/core/kinematics';

const file=process.argv[2];
const raw=JSON.parse(fs.readFileSync(file,'utf8'));
const doc=normalizeDoc(raw.action?.parameters?.document??raw.document??raw);
const saveIdx=process.argv.indexOf('--save');
process.on('exit',()=>{if(saveIdx>0)fs.writeFileSync(process.argv[saveIdx+1],JSON.stringify(doc,null,2));});
const ctx=await createService(path.resolve('public'));
const rig=ctx.rig,racket=attachRacket(rig);
const origin=rig.rest.get('root')!;
const keys=sortedKeys(doc);
console.log(`doc ${doc.id} dur ${doc.duration} keys ${keys.map(k=>`${k.label||k.id}@${k.time}`).join(' ')}`);
for(let i=0;i<keys.length;i++){
 const k=keys[i];
 // Solve the key instant itself, and the midpoints of both adjacent intervals
 // (bend demand is usually worst off-key under interpolation).
 for(const t of [k.time,(k.time+(keys[i+1]?.time??k.time))/2,(k.time+(keys[i-1]?.time??k.time))/2].filter((v,j)=>j===0||v!==k.time&&v>=0&&v<=doc.duration)){
  const f=frameAt(doc,t,origin);solveEffectiveFrame(rig,f);
  const forearm=rig.point('wrist_R').sub(rig.point('lowerarm01_R')).normalize();
  const fwd=toV(f.pose.handR.forward).normalize();
  const bend=forearm.angleTo(fwd)/DEG;
  const tip=racket.localToWorld(new Vector3(0,.61,0));
  const armRoot=rig.point('upperarm01_R');
  const reach=toV(f.pose.handR.target).sub(armRoot).length();
  const a=.265,b=.267;
  const tag=t===k.time?'KEY ':' mid';
  console.log(`${tag} ${k.id} t=${t.toFixed(4)} bend=${bend.toFixed(1)}° reach=${(reach/(a+b)*100).toFixed(0)}% `+
   `forearm=(${forearm.toArray().map(v=>v.toFixed(2))}) fwd=(${fwd.toArray().map(v=>v.toFixed(2))}) `+
   `handT=(${f.pose.handR.target.x.toFixed(2)},${f.pose.handR.target.y.toFixed(2)},${f.pose.handR.target.z.toFixed(2)}) tip=(${tip.toArray().map(v=>v.toFixed(2))})`);
 }
}
/* Candidate-delta preview: --try <keyId> <flex> <dev> <twist> prints the bend
 * at the key and at interval midpoints after rotateHandFrame (the exact call
 * the wrist panel's sliders make). */
const tryIdx=process.argv.indexOf('--try');
if(tryIdx>0){
 const [keyId,fx,dv,tw]=process.argv.slice(tryIdx+1).map((x,i)=>i===0?x:Number(x));
 const k=doc.keys.find(x=>x.id===keyId||x.label===keyId)!;
 rotateHandFrame(k.pose.handR,'flex',fx);rotateHandFrame(k.pose.handR,'dev',dv);rotateHandFrame(k.pose.handR,'twist',tw);
 console.log(`--try ${keyId} flex${fx} dev${dv} twist${tw}:`);
 let worst=0,wt=0;
 for(let i=0;i<=200;i++){
  const t=i/200*doc.duration,f=frameAt(doc,t,origin);solveEffectiveFrame(rig,f);
  const forearm=rig.point('wrist_R').sub(rig.point('lowerarm01_R')).normalize();
  const bend=forearm.angleTo(toV(f.pose.handR.forward).normalize())/DEG;
  if(bend>worst){worst=bend;wt=t;}
 }
 console.log(`  maxBend across 200 samples = ${worst.toFixed(1)}° @${wt.toFixed(3)}s`);
}
/* --tune <keyId> [side] — coordinate-descent the key's stored wrist deltas
 * (the same flex/dev/twist the panel sliders apply) to minimise the MAX bend
 * over the whole motion, including mid-interval samples. Twist matters even
 * though it never moves the key-instant bend: the SO(3) cubic between frames
 * runs through (f,n), so rolling n re-aims the interpolated forward. Prints
 * the deltas to type into the sliders. */
const tuneIdx=process.argv.indexOf('--tune');
const optArg=(i:number,d:string)=>{const v=process.argv[i];return v!==undefined&&!v.startsWith('--')?v:d;};
if(tuneIdx>0){
 const keyId=process.argv[tuneIdx+1],side=optArg(tuneIdx+2,'R') as 'L'|'R';
 const k=doc.keys.find(x=>x.id===keyId||x.label===keyId)!;
 const applied={flex:0,dev:0,twist:0};
 const H=side==='L'?k.pose.handL:k.pose.handR;
 const limit={flex:60,dev:60,twist:90};
 const maxBend=()=>{
  let worst=0,wt=0;
  for(let i=0;i<=160;i++){
   const t=i/160*doc.duration,f=frameAt(doc,t,origin);solveEffectiveFrame(rig,f);
   const forearm=rig.point(`wrist_${side}`).sub(rig.point(`lowerarm01_${side}`)).normalize();
   const bend=forearm.angleTo(toV(f.pose[side==='L'?'handL':'handR'].forward).normalize())/DEG;
   if(bend>worst){worst=bend;wt=t;}
  }
  return {worst,wt};
 };
 const moves:[string,number][]=[];
 let cur=maxBend();
 console.log(`--tune ${keyId} ${side}: baseline maxBend ${cur.worst.toFixed(1)}° @${cur.wt.toFixed(3)}s`);
 for(let pass=0;pass<4;pass++){
  let improved=false;
  for(const ax of ['flex','dev','twist']as const){
   let best=0,bestV=cur.worst;
   for(const step of [20,-20,10,-10,5,-5]){
    const v=Math.max(-limit[ax],Math.min(limit[ax],applied[ax]+step))-applied[ax];
    if(!v)continue;
    rotateHandFrame(H,ax,v);
    const m=maxBend().worst;
    if(m<bestV-.05){bestV=m;best=v;}
    rotateHandFrame(H,ax,-v);
   }
   if(best){rotateHandFrame(H,ax,best);applied[ax]+=best;moves.push([ax,best]);cur={worst:bestV,wt:cur.wt};improved=true;
    console.log(`   pass${pass} ${ax} ${best>0?'+':''}${best.toFixed(0)} → maxBend ${bestV.toFixed(1)}°`);}
  }
  cur=maxBend();if(!improved)break;
 }
 const fin=maxBend();
 console.log(`--tune ${keyId} ${side} RESULT: flex ${applied.flex.toFixed(1)} dev ${applied.dev.toFixed(1)} twist ${applied.twist.toFixed(1)} → maxBend ${fin.worst.toFixed(1)}° @${fin.wt.toFixed(3)}s`);
 console.log(`   UI moves: ${JSON.stringify(moves)}`);
}
/* --solve <keyId> <targetBendDeg> [side]: rotate the key's stored hand frame
 * so `forward` keeps its current deviation DIRECTION from the forearm but
 * shrinks to the target bend — the minimum-intent edit. Solves for the
 * flex/dev deltas the wrist sliders would apply (iterating the first-order
 * decomposition until the residual is <0.1°), then prints them. */
const solIdx=process.argv.indexOf('--solve');
if(solIdx>0){
 const keyId=process.argv[solIdx+1],targetBend=Number(process.argv[solIdx+2]),side=optArg(solIdx+3,'R') as 'L'|'R';
 const k=doc.keys.find(x=>x.id===keyId||x.label===keyId)!;
 const H=()=>side==='L'?k.pose.handL:k.pose.handR;
 const f0=frameAt(doc,k.time,origin);solveEffectiveFrame(rig,f0);
 const forearm=rig.point(`wrist_${side}`).sub(rig.point(`lowerarm01_${side}`)).normalize();
 const acc={flex:0,dev:0};
 const bendOf=()=>{
  const h=H(),f=toV(h.forward).normalize();
  return forearm.angleTo(f)/DEG;
 };
 for(let it=0;it<10;it++){
  const h=H(),f=toV(h.forward).normalize(),n=toV(h.normal).normalize();
  const bend=forearm.angleTo(f)/DEG;
  if(Math.abs(bend-targetBend)<.05)break;
  // Desired forward: rotate forearm toward f by targetBend/bend of the way —
  // the smallest frame edit that lands the bend on target.
  const q=new Quaternion().setFromUnitVectors(forearm,f);
  q.slerp(new Quaternion(),1-targetBend/bend);
  const fd=forearm.clone().applyQuaternion(q).normalize();
  // First-order decomposition onto the slider axes: flex rotates about
  // A1=f×n (moves f toward n), dev about n (moves f toward −A1).
  const a1=new Vector3().crossVectors(f,n);
  const delta=fd.clone().sub(f);
  const dflex=delta.dot(n)/DEG,ddev=-delta.dot(a1)/DEG;
  rotateHandFrame(h,'flex',dflex);rotateHandFrame(h,'dev',ddev);
  acc.flex+=dflex;acc.dev+=ddev;
 }
 console.log(`--solve ${keyId} ${side}: bend now ${bendOf().toFixed(2)}° — apply via sliders: 屈/伸 ${acc.flex.toFixed(1)}° 尺桡偏 ${acc.dev.toFixed(1)}°`);
}
