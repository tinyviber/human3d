import {Quaternion,Vector3} from 'three';
import type {PosePackage} from './pose-package';
import type {RigManifest} from './rig-manifest';
/** Independent package validator: re-walks the manifest hierarchy with the
 * delivered local rotations and recomputes world joint positions (FK), then
 * checks segment lengths, quaternion norms, hemisphere continuity, timestamps
 * and event bounds. Does not share solver code. */
export function validatePosePackage(pkg:PosePackage,manifest:RigManifest):string[]{
 const e:string[]=[];
 if(pkg.schemaVersion!==1||pkg.kind!=='pose-package')e.push('bad schemaVersion/kind');
 if(pkg.quaternionOrder!=='xyzw'||pkg.poseMode!=='local-trs')e.push('unexpected poseMode/quaternionOrder');
 const {timestamps,count,fps}=pkg.timeline;
 if(timestamps.length!==count)e.push(`timeline count ${count} != timestamps ${timestamps.length}`);
 for(let i=1;i<timestamps.length;i++)if(!(timestamps[i]>timestamps[i-1]))e.push(`timestamps not strictly increasing at ${i}`);
 if(!(fps>0&&fps<=240))e.push(`fps ${fps} out of range`);
 if(Math.abs(timestamps[count-1]-pkg.timeline.duration)>1/fps+1e-6)e.push('duration mismatch');
 const bones=new Map(manifest.bones.map(b=>[b.name,b]));
 if(pkg.rig.manifestSHA256!==manifest.manifestSHA256)e.push('rig manifest hash mismatch');
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
 // Independent FK: rest local translations + delivered local rotations.
 const headOf=(n:string)=>new Vector3(...(bones.get(n)!.head));
 const restLocalT=(n:string)=>{const b=bones.get(n)!;return b.parent?headOf(n).sub(headOf(b.parent)):headOf(n);};
 const order=manifest.bones;
 const localQ=(tr:{bone:string;values:number[]}|undefined,i:number)=>tr?new Quaternion(tr.values[i*4],tr.values[i*4+1],tr.values[i*4+2],tr.values[i*4+3]):new Quaternion();
 const byBone=new Map(pkg.tracks.rotations.map(tr=>[tr.bone,tr]));
 let worstLen=0,worstName='';
 const sampleFrames=[0,Math.floor(count/2),count-1];
 for(const i of sampleFrames){
  const worldQ=new Map<string,Quaternion>(),worldP=new Map<string,Vector3>();
  for(const b of order){
   const lq=localQ(byBone.get(b.name),i);
   if(!b.parent){worldQ.set(b.name,lq.clone());worldP.set(b.name,new Vector3(T.values[i*3],T.values[i*3+1],T.values[i*3+2]));}
   else{
    const pq=worldQ.get(b.parent)!,pp=worldP.get(b.parent)!;
    worldQ.set(b.name,pq.clone().multiply(lq));
    worldP.set(b.name,restLocalT(b.name).applyQuaternion(pq).add(pp));
   }
  }
  for(const b of order){
   if(!b.parent)continue;
   const rest=restLocalT(b.name).length(),now=worldP.get(b.name)!.distanceTo(worldP.get(b.parent)!);
   const d=Math.abs(rest-now);if(d>worstLen){worstLen=d;worstName=b.name;}
  }
 }
 if(worstLen>1e-6)e.push(`FK segment-length drift ${(worstLen*1000).toFixed(2)}mm at ${worstName}`);
 for(const ev of pkg.events)if(!(ev.time>=0&&ev.time<=pkg.timeline.duration+1e-6))e.push(`event '${ev.label}' at ${ev.time} outside duration`);
 return [...new Set(e)];
}
