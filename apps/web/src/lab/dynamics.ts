import {webPlatform} from '../platform/platform';
import {ArrowHelper,AxesHelper,BufferGeometry,Color,DoubleSide,Euler,Float32BufferAttribute,Group,LineBasicMaterial,LineSegments,Mesh,MeshStandardMaterial,Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {DebugOptions} from '@human3d/motion-core';
import type {DynamicsRecords,MuscleActionFile} from '@human3d/motion-core';
import {mapMyoSimThumbToSkin,type HandJointPose,type HumanRig} from '@human3d/motion-core';
import {handFrame} from '@human3d/motion-core';
export type DynamicsId=string;
export type DynamicsCase='baseline'|'weak';
export interface DynamicsReadout {
 loading?:boolean;error?:string;case:DynamicsCase;speed:number;power:number[];support:number[];
 muscles:{name:string;force:number;activation:number}[];mass:number;totalPower:number;
}
interface ModelData {
 mass:number;nq:number;nv:number;muscles:number;reduction:string;
 carriedObject?:{body:string;geom:string;massKg:number;radiusM:number;interaction:string};
 bodies:{id:number;name:string;parent:number;restPosition:number[];restQuaternion:number[]}[];
 joints:{name:string;qpos:number;dof:number;dofCount:number}[];
 actuators:{id:number;name:string;tendon:number;fmax:number}[];
}
interface RecordData {
 id:string;case:DynamicsCase;duration:number;headLength:number;
 modelMeta?:string;
 layout:{qpos:number;qvel:number;bodies:number;muscles:number};
 frames:{time:number;offset:number;segments:number}[];
 audit:{virtualWorkErrorW:number;minimumForearmClearanceM:number;maxScalarJointLimitViolationRad:number};
}
interface LoadedRecord{meta:RecordData;values:Float32Array}
const skinHandTargets=new Set([
 'flexion_r','cmc_flexion','cmc_abduction','mp_flexion_r','ip_flexion_r',
 'mcp2_flexion_r','mcp2_abduction_r','pm2_flexion_r','md2_flexion_r',
 'mcp3_flexion_r','mcp3_abduction_r','pm3_flexion_r','md3_flexion',
 'mcp4_flexion_r','mcp4_abduction_r','pm4_flexion','md4_flexion_r',
 'mcp5_flexion_r','mcp5_abduction_r','pm5_flexion_r','md5_flexion_r',
]);
const v=new Vector3(),q=new Quaternion(),q2=new Quaternion();
async function json<T>(url:string):Promise<T>{const r=await webPlatform.fetchAsset(url);if(!r.ok)throw new Error(`仿真资源加载失败：${r.status}`);return r.json() as Promise<T>;}
export function muscleName(name:string){
 const names:Record<string,string>={DELT1:'三角肌前束',DELT2:'三角肌中束',DELT3:'三角肌后束',BIClong:'肱二头肌长头',BICshort:'肱二头肌短头',BRA:'肱肌',TRIlong:'肱三头肌长头',TRIlat:'肱三头肌外侧头',TRImed:'肱三头肌内侧头',SUPSP:'冈上肌',INFSP:'冈下肌',SUBSC:'肩胛下肌',TMAJ:'大圆肌',TMIN:'小圆肌'};
 if(names[name])return names[name];
 if(/^PECM/.test(name))return '胸大肌 '+name.at(-1);
 if(/^LAT[123]/.test(name))return '背阔肌 '+name.at(-1);
 const leg:Record<string,string>={glmax:'臀大肌',glmed:'臀中肌',vaslat:'股外侧肌',vasmed:'股内侧肌',vasint:'股中间肌',recfem:'股直肌',soleus:'比目鱼肌',gasmed:'腓肠肌内侧头',gaslat:'腓肠肌外侧头',tibant:'胫骨前肌',bflh:'股二头肌长头',iliacus:'髂肌',psoas:'腰大肌'};
 for(const [prefix,label]of Object.entries(leg))if(name.startsWith(prefix))return label+(name.endsWith('_l')?' · 左':' · 右');
 if(name.startsWith('EO'))return '腹外斜肌';if(name.startsWith('IO'))return '腹内斜肌';if(name.startsWith('RA'))return '腹直肌';
 return name;
}
/** Replays measured forward-simulation states. This renderer never generates
 * joint targets or reports that playback is a live physics simulation. */
export class DynamicsReplay {
 root=new Group();case:DynamicsCase='baseline';id:DynamicsId='';time=0;
 private actionSpec?:MuscleActionFile;
 private loadRevision=0;private cache=new Map<string,LoadedRecord>();private record?:LoadedRecord;
 private nodes=new Map<number,Group>();private bodyValues:number[]=[];private current?:Float32Array;
 private muscles:LineSegments;private links:LineSegments;private axes=new Map<number,AxesHelper>();
 private arrows=[new ArrowHelper(),new ArrowHelper()];private byName=new Map<string,number>();private jointByName=new Map<string,ModelData['joints'][number]>();private interpolatedJoints=new Map<string,number>();private options?:DebugOptions;
 private referencePose=new Map<number,{position:Vector3;quaternion:Quaternion}>();
 private readonly sourceToScene=new Quaternion().setFromEuler(new Euler(-Math.PI/2,0,0));
 private constructor(public model:ModelData,private anatomy:Group,private surfaceRig?:HumanRig){
  this.root.name='MyoSim forward dynamics playback';this.root.rotation.x=-Math.PI/2;this.root.position.set(.025,0,.1);
  this.root.add(anatomy);anatomy.visible=false;for(const b of model.bodies)this.byName.set(b.name,b.id);for(const j of model.joints)this.jointByName.set(j.name,j);
  anatomy.children.forEach(o=>{if(o.name.startsWith('body-'))this.nodes.set(Number(o.name.slice(5)),o as Group);});
  anatomy.traverse(o=>{if(o instanceof Mesh){o.castShadow=true;o.receiveShadow=true;o.material=new MeshStandardMaterial({color:0xc7c7bd,roughness:.63,metalness:.03,side:DoubleSide});}});
  const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(new Float32Array(1200*6),3));geo.setAttribute('color',new Float32BufferAttribute(new Float32Array(1200*6),3));
  this.muscles=new LineSegments(geo,new LineBasicMaterial({vertexColors:true,transparent:true,opacity:.90}));this.muscles.frustumCulled=false;this.root.add(this.muscles);
  const links=new BufferGeometry();links.setAttribute('position',new Float32BufferAttribute(new Float32Array((model.bodies.length+2)*6),3));
  this.links=new LineSegments(links,new LineBasicMaterial({color:0x2774e8,depthTest:false,transparent:true,opacity:.65}));this.links.frustumCulled=false;this.root.add(this.links);
  for(const n of ['Full Body','torso','humerus_r','ulna_r','lunate_r','humerus_l','ulna_l','femur_r','femur_l','tibia_r','tibia_l','talus_r','talus_l']){
   const id=this.byName.get(n);if(id===undefined)continue;const a=new AxesHelper(.07);this.axes.set(id,a);this.root.add(a);
  }
  for(const a of this.arrows){a.setColor(0xec8136);this.root.add(a);}
  this.root.visible=false;
 }
 static async create(surfaceRig?:HumanRig){
  const [model,gltf]=await Promise.all([json<ModelData>('/dynamics/model.json'),new GLTFLoader().loadAsync(webPlatform.assetUrl('/dynamics/anatomy.glb'))]);
  return new DynamicsReplay(model,gltf.scene,surfaceRig);
 }
 get ready(){return !!this.record;}
 get duration(){return this.record?.meta.duration??0;}
 async load(id:DynamicsId,profile:DynamicsCase,actionSpec?:MuscleActionFile,records?:DynamicsRecords){
  const revision=++this.loadRevision;const key=`${id}-${profile}`;let record=this.cache.get(key);
  if(!record){
   // Envelope record URLs are authoritative when the spec carries them; a
   // bare spec falls back to the per-action layout `/dynamics/<id>/<case>`.
   const ref=records?.[profile],metaUrl=ref?.meta??`/dynamics/${id}/${profile}.json`,dataUrl=ref?.data??`/dynamics/${id}/${profile}.bin`;
   const [meta,response]=await Promise.all([json<RecordData>(metaUrl),webPlatform.fetchAsset(dataUrl)]);if(!response.ok)throw new Error('仿真记录未找到');
   // Same identity gate scripts/test-dynamics-records.py applies: whichever
   // URL served the record, its payload must be the requested id+case — a
   // records table pointing at the wrong action's files is a hard error,
   // not a silent replay of somebody else's trajectory.
   if(meta.id!==id||meta.case!==profile)throw new Error(`仿真记录身份不匹配：请求 ${id}/${profile}，记录为 ${meta.id}/${meta.case}`);
   const values=new Float32Array(await response.arrayBuffer());const end=meta.frames.at(-1)!;if(end.offset+meta.headLength+end.segments*7!==values.length)throw new Error('仿真记录长度校验失败');record={meta,values};this.cache.set(key,record);}
  if(revision!==this.loadRevision)return false;
  this.model=await json<ModelData>(record.meta.modelMeta??'/dynamics/model.json');this.byName.clear();this.jointByName.clear();for(const b of this.model.bodies)this.byName.set(b.name,b.id);for(const j of this.model.joints)this.jointByName.set(j.name,j);
  this.referencePose.clear();const first=record.meta.frames[0],base=first.offset+record.meta.layout.qpos+record.meta.layout.qvel;
  for(const body of this.model.bodies){const at=base+body.id*7;this.referencePose.set(body.id,{position:new Vector3(record.values[at],record.values[at+1],record.values[at+2]),quaternion:new Quaternion(record.values[at+4],record.values[at+5],record.values[at+6],record.values[at+3]).normalize()});}
  this.record=record;this.id=id;this.case=profile;this.actionSpec=actionSpec;this.seek(0);
  // A fixed support fixture defines the experiment's ground reference. Set the
  // visible sole plane to y=0 by one rigid scene translation; no bone rescaling.
  this.root.position.y=0;this.root.updateMatrixWorld(true);let lowest=Infinity;
  for(const n of ['calcn_r','calcn_l','toes_r','toes_l']){
   const node=this.nodes.get(this.byName.get(n)!);node?.traverse(o=>{if(o instanceof Mesh){const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);lowest=Math.min(lowest,v.y);}}});
  }
  if(Number.isFinite(lowest))this.root.position.y=-lowest;
  this.root.updateMatrixWorld(true);if(this.options)this.setOptions(this.options);return true;
 }
 seek(time:number){
  if(!this.record)return;this.time=Math.max(0,Math.min(this.duration,time));const {meta,values}=this.record;
  let lo=0,hi=meta.frames.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(meta.frames[mid].time<=this.time)lo=mid;else hi=mid-1;}
  const a=meta.frames[lo],b=meta.frames[Math.min(lo+1,meta.frames.length-1)],u=b.time>a.time?(this.time-a.time)/(b.time-a.time):0;
  this.current=values.subarray(a.offset,a.offset+meta.headLength);const next=values.subarray(b.offset,b.offset+meta.headLength),bodyStart=meta.layout.qpos+meta.layout.qvel;
  this.bodyValues.length=meta.layout.bodies*7;
  for(let id=0;id<meta.layout.bodies;id++){
   const at=bodyStart+id*7,base=id*7;
   for(let j=0;j<3;j++)this.bodyValues[base+j]=this.current[at+j]*(1-u)+next[at+j]*u;
   q.set(this.current[at+4],this.current[at+5],this.current[at+6],this.current[at+3]).normalize();q2.set(next[at+4],next[at+5],next[at+6],next[at+3]).normalize();q.slerp(q2,u);
   this.bodyValues[base+3]=q.w;this.bodyValues[base+4]=q.x;this.bodyValues[base+5]=q.y;this.bodyValues[base+6]=q.z;
   const node=this.nodes.get(id);if(node){node.position.fromArray(this.bodyValues,base);node.quaternion.copy(q);}
   const axis=this.axes.get(id);if(axis){axis.position.fromArray(this.bodyValues,base);axis.quaternion.copy(q);}
  }
  this.interpolatedJoints.clear();
  for(const joint of this.model.joints){if(joint.dofCount===1)this.interpolatedJoints.set(joint.name,this.current[joint.qpos]*(1-u)+next[joint.qpos]*u);}
  this.applySurfacePose();
  const forceStart=bodyStart+meta.layout.bodies*7,activationStart=forceStart+meta.layout.muscles;
  const positions=this.muscles.geometry.getAttribute('position'),colors=this.muscles.geometry.getAttribute('color');
  for(let i=0;i<a.segments;i++){
   const at=a.offset+meta.headLength+i*7,id=values[at+6],level=this.current[activationStart+id];
   const color=new Color().setRGB(.22+.73*level,.49-.22*level,.74-.55*level);
   for(let j=0;j<2;j++){positions.setXYZ(i*2+j,values[at+j*3],values[at+j*3+1],values[at+j*3+2]);colors.setXYZ(i*2+j,color.r,color.g,color.b);}
  }
  this.muscles.geometry.setDrawRange(0,a.segments*2);positions.needsUpdate=true;colors.needsUpdate=true;
  const lp=this.links.geometry.getAttribute('position');let lines=0;
  for(const body of this.model.bodies){if(body.parent<1)continue;const a=body.id*7,b=body.parent*7;lp.setXYZ(lines*2,this.bodyValues[a],this.bodyValues[a+1],this.bodyValues[a+2]);lp.setXYZ(lines*2+1,this.bodyValues[b],this.bodyValues[b+1],this.bodyValues[b+2]);lines++;}
  this.links.geometry.setDrawRange(0,lines*2);lp.needsUpdate=true;
  const supportStart=activationStart+meta.layout.muscles;
  for(let i=0;i<2;i++){
   const side=i===0?'r':'l',id=this.byName.get('calcn_'+side)!;this.arrows[i].position.fromArray(this.bodyValues,id*7);
   v.fromArray(this.current,supportStart+i*3);const length=v.length();this.arrows[i].setDirection(length>1e-6?v.divideScalar(length):new Vector3(0,0,1));this.arrows[i].setLength(Math.max(.025,Math.min(.6,length*.00065)),.04,.025);
  }
  this.root.updateMatrixWorld(true);
 }
 setOptions(options:DebugOptions){this.options=options;this.anatomy.visible=options.skeleton;this.links.visible=options.skeleton;if(this.surfaceRig)this.surfaceRig.model.visible=options.surface;this.muscles.visible=options.muscles;for(const a of this.axes.values())a.visible=options.axes;for(const a of this.arrows)a.visible=options.targets;}
 /** Retarget physical body states onto the existing continuous MakeHuman skin.
  * Root translation and two-bone limb targets come from the physical segment
  * frames; intermediate torso rotations use the same rest-relative quaternions.
  * Segment proportions remain those of the visual rig, so this is a display
  * retarget, not a second force model or a claim of exact skin deformation. */
 private applySurfacePose(){
  const rig=this.surfaceRig;if(!rig||!this.record||!this.current)return;
  rig.reset();rig.model.position.set(0,0,0);rig.model.updateMatrixWorld(true);
  const bindWorld=new Map([...rig.bones].map(([name,bone])=>[name,bone.getWorldQuaternion(new Quaternion())] as const));
  const id=(name:string)=>this.byName.get(name);
  const sourceQ=(body:number)=>{const at=(this.record!.meta.layout.qpos+this.record!.meta.layout.qvel)+body*7;return new Quaternion(this.current![at+4],this.current![at+5],this.current![at+6],this.current![at+3]).normalize();};
  const qDelta=(bodyName:string)=>{const body=id(bodyName);if(body===undefined)return new Quaternion();const initial=this.referencePose.get(body)!;const now=sourceQ(body);const nowWorld=this.sourceToScene.clone().multiply(now);const startWorld=this.sourceToScene.clone().multiply(initial.quaternion);return nowWorld.multiply(startWorld.invert()).normalize();};
  const point=(name:string)=>this.point(name);
  const rootId=id('Full Body');if(rootId!==undefined){
   const at=(this.record.meta.layout.qpos+this.record.meta.layout.qvel)+rootId*7,initial=this.referencePose.get(rootId)!,delta=new Vector3(this.current[at]-initial.position.x,this.current[at+1]-initial.position.y,this.current[at+2]-initial.position.z).applyQuaternion(this.sourceToScene);
   const root=rig.bone('root');root.position.copy(rig.restLocal.get('root')!).add(delta);
   // The free-root body and MyoSim pelvis body carry the same global heading.
   // Use the free root once here; mapping pelvis again onto the two independent
   // MakeHuman hip pivots double-counts yaw and tears the gluteal skin.
   rig.worldRotation('root',qDelta('Full Body').multiply(bindWorld.get('root')!));
  }
  const map=[['sacrum','spine05'],['lumbar5','spine04'],['lumbar4','spine03'],['lumbar3','spine02'],['torso','spine01'],['neck','neck01'],['head','head'],['clavicle_l','clavicle_L'],['clavicle_r','clavicle_R']] as const;
  for(const [body,bone]of map){if(id(body)===undefined||!rig.bones.has(bone))continue;rig.worldRotation(bone,qDelta(body).multiply(bindWorld.get(bone)!));}
  // IK carries the visible hand and foot to the recorded physical end points,
  // retaining the mesh rig's fixed segment lengths when its proportions differ.
  for(const side of ['L','R'] as const){
   const suffix=side==='L'?'l':'r';
   rig.limb(side,'leg',point(`talus_${suffix}`),point(`tibia_${suffix}`));
   // The source model's supported calcaneus orientation anchors toe heading.
   // Retarget it after the leg IK so the lower leg cannot drag the feet into
   // an unintended inward yaw when the pelvis turns.
   if(id(`calcn_${suffix}`)!==undefined&&rig.bones.has(`foot_${side}`)){
    // The MakeHuman rest feet are about 1–2° more internally rotated than the
    // MyoSim calcaneus frame. Apply a small bilateral toe-out retarget offset.
    const toeOut=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),(side==='R'?-1:1)*5*Math.PI/180);
    rig.worldRotation(`foot_${side}`,toeOut.multiply(qDelta(`calcn_${suffix}`).multiply(bindWorld.get(`foot_${side}`)!)));
   }
  }
  // Both upper limbs are active in the reduced model. Retarget each arm's
  // physical shoulder→elbow→hand direction and elbow flexion onto the skin
  // shoulder. MyoSim and MakeHuman place their neutral shoulder pivots about
  // 12 cm apart; passing the physical hand point directly makes a straight
  // punch look bent on the skin. Use the skin segment lengths and the law of
  // cosines to preserve the simulated elbow angle without scaling the mesh.
  for(const side of ['L','R'] as const){
   const suffix=side==='L'?'l':'r';
   const physicalShoulder=point(`humerus_${suffix}`),physicalElbow=point(`ulna_${suffix}`),physicalHand=point(`lunate_${suffix}`);
   const skinShoulder=rig.point(`upperarm01_${side}`);
   const a=rig.rest.get(`upperarm01_${side}`)!.distanceTo(rig.rest.get(`lowerarm01_${side}`)!);
   const b=rig.rest.get(`lowerarm01_${side}`)!.distanceTo(rig.rest.get(`wrist_${side}`)!);
   const elbowFlex=Math.max(0,Math.min(145*Math.PI/180,Math.PI-physicalShoulder.clone().sub(physicalElbow).angleTo(physicalHand.clone().sub(physicalElbow))));
   const targetLength=Math.sqrt(a*a+b*b+2*a*b*Math.cos(elbowFlex));
   const armDirection=physicalHand.sub(physicalShoulder).normalize();
   rig.limbToWorldTargets(side,'arm',skinShoulder.clone().addScaledVector(armDirection,targetLength),physicalElbow);
  }
  if(id('lunate_l')!==undefined)rig.worldRotation('wrist_L',qDelta('lunate_l').multiply(bindWorld.get('wrist_L')!));
  const retargetRightHand=this.actionSpec?.display.handPoseSource==='task-keyframe-retarget';
  if(id('lunate_r')!==undefined&&!retargetRightHand)rig.worldRotation('wrist_R',qDelta('lunate_r').multiply(bindWorld.get('wrist_R')!));
  const handTargetAngle=(name:string)=>{
   const action=this.actionSpec;if(action?.display.handPoseSource!=='task-keyframe-retarget'||!skinHandTargets.has(name))return undefined;
   const frames=action.reference.keyframes;if(!frames?.length)return undefined;
   const lead=action.simulation.leadSeconds??0,speed=action.simulation.referenceSpeedScale??1;
   const sourceTime=Math.max(0,(this.time-lead)*speed);
   const target=(index:number)=>frames[index]?.jointTargetsDeg?.[name];
   if(sourceTime<=frames[0].timeSeconds){const value=target(0);return value===undefined?undefined:value*Math.PI/180;}
   let upper=frames.findIndex(frame=>frame.timeSeconds>=sourceTime);if(upper<0)upper=frames.length-1;
   const lower=Math.max(0,upper-1),a=target(lower),b=target(upper);
   if(a===undefined&&b===undefined)return undefined;
   if(a===undefined)return b!*Math.PI/180;if(b===undefined)return a*Math.PI/180;
   const span=frames[upper].timeSeconds-frames[lower].timeSeconds;
   const u=span>0?Math.max(0,Math.min(1,(sourceTime-frames[lower].timeSeconds)/span)):0;
   const eased=u*u*(3-2*u);
   return (a+(b-a)*eased)*Math.PI/180;
  };
  // For actions with a declared hand retarget, build the hand frame from the
  // visible forearm direction and its physical pronation, then apply the
  // bounded authored wrist-flexion angle. This avoids carrying the source
  // model's mismatched wrist-to-forearm orientation into the skin rig.
  const wristFlexionTarget=handTargetAngle('flexion_r');
  if(retargetRightHand&&wristFlexionTarget!==undefined&&rig.bones.has('lowerarm01_R')&&rig.bones.has('wrist_R')){
   const frame=handFrame(rig.rest,'R');
   const forearm=rig.point('wrist_R').sub(rig.point('lowerarm01_R')).normalize();
   const forearmWorld=rig.bone('lowerarm01_R').getWorldQuaternion(new Quaternion());
   const normal=frame.normal.clone().applyQuaternion(bindWorld.get('lowerarm01_R')!.clone().invert())
    .applyQuaternion(forearmWorld).normalize();
   const pronation=this.interpolatedJoints.get('pro_sup_r')??0;
   const pronationRotation=new Quaternion().setFromAxisAngle(forearm,pronation);
   const palmNormal=normal.applyQuaternion(pronationRotation).normalize();
   const flexionAxis=new Vector3().crossVectors(forearm,palmNormal).normalize();
   const wristBend=new Quaternion().setFromAxisAngle(flexionAxis,wristFlexionTarget);
   rig.hand('R',forearm.clone().applyQuaternion(wristBend),palmNormal.applyQuaternion(wristBend).normalize());
  }
  const angle=(name:string)=>handTargetAngle(name)??this.interpolatedJoints.get(name)??0;
  const pose:HandJointPose={
   // MyoSim and MakeHuman use opposite local axes at thumb CMC flexion and
   // MCP. Convert at the simulation-to-skin boundary, not in the action data.
   thumb:mapMyoSimThumbToSkin({cmcFlexion:angle('cmc_flexion'),cmcOpposition:angle('cmc_abduction'),mcp:angle('mp_flexion_r'),ip:angle('ip_flexion_r')}),
   fingers:{
    2:{mcp:angle('mcp2_flexion_r'),pip:angle('pm2_flexion_r'),dip:angle('md2_flexion_r'),abduction:angle('mcp2_abduction_r')},
    3:{mcp:angle('mcp3_flexion_r'),pip:angle('pm3_flexion_r'),dip:angle('md3_flexion'),abduction:angle('mcp3_abduction_r')},
    4:{mcp:angle('mcp4_flexion_r'),pip:angle('pm4_flexion'),dip:angle('md4_flexion_r'),abduction:angle('mcp4_abduction_r')},
    5:{mcp:angle('mcp5_flexion_r'),pip:angle('pm5_flexion_r'),dip:angle('md5_flexion_r'),abduction:angle('mcp5_abduction_r')},
   },
  };
  rig.articulateHand('R',pose);
  const leftGuard=this.actionSpec?.display.leftGuardHandPoseDeg;
  if(leftGuard){
   const toRadians=(degrees:number)=>degrees*Math.PI/180;
   rig.articulateHand('L',{
    thumb:{cmcFlexion:toRadians(leftGuard.thumb.cmcFlexion),cmcOpposition:toRadians(leftGuard.thumb.cmcOpposition),mcp:toRadians(leftGuard.thumb.mcp),ip:toRadians(leftGuard.thumb.ip)},
    fingers:{
     2:{mcp:toRadians(leftGuard.fingers['2'].mcp),pip:toRadians(leftGuard.fingers['2'].pip),dip:toRadians(leftGuard.fingers['2'].dip)},
     3:{mcp:toRadians(leftGuard.fingers['3'].mcp),pip:toRadians(leftGuard.fingers['3'].pip),dip:toRadians(leftGuard.fingers['3'].dip)},
     4:{mcp:toRadians(leftGuard.fingers['4'].mcp),pip:toRadians(leftGuard.fingers['4'].pip),dip:toRadians(leftGuard.fingers['4'].dip)},
     5:{mcp:toRadians(leftGuard.fingers['5'].mcp),pip:toRadians(leftGuard.fingers['5'].pip),dip:toRadians(leftGuard.fingers['5'].dip)},
    },
   });
  }
  rig.model.updateMatrixWorld(true);
 }
 point(name:string){const id=this.byName.get(name)??1;return this.root.localToWorld(new Vector3().fromArray(this.bodyValues,id*7));}
 diagnostics(){
  if(!this.current||!this.record)return null;const l=this.record.meta.layout,forceStart=l.qpos+l.qvel+l.bodies*7,actStart=forceStart+l.muscles,supportStart=actStart+l.muscles;
  const power=Array.from(this.current.subarray(supportStart+6,supportStart+9));
  const muscles=this.model.actuators.filter(a=>a.id<273||a.id>=336).map(a=>({name:a.name,force:this.current![forceStart+a.id],activation:this.current![actStart+a.id]})).sort((a,b)=>b.force*b.activation-a.force*a.activation).slice(0,5);
  return {case:this.case,mass:this.model.mass,power,totalPower:power.reduce((a,b)=>a+b,0),support:Array.from(this.current.subarray(supportStart,supportStart+6)),speed:this.current[supportStart+9],muscles} as DynamicsReadout;
 }
 jointAngle(name:string){const j=this.model.joints.find(j=>j.name===name);return j&&this.current?this.current[j.qpos]*180/Math.PI:0;}
 dispose(){this.root.traverse(o=>{if(o instanceof Mesh||o instanceof LineSegments){o.geometry.dispose();const mat=Array.isArray(o.material)?o.material:[o.material];mat.forEach(m=>m.dispose());}});this.root.removeFromParent();}
}
