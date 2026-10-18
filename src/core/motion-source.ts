import {LoopOnce,LoopRepeat,Quaternion,Vector3,type AnimationAction,type AnimationMixer,type Bone,type Object3D} from 'three';
import {angleAt} from './kinematics';
import {gripFrame} from './racket';
import type {HumanRig} from './rig';
import {POSE_PACKAGE_KIND,POSE_PACKAGE_SCHEMA_VERSION} from './package-const';
// Type-only: the decoder never runs the capture path, so a value import would
// just add solver/sampler weight to the lab bundle.
import type {PosePackage} from './pose-package';
import type {MotionCapabilities} from './motion-file';
import {motionFileById} from './motion-files';
import {frameAt,type WorkshopDoc} from '../workshop/document';
import {solveEffectiveFrame} from '../workshop/solver';
import type {DynamicsCase,DynamicsReplay} from './dynamics';
import type {MuscleActionFile} from './motions';
import type {DebugOptions,MotionId,MotionSpec} from './types';

/** Per-frame measurements for the inspector/QA: joint angles from FK points,
 * the racket grip offset, and anchor positions. */
export interface FrameReadout{knee:number;elbow:number;gripError:number;footL:number[];footR:number[];root:number[];hand:number[];bones:number;vertices:number}
export type SourceStatus='loading'|'ready'|'error';

/** One trajectory backend behind the engine's single playhead (`engine.time`).
 * clip / document / pose-package all write the shared skin rig; dynamics keeps
 * its own replay object, exposed through `physics` for the panel and QA. */
export interface MotionSource{
  kind:'clip'|'document'|'dynamics'|'pose-package';
  status:SourceStatus;error?:string;readonly duration:number;
  seek(t:number):void;
  /** Camera/floor anchor: the rig root for skinned sources, the physical body for dynamics. */
  rootPoint():Vector3;
  /** Each implementation resolves names in its own domain (rig bones vs MyoSim bodies). */
  point(name:string):Vector3|undefined;
  /** Whether the prop is on screen this frame — the document grip ramp counts. */
  wantsProp():boolean;
  /** Whole-model visual offset (walk accumulates one stride per loop wrap). */
  readonly modelOffset?:Vector3;
  /** Extra scene object managed by the source (dynamics replay root). */
  object3d?:Object3D;
  /** Loop-seam side effect, e.g. the walk clip accumulating its stride. */
  loopWrapAdvance?():void;
  setDebug?(o:DebugOptions):void;
  diagnostics():FrameReadout|null;
  /** Escape hatch for the dynamics panel and QA hooks. */
  physics?:DynamicsReplay;
  activate?():void;deactivate?():void;dispose?():void;
}

/** Shared skeleton measurement (the old engine.diagnostics() shape). The
 * racket grip error is only meaningful while the prop is wanted — callers pass
 * the racket in then, otherwise gripError is 0. */
function rigReadout(rig:HumanRig,racket?:{getWorldPosition(v:Vector3):Vector3}):FrameReadout{
  rig.model.updateMatrixWorld(true);
  const p=(n:string)=>rig.point(n);
  let gripError=0;
  if(racket)gripError=rig.bone('wrist_R').localToWorld(gripFrame(rig).center.clone()).distanceTo(racket.getWorldPosition(new Vector3()));
  return {knee:angleAt(p('upperleg01_R'),p('lowerleg01_R'),p('foot_R')),elbow:angleAt(p('upperarm01_R'),p('lowerarm01_R'),p('wrist_R')),gripError,footL:p('foot_L').toArray(),footR:p('foot_R').toArray(),root:p('root').toArray(),vertices:rig.info.vertices,bones:rig.bones.size,hand:p('wrist_R').toArray()};
}

/** A baked AnimationClip driven through the shared mixer. The engine owns the
 * mixer; the source only steers its action's time. `modelOffset` carries the
 * walk stride accumulation — it survives seeks so the wrap keeps translating,
 * and the engine clears it on scrub/switch (the old walkOffset semantics). */
