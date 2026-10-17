import {Quaternion,Vector3} from 'three';
import {DEG} from '../core/kinematics';
import {blankDocument,canonicalizeHands,contactStartKey,frameAt,toV,validateDocShape,type FootTarget,type HandTarget,type PoseParams,type V3,type WorkshopDoc,type WorkshopKey} from './document';
import {ankleYForLift,footGeometry,soleOffset,type Side} from './foot';
import {WORKSHOP_LIMITS} from './limits';

/** mulberry32 — the seeded PRNG the workshop tests and scripts use. Two copies
 * still live inline (regressions.test.ts, scripts/random-document-stats.mts);
 * new consumers draw from here so a seed means the same stream everywhere. */
export function mulberry32(seed:number):()=>number{
 let s=seed;
 return ()=>{
  s|=0;s=s+0x6D2B79F5|0;
  let t=Math.imul(s^s>>>15,1|s);
  t=t+Math.imul(t^t>>>7,61|t)^t;
  return((t^t>>>14)>>>0)/4294967296;
 };
}

const MIN_KEY_GAP=.02;
/** The pelvis correction can pull the root up to this far posterior (solver
 * maxShift). A planted contact must stay reachable even at full shift. */
const PELVIS_SHIFT_M=.15;
/** Trajectory sampling step for the hip/sole verification sweeps — fine
 * enough that Hermite wiggles between samples stay under a millimetre. */
const TRAJECTORY_DT=.012;
/** Target-channel sole clearance the generator insists on: the solved ankle
 * tracks a reachable target within a few millimetres, so a sole estimate at
 * this floor keeps every real toe above the −2mm property bound. */
const CLEARANCE_M=.012;

/** Sorted, strictly increasing key times anchored at 0, built from random gaps
 * so every draw is valid — no rejection loop and no clamping onto duplicates.
 * `fill` spreads the keys over a random share of [0,span]; the gap floor keeps
 * Hermite intervals non-degenerate. */
function randomTimes(rng:()=>number,n:number,span:number):number[]{
 while(n>2&&span<MIN_KEY_GAP*(n-1))n--;
 const w:number[]=[];for(let i=0;i<n-1;i++)w.push(rng());
 const sum=w.reduce((a,b)=>a+b,0)||1;
 const leftover=Math.max(0,span-MIN_KEY_GAP*(n-1)),fill=rng();
 const times=[0];let t=0;
 for(let i=0;i<n-1;i++){t+=MIN_KEY_GAP+leftover*fill*w[i]/sum;times.push(t);}
 return times;
}

/** A random document sampled inside the validated domain, built on the blank
 * template so the container fields are always well-formed. Domain choices:
 *  - root is narrowed to ±.15/.2 vs the UI's full ±.6 — the far corner is the
 *    pelvis-fold region the semantic validator exists to reject, and a
 *    generator that mostly produces rejected input tests nothing;
 *  - foot target.y is the *inverse* of the lift handle (ankleYForLift), so the
 *    stored ankle height puts the sole at lift≥0 above the rest sole plane
 *    for every yaw/pitch — a foot can never be stored under ground;
 *  - every foot target is pulled inside the leg's reach sphere about the
 *    key's own posed hip (|hip−target| ≤ upper+lower−.01), and contact-run
 *    starts additionally stay reachable from every hip the run sees —
 *    including the fully shifted pelvis — so a held contact cannot drift out
 *    of reach mid-run;
 *  - hand forward/normal are random directions re-orthogonalized by the same
 *    canonicalizeHands the parser applies, so the stored pair always forms a
 *    valid frame.
 * After construction the document must pass validateDocShape; a field that
 * fails is resampled (scoped to the offending key when the error names one),
 * never released invalid. */
