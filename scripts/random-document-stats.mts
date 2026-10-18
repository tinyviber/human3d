// Random workshop documents through the public service: which ones the
// semantic validator refuses, why, and how many accepted documents still carry
// failed solver quality checks. Usage:
//   tsx scripts/random-document-stats.mts [seed=1] [count=8] [saveDir]
// A seed always produces the same documents. With saveDir, each refused
// document is written there as a /v1/motions request (the pelvis-fold fixture
// under spec/examples is seed 1, document 2).
import fs from 'node:fs';
import path from 'node:path';
import {createService,handleRequest} from '../src/server/service';
import {blankDocument,serializeDoc,type WorkshopDoc,type WorkshopKey} from '../src/workshop/document';
import {mulberry32} from '../src/workshop/random-document';
import type {PosePackage} from '../src/core/pose-package';

const [seed0=1,count=8]=process.argv.slice(2,4).map(Number);
const saveDir=process.argv[4];
const ctx=await createService(path.resolve('public'));
const rig=ctx.rig;
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));

const rnd=mulberry32(seed0);
const r=(a:number,b:number)=>a+(b-a)*rnd();

function docWith(times:number[],edit:(i:number,k:WorkshopKey)=>void,duration:number):WorkshopDoc{
  const base=blankDocument(rig.rest,'t','t');const tmpl=base.keys[0];
  const doc:WorkshopDoc={...base,duration,keys:[]};
  times.forEach((time,i)=>{const k=clone(tmpl);k.id=`k${i}`;k.time=time;edit(i,k);doc.keys.push(k);});
  return doc;
}

function randomDocument():WorkshopDoc{
  const duration=r(.6,4);const n=2+Math.floor(rnd()*3);
  const times=Array.from({length:n},(_,i)=>i===0?0:Math.min(duration-.05,(i/(n-1))*duration));
  return docWith(times,(_,k)=>{
    k.constraints={plantL:rnd()<.7,plantR:rnd()<.7,grip:rnd()<.5,contact:false};
    k.pose.root={x:r(-.1,.1),y:r(-.2,.05),z:r(-.1,.1)};
    k.pose.lean=r(-20,30);k.pose.chest=r(-20,20);k.pose.yaw=r(-40,40);
    k.pose.footL.target={x:r(-.2,.2),y:r(0,.3),z:r(-.3,.3)};k.pose.footR.target={x:r(-.2,.2),y:r(0,.3),z:r(-.3,.3)};
  },duration);
}

// Group validator messages by kind, dropping the measured values.
const kindOf=(detail:string)=>detail.replace(/^semantic: /,'').split(' at t=')[0].replace(/[\d.]+/g,'N');
const tally=new Map<string,number>();
let accepted=0,acceptedWithFailedChecks=0,rejected=0,errors=0;

for(let n=0;n<count;n++){
  const req={action:{id:'workshop-doc',parameters:{document:JSON.parse(serializeDoc(randomDocument()))}},sample:{fps:40}};
  const res=handleRequest(ctx,'POST','/v1/motions',req,{});
  const label=`seed${seed0} doc${n}`;
  if(res.status===200){
    accepted++;
    const failed=(res.body as PosePackage).quality.checks.filter(c=>!c.ok).map(c=>c.code);
    if(failed.length)acceptedWithFailedChecks++;
    console.log(`${label} accepted${failed.length?`  quality failed: ${failed.join(', ')}`:''}`);
  }else if(res.status===422){
    rejected++;
    const details=(res.body as {error:{details:string[]}}).error.details;
    details.forEach(d=>tally.set(kindOf(d),(tally.get(kindOf(d))??0)+1));
    console.log(`${label} rejected  ${details.join(' | ')}`);
    if(saveDir){
      fs.mkdirSync(saveDir,{recursive:true});
      fs.writeFileSync(path.join(saveDir,`seed${seed0}-doc${n}.request.json`),JSON.stringify(req,null,1)+'\n');
    }
  }else{
    errors++;
    console.log(`${label} HTTP ${res.status} ${JSON.stringify(res.body).slice(0,200)}`);
  }
}

console.log(`seed ${seed0}: ${accepted} accepted (${acceptedWithFailedChecks} with failed quality checks), ${rejected} rejected, ${errors} other`);
for(const [kind,n] of [...tally].sort((a,b)=>b[1]-a[1]))console.log(`  ${n} × ${kind}`);