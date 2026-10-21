import {Quaternion,Vector3} from 'three';
import {POSE_PACKAGE_SCHEMA_VERSION} from './package-const';
import type {PosePackage} from './pose-package';
import type {RigManifest} from './protocol';
import {supportDrift} from './support-contact';

/** Semantic limits enforced by the validator. A package beyond one of them is
 * rejected, never warned about. Thresholds and the shipped-motion peaks they
 * were calibrated against are recorded in docs/validation.md. */
export const VALIDATION_LIMITS={
 /** Worst local rotation rate of any bone between consecutive samples (rad/s).
  * Shipped peak 6.8 (forehand); default workshop flick 29; the pre-fix forehand
  * popped at 60–72. */
 angularSpeedRadPerS:40,
 /** Worst root translation rate between consecutive samples (m/s). Shipped peak 0.4. */
 rootSpeedMPerS:4,
 /** Worst root acceleration (m/s², ≈4 g). Shipped peak 9.1 (squat), default doc 3.8;
  * a one-frame pelvis step measured 235–260. */
 rootAccelMPerS2:40,
 /** Knee and elbow flexion from FK positions (deg); solver limits are 135 / 145. */
 kneeFlexionDeg:135,
 elbowFlexionDeg:145,
 /** FK-vs-solver residue allowed on the flexion limits (deg). */
 angleToleranceDeg:.5,
 /** Planted-foot drift between a support-start and its support-end (m), measured
  * on the floor contacts (support-contact.ts, ADR-0010). */
 supportSlipM:.01,
} as const;

/** Worst observed value of one measured quantity and where it occurred. */
export interface Peak{value:number;at:string;t:number}
export interface Measurements{
 angularSpeed:Peak;
 rootSpeed:Peak;
 knee:Peak;
 elbow:Peak;
 /** null when the package has no support intervals — e.g. a document that
  * never plants a foot. The bundled motions are planted throughout, so they
  * always produce intervals. */
 slip:Peak|null;
 /** Largest rate of change of root velocity (m/s²). Catches a pelvis step that a
  * speed limit alone can miss at low frame rates. */
 rootAccel:Peak;
 /** Largest segment-length error of the FK re-walk (m). */
 fkDriftM:number;
}

/** Re-walks the manifest hierarchy with the delivered local rotations and
 * returns the worst observed value of each semantic quantity. Shares no solver
 * code: it reads only the package and the manifest. Assumes the package has
 * already passed the structural checks in validatePosePackage. */
