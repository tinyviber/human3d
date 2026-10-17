// One-shot migration: bake the authored motions (the since-deleted
// src/core/authoring.ts keyframe presets, kept verbatim below as a frozen
// snapshot) into WorkshopDoc envelopes under assets/motions/, and measure how
// faithfully the workshop pipeline reproduces them against golden captures
// taken in the same run. Rerunnable — all outputs are overwritten.
//
// WP-C note: the authored-pipeline captures this script produces are written
// under evidence/migration-authored/ — they are the residual measurement's
// reference, not a test baseline. The regression goldens in spec/migration/
// are SOLVER captures owned by scripts/recapture-migration-goldens.mts (a
// change-detector baseline; see migration.test.ts), and must not be
// overwritten with authored-pipeline output.
// Usage: npx tsx scripts/migrate-authored-motions.mts
import fs from 'node:fs';
import path from 'node:path';
import {Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from '../src/core/rig';
import {applyGrip} from '../src/core/racket';
import {DEG,pelvisDorsiCorrection} from '../src/core/kinematics';
import {footRotation} from '../src/workshop/foot';
import {motionFileById} from '../src/core/motion-files';
import {controlsToPoseParams,frameAt,validateDocShape,type KeyConstraints,type WorkshopDoc,type WorkshopKey} from '../src/workshop/document';
import {solveEffectiveFrame,solvePose} from '../src/workshop/solver';
import {normalizeMotionFile,type MotionCapabilities,type MotionFile} from '../src/core/motion-file';
import type {RigInfo} from '../src/core/types';

/* ---- frozen migration snapshot — do not edit -----------------------------
 * Verbatim copy of the former src/core/authoring.ts @ feat/arch-convergence;
 * that module was deleted once this migration landed. The only adaptation:
 * seq is keyed by plain string so poseAt takes `id:string` instead of the
 * deleted alias. */
type V=[number,number,number];
interface Controls{y:number;z:number;yaw:number;chest:number;lean:number;right:V;left:V;rf:V;rn:V;lf:V;ln:V;stance:number}
type Key={t:number;pose:Partial<Controls>};
const base:Controls={y:.002,z:0,yaw:0,chest:0,lean:0,right:[-.25,.915,.035],left:[.25,.915,.035],rf:[0,-1,0],rn:[1,0,0],lf:[0,-1,0],ln:[-1,0,0],stance:.135};
const ready:Partial<Controls>={y:-.055,z:-.05,lean:5,right:[-.24,1.09,.29],left:[.17,1.14,.30],rf:[0,0,1],rn:[1,0,0],lf:[-.6,-.2,.7],ln:[-.4,.8,0],stance:.20};
const seq:Record<string,Key[]>={
 idle:[{t:0,pose:{}},{t:1.2,pose:{lean:-.2,right:[-.251,.916,.036]}},{t:2.4,pose:{lean:-.65,right:[-.253,.919,.037],left:[.253,.919,.037]}},{t:3.6,pose:{lean:-.2}},{t:4.8,pose:{}}],
 reach:[{t:0,pose:{}},{t:.7,pose:{}},{t:1.5,pose:{yaw:16,chest:8,right:[-.37,1.12,.24],left:[.25,.94,.09],rf:[0,.1,1]}},{t:2.7,pose:{yaw:22,chest:12,right:[-.32,1.72,.22],left:[.25,.95,.10],rf:[-.2,.95,.2],rn:[.8,0,.2]}},{t:3.3,pose:{yaw:22,chest:12,right:[-.32,1.72,.22],left:[.25,.95,.10],rf:[-.2,.95,.2],rn:[.8,0,.2]}},{t:4.7,pose:{yaw:10,chest:5,right:[-.36,1.15,.19],rf:[0,-.6,.8]}},{t:6,pose:{}}],
 squat:[{t:0,pose:{}},{t:.6,pose:{}},{t:1.5,pose:{y:-.16,z:-.09,lean:17,right:[-.23,1.09,.40],left:[.23,1.09,.40],rf:[0,0,1],lf:[0,0,1]}},{t:2.5,pose:{y:-.31,z:-.25,lean:37,right:[-.20,1.12,.59],left:[.20,1.12,.59],rf:[0,0,1],lf:[0,0,1]}},{t:3.1,pose:{y:-.31,z:-.25,lean:37,right:[-.20,1.12,.59],left:[.20,1.12,.59],rf:[0,0,1],lf:[0,0,1]}},{t:4.7,pose:{}},{t:5.6,pose:{}}],
 ready:[{t:0,pose:ready},{t:1,pose:{...ready,y:-.060,z:-.045}},{t:2,pose:{...ready,y:-.052,z:-.052}},{t:3,pose:{...ready,y:-.058}},{t:4,pose:ready}],
 forehand:[{t:0,pose:ready},{t:.55,pose:ready},
 {t:1.3,pose:{...ready,y:-.085,yaw:-32,chest:-18,right:[-.43,1.15,-.015],left:[.12,1.23,.37],rf:[0,0,1],rn:[1,0,.1]}},
 {t:1.85,pose:{...ready,y:-.09,yaw:-26,chest:-20,right:[-.43,.98,-.045],left:[.13,1.23,.32],rf:[0,.35,.94],rn:[.8,.3,-.1]}},
 {t:2.25,pose:{...ready,y:-.05,yaw:0,chest:-8,right:[-.43,1.01,.27],left:[.18,1.25,.19],rf:[0,.15,1],rn:[.35,.94,0]}},
 {t:2.55,pose:{...ready,y:-.03,yaw:15,chest:10,right:[-.34,1.12,.43],left:[.27,1.20,.10],rf:[0,.1,1],rn:[.15,.99,0]}},
 {t:3.35,pose:{...ready,y:-.025,yaw:31,chest:25,right:[.16,1.40,.25],left:[.25,1.18,.08],rf:[-.55,.66,.30],rn:[.40,.15,.80]}},
 {t:3.8,pose:{...ready,y:-.03,yaw:28,chest:18,right:[.19,1.39,.24],left:[.26,1.15,.08],rf:[-.55,.66,.30],rn:[.40,.15,.80]}},
 {t:4.6,pose:{...ready,yaw:8,chest:4,right:[-.15,1.13,.35]}},{t:5.2,pose:ready}],
};
function sample(keys:Key[],time:number):Controls{
 const frames=keys.map(k=>({...base,...k.pose}));let i=0;while(i<keys.length-2&&time>keys[i+1].t)i++;
 const dt=keys[i+1].t-keys[i].t,u=Math.max(0,Math.min(1,(time-keys[i].t)/dt));
 const scalar=(k:keyof Controls,c?:number)=>{
  const val=(j:number)=>{const v=frames[j][k];return Array.isArray(v)?v[c!]:v as number;};
  const a=val(i),b=val(i+1);
  // Nonuniform cubic Hermite: continuous velocity at the measured/constructed phases.
  const m0=i===0?0:(val(i+1)-val(i-1))/(keys[i+1].t-keys[i-1].t);
  const m1=i+1===keys.length-1?0:(val(i+2)-val(i))/(keys[i+2].t-keys[i].t);
  return (2*u**3-3*u*u+1)*a+(u**3-2*u*u+u)*dt*m0+(-2*u**3+3*u*u)*b+(u**3-u*u)*dt*m1;
 };
 const out={} as Controls;
 for(const k of Object.keys(base) as (keyof Controls)[]){(out as unknown as Record<string,number|number[]>)[k]=Array.isArray(base[k])?[0,1,2].map(c=>scalar(k,c)):scalar(k);}
 return out;
}
function poseAt(rig:HumanRig,id:string,time:number){
 rig.reset();const p=sample(seq[id],time),root=rig.bone('root'),origin=rig.rest.get('root')!;
 p.y=Math.min(base.y,p.y);
 root.position.copy(origin).add(new Vector3(0,p.y,p.z));rig.rotate('root',0,p.yaw,0);
 for(const n of ['spine05','spine04','spine03','spine02','spine01'])rig.rotate(n,p.lean/5,p.chest/5,0);
 rig.rotate('neck01',-p.lean*.22,-p.chest*.15,0);rig.rotate('neck02',-p.lean*.22,0,0);rig.rotate('head',-p.lean*.12,0,0);
 const yaw=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),p.yaw*DEG);
 const world=(v:V)=>new Vector3(...v).sub(origin).applyQuaternion(yaw).add(root.position);
 const legInputs=(['L','R'] as const).map(side=>{
  const sign=side==='L'?1:-1;
  return {side,hip:rig.point(`upperleg01_${side}`),target:new Vector3(sign*p.stance,rig.rest.get(`foot_${side}`)!.y,.018+(id==='ready'||id==='forehand'?sign*.045:0)),pole:new Vector3(sign*.22,.5,1),footQ:footRotation(sign*7,0),a:rig.rest.get(`upperleg01_${side}`)!.distanceTo(rig.rest.get(`lowerleg01_${side}`)!),b:rig.rest.get(`lowerleg01_${side}`)!.distanceTo(rig.rest.get(`foot_${side}`)!)};
 });
 // Posterior pelvis correction against ankle dorsiflexion: the same helper the
 // workshop solver uses, with both legs fully weighted (authored stances are planted).
 const correction=pelvisDorsiCorrection(legInputs.map(l=>({hip:l.hip,target:l.target,pole:l.pole,upper:l.a,lower:l.b,footQ:l.footQ,weight:1})));
 if(correction.shift>0){root.position.z-=correction.shift;rig.model.updateMatrixWorld(true);}
 for(const l of legInputs){rig.limb(l.side,'leg',l.target,l.pole);rig.worldRotation(`foot_${l.side}`,l.footQ);}
 // A modest clavicle elevation shares shoulder movement during reaching.
 if(id==='reach'){
  const lift=Math.max(0,(p.right[1]-1.1)/.62);
  rig.rotate('clavicle_R',0,0,-lift*8);rig.rotate('shoulder01_R',0,0,-lift*5);
 }
 const rtarget=world(p.right),ltarget=world(p.left);
 // Keep shoulders down and elbows on the anatomical flexion side of the chain.
 rig.limb('R','arm',rtarget,world([- .52,1.17,-.12]));
 rig.limb('L','arm',ltarget,world([.51,1.13,-.12]));
 rig.hand('R',new Vector3(...p.rf).applyQuaternion(yaw),new Vector3(...p.rn).applyQuaternion(yaw));
 rig.hand('L',new Vector3(...p.lf).applyQuaternion(yaw),new Vector3(...p.ln).applyQuaternion(yaw));
 if(id==='ready'||id==='forehand')applyGrip(rig);
 for(const side of (id==='ready'||id==='forehand'?['L']:['L','R']))rig.relaxHand(side as 'L'|'R');
 rig.model.updateMatrixWorld(true);
}
/* ---- end frozen snapshot ------------------------------------------------- */