export class ClipSource implements MotionSource{
  readonly kind='clip' as const;status:SourceStatus='ready';
  readonly modelOffset=new Vector3();
  constructor(private rig:HumanRig,private mixer:AnimationMixer,private action:AnimationAction,private stride:Vector3,private racket?:{getWorldPosition(v:Vector3):Vector3}){}
  get duration(){return this.action.getClip().duration;}
  setLoop(loop:boolean){this.action.setLoop(loop?LoopRepeat:LoopOnce,loop?Infinity:1);this.action.clampWhenFinished=true;}
  activate(){this.modelOffset.set(0,0,0);this.action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();}
  deactivate(){this.modelOffset.set(0,0,0);this.action.stop();}
  seek(t:number){
    this.action.enabled=true;this.action.setEffectiveWeight(1);this.action.paused=false;
    // `-1e-6` keeps a LoopRepeat action from wrapping the exact end to frame 0.
    this.action.time=Math.min(this.duration-1e-6,Math.max(0,t));this.mixer.update(0);
  }
  loopWrapAdvance(){this.modelOffset.add(this.stride);}
  wantsProp(){return false;}
  rootPoint(){return this.rig.point('root');}
  point(name:string){return this.rig.bones.has(name)?this.rig.point(name):undefined;}
  diagnostics(){return rigReadout(this.rig,this.racket);}
}

/** A WorkshopDoc solved live: frameAt → solveEffectiveFrame, the same path the
 * service's package builder samples. `origin` must be the rest root — the same
 * pelvis-frame origin the workshop and service use, else pelvis-frame hands shift. */
export class DocumentSource implements MotionSource{
  readonly kind='document' as const;status:SourceStatus='ready';
  private readonly origin:Vector3;private grip=0;
  constructor(private rig:HumanRig,private doc:WorkshopDoc,private racket?:{getWorldPosition(v:Vector3):Vector3}){
    this.origin=rig.rest.get('root')!.clone();
  }
  get duration(){return this.doc.duration;}
  seek(t:number){
    const f=frameAt(this.doc,Math.max(0,Math.min(this.doc.duration,t)),this.origin);
    solveEffectiveFrame(this.rig,f);this.grip=f.gripAmount;
  }
  wantsProp(){return this.grip>0;}
  rootPoint(){return this.rig.point('root');}
  point(name:string){return this.rig.bones.has(name)?this.rig.point(name):undefined;}
  diagnostics(){return rigReadout(this.rig,this.wantsProp()?this.racket:undefined);}
}

const isObj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const isVec=(v:unknown):v is number[]=>Array.isArray(v)&&v.every(Number.isFinite);

/** Structural self-check for a delivered pose package: wire constants, the
 * timestamp contract (strictly increasing, `timestamps.at(-1) === duration`),
 * count consistency and track shapes; `validBones` additionally binds rotation
 * tracks to the local rig's bone set. Human-readable problems; empty = decodable. */
export function checkPosePackageShape(pkg:unknown,validBones?:ReadonlySet<string>):string[]{
  const e:string[]=[];
  if(!isObj(pkg))return ['姿态包不是对象'];
  const p=pkg as unknown as PosePackage;
  if(p.kind!==POSE_PACKAGE_KIND)e.push(`kind 必须是 ${POSE_PACKAGE_KIND}`);
  if(p.schemaVersion!==POSE_PACKAGE_SCHEMA_VERSION)e.push(`schemaVersion 必须是 ${POSE_PACKAGE_SCHEMA_VERSION}`);
  if(!isObj(p.units)||p.units.length!=='meter'||p.units.angle!=='radian'||p.units.time!=='second')e.push('units 必须是 meter/radian/second');
  if(!isObj(p.frame)||p.frame.handedness!=='right'||p.frame.up!=='+Y'||p.frame.forward!=='+Z')e.push('frame 必须是 right/+Y/+Z');
  if(p.poseMode!=='local-trs'||p.quaternionOrder!=='xyzw')e.push('poseMode/quaternionOrder 必须是 local-trs/xyzw');
  const count=p.timeline?.count,timestamps=p.timeline?.timestamps;
  if(typeof count!=='number'||count<1||!Number.isFinite(p.timeline?.duration)||!Array.isArray(timestamps)||timestamps.length!==count)e.push('timeline 畸形：需要 count≥1、有限 duration、timestamps 长度等于 count');
  else if(timestamps.every(Number.isFinite)){
    for(let i=1;i<timestamps.length;i++)if(!(timestamps[i]>timestamps[i-1])){e.push(`timestamps 未严格递增（第 ${i} 项）`);break;}
    if(timestamps[timestamps.length-1]!==p.timeline.duration)e.push('末时间戳不等于 duration');
  }else e.push('timestamps 含非有限数');
  const T=p.tracks?.translation,c=typeof count==='number'?count:-1;
  if(!T||T.bone!=='root'||!isVec(T.values)||T.values.length!==c*3)e.push('root 位移轨缺失或长度不是 count×3');
  if(!Array.isArray(p.tracks?.rotations))e.push('tracks.rotations 缺失');
  else for(const tr of p.tracks.rotations){
    if(validBones&&!validBones.has(tr?.bone))e.push(`旋转轨引用了 rig 外的骨骼 ${tr?.bone}`);
    if(!isVec(tr?.values)||tr.values.length!==c*4)e.push(`${tr?.bone??'?'} 的旋转值长度不是 count×4`);
  }
  return [...new Set(e)];
}

