import {describe,it,expect,beforeAll} from 'vitest';
import fs from 'node:fs';
import {Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from '../core/rig';
import {attachRacket} from '../core/racket';
import {blankDocument,contactStartKey,flattenPose,frameAt,isReleaseKey,samplePose,validateDocShape,type WorkshopDoc,type WorkshopKey} from './document';
import {ankleYForLift,footGeometry,footLift,type Side} from './foot';
import {analyzePose,solvePose} from './solver';

/** Regression tests for issue #2 P1-1..P1-5. Every case runs through the same
 * path the engine and the service use: frameAt → solvePose → rig measurements. */
let rig:HumanRig;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync('public/models/rig.json','utf8')));
 attachRacket(rig);
},30000);

const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const origin=()=>rig.rest.get('root')!;
function solveAt(doc:WorkshopDoc,t:number,mode?:'stepped'){
  const d=mode==='stepped'?{...doc,inbetweens:false}:doc;
  const f=frameAt(d as WorkshopDoc,t,origin());
  const r=solvePose(rig,f.pose,f.constraints,{support:f.support,gripAmount:f.gripAmount});
  return {f,...r};
}
const footPoint=(side:Side)=>rig.point(`foot_${side}`).clone();
/** Stance keys with explicit times; keys are cloned from the blank template. */
function docWith(times:number[],edit:(i:number,k:WorkshopKey)=>void,duration=times[times.length-1]+.5){
  const base=blankDocument(rig.rest,'t','t');
  const tmpl=base.keys[0];
  const doc:WorkshopDoc={...base,duration,keys:[]};
  times.forEach((time,i)=>{const k=clone(tmpl);k.id=`k${i}`;k.time=time;edit(i,k);doc.keys.push(k);});
  return doc;
}

describe('P1-1 pelvis correction is continuous and reports saturation',()=>{
 // The issue's lunge repro: the rear foot lifts at t=1 and replants at t=2.
 const lunge=()=>docWith([0,1,2],(i,k)=>{
  k.constraints={plantL:true,plantR:i!==1,grip:false,contact:false};
  k.pose.root={x:0,y:-.3,z:-.05};k.pose.lean=30;k.pose.footL.target.z=.3;k.pose.footR.target.z=-.25;
 },2);
 it('moves the pelvis in small steps across the lift and replant at 60 fps',()=>{
  const d=lunge();let prev:number|null=null,maxStep=0;
  for(let i=0;i<=120;i++){
   const {f}=solveAt(d,i/60);void f;
   const z=rig.bone('root').position.z;
   if(prev!==null)maxStep=Math.max(maxStep,Math.abs(z-prev));
   prev=z;
  }
  // The issue measured 150 mm in one step; the weighted correction stays under 5 mm per frame.
  expect(maxStep).toBeLessThan(.005);
 });
 it('reports a saturated rear leg as a failed check instead of clamping silently',()=>{
  const d=lunge();const r=solveAt(d,0);
  expect(r.pelvisSaturated).toBe(true);
  const a=analyzePose(rig,r.f.pose,r.f.constraints);
  const dorsi=a.items.find(i=>i.code==='ankle-dorsiflexion-R');
  expect(dorsi?.ok).toBe(false);
 });
});

describe('P1-2 stepped mode uses the contact-rewritten key pose',()=>{
 it('keeps a planted foot still across keys of one contact run',()=>{
  const d=docWith([0,1],(i,k)=>{
   k.constraints={plantL:true,plantR:true,grip:false,contact:false};
   if(i===1)k.pose.footL.target.z+=.15; // moved target inside the same planted run
  },1);
  const a=solveAt(d,.2,'stepped'),b=solveAt(d,.9,'stepped');
  void a;void b;
  const p1=footPoint('L');solveAt(d,.2,'stepped');const q1=footPoint('L');solveAt(d,.9,'stepped');const q2=footPoint('L');
  expect(q1.distanceTo(q2)).toBeLessThan(.002);
  expect(p1.distanceTo(q1)).toBeLessThan(.002);
 });
});