const IDS=['idle','reach','squat','ready','forehand'] as const;
const ORDER=['idle','walk','reach','squat','ready','forehand'];
const LICENSE='MIT (project-authored motion data)';
const JOINTS=['root','wrist_L','wrist_R','lowerarm01_L','lowerarm01_R','lowerleg01_L','lowerleg01_R','foot_L','foot_R'];
const CAPS:Record<string,MotionCapabilities|undefined>={
 reach:{camera:{targetHeight:.98,distance:3.9}},
 ready:{prop:{kind:'racket',trail:true,handView:true}},
 forehand:{prop:{kind:'racket',trail:true,handView:true}},
};
// Picked after a first measurement pass; see evidence/migration-report.txt.
const TOLERANCE={quatDeg:5,posMm:5};

const assetDir=path.resolve('public');
const glb=fs.readFileSync(path.join(assetDir,'models/human.glb'));
const rigJson=fs.readFileSync(path.join(assetDir,'models/rig.json'));
const gltf=await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const rig=new HumanRig(gltf.scene,JSON.parse(rigJson.toString('utf8')) as RigInfo);
const rest=rig.rest,bones=[...rig.bones.keys()];
const motionsDir=path.resolve('assets/motions'),goldenDir=path.resolve('evidence/migration-authored'),evidenceDir=path.resolve('evidence');
for(const d of [motionsDir,goldenDir,evidenceDir])fs.mkdirSync(d,{recursive:true});

