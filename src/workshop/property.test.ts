import {describe,it,beforeAll} from 'vitest';
import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Quaternion,Vector3} from 'three';
import {HumanRig} from '../core/rig';
import {DEG} from '../core/kinematics';
import {contactStartKey,flattenPose,frameAt,serializeDoc,sortedKeys,toV,validateDocShape,type WorkshopDoc} from './document';
import {footGeometry,type Side} from './foot';
import {solveEffectiveFrame} from './solver';
import {mulberry32,randomDoc} from './random-document';
import {createService,handleRequest,type ServiceContext} from '../server/service';

/** Property sweep over seeded random documents. Every document goes through
 * the real production path — frameAt → solveEffectiveFrame on the skin rig —
 * and the assertions land on the solved skeleton, never on proxies: finite
 * pose channels and unit quaternions, rigid segment lengths, bounded step
 * displacement, held contacts, and feet that never pass under the ground.
 * A failing document reports seed + index + its JSON so it replays verbatim. */
let rig:HumanRig;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
},30000);

const SEEDS=[20260601,7,90210];
const DOCS_PER_SEED=48,UNIFORM=80;
const SIDES:Side[]=['L','R'];
/** flattenPose channel ranges — positions in metres, angles in degrees, hand
 * bases as vector pairs (see document.ts channel layout). */
const POS_CH=[0,7,10,19,22,31,34,39,42];
const ANG_CH=[3,4,5,6,37,38,45,46];
const HAND_FWD=[13,25];
/** Distal lever arm: a body/hand/foot angle change moves the farthest points
 * at roughly this radius. Used only to scale the per-step bound. */
const LEVER=1.3;

const sampleTimes=(doc:WorkshopDoc)=>{
 const s=new Set<number>();
 for(let i=0;i<=UNIFORM;i++)s.add(i*doc.duration/UNIFORM);
 for(const k of doc.keys)s.add(k.time);
 return [...s].sort((a,b)=>a-b);
};

/** Worst key-to-key travel rate the document can inject, in metres per second:
 * position channels weigh directly, rotations count through LEVER, and hand
 * frames through the swing of their forward/normal pair. */
function maxKeyVel(doc:WorkshopDoc){
 const keys=sortedKeys(doc),n=keys.length,flat=keys.map(k=>flattenPose(k.pose));
 const pairs:[number,number][]=[];
 for(let i=0;i<n-1;i++)pairs.push([i,i+1]);
 if(doc.loop&&n>1)pairs.push([n-1,0]);
 let v=0;
 for(const [a,b]of pairs){
  const dt=Math.max(1e-9,(b===0?keys[b].time+doc.duration:keys[b].time)-keys[a].time);
  let travel=0;
  for(const c of POS_CH)travel=Math.max(travel,Math.hypot(flat[b][c]-flat[a][c],flat[b][c+1]-flat[a][c+1],flat[b][c+2]-flat[a][c+2]));
  for(const c of ANG_CH)travel=Math.max(travel,Math.abs(flat[b][c]-flat[a][c])*DEG*LEVER);
  for(const c of HAND_FWD){
   const f0=new Vector3(flat[a][c],flat[a][c+1],flat[a][c+2]),f1=new Vector3(flat[b][c],flat[b][c+1],flat[b][c+2]);
   const n0=new Vector3(flat[a][c+3],flat[a][c+4],flat[a][c+5]),n1=new Vector3(flat[b][c+3],flat[b][c+4],flat[b][c+5]);
   travel=Math.max(travel,Math.max(f0.angleTo(f1),n0.angleTo(n1))*LEVER);
  }
  v=Math.max(v,travel/dt);
 }
 return v;
}

/** Run the full assertion set on one document; returns human-readable problems
 * (empty = clean). Assertions of the sweep contract, in execution order:
 * (1) finite channels, unit quaternions, finite world points; (2) rigid
 * segments; (3) interpolated weights inside [0,1]; (4) soles never under the
 * ground plane; (5) contacts held (effective target, stored contact point,
 * position/rotation between samples); (6) bounded step displacement;
 * (7) deterministic re-solve; (8) loop seam. */
