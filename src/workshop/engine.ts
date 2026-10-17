import {AmbientLight,BufferGeometry,Color,DirectionalLight,DoubleSide,Group,HemisphereLight,Line,LineBasicMaterial,LineDashedMaterial,LineLoop,Mesh,MeshBasicMaterial,MeshStandardMaterial,PerspectiveCamera,Plane,PlaneGeometry,Raycaster,RingGeometry,Scene,SkinnedMesh,SphereGeometry,Vector2,Vector3,WebGLRenderer,PCFSoftShadowMap,SRGBColorSpace,ACESFilmicToneMapping,Clock,GridHelper} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {HumanRig} from '../core/rig';
import {attachRacket} from '../core/racket';
import type {RigInfo,ViewId} from '../core/types';
import type {EffectiveFrame,KeyConstraints,PoseParams,WorkshopDoc,WorkshopKey} from './document';
import {constraintsAt,frameAt,sortedKeys,toV} from './document';
import {analyzePose,solvePose,type Analysis} from './solver';

export interface WorkshopFrame{time:number;duration:number;playing:boolean;label:string;analysis?:Analysis}
export interface WorkshopOptions{handles:boolean;trajectories:boolean;balance:boolean}
type DragKind='root'|'hand'|'foot'|'swing'|'poleArm'|'poleLeg'|'tip'|'contact';
/** `passive` handles render but never start a drag — used for the actual foot
 * during a release interval, where the editable control is the swing point. */
interface Handle{kind:DragKind;side?:'L'|'R';mesh:Mesh;keyId?:string;passive?:boolean}

/** Pose-editor scene: same rig and view language as the lab viewer, but every
 * effector is a draggable task-space handle resolved by the kinematic solver. */