const _qa=new Quaternion(),_qb=new Quaternion();
/** Reference decoder for delivered pose packages: local quaternions slerped
 * between the two bracketing samples, the root track lerped. Untracked bones
 * stay at their rest pose (identity local rotation). */
export class PosePackageSource implements MotionSource{
  readonly kind='pose-package' as const;
  status:SourceStatus='ready';error?:string;
  private ts:number[]=[0];private rootValues:number[]=[0,0,0];private _duration=0;
  private rotations:{bone:Bone;values:number[]}[]=[];
  /** @param prop Package-level prop hint (the derived spec's
   * capabilities.prop). v2 packages carry no per-frame grip channel, so the
   * prop is either constantly present or absent — `wantsProp` returns the
   * constant. The spec description records this ceiling. */
  constructor(private rig:HumanRig,pkg:unknown,private prop?:MotionCapabilities['prop'],private racket?:{getWorldPosition(v:Vector3):Vector3}){
    const problems=checkPosePackageShape(pkg,new Set(rig.bones.keys()));
    // Loud refusal: a malformed package must surface as an error state, never
    // silently decode into garbage poses.
    if(problems.length){this.status='error';this.error=`姿态包结构不合规：${problems[0]}${problems.length>1?`（共 ${problems.length} 处问题）`:''}`;return;}
    const p=pkg as PosePackage;
    this._duration=p.timeline.duration;this.ts=p.timeline.timestamps;this.rootValues=p.tracks.translation.values;
    for(const tr of p.tracks.rotations)this.rotations.push({bone:rig.bone(tr.bone),values:tr.values});
  }
  get duration(){return this._duration;}
  /** Last timestamp index at or before `t` (timeline timestamps are ascending). */
  private lowerIndex(t:number){
    let lo=0,hi=this.ts.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(this.ts[mid]<=t)lo=mid;else hi=mid-1;}
    return lo;
  }
  seek(t:number){
    if(this.status!=='ready')return;
    const time=Math.max(0,Math.min(this._duration,t)),i=this.lowerIndex(time),j=Math.min(i+1,this.ts.length-1);
    const dt=this.ts[j]-this.ts[i],u=dt>1e-9?(time-this.ts[i])/dt:0;
    this.rig.reset();
    const v=this.rootValues;
    this.rig.bone('root').position.set(v[i*3]+(v[j*3]-v[i*3])*u,v[i*3+1]+(v[j*3+1]-v[i*3+1])*u,v[i*3+2]+(v[j*3+2]-v[i*3+2])*u);
    for(const tr of this.rotations){
      _qa.fromArray(tr.values,i*4);_qb.fromArray(tr.values,j*4);
      // The builder normalized quaternion hemisphere, so this slerp is the short arc.
      tr.bone.quaternion.copy(_qa).slerp(_qb,u);
    }
    this.rig.model.updateMatrixWorld(true);
  }
  wantsProp(){return this.status==='ready'&&!!this.prop;}
  rootPoint(){return this.rig.point('root');}
  point(name:string){return this.rig.bones.has(name)?this.rig.point(name):undefined;}
  diagnostics(){return rigReadout(this.rig,this.wantsProp()?this.racket:undefined);}
}