describe('P1-3 a contact locks the foot orientation as well as the ankle',()=>{
 it('keeps yaw and pitch fixed across a planted run, so toes do not slide',()=>{
  const d=docWith([0,1],(i,k)=>{
   k.constraints={plantL:true,plantR:true,grip:false,contact:false};
   if(i===1){k.pose.footL.yaw=25;k.pose.footL.pitch=12;k.pose.footL.target.z+=.05;}
  },1);
  const toes=footGeometry(rig.rest,'L').names;
  solveAt(d,.2);const q1=rig.bone('foot_L').getWorldQuaternion(new Quaternion());
  const p1=toes.map(n=>rig.point(n).clone());
  solveAt(d,.8);const q2=rig.bone('foot_L').getWorldQuaternion(new Quaternion());
  const p2=toes.map(n=>rig.point(n).clone());
  expect(q1.angleTo(q2)*180/Math.PI).toBeLessThan(.5);
  for(let i=0;i<toes.length;i++)expect(p1[i].distanceTo(p2[i])).toBeLessThan(.002);
 });
});

describe('P1-4 foot height is the sole, measured on the solved rig',()=>{
 it('places the lowest solved foot point at the requested sole lift',()=>{
  for(const [yaw,pitch] of [[0,0],[30,10],[-20,-15]]){
   const g=footGeometry(rig.rest,'L');
   const lift=.1;
   const d=docWith([0,1],(_,k)=>{
    k.constraints={plantL:false,plantR:true,grip:false,contact:false};
    k.pose.footL.yaw=yaw;k.pose.footL.pitch=pitch;
    k.pose.footL.target.y=ankleYForLift(g,lift,yaw,pitch);
   },2);
   solveAt(d,0);
   const lowest=Math.min(...g.names.map(n=>rig.point(n).y));
   expect(Math.abs((lowest-g.groundY)-lift)).toBeLessThan(.003);
   const ankle=rig.point('foot_L').y;
   expect(Math.abs(footLift(g,ankle,yaw,pitch)-lift)).toBeLessThan(.003);
  }
 });
});

describe('P1-5 dragging a planted foot writes the contact run start',()=>{
 it('resolves the run start key and moves the planted foot through the whole run',()=>{
  const d=docWith([0,.5,1,1.5],(i,k)=>{
   k.constraints={plantL:i<3,plantR:true,grip:false,contact:false};
  },2);
  expect(contactStartKey(d,'L',.8)?.id).toBe('k0');
  expect(contactStartKey(d,'L',1.2)?.id).toBe('k0');
  expect(contactStartKey(d,'L',1.7)).toBeUndefined();
  const before=(solveAt(d,.75),footPoint('L'));
  const start=contactStartKey(d,'L',.75)!;
  start.pose.footL.target.z+=.12;
  const after=(solveAt(d,.75),footPoint('L'));
  expect(after.distanceTo(before)).toBeGreaterThan(.1);
 });
});

describe('review P2-1 only planted and release keys defer to the contact owner',()=>{
 it('keeps stored foot orientation live on free-swing keys inside a swing stretch',()=>{
  // K0 plant → K1 release → K2 free swing → K3 replant. Stored yaw/pitch are
  // dead only on the locked run and the release instant; K2's are real
  // keyframe data the swing passes through.
  const d=docWith([0,1,2,3],(i,k)=>{
   k.constraints={plantL:i===0||i===3,plantR:true,grip:false,contact:false};
   k.pose.footL.yaw=i*20;k.pose.footL.pitch=i*10;
  },3);
  expect(isReleaseKey(d,1,'L')).toBe(true);
  expect(isReleaseKey(d,2,'L')).toBe(false);
  const at=(t:number)=>samplePose(d,t,origin()).footL;
  // Release instant: inherited contact orientation (K0 stored 0/0), its own
  // stored 20/10 is dead.
  expect(at(1).yaw).toBeCloseTo(0,6);expect(at(1).pitch).toBeCloseTo(0,6);
  // Free-swing K2: its stored values are sampled — editing them is live.
  expect(at(2).yaw).toBeCloseTo(40,6);expect(at(2).pitch).toBeCloseTo(20,6);
  // Replant K3 opens a new contact on its own stored orientation.
  expect(at(3).yaw).toBeCloseTo(60,6);expect(at(3).pitch).toBeCloseTo(30,6);
 });
});