function checkDocument(doc:WorkshopDoc){
 const problems:string[]=[];
 const bad=(m:string)=>{if(problems.length<60)problems.push(m);};
 const origin=rig.rest.get('root')!;
 for(const e of validateDocShape(doc))bad(`validateDocShape: ${e}`);
 const times=sampleTimes(doc),bones=[...rig.bones.keys()];
 const keys=sortedKeys(doc),lastT=keys[keys.length-1].time;
 const geo={L:footGeometry(rig.rest,'L'),R:footGeometry(rig.rest,'R')};
 const vel=maxKeyVel(doc);
 /* The sampler's governing-key semantics differ from constraintsAt at two
  * edges of the interpolated path: frameAt caps its interval index at len−2,
  * so past the last key of a non-loop doc the penultimate key still governs,
  * and a loop wraps t=duration to key 0. Stepped mode is constraintsAt
  * verbatim. contactStartKey must be asked at an instant inside the interval
  * that actually governs t. */
 const governingTime=(t:number)=>{
  if(!doc.inbetweens)return t;
  // The loop chain wraps only at t≥duration (frameAt clamps, then the entry
  // at time D is key 0's periodic copy). A grid sample one ulp below D still
  // resolves the last interval, so the remap must not absorb it.
  if(doc.loop)return t>=doc.duration?0:t;
  return t>=lastT?(keys[keys.length-2].time+lastT)/2:t;
 };
 let prevPts:Map<string,Vector3>|undefined,prevT=0;
 const wasPlanted:Record<Side,boolean>={L:false,R:false};
 const prevFoot:Partial<Record<Side,Vector3>>={},prevFootQ:Partial<Record<Side,Quaternion>>={};
 const detAt=new Set([0,times.length>>1,times.length-1]);
 for(const [idx,t]of times.entries()){
  const f=frameAt(doc,t,origin);
  solveEffectiveFrame(rig,f);
  rig.model.updateMatrixWorld(true);
  const pts=new Map<string,Vector3>();
  // (1) finite channels, unit quaternions, finite world points; (2) rigid segments
  // (segment lengths measured on local translations against the rest pose)
  if(!flattenPose(f.pose).every(Number.isFinite))bad(`t=${t.toFixed(3)} flattenPose non-finite`);
  if(!Number.isFinite(f.support.L+f.support.R+f.gripAmount))bad(`t=${t.toFixed(3)} non-finite support/grip`);
  for(const n of bones){
   const b=rig.bone(n),p=b.getWorldPosition(new Vector3());
   pts.set(n,p);
   const ql=b.quaternion.length();
   if(!(Math.abs(ql-1)<1e-4))bad(`t=${t.toFixed(3)} ${n} |q|=${ql.toFixed(6)}`);
   if(!Number.isFinite(p.x+p.y+p.z))bad(`t=${t.toFixed(3)} ${n} point non-finite`);
   if(n!=='root'){
    const d=b.position.distanceTo(rig.restLocal.get(n)!);
    if(d>1e-7)bad(`t=${t.toFixed(3)} ${n} segment moved ${(d*1000).toFixed(3)}mm`);
   }
  }
  // (3) interpolated weights stay inside [0,1]
  for(const [nm,v]of [['support.L',f.support.L],['support.R',f.support.R],['gripAmount',f.gripAmount]]as const)
   if(!(v>=0&&v<=1))bad(`t=${t.toFixed(3)} ${nm}=${v} outside [0,1]`);
  // (4) the sole never passes under the ground plane (2mm tolerance)
  for(const s of SIDES)for(const n of geo[s].names){
   const y=pts.get(n)!.y;
   if(!(y>=-.002))bad(`t=${t.toFixed(3)} ${n} y=${y.toFixed(4)} under ground`);
  }
  // (5) contacts: position held ≤2mm/step, orientation ≤1°/step, and the
  // solved ankle within 6mm of both the effective target and the run's
  // stored contact point
  for(const s of SIDES){
   const planted=s==='L'?f.constraints.plantL:f.constraints.plantR;
   const footKey=s==='L'?'footL':'footR';
   const p=pts.get(`foot_${s}`)!,q=rig.bone(`foot_${s}`).getWorldQuaternion(new Quaternion());
   if(planted){
    const eff=p.distanceTo(toV(f.pose[footKey].target));
    if(eff>.006)bad(`t=${t.toFixed(3)} foot_${s} off effective target by ${(eff*1000).toFixed(1)}mm`);
    const start=contactStartKey(doc,s,governingTime(t));
    if(!start)bad(`t=${t.toFixed(3)} foot_${s} flagged planted but no contact run owns it`);
    else{
     const res=p.distanceTo(toV(start.pose[footKey].target));
     if(res>.006)bad(`t=${t.toFixed(3)} foot_${s} ${(res*1000).toFixed(1)}mm from stored contact (key ${start.id})`);
    }
    if(wasPlanted[s]){
     const step=p.distanceTo(prevFoot[s]!),ang=q.angleTo(prevFootQ[s]!)/DEG;
     if(step>.002)bad(`t=${t.toFixed(3)} planted foot_${s} moved ${(step*1000).toFixed(2)}mm between samples`);
     if(ang>1)bad(`t=${t.toFixed(3)} planted foot_${s} rotated ${ang.toFixed(2)}° between samples`);
    }
   }
   wasPlanted[s]=planted;prevFoot[s]=p;prevFootQ[s]=q;
  }
  // (6) bounded step displacement — interpolated docs only (stepped mode is
  // piecewise-constant and jumps at keys by design)
  if(doc.inbetweens&&prevPts){
   const dt=t-prevT;
   /* Bound provenance: `vel·dt` is the worst key-to-key travel the document
    * channels can inject (maxKeyVel); ×4 is slack for Hermite interior
    * tangents exceeding the secant rate between keys — since WP-C they are
    * capped at 2× the smaller adjacent secant (TANGENT_SECANT_CAP), so the
    * factor now carries double headroom rather than an unbounded curve.
    * `+.8·dt` covers
    * solver-added displacement the channels don't express: the posterior
    * pelvis shift (≤.15 m, solver maxShift) fades in/out with the support
    * weights across a transition interval — up to ~0.75 m/s of root motion
    * over a ~.2 s fade. The .05 m floor keeps near-static documents
    * measurable — it absorbs fixed per-sample residue such as grip-ramp
    * finger travel and one-step contact corrections, which are not driven
    * by key velocity at all. */
   const bound=Math.max(.05,4*vel*dt+.8*dt);
   for(const n of bones){
    const d=pts.get(n)!.distanceTo(prevPts.get(n)!);
    if(d>bound+1e-9)bad(`t=${t.toFixed(3)} ${n} stepped ${d.toFixed(4)}m > bound ${bound.toFixed(4)}m (dt=${dt.toFixed(4)}s, keyVel=${vel.toFixed(2)}m/s)`);
   }
  }
  // (7) determinism: re-solving the same frame must be bitwise identical
  if(detAt.has(idx)){
   const snap=bones.map(n=>{const b=rig.bone(n);return[b.position.x,b.position.y,b.position.z,b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w];});
   solveEffectiveFrame(rig,frameAt(doc,t,origin));
   rig.model.updateMatrixWorld(true);
   for(const [bi,n]of bones.entries()){
    const b=rig.bone(n),s=snap[bi],now=[b.position.x,b.position.y,b.position.z,b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w];
    for(let c=0;c<7;c++)if(now[c]!==s[c]){bad(`t=${t.toFixed(3)} re-solve differs on ${n} ch${c}: ${s[c]} → ${now[c]}`);break;}
   }
  }
  prevPts=pts;prevT=t;
 }
 // (8) loop seam: the wrap step must look like any other uniform step
 if(doc.loop&&doc.inbetweens){
  const dt=doc.duration/UNIFORM;
  const diff=(a:number,b:number)=>{const x=flattenPose(frameAt(doc,a,origin).pose),y=flattenPose(frameAt(doc,b,origin).pose);let m=0;for(let i=0;i<x.length;i++)m=Math.max(m,Math.abs(x[i]-y[i]));return m;};
  const seam=diff(doc.duration-dt,dt);
  let typical=0;for(let i=0;i<UNIFORM;i++){const a=i*dt;typical=Math.max(typical,diff(a,a+dt));}
  if(!(seam<2*typical+1e-3))bad(`loop seam step ${seam.toFixed(4)} ≥ 2× typical ${typical.toFixed(4)}`);
 }
 return problems;
}

