/** CMU ordinary walking, with anatomical hand frames and stable arm twist.
 * Recorded segment directions and root motion are preserved; hand relaxation,
 * contact locking and joint guards are explicit retargeting approximations. */
import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {BVHLoader} from 'three/addons/loaders/BVHLoader.js';
import {AnimationMixer,Group,Vector3,Quaternion,AnimationClip,QuaternionKeyframeTrack,VectorKeyframeTrack} from 'three';
import {HumanRig} from '../src/core/rig.ts';
import {frameRotation,hingedArmRotations,DEG} from '../src/core/kinematics.ts';

const sourceId='35_01',start=1.28,duration=1.12,fps=60,frames=Math.round(duration*fps);
const rig=JSON.parse(fs.readFileSync('public/models/rig.json','utf8'));
const glb=fs.readFileSync('public/models/human.glb');
const gltf=await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const human=new HumanRig(gltf.scene,rig),rests=human.rest;
const source=new BVHLoader().parse(fs.readFileSync(`assets/source/${sourceId}.bvh`,'utf8'));
const root=new Group();root.add(source.skeleton.bones[0]);
const mixer=new AnimationMixer(root);mixer.clipAction(source.clip).play();
const by=Object.fromEntries(source.skeleton.bones.map(b=>[b.name,b]));
const at=t=>{mixer.setTime(t);root.updateMatrixWorld(true);};
const rawP=n=>by[n].getWorldPosition(new Vector3());
at(start);const rawOrigin=rawP('Hips');at(start+duration);
const travel=rawP('Hips').sub(rawOrigin);
// Align the measured travel, rather than assuming the capture faced an axis.
const heading=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.atan2(-travel.x,travel.z));
const p=n=>rawP(n).applyQuaternion(heading);
const q=n=>heading.clone().multiply(by[n].getWorldQuaternion(new Quaternion()));
at(start);const initial=p('Hips');
const targetLeg=rests.get('lowerleg01_L').distanceTo(rests.get('upperleg01_L'))+rests.get('foot_L').distanceTo(rests.get('lowerleg01_L'));
const sourceLeg=p('LeftLeg').distanceTo(p('LeftUpLeg'))+p('LeftFoot').distanceTo(p('LeftLeg'));
const scale=targetLeg/sourceLeg,ankleBase=rests.get('foot_L').y;
const cycleTravel=travel.clone().applyQuaternion(heading).multiplyScalar(scale);cycleTravel.y=0;
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const samples=[];
for(let i=0;i<=frames;i++){
 at(start+i/frames*duration);
 samples.push({points:Object.fromEntries(Object.keys(by).filter(n=>n!=='ENDSITE').map(n=>[n,p(n)])),quats:Object.fromEntries(Object.keys(by).filter(n=>n!=='ENDSITE').map(n=>[n,q(n)]))});
}
const ground=Math.min(...samples.flatMap(s=>[s.points.LeftFoot.y,s.points.RightFoot.y]));
const rawTarget=(s,side)=>{
 const v=s.points[(side==='L'?'Left':'Right')+'Foot'].clone();
 return new Vector3((v.x-initial.x)*scale,(v.y-ground)*scale+ankleBase,(v.z-initial.z)*scale+rests.get('spine05').z);
};
const anchor=(time,side)=>{
 const v=rawTarget(samples[Math.round(time/duration*frames)],side);v.y=ankleBase;return v;
};
const leftAnchor=anchor(.18,'L'),rightAnchor=anchor(.66,'R'),nextLeft=leftAnchor.clone().add(cycleTravel);
// Source 35_01: left support -> right support -> next left support.
const supportWindows=[{side:'L',start:.08,end:.30},{side:'R',start:.52,end:.88}];
function contactTarget(t,side,raw){
 if(side==='L'){
  if(t<=.44)return raw.lerp(leftAnchor,1-smooth((t-.34)/.10));
  if(t>=1.00)return raw.lerp(nextLeft,smooth((t-1.00)/.10));
 }else if(t>=.40&&t<=1.00){const w=smooth((t-.40)/.10)*(1-smooth((t-.90)/.10));return raw.lerp(rightAnchor,w);}
 return raw;
}
const times=[],rot=Object.fromEntries(rig.bones.map(b=>[b.name,[]])),positions=[];
let firstGlobals,firstRoot;
for(let i=0;i<=frames;i++){
 const t=i/frames*duration,s=samples[i],sp=n=>s.points[n].clone(),sq=n=>s.quats[n].clone();times.push(t);
 const across=sp('LeftUpLeg').sub(sp('RightUpLeg')).normalize();
 const globals=Object.fromEntries(rig.bones.map(b=>[b.name,new Quaternion()]));
 globals.root=sq('Hips');
 for(const [target,src]of [['spine05','LowerBack'],['spine04','LowerBack'],['spine03','Spine'],['spine02','Spine1'],['spine01','Spine1'],['neck01','Neck'],['neck02','Neck1'],['neck03','Neck1'],['head','Head']])globals[target]=sq(src);
 for(const side of ['L','R']){
  const prefix=side==='L'?'Left':'Right';
  globals[`pelvis_${side}`]=globals.root.clone();
  globals[`clavicle_${side}`]=sq(prefix+'Shoulder');globals[`shoulder01_${side}`]=globals[`clavicle_${side}`].clone();
  for(const kind of ['arm','leg']){
   const u=(kind==='arm'?'upperarm01_':'upperleg01_')+side,l=(kind==='arm'?'lowerarm01_':'lowerleg01_')+side,e=(kind==='arm'?'wrist_':'foot_')+side;
   const su=prefix+(kind==='arm'?'Arm':'UpLeg'),sl=prefix+(kind==='arm'?'ForeArm':'Leg'),se=prefix+(kind==='arm'?'Hand':'Foot');
   const a=rests.get(l).clone().sub(rests.get(u)),b=rests.get(e).clone().sub(rests.get(l));
   const restNormal=new Vector3().crossVectors(a,b).normalize(),da=sp(sl).sub(sp(su)),db=sp(se).sub(sp(sl));
   if(kind==='arm'){
    // Both elbows flex forward about the SAME anatomical lateral axis. Using
    // opposite signs on mirrored arms turns the left upper arm inside out.
    // Retain measured shoulder directions and elbow flexion, then use a single
    // calibrated FK hinge instead of aiming both segments independently.
    const hinge=new Vector3(-1,0,0).applyQuaternion(globals.spine01);
    const arm=hingedArmRotations(a,b,da,hinge,da.angleTo(db)/DEG);
    globals[u]=arm.shoulder;globals[l]=arm.elbow;
   }else{
    const normal=new Vector3().crossVectors(da,db).normalize();
    globals[u]=frameRotation(a,restNormal,da,normal);globals[l]=frameRotation(b,restNormal,db,normal);
   }
   globals[(kind==='arm'?'upperarm02_':'upperleg02_')+side]=globals[u].clone();
   globals[(kind==='arm'?'lowerarm02_':'lowerleg02_')+side]=globals[l].clone();
   if(kind==='leg')globals[e]=frameRotation(by[prefix+'ToeBase'].position.clone(),new Vector3(1,0,0),sp(prefix+'ToeBase').sub(sp(se)),new Vector3(1,0,0));
   else globals[e]=globals[l].clone();
  }
 }
 const mapped=new Set(['root','spine05','spine04','spine03','spine02','spine01','neck01','neck02','neck03','head',...['L','R'].flatMap(side=>['pelvis_','clavicle_','shoulder01_','upperarm01_','upperarm02_','lowerarm01_','lowerarm02_','wrist_','upperleg01_','upperleg02_','lowerleg01_','lowerleg02_','foot_'].map(n=>n+side))]);
 for(const b of rig.bones)if(!mapped.has(b.name)&&b.parent)globals[b.name]=globals[b.parent].clone();
 const rootPos=rests.get('root').clone().add(sp('Hips').sub(initial).multiplyScalar(scale));
 const worldPos={};
 for(const b of rig.bones)worldPos[b.name]=b.parent?rests.get(b.name).clone().sub(rests.get(b.parent)).applyQuaternion(globals[b.parent]).add(worldPos[b.parent]):rootPos.clone();
 rootPos.y+=ankleBase-Math.min(worldPos.foot_L.y,worldPos.foot_R.y);
 if(i===0){firstGlobals=Object.fromEntries(Object.entries(globals).map(([n,q])=>[n,q.clone()]));firstRoot=rootPos.clone();}
 // Close the seam before solving contacts, so the IK pass also repairs the seam.
 const seam=smooth((t-(duration-.10))/.10);
 if(seam>0){for(const n of Object.keys(globals))globals[n].slerp(firstGlobals[n],seam);rootPos.y+=(firstRoot.y-rootPos.y)*seam;}
 human.reset();human.bone('root').position.copy(rootPos);
 for(const b of rig.bones){const local=globals[b.name].clone();if(b.parent)local.premultiply(globals[b.parent].clone().invert());human.bone(b.name).quaternion.copy(local);}
 human.model.updateMatrixWorld(true);
 const targets=Object.fromEntries(['L','R'].map(side=>{
  const raw=rawTarget(s,side);
  if(seam>0)raw.lerp(rawTarget(samples[0],side).add(cycleTravel),seam);
  return [side,contactTarget(t,side,raw)];
 }));
 // Retargeted proportions can put a recorded support ankle beyond full leg
 // extension. Lower the pelvis by the geometric reach deficit before IK;
 // never stretch the leg or let an unreachable stance target slide.
 let lowering=0;
 for(const side of ['L','R']){
  const hip=human.point(`upperleg01_${side}`),target=targets[side];
  const reach=rests.get(`lowerleg01_${side}`).distanceTo(rests.get(`upperleg01_${side}`))+rests.get(`foot_${side}`).distanceTo(rests.get(`lowerleg01_${side}`))-.0001;
  const horizontalSq=(hip.x-target.x)**2+(hip.z-target.z)**2;
  const maxHipY=target.y+Math.sqrt(Math.max(0,reach*reach-horizontalSq));
  lowering=Math.max(lowering,hip.y-maxHipY);
 }
 rootPos.y-=lowering;human.bone('root').position.copy(rootPos);human.model.updateMatrixWorld(true);
 for(const side of ['L','R']){
  const target=targets[side],pole=target.clone().add(new Vector3(0,.35,.9));
  human.limb(side,'leg',target,pole);
  const footQ=globals[`foot_${side}`].clone();
  for(let pass=0;pass<10;pass++){
   const shank=human.point(`foot_${side}`).sub(human.point(`lowerleg01_${side}`)).applyQuaternion(footQ.clone().invert());
   const dorsi=Math.atan2(-shank.z,-shank.y);
   if(dorsi>20*DEG)footQ.multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),dorsi-20*DEG));
   const toe=new Vector3(0,-ankleBase,.15).applyQuaternion(footQ).add(target),heel=new Vector3(0,-ankleBase,-.055).applyQuaternion(footQ).add(target);
   const deficit=Math.max(0,-Math.min(toe.y,heel.y));if(deficit>0){target.y+=deficit;human.limb(side,'leg',target,pole);}
  }
  human.worldRotation(`foot_${side}`,footQ);
  const handDirection=human.point(`wrist_${side}`).sub(human.point(`lowerarm01_${side}`)).normalize();
  const palmNormal=across.clone().multiplyScalar(side==='L'?-1:1);
  if(seam>0)palmNormal.lerp(samples[0].points.LeftUpLeg.clone().sub(samples[0].points.RightUpLeg).normalize().multiplyScalar(side==='L'?-1:1),seam);
  human.hand(side,handDirection,palmNormal);human.relaxHand(side);
 }
 human.model.updateMatrixWorld(true);
 for(const b of rig.bones)rot[b.name].push(...human.bone(b.name).quaternion.toArray());
 positions.push(...rootPos.toArray());
}
const tracks=rig.bones.map(b=>new QuaternionKeyframeTrack(b.name+'.quaternion',times,rot[b.name]));tracks.push(new VectorKeyframeTrack('root.position',times,positions));
const clip=new AnimationClip('walk',duration,tracks);
fs.writeFileSync('public/models/walk.json',JSON.stringify(AnimationClip.toJSON(clip)));
const stride=[positions.at(-3)-positions[0],0,positions.at(-1)-positions[2]];
fs.writeFileSync('public/models/walk-meta.json',JSON.stringify({source:`CMU ${sourceId}`,description:'Ordinary walk, source label: walk',start,duration,fps,scale,stride,supportWindows,sourceUrl:'https://github.com/una-dinosauria/cmu-mocap/blob/master/data/035/35_01.bvh',contactLock:'Measured stance intervals, world-space anchors, 100ms transitions',note:'Calibrated shoulder-elbow FK hinge with measured flexion timing; mirrored palmar hand frames; neutral wrists and relaxed fingers; pelvis reach correction and bounded ankle rocker. No gender label inferred from the capture.'},null,2));
console.log({sourceId,start,duration,frames,stride,scale});
