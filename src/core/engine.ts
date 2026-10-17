import {AmbientLight,AnimationAction,AnimationClip,AnimationMixer,AxesHelper,Bone,Box3,BufferGeometry,Color,DirectionalLight,Float32BufferAttribute,GridHelper,Group,HemisphereLight,Line,LineBasicMaterial,LineSegments,Mesh,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,Quaternion,QuaternionKeyframeTrack,Scene,SkinnedMesh,SphereGeometry,Vector3,VectorKeyframeTrack,WebGLRenderer,PCFSoftShadowMap,SRGBColorSpace,ACESFilmicToneMapping,Clock,LoopOnce,LoopRepeat} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {HumanRig} from './rig';
import {MOTION_FILES} from './motion-files';
import {frameAt,type WorkshopDoc} from '../workshop/document';
import {solveEffectiveFrame} from '../workshop/solver';
import {attachRacket,gripFrame} from './racket';
import type {DynamicsCase,DynamicsReadout,DynamicsReplay} from './dynamics';
import {isDynamicsMotion,motionById,muscleActionById} from './motions';
import {angleAt} from './kinematics';
import type {DebugOptions,MotionId,RigInfo,ViewId} from './types';
export interface FrameState{time:number;duration:number;phase:string;playing:boolean;knee:number;elbow:number;gripError:number;dynamics?:DynamicsReadout}
/** Bake a workshop-motion document into a mixer clip at 40 fps — the same
 * sample density the pose-package builder uses, so the lab viewer and the
 * service share one trajectory source (envelope → frameAt → solveEffectiveFrame). */