/** Derive the lab's MotionSpec for a delivered pose package — the inverse of
 * what solveWorkshop + workshopMeta stamped at solve time. Field priority:
 * the bundled envelope (`action.id` matching motionFileById) > the ad-hoc
 * `action.parameters` channel (`documentName` + `presentation.{prop,loop}`,
 * written by both builders — see core/protocol.ts) > the bare action id.
 * `phases` always come from the package's own events: 'phase' events first,
 * else 'keyframe' events as timeline markers, so markers reflect delivered
 * data rather than whatever the action id claims. The description is the
 * honesty surface: solver provenance, the quality warnings the package
 * carries, and the constant-prop caveat (a v2 package cannot express the
 * document's per-frame grip ramp, so the prop is constantly shown). */
export function posePackageSpec(p:PosePackage,id:MotionId):MotionSpec{
 const actionId=typeof p.action?.id==='string'&&p.action.id?p.action.id:'pose-package';
 const envelope=motionFileById(actionId);
 const params=isObj(p.action?.parameters)?p.action.parameters:{};
 const pres=isObj(params.presentation)?params.presentation:{};
 // 'racket' is the only prop kind the lab can mount — the ad-hoc hint maps to
 // the same capability record the bundled racket envelopes declare. When an
 // envelope exists it is authoritative: its absence of a prop is also truth,
 // so a forged presentation channel cannot add a prop to a bundled id.
 const prop=envelope?envelope.capabilities?.prop
  :(pres.prop==='racket'?{kind:'racket' as const,trail:true,handView:true}:undefined);
 const capabilities:MotionCapabilities|undefined=envelope?envelope.capabilities:(prop?{prop}:undefined);
 // Loop semantics are authored in the document, not the package: bundled
 // envelopes carry the document, ad-hoc packages carry presentation.loop.
 const authoredLoop=envelope?envelope.document?.loop:(typeof pres.loop==='boolean'?pres.loop:undefined);
 const events=Array.isArray(p.events)?p.events:[];
 const phases=events.filter(e=>e.type==='phase').map(({time,label})=>({time,label}));
 const keys=events.filter(e=>e.type==='keyframe').map(({time,label})=>({time,label}));
 const warnings=(Array.isArray(p.quality?.warnings)?p.quality.warnings:[]).filter((w):w is string=>typeof w==='string');
 const solver=typeof p.provenance?.solver==='string'?p.provenance.solver:'';
 const solverRev=typeof p.provenance?.solverRevision==='string'&&p.provenance.solverRevision?`@${p.provenance.solverRevision}`:'';
 const source=typeof p.provenance?.source==='string'&&p.provenance.source?`来源 ${p.provenance.source}`:'';
 const description=[
  '外部姿态包（pose-json）回放',
  solver?`求解器 ${solver}${solverRev}`:'',
  source,
  warnings.length?`质量警告 ${warnings.length} 条：${warnings.slice(0,3).join('；')}${warnings.length>3?' …':''}`:'质量警告 0 条',
  prop?'v2 姿态包不携带逐帧握拍量，道具按包级 hint 全程常量显示':'',
 ].filter(Boolean).join(' · ');
 const documentName=typeof params.documentName==='string'&&params.documentName?params.documentName:undefined;
 return {id,name:envelope?.name||documentName||actionId,
  english:envelope?.english||'POSE PACKAGE',duration:p.timeline.duration,
  description,method:envelope?.method??'服务交付轨迹 · FK 采样重放',
  focus:envelope?.focus??['姿态包回放'],phases:phases.length?phases:keys,
  capabilities,oneShot:authoredLoop===undefined?undefined:!authoredLoop,
  source:{kind:'pose-package',package:p}};
}

/** Shared replay holder: one MyoSim replay per engine, reloaded per motion —
 * the same single-replay semantics the old engine.physics/physicsPromise had. */
export interface DynamicsSession{rig:HumanRig;parent:Object3D;replay?:DynamicsReplay;promise?:Promise<DynamicsReplay>;retired?:boolean}
export const createDynamicsSession=(rig:HumanRig,parent:Object3D):DynamicsSession=>({rig,parent});

