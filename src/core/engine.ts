import {AmbientLight,AnimationClip,AnimationMixer,AxesHelper,BufferGeometry,Color,DirectionalLight,Float32BufferAttribute,GridHelper,Group,HemisphereLight,Line,LineBasicMaterial,LineSegments,Mesh,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,Quaternion,Scene,SkinnedMesh,SphereGeometry,Vector3,WebGLRenderer,PCFSoftShadowMap,SRGBColorSpace,ACESFilmicToneMapping,Clock} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {HumanRig,skeletonSegments} from './rig';
import {MOTIONS,motionById,muscleActionById} from './motions';
import {attachRacket} from './racket';
import {ClipSource,DocumentSource,DynamicsSource,PoseFade,PosePackageSource,checkPosePackageShape,createDynamicsSession,posePackageSpec,type DynamicsSession,type MotionSource} from './motion-source';
import type {PosePackage} from './pose-package';
import type {DynamicsCase,DynamicsReadout,DynamicsReplay} from './dynamics';
import type {DebugOptions,MotionId,MotionSpec,RigInfo,ViewId} from './types';
export interface FrameState{time:number;duration:number;phase:string;playing:boolean;knee:number;elbow:number;gripError:number;dynamics?:DynamicsReadout}
const ZERO=new Vector3();
export class HumanEngine{
 scene=new Scene();camera=new PerspectiveCamera(35,1,.01,120);renderer:WebGLRenderer;controls:OrbitControls;
 model?:Group;rig?:HumanRig;mixer?:AnimationMixer;
 /** The one and only playhead, in seconds of the active source. */
 time=0;activeId:MotionId='idle';playing=true;speed=1;private _loop=true;disposed=false;ready=false;
 private sources=new Map<MotionId,MotionSource>();private specs=new Map<MotionId,MotionSpec>();
 /** Fallback key material for pose packages that arrive without an artifact id. */
 private pkgSeq=0;
 private _source?:MotionSource;private fade=new PoseFade();private dynSession?:DynamicsSession;
 debug:DebugOptions={surface:true,skeleton:false,axes:false,targets:false,trail:false,muscles:false};
 racket?:Group;skeletonLines?:LineSegments;jointGroup=new Group();axesGroup=new Group();targetGroup=new Group();
 targetMarkers=new Map<string,Mesh>();trail?:Line;trailPoints:Vector3[]=[];
 previousPosition=new Vector3();view:ViewId='front';
 private floor?:Mesh;private grid?:GridHelper;private keyLight?:DirectionalLight;private clock=new Clock();private lastNotify=0;private resizeObserver:ResizeObserver;private raf=0;
 onView?:(view:ViewId)=>void;onFrame?:(frame:FrameState)=>void;onReady?:(info:RigInfo)=>void;onError?:(error:Error)=>void;
 get source(){return this._source;}
 get isPhysics(){return this._source?.kind==='dynamics';}
 private dynamicsSource(){return this._source instanceof DynamicsSource?this._source:undefined;}
 get physics(){return this.dynamicsSource()?.physics;}
 get physicsLoading(){return this.dynamicsSource()?.status==='loading';}
 get physicsCase(){return this.dynamicsSource()?.profile??'baseline';}
 get loop(){return this._loop;}
 set loop(value:boolean){this._loop=value;for(const s of this.sources.values())if(s instanceof ClipSource)s.setLoop(value);}
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
   const clipSpecs=MOTIONS.filter(m=>m.source?.kind==='clip');
   const [gltf,info,...clipAssets]=await Promise.all([new GLTFLoader().loadAsync('/models/human.glb'),fetch('/models/rig.json').then(r=>{if(!r.ok)throw new Error('人体骨架加载失败');return r.json() as Promise<RigInfo>}),...clipSpecs.map(async m=>{
    const s=m.source as {kind:'clip';clip:string;meta?:string};
    const data=await fetch(s.clip).then(r=>{if(!r.ok)throw new Error('动作片段加载失败');return r.json()});
    const meta=s.meta?await fetch(s.meta).then(r=>r.json()):undefined;
    return {id:m.id as MotionId,clip:AnimationClip.parse(data),stride:new Vector3().fromArray(meta?.stride??[0,0,0])};
   })]);
   if(this.disposed){gltf.scene.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose()});return;}
   this.model=gltf.scene;this.scene.add(this.model);this.rig=new HumanRig(this.model,info);
   this.model.traverse(o=>{if(o instanceof SkinnedMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;o.material=new MeshStandardMaterial({color:0x7997b2,roughness:.53,metalness:.08});}});
   // Sclerae at the original MakeHuman eye pivots, keeping facial silhouette intact.
   for(const side of ['L','R']){
    const eye=this.rig.bone(`eye_${side}`);const sclera=new Mesh(new SphereGeometry(.0105,20,12),new MeshStandardMaterial({color:0xbdcbd2,roughness:.5}));eye.add(sclera);
   }
   this.racket=attachRacket(this.rig);this.racket.visible=false;
   this.mixer=new AnimationMixer(this.model);
   this.dynSession=createDynamicsSession(this.rig,this.scene);
   const clips=new Map(clipAssets.map(c=>[c.id,c]));
   for(const spec of MOTIONS){
    this.specs.set(spec.id,spec);const s=spec.source;
    if(s?.kind==='clip'){const c=clips.get(spec.id)!;this.sources.set(spec.id,new ClipSource(this.rig,this.mixer,this.mixer.clipAction(c.clip),c.stride,this.racket));}
    else if(s?.kind==='document')this.sources.set(spec.id,new DocumentSource(this.rig,s.document,this.racket));
    else if(s?.kind==='dynamics')this.sources.set(spec.id,DynamicsSource.create(this.dynSession));
   }
   this.loop=this._loop;
   this.makeDebug();this.ready=true;this.setMotion('idle',false);this.setView('front');this.onReady?.(info);
  }catch(err){this.onError?.(err instanceof Error?err:new Error(String(err)));}
 }
 private specOf(id:MotionId){return this.specs.get(id)??motionById(id);}
 /** Register an externally delivered pose package as a temporary motion.
  * The package is shape-checked against the local rig; a malformed package is
  * refused loudly through onError, never decoded silently. */
 openPosePackage(pkg:unknown):MotionSpec|undefined{
  if(!this.ready||!this.rig){this.onError?.(new Error('模型尚未就绪，无法播放姿态包'));return undefined;}
  const problems=checkPosePackageShape(pkg,new Set(this.rig.bones.keys()));
  if(problems.length){this.onError?.(new Error(`姿态包不可用：${problems[0]}${problems.length>1?`（共 ${problems.length} 处问题）`:''}`));return undefined;}
  const p=pkg as PosePackage;
  // Key the temp entry on the package's artifact id (content-addressed), not
  // the action id: two packages solved for the same action stay distinct
  // entries, and reopening the same package is idempotent.
  const specId=`pkg:${typeof p.id==='string'&&p.id?p.id:`unkeyed-${this.pkgSeq++}`}`;
  // The display spec is derived from what the package carries: bundled
  // envelopes (matched by action.id) restore capabilities/name/phases, the
  // ad-hoc parameters channel carries documentName and presentation hints.
  const spec=posePackageSpec(p,specId);
  this.specs.set(spec.id,spec);this.sources.set(spec.id,new PosePackageSource(this.rig,p,spec.capabilities?.prop,this.racket));
  this.setMotion(spec.id,false);return spec;
 }
 private loadDynamics(source:DynamicsSource,profile:DynamicsCase){
  const spec=this.specOf(this.activeId);
  // The spec's dynamics source is authoritative: it carries the envelope's
  // action parameters and record URLs straight into the replay.
  const ds=spec.source?.kind==='dynamics'?spec.source:undefined;
  void source.load(this.activeId,profile,ds?.action??muscleActionById(this.activeId),ds?.records).then(result=>{
   if(this._source!==source)return;
   const replay=source.physics;
   if(result==='applied'&&replay){
    source.setDebug(this.debug);source.seek(this.time);this.previousPosition.copy(source.rootPoint());
    this.setView(this.view==='hand'?'threeQuarter':this.view);this.playing=true;this.notify();
   }else if(result==='error'){
    this.playing=false;
    this.onFrame?.({time:0,duration:spec.duration,phase:'加载失败',playing:false,knee:0,elbow:0,gripError:0,dynamics:{case:profile,loading:false,error:source.error??'加载失败',mass:0,power:[0,0,0],totalPower:0,support:[0,0,0,0,0,0],speed:0,muscles:[]}});
   }
  });
  this.notify();
 }
 setPhysicsCase(profile:DynamicsCase){const s=this.dynamicsSource();if(s){this.playing=false;this.loadDynamics(s,profile);}}
 setMotion(id:MotionId,fade=true){
  if(!this.ready)return;
  const source=this.sources.get(id);if(!source)return;
  const previous=this._source,spec=this.specOf(id);
  const skinned=(s?:MotionSource)=>!!s&&s.kind!=='dynamics';
  this.activeId=id;this._source=source;this.time=0;
  if(source instanceof DynamicsSource){
   previous?.deactivate?.();this.fade.clear();this.playing=false;
   this.model!.visible=false;this.racket&&(this.racket.visible=false);
   this.jointGroup.visible=false;this.axesGroup.visible=false;this.targetGroup.visible=false;
   this.skeletonLines&&(this.skeletonLines.visible=false);this.trail&&(this.trail.visible=false);
   this.loadDynamics(source,'baseline');return;
  }
  this.model!.visible=true;
  previous?.deactivate?.();
  // Pose fade applies only between skinned sources; switching to or from a
  // physics replay stays a hard cut, as before.
  if(fade&&previous&&previous!==source&&skinned(previous))this.fade.start(this.rig!);else this.fade.clear();
  source.activate?.();source.seek(this.time);
  this.model!.position.copy(source.modelOffset??ZERO);
  if(this.racket)this.racket.visible=!!spec.capabilities?.prop&&source.wantsProp();
  this.trailPoints=[];this.previousPosition.set(0,0,0);this.playing=true;
  this.controls.target.set(0,.88,0);this.setView(this.view==='hand'?'threeQuarter':this.view);
  this.setDebug(this.debug);this.notify();
 }
 setPlaying(value:boolean){
  if(this.isPhysics){const r=this.physics;if(r?.ready&&this.time>=r.duration-.001&&value)this.time=0;this.playing=value&&!this.physicsLoading;this.notify();return;}
  const src=this._source;
  if(value&&src&&this.time>=src.duration-.001&&this.time>0)this.seek(0);
  this.playing=value;this.notify();
 }
 seek(time:number){
  const src=this._source;if(!src)return;
  if(this.isPhysics){
   if(src.status==='ready'){const r=this.physics!;this.time=Math.max(0,Math.min(r.duration,time));src.seek(this.time);this.notify();}
   return;
  }
  this.fade.clear();
  this.time=Math.max(0,Math.min(src.duration,time));
  src.seek(this.time);
  // Scrubbing resets the accumulated walk offset — same as the old walkOffset.clear on seek.
  src.modelOffset?.set(0,0,0);this.model?.position.copy(src.modelOffset??ZERO);
  this.trailPoints=[];this.updateDebug();this.notify();
 }
 replay(){if(this.isPhysics){this.time=0;this.physics?.seek(0);this.playing=!this.physicsLoading;this.notify();return;}this.seek(0);this.playing=true;}
 setDebug(patch:Partial<DebugOptions>){
  Object.assign(this.debug,patch);
  if(this.isPhysics){this._source?.setDebug?.(this.debug);return;}
  this.model?.traverse(o=>{if(o instanceof SkinnedMesh)o.visible=this.debug.surface;});
  this.skeletonLines&&(this.skeletonLines.visible=this.debug.skeleton);this.jointGroup.visible=this.debug.skeleton;this.axesGroup.visible=this.debug.axes;this.targetGroup.visible=this.debug.targets;
  if(this.trail)this.trail.visible=this.debug.trail&&!!this.specOf(this.activeId).capabilities?.prop?.trail;this.updateDebug();
 }
 setView(view:ViewId){
  this.view=view;this.onView?.(view);const spec=this.specOf(this.activeId);
  const root=(this.isPhysics&&this.physics?.ready?this._source?.point('Full Body'):this._source?.rootPoint())??new Vector3(0,.94,0),target=root.clone();
  target.y=spec.capabilities?.camera?.targetHeight??.87;
  if(view==='free'){const shift=target.clone().sub(this.controls.target);this.camera.position.add(shift);this.controls.target.copy(target);this.previousPosition.copy(root);this.controls.update();this.render();return;}
  if(view==='hand'&&this.rig){
   const wrist=(this.isPhysics&&this.physics?.ready?this._source?.point('lunate_r'):this.rig.point('wrist_R'))??this.rig.point('wrist_R');
   target.copy(wrist).add(new Vector3(0,.01,.03));this.camera.position.copy(target).add(new Vector3(-.34,.18,.42));
  }else{
   const distance=Math.max(this.isPhysics?4.15:spec.capabilities?.camera?.distance??3.65,2.0/Math.max(.4,this.camera.aspect));
   const angles={front:0,side:Math.PI/2,back:Math.PI,threeQuarter:-Math.PI/4,hand:0,free:0};const a=angles[view];this.camera.position.copy(target).add(new Vector3(Math.sin(a)*distance,.14,Math.cos(a)*distance));
  }
  this.controls.target.copy(target);this.camera.lookAt(target);this.controls.update();this.previousPosition.copy(root);this.render();
 }
 private animate=()=>{
  if(this.disposed)return;this.raf=requestAnimationFrame(this.animate);const dt=Math.min(this.clock.getDelta(),.1);
  this.tick(dt);this.controls.update();this.render();
 };
 tick(dt:number){
  const dyn=this.dynamicsSource();
  if(dyn){
   const replay=dyn.physics;
   if(replay?.ready&&dyn.status==='ready'){
    const spec=this.specOf(this.activeId);
    if(this.playing){this.time+=dt*this.speed;if(this.time>=replay.duration){if(this.loop&&!spec.oneShot)this.time%=replay.duration;else{this.time=replay.duration;this.playing=false;}}}
    dyn.seek(this.time);
    const current=replay.point('Full Body'),delta=current.clone().sub(this.previousPosition);delta.y=0;this.controls.target.add(delta);this.camera.position.add(delta);this.previousPosition.copy(current);
    if(this.keyLight){this.keyLight.position.set(current.x-3,5,current.z+4);this.keyLight.target.position.set(current.x,0,current.z);this.keyLight.target.updateMatrixWorld();}
    this.lastNotify+=dt;if(this.lastNotify>.07){this.lastNotify=0;this.notify();}
   }
   return;
  }
  const src=this._source;
  if(!this.ready||!src||!this.model||!this.rig)return;
  const spec=this.specOf(this.activeId);
  const duration=src.duration;
  if(this.playing&&duration>0){
   this.time+=dt*this.speed;
   if(this.time>=duration){
    if(this.loop&&!spec.oneShot){this.time%=duration;src.loopWrapAdvance?.();}
    else{this.time=duration;this.playing=false;}
   }
  }
  src.seek(this.time);
  this.fade.apply(this.rig,this.playing?dt:0);
  // Only clip sources carry a model offset; non-clip sources can never inherit
  // a stale walk translation because ZERO is copied in.
  this.model.position.copy(src.modelOffset??ZERO);
  // The prop appears/disappears with the grip amount — during the grip ramp it
  // fades in/out rather than snapping, an acceptable semantics for the ramp.
  if(this.racket)this.racket.visible=!!spec.capabilities?.prop&&src.wantsProp();
  this.model.updateMatrixWorld(true);
  const current=src.rootPoint(),delta=current.clone().sub(this.previousPosition);
  // Camera translation follows locomotion only; Orbit orientation / zoom remain independent.
  if(spec.capabilities?.locomotion==='follow'||this.fade.active){delta.y=0;this.controls.target.add(delta);this.camera.position.add(delta);}
  if(this.view==='hand'){const target=(src.point('wrist_R')??this.rig.point('wrist_R')).add(new Vector3(0,.01,.03)),d=target.clone().sub(this.controls.target);this.controls.target.add(d);this.camera.position.add(d);}
  this.previousPosition.copy(current);if(this.floor){this.floor.position.x=current.x;this.floor.position.z=current.z;}if(this.grid){this.grid.position.x=Math.round(current.x/.25)*.25;this.grid.position.z=Math.round(current.z/.25)*.25;}if(this.keyLight){this.keyLight.position.set(current.x-3,5,current.z+4);this.keyLight.target.position.set(current.x,0,current.z);this.keyLight.target.updateMatrixWorld();}this.updateDebug();
  this.lastNotify+=dt;if(this.lastNotify>.07){this.lastNotify=0;this.notify();}
 }
 private updateDebug(){
  if(this.isPhysics)return;
  if(!this.rig||!this.model)return;this.model.updateMatrixWorld(true);
  if(this.skeletonLines&&this.debug.skeleton){const a=this.skeletonLines.geometry.getAttribute('position');const seg=this.skeletonLines.userData.segments as {name:string;parent:string}[];seg.forEach((b,i)=>{const p=this.rig!.point(b.name),q=this.rig!.point(b.parent);a.setXYZ(i*2,p.x,p.y,p.z);a.setXYZ(i*2+1,q.x,q.y,q.z);});a.needsUpdate=true;}
  for(const group of [this.jointGroup,this.axesGroup,this.targetGroup])if(group.visible)group.children.forEach(o=>{o.position.copy(this.rig!.point(o.userData.bone));if(o instanceof AxesHelper)o.quaternion.copy(this.rig!.bone(o.userData.bone).getWorldQuaternion(new Quaternion()));});
  if(this.trail){this.trail.visible=this.debug.trail&&!!this.specOf(this.activeId).capabilities?.prop?.trail&&!!this.racket?.visible;if(this.trail.visible&&this.playing&&this.racket){const tip=this.racket.localToWorld(new Vector3(0,.61,0));if(!this.trailPoints.length||tip.distanceTo(this.trailPoints.at(-1)!)>.005){this.trailPoints.push(tip);if(this.trailPoints.length>200)this.trailPoints.shift();this.trail.geometry.dispose();this.trail.geometry=new BufferGeometry().setFromPoints(this.trailPoints);}}}
 }
 private makeDebug(){
  if(!this.rig)return;
  const segments=skeletonSegments(this.rig.info);
  const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(new Float32Array(segments.length*6),3));
  const lines=new LineSegments(geo,new LineBasicMaterial({color:0x367cff,depthTest:false,transparent:true,opacity:.85}));lines.renderOrder=10;lines.frustumCulled=false;lines.userData.segments=segments;this.skeletonLines=lines;this.scene.add(lines);lines.visible=false;
  const jointGeo=new SphereGeometry(.009,10,8);const jointMat=new MeshStandardMaterial({color:0x225bdb,depthTest:false});
  const names=['root','spine03','spine01','neck01','head',...['L','R'].flatMap(s=>['upperarm01_','lowerarm01_','wrist_','upperleg01_','lowerleg01_','foot_'].map(n=>n+s))];
  for(const n of names){const marker=new Mesh(jointGeo,jointMat);marker.userData.bone=n;marker.renderOrder=11;this.jointGroup.add(marker);const axis=new AxesHelper(.075);axis.userData.bone=n;axis.renderOrder=12;const mat=axis.material as LineBasicMaterial;mat.depthTest=false;this.axesGroup.add(axis);}
  for(const n of ['wrist_R','wrist_L','foot_R','foot_L']){const marker=new Mesh(new SphereGeometry(.017,12,8),new MeshStandardMaterial({color:0xec8c39,depthTest:false,transparent:true,opacity:.8,wireframe:true}));marker.userData.bone=n;marker.renderOrder=13;this.targetGroup.add(marker);this.targetMarkers.set(n,marker);}
  this.trail=new Line(new BufferGeometry(),new LineBasicMaterial({color:0x3069ed,transparent:true,opacity:.6}));this.scene.add(this.trail);this.trail.visible=false;
 }
 resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);}
 diagnostics(){
  if(this.isPhysics&&this.physics?.ready){const p=this.physics;return {knee:p.jointAngle('knee_angle_r'),elbow:p.jointAngle('elbow_flexion_r'),gripError:0,footL:p.point('talus_l').toArray(),footR:p.point('talus_r').toArray(),root:p.point('Full Body').toArray(),vertices:0,bones:p.model.bodies.length,hand:p.point('3proxph_r').toArray()};}
  return this._source?.diagnostics()??null;
 }
 private notify(){
  const spec=this.specOf(this.activeId),time=this.time;
  const phase=[...spec.phases].reverse().find(p=>p.time<=time)?.label??spec.phases[0]?.label??'';
  if(this.isPhysics){
   const replay=this.physics;
   const d=replay?.diagnostics()??{case:this.physicsCase,mass:0,power:[0,0,0],totalPower:0,support:[0,0,0,0,0,0],speed:0,muscles:[]};
   this.onFrame?.({time,duration:this.physicsLoading?spec.duration:replay?.duration??spec.duration,phase,playing:this.playing,knee:replay?.jointAngle('knee_angle_r')??0,elbow:replay?.jointAngle('elbow_flexion_r')??0,gripError:0,dynamics:{...d,loading:this.physicsLoading}});return;
  }
  const src=this._source;if(!src)return;
  const d=src.diagnostics();
  this.onFrame?.({time,duration:src.duration,phase,playing:this.playing,knee:d?.knee??0,elbow:d?.elbow??0,gripError:d?.gripError??0});
 }
 render(){this.renderer.render(this.scene,this.camera);}
 dispose(){this.disposed=true;for(const s of this.sources.values())s.dispose?.();cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();this.controls.dispose();this.mixer?.stopAllAction();this.scene.traverse(o=>{if(o instanceof Mesh||o instanceof LineSegments||o instanceof Line){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});this.renderer.dispose();this.renderer.domElement.remove();}
}
