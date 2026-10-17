// Decompose the hand-frame rotation seed→final into a rotateHandFrame delta
// sequence (flex/dev/twist axes of the evolving frame) — what the UI wrist
// sliders would apply.
import path from 'node:path';import fs from 'node:fs';
import {Matrix4,Quaternion,Vector3} from 'three';
import {createService} from '../../src/server/service';
import {defaultDocument} from '../../src/workshop/document';
import {rotateHandFrame} from '../../src/workshop/solver';
const ctx=await createService(path.resolve('public'));
const seed=defaultDocument(ctx.rig.rest);
const fin=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const toV=(v:any)=>new Vector3(v.x,v.y,v.z);
const fq=(h:any)=>{
 const f=toV(h.forward);if(f.lengthSq()<1e-10)f.set(0,0,1);f.normalize();
 const n=toV(h.normal);n.addScaledVector(f,-n.dot(f));n.normalize();
 return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(f,n,new Vector3().crossVectors(f,n)));
};
for(const sk of seed.keys){
 const fk=fin.keys.find((k:any)=>k.id===sk.id);if(!fk)continue;
 const h={forward:{...sk.pose.handR.forward},normal:{...sk.pose.handR.normal}};
 const qf=fq(fk.pose.handR);
 const moves:[string,number][]=[];
 for(let it=0;it<10;it++){
  const qc=fq(h);const dq=qf.clone().multiply(qc.clone().invert());
  let w=dq.w;if(w<0){dq.x*=-1;dq.y*=-1;dq.z*=-1;w*=-1;}
  const ang=2*Math.acos(Math.min(1,w));
  if(ang<0.4*Math.PI/180)break;
  const s=Math.sqrt(Math.max(1e-12,1-dq.w*dq.w));
  const rv=new Vector3(dq.x,dq.y,dq.z).divideScalar(s).multiplyScalar(ang);
  const f=toV(h.forward).normalize(),n=toV(h.normal).normalize();
  const axF=new Vector3().crossVectors(f,n).normalize(),axD=n.clone(),axT=f.clone();
  const proj=([['flex',axF],['dev',axD],['twist',axT]] as const).map(([k,a])=>[k,rv.dot(a)] as [string,number]);
  proj.sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  const [kind,rad]=proj[0];const deg=Math.max(-60,Math.min(60,Math.round(rad*180/Math.PI)));
  if(Math.abs(deg)<1)break;
  rotateHandFrame(h,kind as any,deg);moves.push([kind,deg]);
 }
 const err=fq(h).angleTo(qf)*180/Math.PI;
 console.log(sk.id,'moves',JSON.stringify(moves),'residual',err.toFixed(2),'°');
}