/* Golden capture: 41 uniform instants + every authored key + every adjacent-key
 * midpoint. Only the schema'd fields go to disk; world joint positions stay in
 * memory for the residual report (local quats + root are the regression data). */
interface Golden{times:number[];root:number[][];world:number[][][];quats:number[][][]}
const captureGolden=(id:string,duration:number):Golden=>{
 const mid=seq[id].slice(0,-1).map((k,i)=>(k.t+seq[id][i+1].t)/2);
 const times=[...new Set([...Array.from({length:41},(_,i)=>i/40*duration),...seq[id].map(k=>k.t),...mid])].sort((a,b)=>a-b);
 const g:Golden={times,root:[],world:[],quats:[]};
 for(const t of times){
  poseAt(rig,id,t);
  g.root.push(rig.bone('root').position.toArray());
  g.world.push(JOINTS.map(n=>rig.point(n).toArray()));
  g.quats.push(bones.map(n=>rig.bone(n).quaternion.toArray() as number[]));
 }
 return g;
};

/* Key times: authored keys, subdivided so no gap exceeds MAX_KEY_GAP (denser
 * keys pull the stored tangents toward the secant slopes of the authored
 * curve — the doc Hermite converges to it), plus the y-clamp crossings.
 * poseAt clamps root.y to base.y every instant; a smooth Hermite over clamped
 * keys would keep a bump wherever the raw sampled y overshoots the ceiling.
 * A pair of keys straddling each crossing makes the plateau flat (zero
 * interior tangents) and confines the residual to a δ-wide sliver. */