describe('loop seam, grip ramp, and random documents',()=>{
 it('joins the last and first frame of a loop without a visible velocity break',()=>{
  const d=docWith([0,.6,1.2],(i,k)=>{k.constraints={plantL:true,plantR:true,grip:false,contact:false};k.pose.lean=i*6;},1.5);
  d.loop=true;
  const dt=1/240,D=d.duration;
  const diff=(a:number,b:number)=>{const x=flattenPose(samplePose(d,a,origin())),y=flattenPose(samplePose(d,b,origin()));let m=0;for(let i=0;i<x.length;i++)m=Math.max(m,Math.abs(x[i]-y[i]));return m;};
  const seam=diff(D-dt,dt);
  let typical=0;for(let t=.05;t<D-.05;t+=.05)typical=Math.max(typical,diff(t,t+dt));
  expect(seam).toBeLessThan(2*typical+1e-3);
 });
 it('ramps the grip over a quarter second after a grip key',()=>{
  const d=docWith([0,1],(i,k)=>{k.constraints={plantL:true,plantR:true,grip:i===1,contact:false};},2);
  expect(frameAt(d,1,origin()).gripAmount).toBeCloseTo(0,5);
  expect(frameAt(d,1.125,origin()).gripAmount).toBeGreaterThan(.3);
  expect(frameAt(d,1.125,origin()).gripAmount).toBeLessThan(.7);
  expect(frameAt(d,1.5,origin()).gripAmount).toBeCloseTo(1,5);
 });
 it('keeps random valid documents finite and valid through the solver',()=>{
  let seed=20240607;const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
  const r=(a:number,b:number)=>a+(b-a)*rnd();
  for(let n=0;n<8;n++){
   const duration=r(.6,4);const count=2+Math.floor(rnd()*3);
   const times=Array.from({length:count},(_,i)=>i===0?0:Math.min(duration-.05,(i/(count-1))*duration));
   times[times.length-1]=Math.min(duration-.05,times[times.length-1]);
   const d=docWith(times,(i,k)=>{
    k.constraints={plantL:rnd()<.7,plantR:rnd()<.7,grip:rnd()<.5,contact:false};
    k.pose.root={x:r(-.1,.1),y:r(-.2,.05),z:r(-.1,.1)};
    k.pose.lean=r(-20,30);k.pose.chest=r(-20,20);k.pose.yaw=r(-40,40);
    k.pose.footL.target={x:r(-.2,.2),y:r(0,.3),z:r(-.3,.3)};k.pose.footR.target={x:r(-.2,.2),y:r(0,.3),z:r(-.3,.3)};
   },duration);
   d.duration=duration;
   expect(validateDocShape(d)).toEqual([]);
   for(let s=0;s<=10;s++){
    const t=s/10*duration;const f=frameAt(d,t,origin());
    const out=solvePose(rig,f.pose,f.constraints,{support:f.support,gripAmount:f.gripAmount});
    expect(Number.isFinite(out.pelvisShift)).toBe(true);
    const a=analyzePose(rig,f.pose,f.constraints);
    for(const it of a.items)expect(Number.isFinite(it.value??0)).toBe(true);
   }
  }
 });
});
void ({} as Vector3);
void ({} as Side);