/** Dynamics replay source. `static create` keeps the dynamics module behind a
 * lazy import; `load` drives status loading→ready/error with the promise
 * singleton and the replay's own out-of-order guard preserved. */
export class DynamicsSource implements MotionSource{
  readonly kind='dynamics' as const;
  status:SourceStatus='loading';error?:string;
  /** The last requested case; mirrors the old physicsCase (set at load start so
   * the panel reports the attempted profile even when the load fails). */
  profile:DynamicsCase='baseline';
  private motionId='';private debug?:DebugOptions;
  private constructor(private session:DynamicsSession){}
  static create(session:DynamicsSession){return new DynamicsSource(session);}
  get physics(){return this.session.replay;}
  get object3d(){return this.session.replay?.root;}
  get duration(){return this.session.replay?.duration??0;}
  /** Load the record for `id`. 'applied' → the engine finishes activation;
   * 'superseded' → a newer load or a source switch owns the replay now;
   * 'error' → status/error already carry the message. */
  async load(id:string,profile:DynamicsCase,muscleAction?:MuscleActionFile):Promise<'applied'|'superseded'|'error'>{
    this.motionId=id;this.profile=profile;this.status='loading';this.error=undefined;
    const s=this.session;
    try{
      s.promise??=import('./dynamics').then(m=>m.DynamicsReplay.create(s.rig));
      const replay=await s.promise;
      if(s.retired){if(s.replay!==replay)replay.dispose();return 'superseded';}
      if(!s.replay){s.replay=replay;s.parent.add(replay.root);}
      const accepted=await replay.load(id,profile,muscleAction);
      if(!accepted||this.motionId!==id)return 'superseded';
      this.status='ready';replay.root.visible=true;if(this.debug)replay.setOptions(this.debug);
      return 'applied';
    }catch(err){
      s.promise=undefined;
      if(this.motionId!==id)return 'superseded';
      this.status='error';this.error=err instanceof Error?err.message:String(err);
      return 'error';
    }
  }
  seek(t:number){const r=this.session.replay;if(this.status!=='ready'||!r)return;r.seek(Math.max(0,Math.min(r.duration,t)));}
  rootPoint(){return this.point('Full Body')??this.session.rig.point('root');}
  point(name:string){const r=this.session.replay;return r?.ready?r.point(name):undefined;}
  wantsProp(){return false;}
  setDebug(o:DebugOptions){this.debug=o;this.session.replay?.setOptions(o);}
  diagnostics(){return null;}
  deactivate(){if(this.session.replay)this.session.replay.root.visible=false;}
  dispose(){const s=this.session;s.retired=true;if(s.replay){const r=s.replay;s.replay=undefined;r.dispose();}}
}

/** Cross-source pose blend (~.32 s): snapshots the whole skeleton at switch
 * time, then each tick blends every bone from the snapshot toward what the new
 * source wrote this frame. Replaces the mixer crossFade, which only worked
 * clip→clip. Skin-to-skin only (clip/document/pose-package); dynamics switches
 * stay hard cuts, as before. */
export class PoseFade{
  private static readonly DURATION=.32;
  private snapshot?:Map<Bone,Quaternion>;private rootAt?:Vector3;private elapsed=Infinity;
  get active(){return this.elapsed<PoseFade.DURATION;}
  start(rig:HumanRig){
    this.snapshot=new Map([...rig.bones.values()].map(b=>[b,b.quaternion.clone()]));
    this.rootAt=rig.bone('root').position.clone();this.elapsed=0;
  }
  clear(){this.snapshot=undefined;this.elapsed=Infinity;}
  /** Advance the blend by `dt` wall seconds (0 keeps the blend frozen). */
  apply(rig:HumanRig,dt:number){
    if(!this.snapshot)return;
    this.elapsed+=dt;
    const u=Math.min(1,this.elapsed/PoseFade.DURATION),cur=new Quaternion();
    for(const [b,q]of this.snapshot){cur.copy(b.quaternion);b.quaternion.copy(q).slerp(cur,u);}
    if(this.rootAt){const root=rig.bone('root');root.position.lerpVectors(this.rootAt,root.position,u);}
    rig.model.updateMatrixWorld(true);
    if(this.elapsed>=PoseFade.DURATION)this.clear();
  }
}