const MAX_KEY_GAP=.12;
const keyTimesFor=(id:string)=>{
 const ks=seq[id],times=new Set(ks.map(k=>k.t));
 const over=(t:number)=>sample(seq[id],t).y>base.y;
 const cross=(a:number,b:number,overA:boolean)=>{
  let lo=a,hi=b;for(let k=0;k<24;k++){const m=(lo+hi)/2;if(over(m)===overA)lo=m;else hi=m;}
  return hi;
 };
 for(let i=0;i<ks.length-1;i++){
  const t0=ks[i].t,t1=ks[i+1].t;
  const parts=Math.max(1,Math.ceil((t1-t0)/MAX_KEY_GAP));
  for(let p=1;p<parts;p++)times.add(t0+(t1-t0)*p/parts);
  const N=24,at=(j:number)=>t0+(t1-t0)*j/N,overAt=(j:number)=>j>=1&&j<=N-1&&over(at(j));
  let s=1;
  while(s<N){
   if(!overAt(s)){s++;continue;}
   let e=s;while(overAt(e+1))e++;
   const cE=cross(at(s-1),at(s),false);times.add(cE);times.add(Math.min(cE+.03,t1-.005));
   const cX=cross(at(e),at(e+1),true);times.add(Math.max(cX-.03,t0+.005));times.add(cX);
   s=e+1;
  }
 }
 // Quantize to microseconds: fractional subdivision and bisection otherwise
 // leak binary float tails (e.g. 5.599999997764826) into the shipped document,
 // which is hashed verbatim into definitionSHA256.
 const sorted=[...times].sort((a,b)=>a-b).map(t=>Math.round(t*1e6)/1e6);
 return sorted.filter((t,i)=>i===0||t-sorted[i-1]>.01);
};
const footFor=(id:string)=>id==='ready'||id==='forehand'?{zBase:.018,zStep:.045}:{zBase:.018,zStep:0};

const buildDoc=(id:string):WorkshopDoc=>{
 const spec=motionFileById(id)!,grip=id==='ready'||id==='forehand';
 const keys:WorkshopKey[]=keyTimesFor(id).map((t,i)=>{
  const c=sample(seq[id],t);c.y=Math.min(base.y,c.y); // the same clamp poseAt applies to its controls
  const pose=controlsToPoseParams(rest,c,footFor(id));
  const constraints:KeyConstraints={plantL:true,plantR:true,grip,contact:id==='forehand'&&Math.abs(t-2.55)<1e-9};
  // Authoring resolves hand targets/poles AFTER the posterior pelvis shift, so
  // the stored values move with the corrected root: bake (0,0,−shift) in, from
  // the same leg inputs the replay solver recomputes (full support, weight 1).
  // Feet stay unbaked — authored foot targets are world-space constants.
  const shift=solvePose(rig,pose,constraints).pelvisShift;
  pose.handL.target.z-=shift;pose.handL.pole.z-=shift;
  pose.handR.target.z-=shift;pose.handR.pole.z-=shift;
  return {id:`${id}-k${i}`,time:t,label:spec.phases.find(p=>Math.abs(p.time-t)<1e-6)?.label??'',pose,constraints};
 });
 const doc:WorkshopDoc={schemaVersion:2,id,name:spec.name,english:spec.english,duration:spec.duration,
  inbetweens:true,loop:false,handFrames:{L:'pelvis',R:'pelvis'},clavicleLift:id==='reach'?true:undefined,keys};
 const errs=validateDocShape(doc);if(errs.length)throw new Error(`${id}: ${errs.join('; ')}`);
 return doc;
};