export function randomDoc(rng:()=>number,rest:ReadonlyMap<string,Vector3>):WorkshopDoc{
 const r=(a:number,b:number)=>a+(b-a)*rng();
 const restRoot=rest.get('root')!;
 const geo={L:footGeometry(rest,'L'),R:footGeometry(rest,'R')};
 const yawQ=(deg:number)=>new Quaternion().setFromAxisAngle(new Vector3(0,1,0),deg*DEG);
 const restHip=(s:Side)=>rest.get(`upperleg01_${s}`)!;
 /** World hip position under a pose's root offset and pelvis yaw — the same
  * chain the solver applies (root translate, then Y-rotation; spine bends do
  * not reach the pelvis). */
 const hipAt=(s:Side,root:V3,yaw:number)=>restHip(s).clone().sub(restRoot).applyQuaternion(yawQ(yaw)).add(restRoot).add(toV(root));
 /** Leg reach annulus. Far side: |hip−target| ≤ upper+lower−.01 keeps the two
  * bone solve inside reach. Near side: the knee cannot flex past 135°, so
  * solveTwoBone clamps targets closer than
  * sqrt(a²+b²+2ab·cos135°) — a planted foot there slides off its contact, so
  * contacts need the lower bound too. */
 const legSpan=(s:Side)=>({a:rest.get(`upperleg01_${s}`)!.distanceTo(rest.get(`lowerleg01_${s}`)!),
  b:rest.get(`lowerleg01_${s}`)!.distanceTo(rest.get(`foot_${s}`)!)});
 const legReach=(s:Side)=>{const {a,b}=legSpan(s);return a+b-.01;};
 const legMinReach=(s:Side)=>{const {a,b}=legSpan(s);return Math.sqrt(a*a+b*b+2*a*b*Math.cos(135*DEG))+.005;};
 const vec=(x:[number,number],y:[number,number],z:[number,number]):V3=>({x:r(...x),y:r(...y),z:r(...z)});
 const dir=():V3=>vec([-1,1],[-1,1],[-1,1]);

 /** Move `target` inside the reach annulus [legMinReach, legReach] of every
  * hip in `hips`, preserving y where possible (raising y can only add sole
  * clearance; horizontal nudges never lower it). Iterative projection onto
  * the annuli∩balls converges while their intersection is nonempty; the pass
  * bound keeps a pathological draw from spinning. */
 const clampReach=(s:Side,target:V3,hips:Vector3[])=>{
  const hi=legReach(s),lo=legMinReach(s);
  for(let pass=0;pass<10;pass++){
   let moved=false;
   for(const hip of hips){
    let dy=target.y-hip.y;
    // Too close to the hip (knee past the flexion limit): the horizontal
    // offset must reach sqrt(lo²−dy²); already satisfied when |dy|≥lo.
    if(Math.abs(dy)<lo){
     const dx=target.x-hip.x,dz=target.z-hip.z,flat=Math.hypot(dx,dz);
     const needFlat=Math.sqrt(lo*lo-dy*dy);
     if(flat<needFlat){
      if(flat>1e-9){const k=needFlat/flat;target.x=hip.x+dx*k;target.z=hip.z+dz*k;}
      else{target.x=hip.x+needFlat;}
      moved=true;
     }
    }
    // Too far: pull toward the hip horizontally; if the ankle sits deeper
    // below the hip than the leg is long, raise it (never lower it).
    dy=target.y-hip.y;
    if(-dy>hi){target.y=hip.y-hi+1e-3;dy=target.y-hip.y;moved=true;}
    const dx=target.x-hip.x,dz=target.z-hip.z,flat=Math.hypot(dx,dz);
    const allowed=Math.sqrt(Math.max(0,hi*hi-dy*dy));
    if(flat>allowed&&flat>1e-9){const k=allowed/flat;target.x=hip.x+dx*k;target.z=hip.z+dz*k;moved=true;}
   }
   if(!moved)break;
  }
 };

 const makePose=():PoseParams=>{
  const root=vec([-.15,.15],[-.2,.05],[-.15,.15]);
  const yaw=r(-90,90),lean=r(-35,35),chest=r(-45,45),side=r(-30,30);
  const hand=():HandTarget=>({target:vec([-.7,.7],[.4,1.75],[-.5,.7]),pole:vec([-.8,.8],[0,1.8],[-.6,.8]),forward:dir(),normal:dir()});
  const foot=(s:Side):FootTarget=>{
   const fyaw=r(-45,45),pitch=r(-30,30);
   const target=vec([-.4,.4],[0,0],[-.4,.4]);
   target.y=ankleYForLift(geo[s],r(0,.4),fyaw,pitch);
   const hip=hipAt(s,root,yaw);
   clampReach(s,target,[hip,hip.clone().add(new Vector3(0,0,-PELVIS_SHIFT_M))]);
   return {target,pole:vec([-.6,.6],[.05,.8],[-.5,.9]),yaw:fyaw,pitch};
  };
  const pose:PoseParams={root,yaw,lean,chest,side,handL:hand(),handR:hand(),footL:foot('L'),footR:foot('R')};
  canonicalizeHands(pose);
  return pose;
 };

 const makeKey=(i:number,time:number):WorkshopKey=>{
  const grip=rng()<.4;
  return {id:`k${i}`,time,label:'',pose:makePose(),
   constraints:{plantL:rng()<.7,plantR:rng()<.7,grip,contact:grip&&rng()<.2}};
 };

 /** End instant of the planted run starting at key i: the first unplanted
  * key's time (the release instant still stands on the contact), wrapping
  * around the seam for loops, or the document end when nothing releases it.
  * Hip positions over that span are sampled through the real frameAt path so
  * Hermite drift between keys counts too — contacts verified only at key
  * instants can still be dragged out of the reach annulus mid-interval. */
 const endOfRun=(keys:WorkshopKey[],planted:boolean[],i:number,loop:boolean,duration:number)=>{
  const n=keys.length;
  if(loop&&planted.every(Boolean))return keys[i].time+duration;
  for(let step=1;step<n;step++){
   const j=i+step,idx=loop?j%n:j;
   if(idx>=n)break;
   if(!planted[idx])return keys[idx].time+Math.floor(j/n)*duration;
  }
  return loop?keys[i].time+duration:duration;
 };

 /** Hip positions along [t0,t1] through the real sampler, plus the fully
  * shifted-pelvis variant of each. Loop times wrap; a non-loop tail holds
  * the last pose. */
 const hipTrajectory=(doc:WorkshopDoc,s:Side,t0:number,t1:number)=>{
  const hips:Vector3[]=[],D=doc.duration,span=Math.max(0,t1-t0);
  const steps=Math.max(2,Math.min(600,Math.ceil(span/TRAJECTORY_DT)+1));
  for(let k=0;k<=steps;k++){
   let t=t0+span*k/steps;
   t=doc.loop?((t%D)+D)%D:Math.min(t,D);
   const p=frameAt(doc,t,restRoot).pose;
   const hip=hipAt(s,p.root,p.yaw);
   hips.push(hip,hip.clone().add(new Vector3(0,0,-PELVIS_SHIFT_M)));
  }
  return hips;
 };

 const reachViolation=(s:Side,target:V3,hip:Vector3)=>{
  const d=hip.distanceTo(toV(target));
  return Math.max(d-legReach(s),legMinReach(s)-d);
 };

 /** Strengthen run-start contacts: the stored target of a planted run's first
  * key is the contact the whole run holds, so it must stay inside the reach
  * annulus of the hip at every instant of the run (the release instant still
  * stands on it) with the pelvis anywhere in its posterior shift range.
  * Returns false when the annulus intersection came up empty — the caller
  * regenerates rather than emits a doc whose contact cannot be held. */
 const strengthenContacts=(doc:WorkshopDoc):boolean=>{
  const keys=[...doc.keys].sort((a,b)=>a.time-b.time),n=keys.length;
  for(const s of ['L','R']as const){
   const flag=s==='L'?'plantL':'plantR',foot=s==='L'?'footL':'footR';
   const planted=keys.map(k=>k.constraints[flag]);
   const allPlanted=planted.every(Boolean);
   for(let i=0;i<n;i++){
    if(!planted[i])continue;
    const pi=doc.loop?(i-1+n)%n:i-1;
    const isStart=doc.loop&&allPlanted?i===0:pi<0||!planted[pi];
    if(!isStart)continue;
    const hips=hipTrajectory(doc,s,keys[i].time,endOfRun(keys,planted,i,doc.loop,doc.duration));
    clampReach(s,keys[i].pose[foot].target,hips);
    if(hips.some(h=>reachViolation(s,keys[i].pose[foot].target,h)>5e-4))return false;
   }
  }
  return true;
 };

 /** Estimated sole height at one instant: the solver lands a reachable ankle
  * on the target and radially clamps an unreachable one, so clamping the
  * sampled target onto the annulus about the posed hip (at each shift
  * extreme) and adding soleOffset reproduces the solved foot's lowest point
  * within a few millimetres. */
 const soleEstimate=(doc:WorkshopDoc,t:number,s:Side)=>{
  const f=frameAt(doc,doc.loop?((t%doc.duration)+doc.duration)%doc.duration:Math.min(Math.max(t,0),doc.duration),restRoot);
  const fp=s==='L'?f.pose.footL:f.pose.footR,tgt=toV(fp.target),hip=hipAt(s,f.pose.root,f.pose.yaw);
  let lo=Infinity;
  for(const shift of [0,PELVIS_SHIFT_M/2,PELVIS_SHIFT_M]){
   const h=hip.clone().add(new Vector3(0,0,-shift)),d=tgt.distanceTo(h),hi=legReach(s),mn=legMinReach(s);
   const eff=d>hi?h.clone().addScaledVector(tgt.clone().sub(h),hi/d):d<mn?h.clone().addScaledVector(tgt.clone().sub(h),mn/d):tgt;
   lo=Math.min(lo,eff.y+soleOffset(geo[s],fp.yaw,fp.pitch));
  }
  return lo;
 };

 /** Raise the stored lift of the keys that drive the foot channel at `t`:
  * a planted dip is a contact problem (raise the run-start key's stored
  * target), a swing dip is an arc problem (raise the interval endpoints,
  * which for a release interval are the waypoint and the landing target). */
 const raiseLiftAt=(doc:WorkshopDoc,keys:WorkshopKey[],t:number,s:Side,amount:number)=>{
  const flag=s==='L'?'plantL':'plantR',foot=s==='L'?'footL':'footR';
  let i=0;while(i<keys.length-2&&t>=keys[i+1].time)i++;
  if(doc.loop&&t>=keys[keys.length-1].time)i=keys.length-1;
  const owners=[keys[i]];
  const nextIdx=doc.loop?(i+1)%keys.length:Math.min(i+1,keys.length-1);
  if(keys[nextIdx]!==owners[0])owners.push(keys[nextIdx]);
  // A planted instant: the run's first key owns the contact, not the bracket —
  // resolve it with the production helper (cyclic adjacency, all-planted
  // loop anchored on key 0).
  const cs=contactStartKey(doc,s,Math.min(Math.max(t,0),doc.duration));
  if(cs){owners.length=0;owners.push(cs);}
  for(const k of owners){
   k.pose[foot].target.y+=amount;
   clampReach(s,k.pose[foot].target,hipTrajectory(doc,s,k.time,k.time));
  }
 };

 /** After construction the sampled sole of each foot must clear the ground
  * margin; Hermite swing arcs can dip below their endpoints, so dips get a
  * lift bump on the driving keys and a re-check. Returns false when the dip
  * cannot be repaired locally — the caller regenerates the document. */
 const enforceClearance=(doc:WorkshopDoc):boolean=>{
  const keys=[...doc.keys].sort((a,b)=>a.time-b.time);
  for(let round=0;round<6;round++){
   let worst=CLEARANCE_M,worstT=0,worstSide:Side='L';
   const steps=Math.max(4,Math.ceil(doc.duration/TRAJECTORY_DT));
   for(const s of ['L','R']as const){
    for(let k=0;k<=steps;k++){
     const t=doc.duration*k/steps,sole=soleEstimate(doc,t,s);
     if(sole<worst){worst=sole;worstT=t;worstSide=s;}
    }
   }
   if(worst>=CLEARANCE_M)return true;
   raiseLiftAt(doc,keys,worstT,worstSide,CLEARANCE_M-worst+.004);
   if(!strengthenContacts(doc))return false;
  }
  return false;
 };

 /** A non-loop document may not end on a release key: the sampler's release
  * branch evaluates its swing Hermite at the raw (unclamped) time, so a tail
  * after the last key would extrapolate the swing instead of holding the last
  * pose — and an unplanted trailing key is a dead-write state the UI itself
  * warns about. Landing the foot (plant=true) keeps the doc in the intended
  * domain. */
 const landTailReleases=(doc:WorkshopDoc)=>{
  if(doc.loop||doc.keys.length<2)return;
  const keys=[...doc.keys].sort((a,b)=>a.time-b.time),last=keys[keys.length-1],prev=keys[keys.length-2];
  for(const s of ['L','R']as const){
   const flag=s==='L'?'plantL':'plantR';
   if(!last.constraints[flag]&&prev.constraints[flag])last.constraints[flag]=true;
  }
 };

 const build=():WorkshopDoc|undefined=>{
  const duration=r(.3,6),loop=rng()<.25;
  const span=loop?duration-WORKSHOP_LIMITS.loopGap:duration;
  const n=2+Math.floor(rng()*11);
  const times=randomTimes(rng,n,span);
  const base=blankDocument(rest,'随机文档','rand');
  const doc:WorkshopDoc={...base,
   id:`rand-${Math.floor(rng()*1e9).toString(36)}`,name:'随机文档',english:'RANDOM DOCUMENT',
   duration,inbetweens:rng()<.8,loop,
   handFrames:{L:rng()<.5?'pelvis':'world',R:rng()<.5?'pelvis':'world'},
   keys:times.map((t,i)=>makeKey(i,t))};
  landTailReleases(doc);
  if(!strengthenContacts(doc))return undefined;
  if(!enforceClearance(doc))return undefined;
  return doc;
 };

 for(let attempt=0;attempt<30;attempt++){
  const doc=build();
  if(!doc)continue;
  // Repair at field granularity: errors naming a key resample that key's
  // contents; anything else rebuilds the document. Never released invalid.
  for(let repair=0;repair<20;repair++){
   const errs=validateDocShape(doc);
   if(!errs.length)return doc;
   const idx=new Set<number>();let structural=false;
   for(const e of errs){
    const m=/^keys\[(\d+)\]\.(?:pose|constraints)/.exec(e);
    if(m)idx.add(+m[1]);else structural=true;
   }
   if(structural)break;
   for(const i of idx)doc.keys[i]=makeKey(i,doc.keys[i].time);
   landTailReleases(doc);
   if(!strengthenContacts(doc)||!enforceClearance(doc))break;
  }
 }
 throw new Error('randomDoc: resampling could not produce a valid document — the sampling domain disagrees with validateDocShape');
}