export function measurePackage(pkg:PosePackage,manifest:RigManifest):Measurements{
 const {timestamps,count,fps}=pkg.timeline;
 const bones=new Map(manifest.bones.map(b=>[b.name,b]));
 const headOf=(n:string)=>new Vector3(...(bones.get(n)!.head));
 const restLocalT=(n:string)=>{const b=bones.get(n)!;return b.parent?headOf(n).sub(headOf(b.parent)):headOf(n);};
 const T=pkg.tracks.translation;
 const byBone=new Map(pkg.tracks.rotations.map(tr=>[tr.bone,tr]));
 const localQ=(bone:string,i:number)=>{const tr=byBone.get(bone);return tr?new Quaternion(tr.values[i*4],tr.values[i*4+1],tr.values[i*4+2],tr.values[i*4+3]):new Quaternion();};

 // Forward kinematics for every frame: rest local translations + delivered local rotations.
 const world:Vector3[][]=[];
 let fkDriftM=0;
 for(let i=0;i<count;i++){
  const worldQ=new Map<string,Quaternion>(),worldP=new Map<string,Vector3>();
  const frame:Vector3[]=[];
  for(const b of manifest.bones){
   const lq=localQ(b.name,i);
   if(!b.parent){worldQ.set(b.name,lq.clone());worldP.set(b.name,new Vector3(T.values[i*3],T.values[i*3+1],T.values[i*3+2]));}
   else{
    const pq=worldQ.get(b.parent)!,pp=worldP.get(b.parent)!;
    worldQ.set(b.name,pq.clone().multiply(lq));
    worldP.set(b.name,restLocalT(b.name).applyQuaternion(pq).add(pp));
   }
   frame.push(worldP.get(b.name)!);
   if(b.parent&&(i===0||i===count-1||i===Math.floor(count/2))){
    const drift=Math.abs(restLocalT(b.name).length()-worldP.get(b.name)!.distanceTo(worldP.get(b.parent)!));
    fkDriftM=Math.max(fkDriftM,drift);
   }
  }
  world.push(frame);
 }
 const index=new Map(manifest.bones.map((b,i)=>[b.name,i]));
 const at=(i:number,name:string)=>world[i][index.get(name)!];

 // Angular speed of every track's local rotation between consecutive samples.
 const angular:Peak={value:0,at:'',t:0};
 for(const tr of pkg.tracks.rotations)for(let i=1;i<count;i++){
  const a=localQ(tr.bone,i-1),b=localQ(tr.bone,i);
  const w=2*Math.acos(Math.min(1,Math.abs(a.dot(b))))/(timestamps[i]-timestamps[i-1]);
  if(w>angular.value)Object.assign(angular,{value:w,at:tr.bone,t:timestamps[i]});
 }

 // Root speed from the translation track.
 const root:Peak={value:0,at:'root',t:0};
 for(let i=1;i<count;i++){
  const d=Math.hypot(T.values[i*3]-T.values[(i-1)*3],T.values[i*3+1]-T.values[(i-1)*3+1],T.values[i*3+2]-T.values[(i-1)*3+2]);
  const v=d/(timestamps[i]-timestamps[i-1]);
  if(v>root.value)Object.assign(root,{value:v,t:timestamps[i]});
 }
 // Root acceleration: change of the sample-to-sample velocity vector over the mean spacing.
 const rootAccel:Peak={value:0,at:'root',t:0};
 const vel=(i:number)=>new Vector3(T.values[i*3]-T.values[(i-1)*3],T.values[i*3+1]-T.values[(i-1)*3+1],T.values[i*3+2]-T.values[(i-1)*3+2]).divideScalar(timestamps[i]-timestamps[i-1]);
 for(let i=2;i<count;i++){
  const a=vel(i).sub(vel(i-1)).length()/((timestamps[i]-timestamps[i-2])/2);
  if(a>rootAccel.value)Object.assign(rootAccel,{value:a,t:timestamps[i-1]});
 }

 // Joint flexion from world positions (180° = straight), per side.
 const flexion=(a:Vector3,b:Vector3,c:Vector3)=>180-a.clone().sub(b).angleTo(c.clone().sub(b))*180/Math.PI;
 const knee:Peak={value:-Infinity,at:'',t:0},elbow:Peak={value:-Infinity,at:'',t:0};
 for(const side of ['L','R']as const)for(let i=0;i<count;i++){
  const k=flexion(at(i,`upperleg01_${side}`),at(i,`lowerleg01_${side}`),at(i,`foot_${side}`));
  const el=flexion(at(i,`upperarm01_${side}`),at(i,`lowerarm01_${side}`),at(i,`wrist_${side}`));
  if(k>knee.value)Object.assign(knee,{value:k,at:side,t:timestamps[i]});
  if(el>elbow.value)Object.assign(elbow,{value:el,at:side,t:timestamps[i]});
 }

 // Support slip (ADR-0010): between each support-start and its matching
 // support-end the planted foot's floor contacts must stay put — see
 // supportDrift. Worst drift over all intervals, both sides.
 const rest=new Map(manifest.bones.map(b=>[b.name,headOf(b.name)]));
 let slip:Peak|null=null;
 for(const side of ['L','R']as const){
  const starts=pkg.events.filter(ev=>ev.type==='support-start'&&ev.side===side).map(ev=>ev.time);
  const ends=pkg.events.filter(ev=>ev.type==='support-end'&&ev.side===side).map(ev=>ev.time);
  for(const s of starts){
   const end=ends.filter(x=>x>s).sort((a,b)=>a-b)[0]??pkg.timeline.duration;
   const i0=timestamps.findIndex(x=>x>=s-1e-9);
   if(i0<0)continue;
   let n=0;
   while(i0+n<count&&timestamps[i0+n]<=end+1e-9)n++;
   if(n<1)continue;
   const d=supportDrift(side,rest,n,(k,bone)=>at(i0+k,bone));
   if(!slip||d.value>slip.value)slip={value:d.value,at:side,t:timestamps[i0+d.k]};
  }
 }
 return {angularSpeed:angular,rootSpeed:root,rootAccel,knee,elbow,slip,fkDriftM};
}

/** Independent package validator: structure, quaternion hygiene, timestamps,
 * event and quality well-formedness, FK segment lengths, then the semantic
 * limits above. Returns every failure found (empty = valid). */