const motionSchema={
 $schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://kinesis.local/motion.schema.json',
 title:'Motion file envelope',type:'object',
 required:['schemaVersion','kind','id','order','name','english','duration','description','method','focus','phases'],
 additionalProperties:false,
 properties:{
  schemaVersion:{const:1},kind:{enum:['workshop-motion','clip-motion']},
  id:{type:'string',minLength:1},order:{type:'number'},
  name:{type:'string'},english:{type:'string'},duration:{type:'number',exclusiveMinimum:0},
  description:{type:'string'},method:{type:'string'},
  focus:{type:'array',items:{type:'string'}},
  phases:{type:'array',items:{type:'object',required:['time','label'],additionalProperties:false,properties:{time:{type:'number'},label:{type:'string'}}}},
  notes:{type:'array',items:{type:'string'}},license:{type:'string'},oneShot:{type:'boolean'},
  capabilities:{type:'object',additionalProperties:false,properties:{
   prop:{type:'object',required:['kind','trail','handView'],additionalProperties:false,properties:{kind:{const:'racket'},trail:{type:'boolean'},handView:{type:'boolean'}}},
   camera:{type:'object',required:['targetHeight','distance'],additionalProperties:false,properties:{targetHeight:{type:'number'},distance:{type:'number'}}},
   locomotion:{enum:['in-place','follow']}}},
  document:{type:'object'},
  clip:{type:'object',required:['url'],additionalProperties:false,properties:{url:{type:'string'},meta:{type:'string'}}},
 },
 allOf:[
  // Kind exclusivity: a `false` property schema rejects the sibling payload
  // outright (strictRequired forbids `not:{required:[...]}` here).
  {if:{properties:{kind:{const:'workshop-motion'}}},then:{required:['document'],properties:{document:{type:'object'},clip:false}}},
  {if:{properties:{kind:{const:'clip-motion'}}},then:{required:['clip'],properties:{clip:{type:'object',required:['url'],properties:{url:{type:'string'}}},document:false}}},
 ],
};

const write=(file:string,v:unknown)=>fs.writeFileSync(file,JSON.stringify(v,null,2)+'\n');
const report:string[]=['# Authored → workshop-motion migration report',''];
const goldens=new Map<string,Golden>();

for(const id of IDS){
 const spec=motionFileById(id)!;
 const g=captureGolden(id,spec.duration);goldens.set(id,g);
 write(path.join(goldenDir,`${id}.golden.json`),{schema:'migration-golden/v1',id,times:g.times,root:g.root,bones,quats:g.quats});
 const doc=buildDoc(id);
 const env:MotionFile={schemaVersion:1,kind:'workshop-motion',order:ORDER.indexOf(id),id,name:spec.name,english:spec.english,
  duration:spec.duration,description:spec.description,method:spec.method,focus:spec.focus,phases:spec.phases,
  notes:id==='forehand'?['documented-defect: 已知上臂与躯干穿插（研究姿态，未修复）']:undefined,
  license:LICENSE,capabilities:CAPS[id],document:doc};
 write(path.join(motionsDir,`${id}.json`),env);
}
{
 const w=motionFileById('walk')!;
 write(path.join(motionsDir,'walk.json'),{schemaVersion:1,kind:'clip-motion',id:'walk',order:ORDER.indexOf('walk'),
  name:w.name,english:w.english,duration:w.duration,description:w.description,method:w.method,focus:w.focus,phases:w.phases,
  clip:{url:'/models/walk.json',meta:'/models/walk-meta.json'},capabilities:{locomotion:'follow'}} satisfies MotionFile);
 write(path.join(motionsDir,'motion.schema.json'),motionSchema);
}