function bakeDocumentClip(rig:HumanRig,id:string,doc:WorkshopDoc,fps=40){
 const times:number[]=[],positions:number[]=[],rot=new Map([...rig.bones.keys()].map(n=>[n,[] as number[]]));
 const frames=Math.ceil(doc.duration*fps),origin=rig.rest.get('root')!;
 for(let i=0;i<=frames;i++){
  const t=i/frames*doc.duration;solveEffectiveFrame(rig,frameAt(doc,t,origin));
  times.push(t);positions.push(...rig.bone('root').position.toArray());
  for(const [n,b]of rig.bones)rot.get(n)!.push(...b.quaternion.toArray());
 }
 const tracks=[...rot].map(([n,v])=>new QuaternionKeyframeTrack(n+'.quaternion',times,v));
 rig.reset();
 return new AnimationClip(id,doc.duration,[...tracks,new VectorKeyframeTrack('root.position',times,positions)]);
}
export class HumanEngine{
 scene=new Scene();camera=new PerspectiveCamera(35,1,.01,120);renderer:WebGLRenderer;controls:OrbitControls;
 model?:Group;rig?:HumanRig;mixer?:AnimationMixer;clips=new Map<MotionId,AnimationClip>();actions=new Map<MotionId,AnimationAction>();
 activeId:MotionId='idle';active?:AnimationAction;playing=true;speed=1;private _loop=true;disposed=false;ready=false;
 debug:DebugOptions={surface:true,skeleton:false,axes:false,targets:false,trail:false,muscles:false};
 racket?:Group;skeletonLines?:LineSegments;jointGroup=new Group();axesGroup=new Group();targetGroup=new Group();
 targetMarkers=new Map<string,Mesh>();trail?:Line;trailPoints:Vector3[]=[];
 walkOffset=new Vector3();stride=new Vector3();previousPosition=new Vector3();view:ViewId='front';
 private floor?:Mesh;private grid?:GridHelper;private keyLight?:DirectionalLight;private clock=new Clock();private lastNotify=0;private resizeObserver:ResizeObserver;private fadeRemaining=0;private raf=0;
 physics?:DynamicsReplay;physicsTime=0;physicsCase:DynamicsCase='baseline';physicsLoading=false;private physicsPromise?:Promise<DynamicsReplay>;
 get isPhysics(){return isDynamicsMotion(this.activeId);}
 onView?:(view:ViewId)=>void;onFrame?:(frame:FrameState)=>void;onReady?:(info:RigInfo)=>void;onError?:(error:Error)=>void;
 get loop(){return this._loop;}
 set loop(value:boolean){this._loop=value;for(const a of this.actions.values()){a.setLoop(value?LoopRepeat:LoopOnce,value?Infinity:1);a.clampWhenFinished=true;}}
 constructor(public host:HTMLElement){
  this.renderer=new WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));this.renderer.outputColorSpace=SRGBColorSpace;this.renderer.toneMapping=ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
  this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=PCFSoftShadowMap;
  this.renderer.domElement.setAttribute('aria-label','交互式三维人体，拖动旋转，滚轮缩放');this.renderer.domElement.setAttribute('role','img');this.host.appendChild(this.renderer.domElement);
  this.scene.background=new Color('#f5f7fa');this.scene.add(new HemisphereLight(0xffffff,0x8592a6,2.5),new AmbientLight(0xffffff,.35));
  const key=new DirectionalLight(0xfff6ec,4.2);key.position.set(-3,5,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=3;key.shadow.camera.bottom=-3;key.shadow.normalBias=.012;key.shadow.bias=-.0001;this.scene.add(key,key.target);this.keyLight=key;
  const fill=new DirectionalLight(0xc3d9ff,2);fill.position.set(3,2,-3);this.scene.add(fill);
  const floor=new Mesh(new PlaneGeometry(200,200),new MeshStandardMaterial({color:0xf4f6f9,roughness:1,metalness:0}));floor.rotation.x=-Math.PI/2;floor.position.y=-.009;floor.receiveShadow=true;this.scene.add(floor);this.floor=floor;
  const grid=new GridHelper(200,800,0xc3cbd5,0xd8dfe8);grid.position.y=-.007;const gm=grid.material as LineBasicMaterial;gm.transparent=true;gm.opacity=.45;this.scene.add(grid);this.grid=grid;
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.target.set(0,.88,0);this.controls.minDistance=.3;this.controls.maxDistance=8;this.controls.maxPolarAngle=Math.PI*.49;this.controls.enablePan=true;this.camera.position.set(0,1.05,3.6);
  this.controls.addEventListener('start',()=>{this.view='free';this.onView?.('free');});
  this.scene.add(this.jointGroup,this.axesGroup,this.targetGroup);this.jointGroup.visible=false;this.axesGroup.visible=false;this.targetGroup.visible=false;
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
  this.animate();
 }
 async load(){
  try{
   const [gltf,info,walk,walkMeta]=await Promise.all([new GLTFLoader().loadAsync('/models/human.glb'),fetch('/models/rig.json').then(r=>{if(!r.ok)throw new Error('人体骨架加载失败');return r.json() as Promise<RigInfo>}),fetch('/models/walk.json').then(r=>{if(!r.ok)throw new Error('步态动作加载失败');return r.json()}),fetch('/models/walk-meta.json').then(r=>r.json())]);
   if(this.disposed){gltf.scene.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose()});return;}
   this.model=gltf.scene;this.scene.add(this.model);this.rig=new HumanRig(this.model,info);
   this.model.traverse(o=>{if(o instanceof SkinnedMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;o.material=new MeshStandardMaterial({color:0x7997b2,roughness:.53,metalness:.08});}});
   // Sclerae at the original MakeHuman eye pivots, keeping facial silhouette intact.
   for(const side of ['L','R']){
    const eye=this.rig.bone(`eye_${side}`);const sclera=new Mesh(new SphereGeometry(.0105,20,12),new MeshStandardMaterial({color:0xbdcbd2,roughness:.5}));eye.add(sclera);
   }
   this.racket=attachRacket(this.rig);this.racket.visible=false;
   this.clips=new Map();
   for(const f of MOTION_FILES)if(f.kind==='workshop-motion')this.clips.set(f.id,bakeDocumentClip(this.rig,f.id,f.document!));
   this.clips.set('walk',AnimationClip.parse(walk));this.stride.fromArray(walkMeta.stride);
   this.mixer=new AnimationMixer(this.model);
   for(const [id,clip]of this.clips)this.actions.set(id,this.mixer.clipAction(clip));
   this.makeDebug();this.ready=true;this.setMotion('idle',false);this.setView('front');this.onReady?.(info);
  }catch(err){this.onError?.(err instanceof Error?err:new Error(String(err)));}
 }
 private makeDebug(){
  if(!this.rig)return;
  const major=this.rig.info.bones.filter(b=>/^(root|pelvis_|spine|neck|head$|clavicle_|shoulder|upperarm|lowerarm|wrist_|metacarpal|finger|upperleg|lowerleg|foot_|toe)/.test(b.name));
  const segments=major.filter(b=>b.parent);const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(new Float32Array(segments.length*6),3));
  const lines=new LineSegments(geo,new LineBasicMaterial({color:0x367cff,depthTest:false,transparent:true,opacity:.85}));lines.renderOrder=10;lines.frustumCulled=false;lines.userData.segments=segments;this.skeletonLines=lines;this.scene.add(lines);lines.visible=false;
  const jointGeo=new SphereGeometry(.009,10,8);const jointMat=new MeshStandardMaterial({color:0x225bdb,depthTest:false});
  const names=['root','spine03','spine01','neck01','head',...['L','R'].flatMap(s=>['upperarm01_','lowerarm01_','wrist_','upperleg01_','lowerleg01_','foot_'].map(n=>n+s))];
  for(const n of names){const marker=new Mesh(jointGeo,jointMat);marker.userData.bone=n;marker.renderOrder=11;this.jointGroup.add(marker);const axis=new AxesHelper(.075);axis.userData.bone=n;axis.renderOrder=12;const mat=axis.material as LineBasicMaterial;mat.depthTest=false;this.axesGroup.add(axis);}
  for(const n of ['wrist_R','wrist_L','foot_R','foot_L']){const marker=new Mesh(new SphereGeometry(.017,12,8),new MeshStandardMaterial({color:0xec8c39,depthTest:false,transparent:true,opacity:.8,wireframe:true}));marker.userData.bone=n;marker.renderOrder=13;this.targetGroup.add(marker);this.targetMarkers.set(n,marker);}
  this.trail=new Line(new BufferGeometry(),new LineBasicMaterial({color:0x3069ed,transparent:true,opacity:.6}));this.scene.add(this.trail);this.trail.visible=false;
 }
 resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);}
 async loadPhysics(id:MotionId,profile:DynamicsCase='baseline'){
  this.physicsLoading=true;this.notify();
  try{
   if(!this.physicsPromise)this.physicsPromise=import('./dynamics').then(m=>m.DynamicsReplay.create(this.rig));
   const replay=await this.physicsPromise;
   if(this.disposed){replay.dispose();return;}
   if(!this.physics){this.physics=replay;this.scene.add(replay.root);}
   const accepted=await replay.load(id,profile,muscleActionById(id));if(!accepted)return;
   if(this.activeId!==id)return;
   this.physicsLoading=false;this.physicsCase=profile;replay.root.visible=true;replay.setOptions(this.debug);replay.seek(this.physicsTime);this.previousPosition.copy(replay.point('Full Body'));this.setView(this.view==='hand'?'threeQuarter':this.view);this.playing=true;this.notify();
  }catch(error){if(this.activeId===id){this.physicsLoading=false;this.playing=false;this.onFrame?.({time:0,duration:motionById(id).duration,phase:'加载失败',playing:false,knee:0,elbow:0,gripError:0,dynamics:{case:profile,loading:false,error:error instanceof Error?error.message:String(error),mass:0,power:[0,0,0],totalPower:0,support:[0,0,0,0,0,0],speed:0,muscles:[]}});}this.physicsPromise=undefined;}
 }
 setPhysicsCase(profile:DynamicsCase){if(this.isPhysics){this.playing=false;void this.loadPhysics(this.activeId,profile);}}
 setMotion(id:MotionId,fade=true){
  if(!this.ready||!this.mixer)return;
  if(isDynamicsMotion(id)){
   this.activeId=id;this.physicsTime=0;this.physicsCase='baseline';this.playing=false;for(const a of this.actions.values())a.stop();this.model!.visible=false;this.physics&&(this.physics.root.visible=false);this.racket&&(this.racket.visible=false);this.jointGroup.visible=false;this.axesGroup.visible=false;this.targetGroup.visible=false;this.skeletonLines&&(this.skeletonLines.visible=false);this.trail&&(this.trail.visible=false);void this.loadPhysics(id);return;
  }
  this.physicsLoading=false;this.physics&&(this.physics.root.visible=false);this.model!.visible=true;
  const previous=this.active;this.activeId=id;this.active=this.actions.get(id)!;
  this.walkOffset.set(0,0,0);if(this.model)this.model.position.set(0,0,0);
  this.active.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
  if(previous&&previous!==this.active&&fade){this.active.crossFadeFrom(previous,.32,false);this.fadeRemaining=.32;}else{for(const a of this.actions.values())if(a!==this.active)a.stop();this.fadeRemaining=0;}
  if(this.racket)this.racket.visible=id==='ready'||id==='forehand';
  this.trailPoints=[];this.previousPosition.set(0,0,0);this.playing=true;
  this.mixer.update(0);this.controls.target.set(0,.88,0);this.setView(this.view==='hand'?'threeQuarter':this.view);
  this.setDebug(this.debug);this.notify();
 }
 setPlaying(value:boolean){if(this.isPhysics){if(this.physics?.ready&&this.physicsTime>=this.physics.duration-.001&&value)this.physicsTime=0;this.playing=value&&!this.physicsLoading;this.notify();return;}if(value&&this.active?.paused){this.replay();}this.playing=value;this.notify();}
 seek(time:number){if(this.isPhysics){if(this.physics?.ready&&!this.physicsLoading){this.physicsTime=Math.max(0,Math.min(this.physics.duration,time));this.physics.seek(this.physicsTime);this.notify();}return;}if(!this.active||!this.mixer)return;for(const a of this.actions.values())if(a!==this.active)a.stop();this.fadeRemaining=0;this.active.enabled=true;this.active.setEffectiveWeight(1);this.active.paused=false;this.active.time=Math.min(this.active.getClip().duration-1e-6,Math.max(0,time));this.walkOffset.set(0,0,0);this.model?.position.set(0,0,0);this.mixer.update(0);this.trailPoints=[];this.updateDebug();this.notify();}
 replay(){if(this.isPhysics){this.physicsTime=0;this.physics?.seek(0);this.playing=!this.physicsLoading;this.notify();return;}if(this.active)this.active.paused=false;this.seek(0);this.playing=true;}
 setDebug(patch:Partial<DebugOptions>){Object.assign(this.debug,patch);if(this.isPhysics){this.physics?.setOptions(this.debug);return;}this.model?.traverse(o=>{if(o instanceof SkinnedMesh)o.visible=this.debug.surface;});this.skeletonLines&&(this.skeletonLines.visible=this.debug.skeleton);this.jointGroup.visible=this.debug.skeleton;this.axesGroup.visible=this.debug.axes;this.targetGroup.visible=this.debug.targets;if(this.trail)this.trail.visible=this.debug.trail&&(this.activeId==='forehand'||this.activeId==='ready');this.updateDebug();}
 setView(view:ViewId){
  this.view=view;this.onView?.(view);const root=(this.isPhysics&&this.physics?.ready?this.physics.point('Full Body'):this.rig?.point('root'))??new Vector3(0,.94,0),target=root.clone();target.y=this.activeId==='reach'?.98:.87;
  if(view==='free'){const shift=target.clone().sub(this.controls.target);this.camera.position.add(shift);this.controls.target.copy(target);this.previousPosition.copy(root);this.controls.update();this.render();return;}
  if(view==='hand'&&this.rig){const wrist=this.isPhysics&&this.physics?.ready?this.physics.point('lunate_r'):this.rig.point('wrist_R');target.copy(wrist).add(new Vector3(0,.01,.03));this.camera.position.copy(target).add(new Vector3(-.34,.18,.42));}
  else{
   const distance=Math.max(this.isPhysics?4.15:this.activeId==='reach'?3.90:3.65,2.0/Math.max(.4,this.camera.aspect));
   const angles={front:0,side:Math.PI/2,back:Math.PI,threeQuarter:-Math.PI/4,hand:0,free:0};const a=angles[view];this.camera.position.copy(target).add(new Vector3(Math.sin(a)*distance,.14,Math.cos(a)*distance));
  }
  this.controls.target.copy(target);this.camera.lookAt(target);this.controls.update();this.previousPosition.copy(root);this.render();
 }
 private animate=()=>{
  if(this.disposed)return;this.raf=requestAnimationFrame(this.animate);const dt=Math.min(this.clock.getDelta(),.1);
  this.tick(dt);this.controls.update();this.render();
 };
 tick(dt:number){
  if(this.isPhysics){
   if(this.physics?.ready&&!this.physicsLoading){
    if(this.playing){this.physicsTime+=dt*this.speed;if(this.physicsTime>=this.physics.duration){if(this.loop&&!motionById(this.activeId).oneShot)this.physicsTime%=this.physics.duration;else{this.physicsTime=this.physics.duration;this.playing=false;}}}
    this.physics.seek(this.physicsTime);const current=this.physics.point('Full Body'),delta=current.clone().sub(this.previousPosition);delta.y=0;this.controls.target.add(delta);this.camera.position.add(delta);this.previousPosition.copy(current);
    if(this.keyLight){this.keyLight.position.set(current.x-3,5,current.z+4);this.keyLight.target.position.set(current.x,0,current.z);this.keyLight.target.updateMatrixWorld();}
    this.lastNotify+=dt;if(this.lastNotify>.07){this.lastNotify=0;this.notify();}
   }return;
  }
  if(!this.ready||!this.mixer||!this.active||!this.model||!this.rig)return;
  if(this.playing){
   const duration=this.active.getClip().duration,old=this.active.time;
   let advance=dt*this.speed;
   if(!this.loop&&old+advance>=duration){advance=duration-old;this.playing=false;}
   this.mixer.update(advance);
   if(!this.loop&&!this.playing){this.active.time=duration;this.mixer.update(0);}
   if(this.activeId==='walk'&&old+advance>=duration&&this.loop){this.walkOffset.add(this.stride);this.model.position.copy(this.walkOffset);}
   this.fadeRemaining-=advance;if(this.fadeRemaining<=0)for(const a of this.actions.values())if(a!==this.active)a.stop();
  }
  this.model.updateMatrixWorld(true);
  const current=this.rig.point('root'),delta=current.clone().sub(this.previousPosition);
  // Camera translation follows locomotion only; Orbit orientation / zoom remain independent.
  if(this.activeId==='walk'||this.fadeRemaining>0){delta.y=0;this.controls.target.add(delta);this.camera.position.add(delta);}
  if(this.view==='hand'){const target=this.rig.point('wrist_R').add(new Vector3(0,.01,.03)),d=target.clone().sub(this.controls.target);this.controls.target.add(d);this.camera.position.add(d);}
  this.previousPosition.copy(current);if(this.floor){this.floor.position.x=current.x;this.floor.position.z=current.z;}if(this.grid){this.grid.position.x=Math.round(current.x/.25)*.25;this.grid.position.z=Math.round(current.z/.25)*.25;}if(this.keyLight){this.keyLight.position.set(current.x-3,5,current.z+4);this.keyLight.target.position.set(current.x,0,current.z);this.keyLight.target.updateMatrixWorld();}this.updateDebug();
  this.lastNotify+=dt;if(this.lastNotify>.07){this.lastNotify=0;this.notify();}
 }
 private updateDebug(){
  if(this.isPhysics)return;
  if(!this.rig||!this.model)return;this.model.updateMatrixWorld(true);
  if(this.skeletonLines&&this.debug.skeleton){const a=this.skeletonLines.geometry.getAttribute('position');const seg=this.skeletonLines.userData.segments as {name:string;parent:string}[];seg.forEach((b,i)=>{const p=this.rig!.point(b.name),q=this.rig!.point(b.parent);a.setXYZ(i*2,p.x,p.y,p.z);a.setXYZ(i*2+1,q.x,q.y,q.z);});a.needsUpdate=true;}
  for(const group of [this.jointGroup,this.axesGroup,this.targetGroup])if(group.visible)group.children.forEach(o=>{o.position.copy(this.rig!.point(o.userData.bone));if(o instanceof AxesHelper)o.quaternion.copy(this.rig!.bone(o.userData.bone).getWorldQuaternion(new Quaternion()));});
  if(this.trail){this.trail.visible=this.debug.trail&&(this.activeId==='forehand'||this.activeId==='ready');if(this.trail.visible&&this.playing&&this.racket){const tip=this.racket.localToWorld(new Vector3(0,.61,0));if(!this.trailPoints.length||tip.distanceTo(this.trailPoints.at(-1)!)>.005){this.trailPoints.push(tip);if(this.trailPoints.length>200)this.trailPoints.shift();this.trail.geometry.dispose();this.trail.geometry=new BufferGeometry().setFromPoints(this.trailPoints);}}}
 }
 diagnostics(){
  if(this.isPhysics&&this.physics?.ready)return {knee:this.physics.jointAngle('knee_angle_r'),elbow:this.physics.jointAngle('elbow_flexion_r'),gripError:0,footL:this.physics.point('talus_l').toArray(),footR:this.physics.point('talus_r').toArray(),root:this.physics.point('Full Body').toArray(),vertices:0,bones:this.physics.model.bodies.length,hand:this.physics.point('3proxph_r').toArray()};
  if(!this.rig||!this.racket)return null;const p=(n:string)=>this.rig!.point(n);
  const wrist=this.rig.bone('wrist_R'),expected=wrist.localToWorld(gripFrame(this.rig).center.clone()),actual=this.racket.getWorldPosition(new Vector3());
  return {knee:angleAt(p('upperleg01_R'),p('lowerleg01_R'),p('foot_R')),elbow:angleAt(p('upperarm01_R'),p('lowerarm01_R'),p('wrist_R')),gripError:expected.distanceTo(actual),footL:p('foot_L').toArray(),footR:p('foot_R').toArray(),root:p('root').toArray(),vertices:this.rig.info.vertices,bones:this.rig.bones.size,hand:p('wrist_R').toArray()};
 }
 private notify(){if(this.isPhysics){const spec=motionById(this.activeId),time=this.physicsTime,phase=[...spec.phases].reverse().find(p=>p.time<=time)?.label??spec.phases[0].label;const d=this.physics?.diagnostics()??{case:this.physicsCase,mass:0,power:[0,0,0],totalPower:0,support:[0,0,0,0,0,0],speed:0,muscles:[]};this.onFrame?.({time,duration:this.physicsLoading?spec.duration:this.physics?.duration??spec.duration,phase,playing:this.playing,knee:this.physics?.jointAngle('knee_angle_r')??0,elbow:this.physics?.jointAngle('elbow_flexion_r')??0,gripError:0,dynamics:{...d,loading:this.physicsLoading}});return;}if(!this.active)return;const spec=motionById(this.activeId),time=this.active.time;const phase=[...spec.phases].reverse().find(p=>p.time<=time)?.label??spec.phases[0].label;const d=this.diagnostics();this.onFrame?.({time,duration:this.active.getClip().duration,phase,playing:this.playing,knee:d?.knee??0,elbow:d?.elbow??0,gripError:d?.gripError??0});}
 render(){this.renderer.render(this.scene,this.camera);}
 dispose(){this.physics?.dispose();this.disposed=true;cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();this.controls.dispose();this.mixer?.stopAllAction();this.scene.traverse(o=>{if(o instanceof Mesh||o instanceof LineSegments||o instanceof Line){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});this.renderer.dispose();this.renderer.domElement.remove();}
}