export function validatePosePackage(pkg:PosePackage,manifest:RigManifest):string[]{
 const e:string[]=[];
 if(pkg.schemaVersion!==POSE_PACKAGE_SCHEMA_VERSION||pkg.kind!=='pose-package')e.push('bad schemaVersion/kind');
 if(pkg.quaternionOrder!=='xyzw'||pkg.poseMode!=='local-trs')e.push('unexpected poseMode/quaternionOrder');
 const {timestamps,count,fps}=pkg.timeline;
 if(timestamps.length!==count)e.push(`timeline count ${count} != timestamps ${timestamps.length}`);
 if(count<2)e.push(`timeline has ${count} sample(s); at least 2 are needed for the semantic checks`);
 for(let i=1;i<timestamps.length;i++)if(!(timestamps[i]>timestamps[i-1]))e.push(`timestamps not strictly increasing at ${i}`);
 if(!(fps>0&&fps<=240))e.push(`fps ${fps} out of range`);
 if(timestamps[count-1]!==pkg.timeline.duration)e.push('last timestamp is not exactly duration');
 const bones=new Map(manifest.bones.map(b=>[b.name,b]));
 if(pkg.rig.manifestSHA256!==manifest.manifestSHA256)e.push('rig manifest hash mismatch');
 if(pkg.rig.bones!==manifest.bones.length)e.push('rig bone count mismatch');
 const T=pkg.tracks.translation;
 if(T.bone!=='root'||T.values.length!==count*3||!T.values.every(Number.isFinite))e.push('root translation track malformed');
 for(const tr of pkg.tracks.rotations){
  if(!bones.has(tr.bone))e.push(`track for unknown bone ${tr.bone}`);
  if(tr.values.length!==count*4){e.push(`${tr.bone}: ${tr.values.length} values != ${count*4}`);continue;}
  let prev:Quaternion|null=null;
  for(let i=0;i<count;i++){
   const q=new Quaternion(tr.values[i*4],tr.values[i*4+1],tr.values[i*4+2],tr.values[i*4+3]);
   if(!Number.isFinite(q.length())){e.push(`${tr.bone}: NaN at frame ${i}`);break;}
   if(Math.abs(q.length()-1)>1e-3){e.push(`${tr.bone}: non-unit quaternion ${q.length().toFixed(4)} frame ${i}`);break;}
   if(prev&&prev.dot(q)<-1e-9){e.push(`${tr.bone}: hemisphere flip at frame ${i}`);break;}
   prev=q;
  }
 }
 for(const ev of pkg.events){
  if(!(ev.time>=0&&ev.time<=pkg.timeline.duration+1e-6))e.push(`event '${ev.label}' at ${ev.time} outside duration`);
  if((ev.type==='support-start'||ev.type==='support-end')&&ev.side!=='L'&&ev.side!=='R')e.push(`event '${ev.label}' lacks side L|R`);
 }
 for(const c of pkg.quality.checks){
  if(typeof c.code!=='string'||typeof c.ok!=='boolean'||typeof c.label!=='string')e.push(`quality check ${String(c.code)} malformed`);
  // A passing check must not carry a value above its limit (the reverse is allowed: a worst-case record).
  if(c.ok&&c.value!==null&&c.limit!==null&&c.value>c.limit+1e-3)e.push(`quality check ${c.code} passes with value ${c.value} > ${c.limit}`);
 }
 if(e.length)return [...new Set(e)];

 const m=measurePackage(pkg,manifest);
 const L=VALIDATION_LIMITS;
 if(m.fkDriftM>1e-6)e.push(`FK segment-length drift ${(m.fkDriftM*1000).toFixed(2)}mm`);
 if(m.angularSpeed.value>L.angularSpeedRadPerS)
  e.push(`semantic: angular speed ${m.angularSpeed.value.toFixed(1)} rad/s at ${m.angularSpeed.at} t=${m.angularSpeed.t.toFixed(2)}s exceeds ${L.angularSpeedRadPerS}`);
 if(m.rootSpeed.value>L.rootSpeedMPerS)
  e.push(`semantic: root speed ${m.rootSpeed.value.toFixed(2)} m/s at t=${m.rootSpeed.t.toFixed(2)}s exceeds ${L.rootSpeedMPerS}`);
 if(m.rootAccel.value>L.rootAccelMPerS2)
  e.push(`semantic: root acceleration ${m.rootAccel.value.toFixed(1)} m/s² at t=${m.rootAccel.t.toFixed(2)}s exceeds ${L.rootAccelMPerS2} (pelvis step)`);
 if(m.knee.value>L.kneeFlexionDeg+L.angleToleranceDeg)
  e.push(`semantic: ${m.knee.at} knee flexion ${m.knee.value.toFixed(1)}° at t=${m.knee.t.toFixed(2)}s exceeds ${L.kneeFlexionDeg}°`);
 if(m.elbow.value>L.elbowFlexionDeg+L.angleToleranceDeg)
  e.push(`semantic: ${m.elbow.at} elbow flexion ${m.elbow.value.toFixed(1)}° at t=${m.elbow.t.toFixed(2)}s exceeds ${L.elbowFlexionDeg}°`);
 if(m.slip&&m.slip.value>L.supportSlipM)
  e.push(`semantic: ${m.slip.at} support foot slips ${(m.slip.value*100).toFixed(1)} cm at t=${m.slip.t.toFixed(2)}s exceeds ${L.supportSlipM*100} cm`);
 return [...new Set(e)];
}
