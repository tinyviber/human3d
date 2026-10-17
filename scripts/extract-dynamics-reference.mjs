/** CMU is a controller reference only. The rendered experiment pose comes
 * exclusively from forward dynamics, never from these capture samples. */
import fs from 'node:fs';
import {BVHLoader} from 'three/addons/loaders/BVHLoader.js';
import {Vector3,Quaternion,Group,AnimationMixer} from 'three';
const actions=fs.readdirSync('assets/actions').filter(name=>name.endsWith('.json')&&name!=='action.schema.json').map(name=>JSON.parse(fs.readFileSync(`assets/actions/${name}`,'utf8')));
const captures=actions.filter(a=>a.reference.kind==='captured-points').map(a=>({id:a.reference.captureId,file:a.reference.source.motionFile,start:a.reference.source.frameRangeSeconds[0],end:a.reference.source.frameRangeSeconds[1],url:a.reference.source.url??a.reference.source.urls?.[0]}));
const result={license:'Source-specific terms are recorded in each action specification; do not redistribute raw capture data outside those terms.',captures:{}};
for(const spec of captures){
 const {id}=spec;const bvh=new BVHLoader().parse(fs.readFileSync(spec.file,'utf8'));
 const root=new Group();root.add(bvh.skeleton.bones[0]);const mixer=new AnimationMixer(root);mixer.clipAction(bvh.clip).play();const by=Object.fromEntries(bvh.skeleton.bones.map(b=>[b.name,b]));
 const point=n=>by[n].getWorldPosition(new Vector3());
 mixer.setTime(spec.start);root.updateMatrixWorld(true);
 const across=point('LeftArm').sub(point('RightArm'));across.y=0;across.normalize();
 const heading=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.atan2(across.z,across.x));
 const samples=[];
 for(let time=spec.start;time<=spec.end+.001;time+=1/120){
  mixer.setTime(time);root.updateMatrixWorld(true);
  const points=Object.fromEntries(['Hips','Spine','Spine1','Neck1','Head',...['Left','Right'].flatMap(s=>['Arm','ForeArm','Hand','UpLeg','Leg','Foot'].map(n=>s+n))].map(n=>[n,point(n).applyQuaternion(heading).toArray()]));
  samples.push({time:time-spec.start,points});
 }
 result.captures[id]={source:spec.file.split('/').at(-1).replace('.bvh',''),start:spec.start,end:spec.end,fps:120,sourceUrl:spec.url,samples};
}
fs.writeFileSync('assets/source/dynamics/capture-reference.json',JSON.stringify(result));
console.log('Extracted controller references:',Object.fromEntries(Object.entries(result.captures).map(([id,v])=>[id,v.samples.length])));