function runSeed(seed:number){
 const rng=mulberry32(seed);
 for(let di=0;di<DOCS_PER_SEED;di++){
  const doc=randomDoc(rng,rig.rest);
  let problems:string[];
  try{problems=checkDocument(doc);}
  catch(e){throw new Error(`seed ${seed} doc ${di} threw ${e instanceof Error?e.stack:e}\n${serializeDoc(doc)}`);}
  if(problems.length)
   throw new Error(`seed ${seed} doc ${di} (${doc.inbetweens?'interpolated':'stepped'}${doc.loop?' loop':''}, ${doc.keys.length} keys, ${doc.duration.toFixed(2)}s):\n${problems.slice(0,25).join('\n')}\n${serializeDoc(doc)}`);
 }
}

describe('random document sweep',()=>{
 for(const seed of SEEDS)
  it(`seed ${seed}: ${DOCS_PER_SEED} documents stay finite, rigid, continuous and contact-stable`,()=>runSeed(seed),180000);
});

describe('random documents through the service',()=>{
 let ctx:ServiceContext;
 beforeAll(async()=>{ctx=await createService('public');},30000);
 for(const seed of SEEDS)
  it(`seed ${seed}: every 200 package satisfies the schema, every 422 is purely semantic`,()=>{
   const rng=mulberry32(seed^0x51ab);
   for(let di=0;di<12;di++){
    const doc=randomDoc(rng,ctx.rig.rest);
    const wire=JSON.parse(serializeDoc(doc));
    const res=handleRequest(ctx,'POST','/v1/motions',{action:{id:'workshop-doc',parameters:{document:wire}}});
    if(res.status===200){
     if(!ctx.contract.posePackage(res.body))
      throw new Error(`seed ${seed} doc ${di}: 200 but schema rejects package: ${JSON.stringify(ctx.contract.posePackage.errors)}\n${serializeDoc(doc)}`);
    }else if(res.status===422){
     const details=(res.body as {error:{details:string[]}}).error.details;
     const nonSemantic=details.filter(d=>!d.startsWith('semantic:'));
     if(!details.length||nonSemantic.length)
      throw new Error(`seed ${seed} doc ${di}: 422 with non-semantic details ${JSON.stringify(nonSemantic)}\n${serializeDoc(doc)}`);
    }else throw new Error(`seed ${seed} doc ${di}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0,300)}\n${serializeDoc(doc)}`);
   }
  },120000);
});