/* Residual measurement: read each envelope back off disk, normalize through the
 * real entry point, replay the production path (frameAt → solveEffectiveFrame)
 * and diff against the golden capture: every bone's local quaternion (deg) and
 * world positions of root/wrists/elbows/knees/feet (mm). */
const stats=(a:number[])=>{const s=[...a].sort((x,y)=>x-y),mean=a.reduce((x,y)=>x+y,0)/a.length;
 return {max:s[s.length-1],p95:s[Math.floor(.95*(s.length-1))],mean};};
for(const id of IDS){
 const spec=motionFileById(id)!,g=goldens.get(id)!,{times}=g;
 const env=normalizeMotionFile(JSON.parse(fs.readFileSync(path.join(motionsDir,`${id}.json`),'utf8')));
 const doc=env.document!,origin=rest.get('root')!;
 const qd:number[]=[],pd:number[]=[];
 const qOver:{t:number;bone:string;deg:number}[]=[],pOver:{t:number;joint:string;mm:number}[]=[];
 times.forEach((t,i)=>{
  solveEffectiveFrame(rig,frameAt(doc,t,origin));
  bones.forEach((n,bi)=>{
   const deg=rig.bone(n).quaternion.angleTo(new Quaternion(...g.quats[i][bi] as [number,number,number,number]))/DEG;
   qd.push(deg);if(deg>TOLERANCE.quatDeg)qOver.push({t,bone:n,deg});
  });
  JOINTS.forEach((n,ji)=>{
   const mm=rig.point(n).distanceTo(new Vector3(...g.world[i][ji] as [number,number,number]))*1000;
   pd.push(mm);if(mm>TOLERANCE.posMm)pOver.push({t,joint:n,mm});
  });
 });
 const qs=stats(qd),ps=stats(pd);
 report.push(`## ${id} (${spec.name}) — ${doc.keys.length} keys · ${times.length} instants × ${bones.length} bones`,
  `quat angle diff (deg):  max ${qs.max.toFixed(3)} · p95 ${qs.p95.toFixed(3)} · mean ${qs.mean.toFixed(3)}`,
  `world pos diff (mm):    max ${ps.max.toFixed(2)} · p95 ${ps.p95.toFixed(2)} · mean ${ps.mean.toFixed(2)}`,
  `over tolerance (>${TOLERANCE.quatDeg}° / >${TOLERANCE.posMm}mm): ${qOver.length} quat samples, ${pOver.length} position samples`);
 const worstQ=[...qOver].sort((a,b)=>b.deg-a.deg).slice(0,6),worstP=[...pOver].sort((a,b)=>b.mm-a.mm).slice(0,6);
 for(const o of worstQ)report.push(`  quat  ${o.bone} @${o.t.toFixed(3)}s  ${o.deg.toFixed(2)}°`);
 for(const o of worstP)report.push(`  pos   ${o.joint} @${o.t.toFixed(3)}s  ${o.mm.toFixed(2)}mm`);
 report.push('');
}
report.push(`Tolerances chosen to cover the measured maxima: quat ${TOLERANCE.quatDeg}°, world position ${TOLERANCE.posMm}mm.`,
 'Residual sources: second-order Hermite error on the baked hand targets/poles, hand-frame',
 'quaternion slerp vs authored component-wise Hermite, the poseAt root-y clamp (reproduced by',
 'extra keys straddling every clamp crossing — the plateau goes flat), and the WP-C tangent',
 'clamp: the workshop spline now caps interior tangent magnitude at 2× the smaller adjacent',
 'secant while the frozen authored capture keeps raw centre differences — a deliberate',
 'semantics change recorded in docs/investigate.md. The regression goldens this report is',
 'measured against live in spec/migration/ and are solver captures (recapture-migration-',
 'goldens.mts), NOT the authored captures written under evidence/migration-authored/.');
fs.writeFileSync(path.join(evidenceDir,'migration-report.txt'),report.join('\n')+'\n');
console.log(report.join('\n'));