export class WorkshopEngine{
  scene=new Scene();camera=new PerspectiveCamera(35,1,.01,120);renderer:WebGLRenderer;controls:OrbitControls;
  model?:Group;rig?:HumanRig;racket?:Group;ready=false;disposed=false;
  playing=true;speed=1;time=0;view:ViewId='threeQuarter';
  options:WorkshopOptions={handles:true,trajectories:true,balance:true};
  private clock=new Clock();private raf=0;private lastNotify=0;private resizeObserver:ResizeObserver;
  private keyLight?:DirectionalLight;
  private handleGroup=new Group();private handles:Handle[]=[];private contactMarkers:Mesh[]=[];
  private trajectories=new Map<string,Line>();private comMarker?:Mesh;private comLine?:Line;private supportLoop?:LineLoop;
  private raycaster=new Raycaster();private pointer=new Vector2();
  private drag?:{h:Handle;plane:Plane;offset:Vector3;key:WorkshopKey};private docDirty=true;
  private latestFrame?:EffectiveFrame;
  onFrame?:(f:WorkshopFrame)=>void;onReady?:(info:RigInfo)=>void;onError?:(e:Error)=>void;
  /** App hooks: begin edit = pick or auto-insert the key being dragged. */
  onBeginEdit?:(time:number,prefer?:string)=>WorkshopKey|null;
  onDocChanged?:()=>void;onSelectKey?:(id:string)=>void;onSeek?:(time:number)=>void;
  /** Fired once when a drag ends — the app persists the doc here so the final
   * pose can't be lost between pointermove re-renders. */
  onEditEnd?:()=>void;
  constructor(public host:HTMLElement,private getDoc:()=>WorkshopDoc){
    this.renderer=new WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));this.renderer.outputColorSpace=SRGBColorSpace;this.renderer.toneMapping=ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label','动作工作台三维编辑视图');this.host.appendChild(this.renderer.domElement);
    this.scene.background=new Color('#f5f7fa');this.scene.add(new HemisphereLight(0xffffff,0x8592a6,2.5),new AmbientLight(0xffffff,.35));
    const key=new DirectionalLight(0xfff6ec,4.2);key.position.set(-3,5,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=3;key.shadow.camera.bottom=-3;key.shadow.normalBias=.012;key.shadow.bias=-.0001;this.scene.add(key,key.target);this.keyLight=key;
    const fill=new DirectionalLight(0xc3d9ff,2);fill.position.set(3,2,-3);this.scene.add(fill);
    const floor=new Mesh(new PlaneGeometry(200,200),new MeshStandardMaterial({color:0xf4f6f9,roughness:1,metalness:0}));floor.rotation.x=-Math.PI/2;floor.position.y=-.009;floor.receiveShadow=true;this.scene.add(floor);
    const grid=new GridHelper(200,800,0xc3cbd5,0xd8dfe8);grid.position.y=-.007;(grid.material as LineBasicMaterial).transparent=true;(grid.material as LineBasicMaterial).opacity=.45;this.scene.add(grid);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.target.set(0,.9,0);this.controls.minDistance=.3;this.controls.maxDistance=8;this.controls.maxPolarAngle=Math.PI*.52;this.camera.position.set(0,1.15,3.4);
    this.controls.addEventListener('start',()=>{this.view='free';});
    this.scene.add(this.handleGroup);
    const dom=this.renderer.domElement;
    dom.addEventListener('pointerdown',this.onPointerDown);dom.addEventListener('pointermove',this.onPointerMove);dom.addEventListener('pointerup',this.onPointerUp);dom.addEventListener('pointercancel',this.onPointerUp);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
    this.animate();
  }
  async load(){
    try{
      const [gltf,info]=await Promise.all([new GLTFLoader().loadAsync('/models/human.glb'),fetch('/models/rig.json').then(r=>{if(!r.ok)throw new Error('人体骨架加载失败');return r.json() as Promise<RigInfo>})]);
      if(this.disposed){gltf.scene.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose()});return;}
      this.model=gltf.scene;this.scene.add(this.model);this.rig=new HumanRig(this.model,info);
      this.model.traverse(o=>{if(o instanceof SkinnedMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;o.material=new MeshStandardMaterial({color:0x7997b2,roughness:.53,metalness:.08});}});
      this.racket=attachRacket(this.rig);this.racket.visible=false;
      this.makeHandles();this.makeMarkers();
      this.ready=true;this.solveCurrent();this.setView('threeQuarter');this.onReady?.(info);
    }catch(err){this.onError?.(err instanceof Error?err:new Error(String(err)));}
  }
  /* ---------- handles ---------- */
  private makeHandles(){
    const mk=(kind:DragKind,side:'L'|'R'|undefined,color:number,r:number)=>{
      const m=new Mesh(new SphereGeometry(r,16,12),new MeshStandardMaterial({color,depthTest:false,transparent:true,opacity:.92}));
      m.renderOrder=20;m.userData.handle=true;this.handleGroup.add(m);const h:Handle={kind,side,mesh:m};this.handles.push(h);m.userData.ref=h;return h;
    };
    mk('root',undefined,0x2469ee,.034);
    mk('hand','L',0xec8c39,.026);mk('hand','R',0xec8c39,.026);
    mk('foot','L',0xe2543a,.026);mk('foot','R',0xe2543a,.026);
    mk('swing','L',0x0891b2,.02);mk('swing','R',0x0891b2,.02);
    mk('poleArm','L',0x4a9e6b,.018);mk('poleArm','R',0x4a9e6b,.018);
    mk('poleLeg','L',0x4a9e6b,.018);mk('poleLeg','R',0x4a9e6b,.018);
    mk('tip',undefined,0xd23c3c,.024);
  }
  private makeMarkers(){
    this.comMarker=new Mesh(new SphereGeometry(.018,14,10),new MeshStandardMaterial({color:0x8a2be2,depthTest:false,transparent:true,opacity:.9}));this.comMarker.renderOrder=18;
    this.comLine=new Line(new BufferGeometry(),new LineDashedMaterial({color:0x8a2be2,dashSize:.03,gapSize:.02,depthTest:false}));this.comLine.renderOrder=17;this.comLine.frustumCulled=false;
    this.supportLoop=new LineLoop(new BufferGeometry(),new LineBasicMaterial({color:0x8a2be2,depthTest:false}));this.supportLoop.renderOrder=17;this.supportLoop.frustumCulled=false;
    this.scene.add(this.comMarker,this.comLine,this.supportLoop);
    for(const [id,color]of [['tip',0xd23c3c],['wrist_R',0xec8c39],['wrist_L',0xec8c39]]as const){
      const line=new Line(new BufferGeometry(),new LineBasicMaterial({color,transparent:true,opacity:.55}));line.frustumCulled=false;this.scene.add(line);this.trajectories.set(id,line);
    }
  }
  /* ---------- pointer / drag ---------- */
  private pick(ev:PointerEvent){
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX-rect.left)/rect.width)*2-1,-((ev.clientY-rect.top)/rect.height)*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const hits=this.raycaster.intersectObjects([...this.handleGroup.children,...this.contactMarkers].filter(o=>o.visible),false);
    const o=hits.find(x=>!x.object.userData.ref?.passive)?.object;return o?o.userData.ref as Handle|undefined:undefined;
  }
  private onPointerDown=(ev:PointerEvent)=>{
    if(ev.button!==0||!this.ready)return;
    const h=this.pick(ev);if(!h)return;
    const time=h.keyId?this.getDoc().keys.find(k=>k.id===h.keyId)?.time??this.time:this.time;
    const key=this.onBeginEdit?.(time,h.keyId);if(!key)return;
    if(h.keyId){this.time=key.time;this.onSeek?.(key.time);this.onSelectKey?.(key.id);}else this.onSelectKey?.(key.id);
    this.solveCurrent();
    const origin=h.mesh.getWorldPosition(new Vector3());
    const normal=new Vector3();this.camera.getWorldDirection(normal);
    // A planted foot is a contact — dragging stays on the ground plane. An
    // unplanted foot is a swing waypoint: drag in the camera-facing plane so
    // the stored target can carry real height.
    const planted=h.kind==='foot'&&key.constraints[h.side==='L'?'plantL':'plantR'];
    const plane=planted
      ?new Plane(new Vector3(0,1,0),-origin.y)
      :new Plane().setFromNormalAndCoplanarPoint(normal,origin);
    const hit=this.raycaster.ray.intersectPlane(plane,new Vector3())??origin;
    this.drag={h,plane,offset:origin.clone().sub(hit),key};
    this.setPlaying(false); // editing a pose while playback moves time is incoherent
    this.controls.enabled=false;try{this.renderer.domElement.setPointerCapture(ev.pointerId);}catch{/* synthetic events have no pointer */}
  };
  private onPointerMove=(ev:PointerEvent)=>{
    if(!this.drag||!this.rig)return;
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX-rect.left)/rect.width)*2-1,-((ev.clientY-rect.top)/rect.height)*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const hit=this.raycaster.ray.intersectPlane(this.drag.plane,new Vector3());if(!hit)return;
    const pos=hit.add(this.drag.offset),k=this.drag.key.pose;
    switch(this.drag.h.kind){
      case 'root':{const rest=this.rig.rest.get('root')!;k.root={x:pos.x-rest.x,y:pos.y-rest.y,z:pos.z-rest.z};break;}
      case 'hand':{(this.drag.h.side==='L'?k.handL:k.handR).target={x:pos.x,y:pos.y,z:pos.z};break;}
      case 'foot':{const f=this.drag.h.side==='L'?k.footL:k.footR;
        const lock=this.drag.key.constraints[this.drag.h.side==='L'?'plantL':'plantR'];
        f.target={x:pos.x,y:lock?f.target.y:Math.max(0,pos.y),z:pos.z};break;}
      case 'swing':{const f=this.drag.h.side==='L'?k.footL:k.footR;f.target={x:pos.x,y:Math.max(0,pos.y),z:pos.z};break;}
      case 'poleArm':{(this.drag.h.side==='L'?k.handL:k.handR).pole={x:pos.x,y:pos.y,z:pos.z};break;}
      case 'poleLeg':{(this.drag.h.side==='L'?k.footL:k.footR).pole={x:pos.x,y:pos.y,z:pos.z};break;}
      case 'tip':case 'contact':{
        if(!this.racket)break;this.solveCurrent();
        const tip=this.racket.localToWorld(new Vector3(0,.61,0));
        const d=pos.clone().sub(tip);const t=k.handR.target;k.handR.target={x:t.x+d.x,y:t.y+d.y,z:t.z+d.z};break;}
    }
    this.solveCurrent();this.docDirty=true;this.onDocChanged?.();
  };
  private onPointerUp=(ev:PointerEvent)=>{
    if(this.drag){this.drag=undefined;this.controls.enabled=true;try{this.renderer.domElement.releasePointerCapture(ev.pointerId);}catch{/* released */}this.onEditEnd?.();}
  };
  /* ---------- pose evaluation ---------- */
  private currentFrame(){
    const doc=this.getDoc();
    const f=frameAt(doc,Math.max(0,Math.min(doc.duration,this.time)));
    return f;
  }
  solveCurrent(){
    if(!this.rig)return;
    const f=this.currentFrame();
    solvePose(this.rig,f.pose,f.constraints);
    this.latestFrame=f;
    if(this.racket)this.racket.visible=f.constraints.grip;
    this.updateHandles(f.pose,f.constraints);
  }
  private updateHandles(p:PoseParams,c:KeyConstraints){
    if(!this.rig)return;
    const put=(kind:DragKind,side:'L'|'R'|undefined,where:Vector3,visible=true)=>{
      const h=this.handles.find(x=>x.kind===kind&&x.side===side);if(!h)return;h.mesh.visible=visible&&this.options.handles;h.mesh.position.copy(where);
    };
    put('root',undefined,this.rig.point('root'));
    put('hand','L',this.rig.point('wrist_L'));put('hand','R',this.rig.point('wrist_R'));
    put('foot','L',this.rig.point('foot_L'));put('foot','R',this.rig.point('foot_R'));
    put('poleArm','L',toV(p.handL.pole));put('poleArm','R',toV(p.handR.pole));
    put('poleLeg','L',toV(p.footL.pole));put('poleLeg','R',toV(p.footR.pole));
    put('tip',undefined,this.racket?this.racket.localToWorld(new Vector3(0,.61,0)):new Vector3(),c.grip);
    // Swing waypoint split: during a release interval the visible foot sits ON
    // the path contact→waypoint→landing, so the bone handle becomes display
    // only and the editable control is a separate handle bound to the release
    // key's stored target — the mid-swing waypoint the foot passes through.
    // Without it a drag would write the stored target while the handle stayed
    // glued to the inherited contact (no visual feedback).
    const keys=sortedKeys(this.getDoc()),i=constraintsAt(keys,this.time).keyIndex;
    for(const [flag,foot,side]of [['plantL','footL','L'],['plantR','footR','R']]as const){
      const release=i>0&&i<keys.length-1&&!keys[i].constraints[flag]&&keys[i-1].constraints[flag];
      const bone=this.handles.find(x=>x.kind==='foot'&&x.side===side),sw=this.handles.find(x=>x.kind==='swing'&&x.side===side);
      if(bone)bone.passive=release;
      if(sw){sw.mesh.visible=release&&this.options.handles;if(release){sw.keyId=keys[i].id;sw.mesh.position.copy(toV(keys[i].pose[foot].target));}}
    }
  }
  private rebuildAux(){
    if(!this.rig)return;
    const doc=this.getDoc(),keys=sortedKeys(doc);
    const save=frameAt(doc,this.time);
    // Trajectory lines at 60 samples.
    const samples=60,paths:Record<string,Vector3[]>={tip:[],wrist_R:[],wrist_L:[]};
    for(let i=0;i<=samples;i++){
      const f=frameAt(doc,i/samples*doc.duration);
      solvePose(this.rig,f.pose,f.constraints);
      paths.wrist_R.push(this.rig.point('wrist_R'));paths.wrist_L.push(this.rig.point('wrist_L'));
      // No grip → no racket: skipping the sample keeps non-grip stretches out
      // of the tip line instead of writing the world origin into the path.
      if(f.constraints.grip&&this.racket)paths.tip.push(this.racket.localToWorld(new Vector3(0,.61,0)));
    }
    for(const [id,line]of this.trajectories){
      const pts=paths[id]??[];
      line.geometry.dispose();line.geometry=new BufferGeometry().setFromPoints(pts);
      line.visible=this.options.trajectories&&(id!=='tip'||keys.some(k=>k.constraints.grip));
    }
    // Contact markers: racket-head position at each contact key.
    for(const m of this.contactMarkers){this.scene.remove(m);m.geometry.dispose();}
    this.contactMarkers=[];
    for(const k of keys.filter(k2=>k2.constraints.contact)){
      const f=frameAt(doc,k.time);solvePose(this.rig,f.pose,f.constraints);
      const at=this.racket?this.racket.localToWorld(new Vector3(0,.61,0)):new Vector3();
      const ball=new Mesh(new SphereGeometry(.022,16,12),new MeshStandardMaterial({color:0xf0b429,depthTest:false,transparent:true,opacity:.95}));
      ball.position.copy(at);ball.renderOrder=21;
      const ring=new Mesh(new RingGeometry(.035,.042,28),new MeshBasicMaterial({color:0xf0b429,side:DoubleSide,depthTest:false,transparent:true,opacity:.8}));
      ring.rotation.x=-Math.PI/2;ring.renderOrder=21;ball.add(ring);
      const h:Handle={kind:'contact',mesh:ball,keyId:k.id};ball.userData.ref=h;ball.userData.handle=true;
      this.contactMarkers.push(ball);this.scene.add(ball);
    }
    solvePose(this.rig,save.pose,save.constraints);this.latestFrame=save;
    if(this.racket)this.racket.visible=save.constraints.grip;
    this.updateHandles(save.pose,save.constraints);
    this.docDirty=false;
  }
  private updateBalance(a:Analysis){
    if(!this.comMarker||!this.comLine||!this.supportLoop)return;
    const on=this.options.balance;
    this.comMarker.visible=on;this.comLine.visible=on;
    this.comMarker.position.copy(a.com);
    this.comLine.geometry.dispose();this.comLine.geometry=new BufferGeometry().setFromPoints([a.com,new Vector3(a.com.x,0,a.com.z)]);
    (this.comMarker.material as MeshStandardMaterial).color.set(a.comStable?0x8a2be2:0xd23c3c);
    this.supportLoop.visible=on&&a.support.length>=3;
    if(a.support.length>=3){this.supportLoop.geometry.dispose();this.supportLoop.geometry=new BufferGeometry().setFromPoints(a.support.map(p=>new Vector3(p.x,.002,p.z)));}
  }
  /* ---------- transport / camera ---------- */
  seek(t:number){const d=this.getDoc().duration;this.time=Math.max(0,Math.min(d,t));this.solveCurrent();this.notify(true);}
  setPlaying(v:boolean){this.playing=v;this.notify(true);}
  setSpeed(v:number){this.speed=v;}
  setOptions(patch:Partial<WorkshopOptions>){Object.assign(this.options,patch);this.docDirty=true;}
  markDirty(){this.docDirty=true;}
  setView(view:ViewId){
    this.view=view;const root=this.rig?.point('root')??new Vector3(0,.94,0),target=root.clone();target.y*=.92;
    if(view==='free'){const shift=target.clone().sub(this.controls.target);this.camera.position.add(shift);this.controls.target.copy(target);this.controls.update();return;}
    const distance=Math.max(3.4,2.0/Math.max(.4,this.camera.aspect));
    const a={front:0,side:Math.PI/2,back:Math.PI,threeQuarter:-Math.PI/4,hand:0,free:0}[view];
    this.camera.position.copy(target).add(new Vector3(Math.sin(a)*distance,.18,Math.cos(a)*distance));
    this.controls.target.copy(target);this.camera.lookAt(target);this.controls.update();
  }
  resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);}
  private animate=()=>{
    if(this.disposed)return;this.raf=requestAnimationFrame(this.animate);
    const dt=Math.min(this.clock.getDelta(),.1);
    if(this.ready&&this.rig){
      const doc=this.getDoc();
      if(this.playing&&!this.drag){this.time+=dt*this.speed;if(this.time>doc.duration)this.time%=doc.duration||1;}
      if(this.docDirty&&!this.drag)this.rebuildAux();
      this.solveCurrent();
      const a=this.rig?analyzePose(this.rig,this.latestFrame!.pose,this.latestFrame!.constraints,this.racket):undefined;
      if(a)this.updateBalance(a);
      this.lastNotify+=dt;if(this.lastNotify>.07){this.lastNotify=0;this.notify(false,a);}
    }
    this.controls.update();this.renderer.render(this.scene,this.camera);
  };
  private notify(force:boolean,a?:Analysis){
    const doc=this.getDoc(),keys=sortedKeys(doc);
    const label=[...keys].reverse().find(k=>k.time<=this.time)?.label??keys[0]?.label??'';
    if(force||a)this.onFrame?.({time:this.time,duration:doc.duration,playing:this.playing,label,analysis:a});
  }
  dispose(){
    this.disposed=true;cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();
    const dom=this.renderer.domElement;
    dom.removeEventListener('pointerdown',this.onPointerDown);dom.removeEventListener('pointermove',this.onPointerMove);dom.removeEventListener('pointerup',this.onPointerUp);dom.removeEventListener('pointercancel',this.onPointerUp);
    // Everything in this scene was created by the workshop (handles, markers,
    // lines, racket, model materials) — release GPU resources before the
    // renderer context dies instead of relying on GC.
    this.scene.traverse(o=>{
      const g=(o as Mesh).geometry as BufferGeometry|undefined;g?.dispose();
      const m=(o as Mesh).material as {dispose():void}|{dispose():void}[]|undefined;
      if(Array.isArray(m))for(const x of m)x.dispose();else m?.dispose?.();
    });
    this.controls.dispose();this.renderer.dispose();this.host.removeChild(dom);
  }
}
