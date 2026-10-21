import fs from 'node:fs';
import path from 'node:path';
import {Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {
 HumanRig,ankleYForLift,canonicalizeHands,footGeometry,frameAt,mirrorDoc,normalizeDoc,solveEffectiveFrame,type RigInfo,type WorkshopDoc,type WorkshopKey,
} from '@human3d/motion-core';
import {
 armLengths,blendArm,handAxis,interpolateTorsoArm,offCatch,offReach,offTransition,placeOffArm,placeRacketArm,
 readReference,setHand,torsoFrame,
 EXTEND_RACKET,FINISH_RACKET,FOLD_RACKET,OFF_SWING,READY_RACKET,SETTLE_RACKET,
 type ArmPose,TorsoArm,
} from './lib/forehand-arms.mts';
import {depthTargets,phaseMedians} from './lib/forehand-depth.mts';

/* Player forehand presets.
 *
 * ARMS. The reference is the user's hand-authored workshop document
 * (scripts/forehand-arm-reference.json). Its 引拍1 / 引拍2 / 击球 racket and off
 * arms are authored; everything else in that document was an untouched copy of
 * the old generated preset. `readReference` solves the document on the
 * production rig and reads each authored key back as TORSO-FRAME coefficients
 * (wrist direction + reach fraction + elbow hinge + racket axis), so every
 * player gets the authored shapes on their own trunk turn. Nothing is a
 * per-axis scaling of world-space targets — that shear is what twisted the
 * previous generation and aimed the racket at the player's own head.
 *
 * KEY STRUCTURE (8 keys). The three authored poses are the swing's C:
 *   准备  designed ready pose (racket in front of the hip)
 *   引拍  AUTHORED 引拍1 — racket up beside the shoulder, elbow bent ~35°
 *   落拍  AUTHORED 引拍2 — head dropped back and down, bottom of the C
 *   击球  AUTHORED 击球  — racket horizontal across the ball        [contact]
 *   延伸  designed: after the ball, arm opening out, head climbing
 *   折肘  designed: elbow folding in front of the chest
 *   随挥  designed: forearm folded to the off shoulder, racket near vertical
 *   恢复  designed: the held finish, settled
 * Designed keys are placed from their own torso coefficients; the one key that
 * interpolates between two anchors (延伸) uses chain-space interpolation (chord
 * direction + hinge + chord length), never a world-space lerp of wrist targets.
 *
 * TRUNK / FEET / TIMING stay parametric per player: the workshop forehand seed
 * supplies the skeleton, and the player's measured hip/shoulder rotation,
 * stance, dip and split step are applied to it. No 2D video landmark is mapped
 * onto the rig (docs/reports/forehand-video-retargeting.md).
 *
 * A left-handed player is built in right-handed geometry and mirrored at the
 * end, so the left document is the exact x-mirror (the torso coefficients are
 * defined off the solved shoulders and therefore mirror by construction). */

type PlayerPreset={
 id:string;name:string;order:number;side?:'L';video:string;frames:[number,number,number,number,number];
 duration:number;back:number;contact:number;follow:number;
 hipTurn:number;shoulderTurn:number;reach:number;dip:number;forward:number;
 stance:number;stagger:number;balance:number;step?:number;
 focus:[string,string,string];
};
const players:PlayerPreset[]=[
 {id:'novak-djokovic-forehand',name:'Novak Djokovic',order:8,video:'德约正手.mp4',frames:[0,3,6,7,8],duration:2.05,back:.77,contact:1.16,follow:1.52,hipTurn:1.02,shoulderTurn:1.08,reach:.96,dip:.02,forward:.025,stance:1.14,stagger:.035,balance:.012,step:.1,focus:['开放式站位','紧凑引拍','平衡回位']},
 {id:'roger-federer-forehand',name:'Roger Federer',order:9,video:'费德勒正手.mp4',frames:[130,131,132,133,135],duration:2.04,back:.73,contact:1.13,follow:1.5,hipTurn:.98,shoulderTurn:1.02,reach:1.13,dip:.01,forward:.012,stance:1.02,stagger:.035,balance:.016,step:.11,focus:['舒展引拍','向前延伸击球','肩上结束']},
 {id:'carlos-alcaraz-forehand',name:'Carlos Alcaraz',order:10,video:'多人正手.mp4',frames:[90,92,93,94,95],duration:1.92,back:.7,contact:1.08,follow:1.47,hipTurn:1.12,shoulderTurn:1.13,reach:1.04,dip:.04,forward:.04,stance:1.12,stagger:-.015,balance:.02,step:.12,focus:['低位准备','快速躯干转动','高位随挥']},
 {id:'alexander-zverev-forehand',name:'Alexander Zverev',order:11,video:'多人正手.mp4',frames:[132,135,138,141,144],duration:2.06,back:.82,contact:1.19,follow:1.56,hipTurn:.98,shoulderTurn:1.03,reach:1.12,dip:.015,forward:.02,stance:1.06,stagger:.02,balance:.012,focus:['高位准备','舒展击球点','稳定回位']},
 {id:'daniil-medvedev-forehand',name:'Daniil Medvedev',order:12,video:'多人正手.mp4',frames:[162,165,168,171,174],duration:2.1,back:.85,contact:1.2,follow:1.58,hipTurn:.94,shoulderTurn:.95,reach:.94,dip:.012,forward:.015,stance:1.1,stagger:-.01,balance:.01,focus:['紧凑引拍','平直向前击球','快速重置']},
 {id:'ben-shelton-forehand',name:'Ben Shelton',order:13,side:'L',video:'多人正手.mp4',frames:[186,189,192,195,198],duration:2,back:.78,contact:1.12,follow:1.52,hipTurn:1.1,shoulderTurn:1.08,reach:1.12,dip:.03,forward:.04,stance:1.1,stagger:.02,balance:.018,focus:['左手引拍','充分躯干转动','高位随挥']},
 {id:'alexander-bublik-forehand',name:'Alexander Bublik',order:14,video:'多人正手.mp4',frames:[216,219,222,225,228],duration:2.12,back:.86,contact:1.24,follow:1.62,hipTurn:.91,shoulderTurn:.93,reach:1.05,dip:.006,forward:.006,stance:1.01,stagger:.025,balance:.01,focus:['放松准备','宽幅引拍','流动随挥']},
 {id:'frances-tiafoe-forehand',name:'Frances Tiafoe',order:15,video:'多人正手.mp4',frames:[240,243,246,249,252],duration:1.98,back:.75,contact:1.11,follow:1.5,hipTurn:1.08,shoulderTurn:1.12,reach:1.03,dip:.04,forward:.03,stance:1.15,stagger:.03,balance:.02,focus:['宽站位','前侧手平衡','躯干带动挥拍']},
 {id:'holger-rune-forehand',name:'Holger Rune',order:16,video:'多人正手.mp4',frames:[267,270,273,276,279],duration:1.96,back:.72,contact:1.09,follow:1.48,hipTurn:1.08,shoulderTurn:1.06,reach:1.03,dip:.032,forward:.03,stance:1.07,stagger:.015,balance:.015,focus:['低重心准备','快速前送','紧凑回位']},
 {id:'alex-de-minaur-forehand',name:'Alex de Minaur',order:17,video:'多人正手.mp4',frames:[285,288,291,294,297],duration:1.9,back:.68,contact:1.05,follow:1.4,hipTurn:.97,shoulderTurn:.98,reach:.93,dip:.05,forward:.035,stance:1.01,stagger:.012,balance:.01,focus:['快速准备','紧凑引拍','快速回位']},
 {id:'alejandro-davidovich-fokina-forehand',name:'Alejandro Davidovich Fokina',order:18,video:'多人正手.mp4',frames:[312,315,318,321,324],duration:2.02,back:.74,contact:1.13,follow:1.51,hipTurn:1.1,shoulderTurn:1.08,reach:1.01,dip:.04,forward:.032,stance:1.16,stagger:-.012,balance:.018,focus:['开放站位','低位平衡','延伸随挥']},
 {id:'flavio-cobolli-forehand',name:'Flavio Cobolli',order:19,video:'多人正手.mp4',frames:[330,333,336,339,342],duration:2.01,back:.75,contact:1.14,follow:1.51,hipTurn:1.04,shoulderTurn:1.04,reach:1.02,dip:.026,forward:.026,stance:1.05,stagger:.02,balance:.012,focus:['连续引拍','前送击球','稳定结束']},
 {id:'marin-cilic-forehand',name:'Marin Cilic',order:20,video:'多人正手.mp4',frames:[345,348,351,354,356],duration:2.1,back:.81,contact:1.21,follow:1.59,hipTurn:1,shoulderTurn:1.07,reach:1.14,dip:.012,forward:.02,stance:1.08,stagger:.035,balance:.01,focus:['长幅引拍','延伸击球点','高位结束']},
 {id:'karen-khachanov-forehand',name:'Karen Khachanov',order:21,video:'多人正手.mp4',frames:[360,363,366,369,372],duration:2.08,back:.8,contact:1.18,follow:1.59,hipTurn:1.08,shoulderTurn:1.1,reach:1.1,dip:.026,forward:.032,stance:1.14,stagger:.02,balance:.012,focus:['深幅引拍','开放站位','伸展随挥']},
 {id:'jakub-mensik-forehand',name:'Jakub Mensik',order:22,video:'多人正手.mp4',frames:[384,387,390,393,396],duration:2.02,back:.77,contact:1.15,follow:1.53,hipTurn:1.05,shoulderTurn:1.05,reach:1.1,dip:.026,forward:.022,stance:1.11,stagger:.02,balance:.014,step:.06,focus:['长幅引拍','前侧击球','肩上随挥']},
 {id:'ignacio-buse-forehand',name:'Ignacio Buse',order:23,video:'多人正手.mp4',frames:[417,420,423,426,429],duration:1.96,back:.71,contact:1.09,follow:1.46,hipTurn:1,shoulderTurn:1.01,reach:.97,dip:.035,forward:.03,stance:1.04,stagger:.01,balance:.01,focus:['紧凑引拍','稳定支撑','快速回位']},
 {id:'felix-auger-aliassime-forehand',name:'Felix Auger-Aliassime',order:24,video:'多人正手.mp4',frames:[441,447,453,459,465],duration:2.02,back:.76,contact:1.15,follow:1.54,hipTurn:1.09,shoulderTurn:1.09,reach:1.09,dip:.032,forward:.04,stance:1.12,stagger:.02,balance:.018,focus:['宽站位','充分转体','高位随挥']},
];
const root=process.cwd();
const request=JSON.parse(fs.readFileSync(path.join(root,'spec/examples/forehand-study.request.json'),'utf8'));
const seed=normalizeDoc(request.action.parameters.document) as WorkshopDoc;
const reference=JSON.parse(fs.readFileSync(path.join(root,'scripts/forehand-arm-reference.json'),'utf8'));
const referenceDoc=normalizeDoc(reference.document) as WorkshopDoc;
const glb=fs.readFileSync(path.join(root,'public/models/human.glb'));
const gltf=await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync(path.join(root,'public/models/rig.json'),'utf8')) as RigInfo);
const restRoot=rig.rest.get('root')!;

/** The authored anchors, read once from the reference document through the
 * solve. These three are the ONLY poses taken from the user's document. */
const refArms=readReference(rig,referenceDoc,['引拍1','引拍2','击球'],
 (doc,time)=>solveEffectiveFrame(rig,frameAt(doc as WorkshopDoc,time,restRoot)));
const TAKE_UP:TorsoArm=refArms['引拍1'].racket;
const TAKE_DROP:TorsoArm=refArms['引拍2'].racket;
const BALL:TorsoArm=refArms['击球'].racket;
const OFF_TAKE_UP:TorsoArm=refArms['引拍1'].off;
const OFF_TAKE_DROP:TorsoArm=refArms['引拍2'].off;
const OFF_BALL:TorsoArm=refArms['击球'].off;

const SWING_LIFT=.06;
/** Landed lead-foot advance as a fraction of the liftoff advance (see below). */
const LAND_SCALE=.55; // was .7; floored 8 cm crouch + posterior bake pushed Medvedev/Mensik lead slip over 1 cm
/** Uniform reach scale for the transferred OFF-arm swing shapes. The off arm
 * carries no racket, so shrinking it about its own shoulder keeps the authored
 * direction and just bends the elbow more. At the full authored reach the
 * straight-across ball shape grazed the chest and the catch sat beyond the
 * solve's reach on the wider presets. */
const OFF_REACH_SCALE=.90;
/** Soften the authored racket-arm lateral spread so contact/takeback wrists sit
 * closer to the video 2D landmarks (model takeback mean Δdx ≈ −0.72 torso
 * units too far to the racket side). Scales the torso-frame wrist.x then
 * re-normalises; reach is scaled uniformly. Does NOT reintroduce 2D→3D
 * mapping — only damps the shared authored shapes per phase. */
function wristAdjust(shape:TorsoArm,lateral=1,reach=1):TorsoArm{
 const [x,y,z]=shape.wrist;const wx=x*lateral;const n=Math.hypot(wx,y,z)||1;
 return {...shape,wrist:[wx/n,y/n,z/n] as [number,number,number],reach:shape.reach*reach};
}
const stepOf=(p:PlayerPreset)=>p.step??(.075+Math.max(0,p.stance-1)*.055+p.dip*.12);

/** Torso frame of `doc` at `time`. Reads only the two shoulders, so it is stable
 * while the hands are rewritten. Always right-handed: a left-handed player is
 * built the same way and mirrored at the end. */
function torsoAt(doc:WorkshopDoc,time:number){
 solveEffectiveFrame(rig,frameAt(doc,time,restRoot));
 return torsoFrame('R',rig.point('upperarm01_R'),rig.point('upperarm01_L'));
}

/** Pelvis travel toward the net with the lead-foot landing (fraction of the
 * step, per base key): the landed lead leg is at full reach otherwise. */
const LEG_ROOT_STEP=[0,0,.4,.5,.5];
/** Lateral weight, in units of WEIGHT_SHIFT: negative toward the racket-side
 * (right) foot, positive toward the lead (left) foot. */
const LEG_ROOT_X=[0,-1,.5,.5,.2];
/** Metres of weight transfer between the back and lead foot. */
const WEIGHT_SHIFT=.035;

/* ---- measured lower-body depth -------------------------------------------
 *
 * The 17 presets take their pelvis height from MediaPipe `worldLandmarks` on
 * the source clips (evidence/forehand-depth.json, produced by
 * scripts/measure-forehand-depth.mts). The measured quantity is hip height
 * above the support ankle as a fraction of that leg's chain; here it is the
 * same fraction on the solved rig, converted to centimetres with the rig's own
 * chain length. Solving each key's root height against that number — rather
 * than authoring a `crouch` and hoping the solver follows — is what keeps the
 * takeback within the 1.5 cm tolerance the measurement supports.
 *
 * The rear-ankle limit does NOT bound the takeback: it binds in the foot-switch
 * segment (落拍 → 击球), where the lead foot is airborne and the rear leg alone
 * carries a still-deep pelvis. See docs/reports/forehand-video-retargeting.md. */

const LEG_CHAIN=rig.rest.get('upperleg01_L')!.distanceTo(rig.rest.get('lowerleg01_L')!)+rig.rest.get('lowerleg01_L')!.distanceTo(rig.rest.get('foot_L')!);
/** Rest hip height above the ankle, in the same ratio the study reports. */
const REST_RATIO=((rig.rest.get('upperleg01_L')!.y+rig.rest.get('upperleg01_R')!.y)/2-rig.rest.get('foot_L')!.y)/LEG_CHAIN;
const depthStudy=JSON.parse(fs.readFileSync(path.join(root,'evidence/forehand-depth.json'),'utf8'));
if(depthStudy.kind!=='forehand-depth-study')throw new Error('evidence/forehand-depth.json 不是正手下肢深度研究的结果');

/** Per-key targets for one preset (scripts/lib/forehand-depth.mts derives
 * them, and the regression test re-derives them with the same function). */
const PHASE_MEDIAN=phaseMedians(depthStudy);
const measuredTargets=(id:string):{targets:number[];takeback:number;fallback:string[]}|null=>
 depthTargets(depthStudy.profiles[id],PHASE_MEDIAN);

/** Per-key targets for a clip that cannot be measured at all: the previous
 * hand-set template, in cm. Kept as an explicit fallback so an unmeasurable
 * player still ships — the preset's notes state that its depth is not
 * video-derived. */
const UNMEASURED_DEPTH=[3,3.6,2.6,2,1.2,.9,.8,.8,1.5];

/** Solved hip height above the lower ankle at `time`, in cm below the rig's
 * rest — the same definition the depth study uses for the video — and how far
 * the farther ankle misses its target (m), i.e. whether the legs still reach. */
function solvedDepth(doc:WorkshopDoc,time:number):{depth:number;miss:number}{
 const frame=frameAt(doc,time,restRoot);
 rig.reset();
 const {pelvisShift}=solveEffectiveFrame(rig,frame);
 let ratio=-Infinity,miss=-Infinity;
 for(const side of ['L','R'] as const){
  const hip=rig.point(`upperleg01_${side}`),target=(side==='L'?frame.pose.footL:frame.pose.footR).target;
  ratio=Math.max(ratio,(hip.y-rig.point(`foot_${side}`).y)/LEG_CHAIN);
  // Reach is judged from the hip BEFORE the solver's posterior correction
  // (a rigid root translation): a leg the solver only reaches by pulling
  // the pelvis back 5–8 cm is out of reach, and baking that pull into one
  // key put a 47 m/s² root acceleration into the Khachanov preset.
  const gap=Math.hypot(hip.x-target.x,hip.y-target.y,hip.z+pelvisShift-target.z)-LEG_CHAIN;
  miss=Math.max(miss,gap);
 }
 return {depth:(REST_RATIO-ratio)*LEG_CHAIN*100,miss};
}
/** Margin (m) inside full leg extension that counts as reaching. */
const REACH_TOLERANCE=-1e-3;
/** Root height that puts key `i` at `targetCm`. Depth falls monotonically as
 * the root rises, so bisection on the real solve path is enough. The root is
 * never raised past the point where both feet still reach their targets: with
 * a staggered, turned stance the legs cannot straighten fully, so the
 * shallowest reachable depth (the stance floor, ~0.3–2 cm) is a property of
 * the authored foot placement. A shallower target clamps to that floor, and a
 * target deeper than the legs can fold clamps to the deepest root; the caller
 * reports both. */
function rootYForDepth(doc:WorkshopDoc,i:number,targetCm:number){
 const key=doc.keys[i],set=(rootY:number)=>{key.pose.root.y=rootY;return solvedDepth(doc,key.time);};
 // Highest root at which both feet still reach.
 let reach=-.3,over=.08;
 for(let n=0;n<30;n++){const mid=(reach+over)/2;if(set(mid).miss<=REACH_TOLERANCE)reach=mid;else over=mid;}
 let lo=-.5,hi=reach; // lo is the deepest root, hi the highest reachable
 if(set(lo).depth<targetCm)return {rootY:lo,depth:set(lo).depth};
 if(set(hi).depth>=targetCm)return {rootY:hi,depth:set(hi).depth};
 for(let n=0;n<36;n++){
  const mid=(lo+hi)/2;
  if(set(mid).depth>targetCm)lo=mid;else hi=mid;
 }
 const rootY=(lo+hi)/2;
 return {rootY,depth:set(rootY).depth};
}
/** Put every key's pelvis at its measured depth. Returns the target/achieved
 * pairs so the preset notes can state any preset that could not reach its
 * video depth. */
function applyMeasuredDepth(doc:WorkshopDoc,targets:number[]){
 const achieved=doc.keys.map((key,i)=>{
  let {rootY,depth}=rootYForDepth(doc,i,targets[i]);
  // A near-upright target below the stance floor: the weight shift onto the
  // back foot is what stretches the lead leg, so re-centre it (at most the
  // whole WEIGHT_SHIFT) until the floor drops to within FLOOR_TOLERANCE.
  for(let moved=0;depth-targets[i]>FLOOR_TOLERANCE&&moved<WEIGHT_SHIFT-1e-9;moved+=FLOOR_STEP){
   key.pose.root.x-=Math.sign(key.pose.root.x)*Math.min(FLOOR_STEP,Math.abs(key.pose.root.x));
   ({rootY,depth}=rootYForDepth(doc,i,targets[i]));
  }
  key.pose.root.y=rootY;
  return {target:targets[i],depth:Math.round(depth*10)/10};
 });
 return achieved;
}
/** How far above a target the stance floor may leave a key before the weight
 * shift is re-centred (cm), and the re-centring step (m). The issue's
 * tolerance is 1.5 cm; this leaves margin for the guard's re-solve. */
const FLOOR_TOLERANCE=1,FLOOR_STEP=.005;

/** Parametric trunk/feet/timing skeleton: the workshop seed retimed to this
 * player's phases with measured rotations, stance, dip and split step applied.
 * Arms are irrelevant here — every key's arms are placed afterwards. */
function skeleton(player:PlayerPreset):WorkshopDoc{
 const doc=normalizeDoc(structuredClone(seed));
 doc.id=player.id;doc.name=player.name;doc.english=player.name;
 doc.duration=player.duration;
 const step=stepOf(player);
 const times=[0,player.back,player.contact,player.follow,player.duration];
 const travel=[0,.2,1,.58,.12],leadZ=[0,.45,1,1,1];
 doc.keys.forEach((key,i)=>{
  const pose=key.pose;
  key.time=times[i];
  pose.yaw*=player.hipTurn;pose.chest*=player.shoulderTurn;pose.side*=player.shoulderTurn;
  pose.lean+=player.dip*100*[0,.14,.2,.1,0][i];
  // Legs. The pelvis carries the measured crouch and the weight transfer; the
  // foot IK bends the knees. `root.y` is filled in after the arm keys are
  // placed (useMeasuredDepth), once every other target is final.
  pose.root.x=LEG_ROOT_X[i]*WEIGHT_SHIFT;
  // The player's forward drive only. A separate per-key `rootStep` curve used
  // to add a pelvis lurch on top of this; combined with the dorsiflexion
  // correction it produced 41–48 m/s² root acceleration at the 击球 plant
  // transition (the service's limit is 40). The step itself is carried by the
  // lead FOOT targets below, where it belongs.
  pose.root.z+=player.forward*travel[i]+step*LEG_ROOT_STEP[i];
  pose.root.x+=player.forward*.18*travel[i];
  for(const side of ['L','R']as const){
   const foot=side==='L'?pose.footL:pose.footR;
   foot.target.x*=player.stance;foot.pole.x*=player.stance;
   foot.target.z+=(side==='L'?1:-1)*player.stagger;
   foot.yaw*=player.hipTurn;
  }
  pose.footL.target.z+=step*leadZ[i];
  pose.footL.pole.z+=step*leadZ[i];
 });
 return doc;
}

/** Back (racket-side) foot push-off. The rear foot is released through 前挥,
 * planted on its ball at 击球 with the heel raised and the toes turned toward
 * the net (the 蹬转 drive), released again through 随挥 and planted flat at 恢复.
 * A planted run holds its first key's contact, so the release/replant pair is
 * what lets the heel rise; the flat 准备 contact is kept at both ends. */
const PUSH_OFF:[number,number,number,number,number][]=[
 // [key, pitch°, yaw°, dx, dz] — pitch + = toes down / heel up. Contact heel is 12°
 // (Notion T3 target). Pre-#17 Frances rejected 12° at 42 m/s² because the old
 // guard lifted the pelvis and the dorsi correction kinked to zero mid-segment;
 // after the posterior-bake guard (issue #17) an in-memory sweep of all 17
 // presets at 12° stays ≤12.6 m/s² root accel and ≤1.4 mm slip at 40 Hz.
 // Key 3/7 sit at 6° so the linear 前挥→击球 ankle ramp is 6→12° (≤2.5 mm toe
 // sink class, same order as the prior 4→8° ramp).
 [3,6,-1,.006,.01],
 [4,12,6,.01,.02],
 [7,6,2,.01,.02],
];
/** Sole clearance (m) held above the ground at the pivot: the planted toe sits
 * exactly on the floor in the rest geometry and sinks a few mm once the
 * pelvis correction rises under it. */
const PUSH_CLEARANCE=.004;
function applyPushOff(keys:WorkshopKey[]){
 const geo=footGeometry(rig.rest,'R');
 const flat=keys[0].pose.footR.target;
 for(const [i,pitch,yaw,dx,dz] of PUSH_OFF){
  const f=keys[i].pose.footR;
  f.pitch=pitch;f.yaw=yaw;
  f.target={x:flat.x+dx,y:ankleYForLift(geo,PUSH_CLEARANCE,yaw,pitch),z:flat.z+dz};
 }
 keys[3].constraints.plantR=false;keys[4].constraints.plantR=true;
 keys[7].constraints.plantR=false;keys[8].constraints.plantR=true;
 // 延伸 / 折肘 sit inside the planted run that starts at 击球: the sampler holds
 // 击球's contact there, so store that same contact on them.
 for(const i of [5,6])keys[i].pose.footR=structuredClone(keys[4].pose.footR);
}

/** Back-ankle guard. The solved shank may not dorsiflex past the range that
 * kinematics.test.ts enforces (ankle ≤ 20.1°, both feet, 80 samples), checked here on a denser 240-sample grid. The solver
 * holds a planted leg at 20° with a posterior pelvis shift, but scales that shift
 * by support, so where a leg lifts, releases or re-plants (the foot switch
 * 落拍 → 击球, the follow-through release) the correction fades out and the
 * ankle overshoots.
 *
 * The guard therefore moves the pelvis BACK, never up: it bakes the solver's
 * own posterior shift at every key into `root.z` (the in-between samples then
 * interpolate an already-corrected pelvis instead of a fading correction), and
 * if a sample still overshoots it nudges the two keys around it further back
 * in GUARD_STEP increments, at most GUARD_MAX_EXTRA each. Hip height — the
 * measured crouch — is untouched. The earlier guard raised the pelvis 6–24 mm
 * from 落拍 on, which cost 0.6–2.4 cm of contact-phase crouch. */
const ANKLE_MAX=20.05;
const ANKLE_SAMPLES=240;
const GUARD_STEP=.005,GUARD_MAX_EXTRA=.06,GUARD_PASSES=6;
type GuardResult={doc:WorkshopDoc;peak:number;time:number;side:'L'|'R';baked:number[];extra:number[]};
function peakDorsiflexion(doc:WorkshopDoc):{peak:number;time:number;side:'L'|'R'}{
 let peak=-Infinity,time=0,side:'L'|'R'='R';
 for(let i=0;i<ANKLE_SAMPLES;i++){
  const t=i/ANKLE_SAMPLES*doc.duration;
  rig.reset();solveEffectiveFrame(rig,frameAt(doc,t,restRoot));rig.model.updateMatrixWorld(true);
  for(const s of ['L','R'] as const){
   const shank=rig.point(`foot_${s}`).sub(rig.point(`lowerleg01_${s}`)).applyQuaternion(rig.bone(`foot_${s}`).getWorldQuaternion(new Quaternion()).invert());
   const dorsi=Math.atan2(-shank.z,-shank.y)*180/Math.PI;
   if(dorsi>peak){peak=dorsi;time=t;side=s;}
  }
 }
 return {peak,time,side};
}
/** Bake the solver's posterior shift into the keys, then nudge the keys
 * bracketing any remaining overshoot further back. Works in place on a copy. */
function guardDoc(input:WorkshopDoc):GuardResult{
 const doc=normalizeDoc(structuredClone(input)) as WorkshopDoc;
 const baked=doc.keys.map(()=>0),extra=doc.keys.map(()=>0);
 for(let pass=0;pass<GUARD_PASSES;pass++){
  let moved=0;
  for(const [i,key] of doc.keys.entries()){
   rig.reset();
   const {pelvisShift}=solveEffectiveFrame(rig,frameAt(doc,key.time,restRoot));
   if(pelvisShift<=1e-4)continue;
   key.pose.root.z-=pelvisShift;baked[i]+=pelvisShift;moved=Math.max(moved,pelvisShift);
  }
  if(moved<1e-3)break;
 }
 // A per-key bake zigzags root.z (e.g. 0, 3, 8, 8, 4 cm back) and 落拍/前挥
 // interpolate linearly, so each zig is a velocity kink — up to 100 m/s² at
 // 240 fps. Widen every key's posterior offset to its neighbours' max: the
 // pelvis holds one setback across the foot switch instead of bouncing.
 // A deeper setback only lowers the planted ankles' dorsiflexion.
 const widened=baked.map((_,i)=>Math.max(baked[i-1]??0,baked[i],baked[i+1]??0));
 widened.forEach((value,i)=>{doc.keys[i].pose.root.z-=value-baked[i];baked[i]=value;});
 let result=peakDorsiflexion(doc);
 while(result.peak>ANKLE_MAX){
  const next=doc.keys.findIndex(key=>key.time>result.time);
  const pair=next<=0?[doc.keys.length-1]:[next-1,next];
  const open=pair.filter(i=>extra[i]<GUARD_MAX_EXTRA-1e-9);
  if(!open.length)throw new Error(`背屈未能约束到 ${ANKLE_MAX}°：${result.peak.toFixed(2)}° @ ${result.time.toFixed(2)}s，骨盆后移已达 ${GUARD_MAX_EXTRA*100} cm 上限`);
  for(const i of open){doc.keys[i].pose.root.z-=GUARD_STEP;extra[i]+=GUARD_STEP;}
  result=peakDorsiflexion(doc);
 }
 return {doc,...result,baked,extra};
}
/** The guard's largest per-key posterior move, in cm, for the preset notes. */
const guardShiftCm=(g:GuardResult)=>Math.max(...g.baked.map((b,i)=>b+g.extra[i]))*100;

/** Build one preset in right-handed geometry; a left-hander is mirrored. */
function buildDoc(player:PlayerPreset):{doc:WorkshopDoc;guard:GuardResult;depth:{target:number;depth:number}[]}{
 const base=skeleton(player);
 const racketArm=armLengths(rig,'R'),offArm=armLengths(rig,'L');
 const finishReach=Math.min(1.05,Math.max(.9,player.reach));
 // Amplitude the authored racket shapes may take per player. Damped hard
 // (≤~5 %): the authored elbow angles are the point of the reference, and a
 // uniform wrist scale is the only per-player variation that cannot shear it.
 const armScale=1+(player.reach-1)*.35;
 const span=player.contact-player.back;
 const t={
  ready:0,back:player.back,drop:player.back+span*.45,
  foreSwing:player.back+span*.45+(player.contact-(player.back+span*.45))*.35,
  hit:player.contact,
  extend:player.contact+(player.follow-player.contact)*.36,
  fold:player.contact+(player.follow-player.contact)*.70,
  follow:player.follow,recover:player.duration,
 };
 const plan:{label:string;time:number;contact?:boolean}[]=[
  {label:'准备',time:t.ready},{label:'引拍',time:t.back},{label:'落拍',time:t.drop},
  {label:'前挥',time:t.foreSwing},{label:'击球',time:t.hit,contact:true},
  {label:'延伸',time:t.extend},{label:'折肘',time:t.fold},
  {label:'随挥',time:t.follow},{label:'恢复',time:t.recover},
 ];
 // Trunk, feet and plant flags at each instant come from the parametric
 // skeleton, so the trunk turn / dip / step timing is exactly the seed's.
 const keys:WorkshopKey[]=plan.map((spec,i)=>{
  const frame=frameAt(base,spec.time,restRoot);
  return {id:`${player.id}-k${i}`,time:+spec.time.toFixed(6),label:spec.label,
   pose:structuredClone(frame.pose),constraints:{...frame.constraints,contact:spec.contact===true}};
 });
 // Straight off-arm targets cross the chest during the quick torso turn from
 // 落拍 → 前挥 → 击球. Linear outgoing curves prevent Hermite tangent overshoot
 // from pushing the interpolated wrist beyond the shoulder-to-wrist reach.
 keys[2].interpolation='linear';
 keys[3].interpolation='linear';
 // Lead-foot step: planted through 引拍, released at 落拍 (that release key
 // carries the swing waypoint), replanted forward from 击球 on. A planted run
 // holds the contact of its FIRST key, so the liftoff/landing pair is the step.
 const leadTarget={...keys[0].pose.footL.target},leadPole={...keys[0].pose.footL.pole};
 const advance=stepOf(player);
 keys.forEach((key,i)=>{
  const inSwing=i===2||i===3;
  key.constraints.plantL=!inSwing;
  const foot=key.pose.footL;
  foot.target={...leadTarget};foot.pole={...leadPole};
  if(i===2){foot.target.z+=advance*.36;foot.target.y+=SWING_LIFT;foot.pole.z+=advance*.36;foot.pole.y+=SWING_LIFT*.45;}
  else if(i===3){foot.target.z+=advance*.58;foot.target.y+=SWING_LIFT*.45;foot.pole.z+=advance*.58;foot.pole.y+=SWING_LIFT*.20;}
  // Landing advance is 70%: the full advance made the planted foot drift
  // 1.3–1.5 cm under the solved pelvis correction.
  else if(i>3){foot.target.z+=advance*LAND_SCALE;foot.pole.z+=advance*LAND_SCALE;}
 });
 // The short off-arm swing from 落拍 through 前挥 is linear: poles stay world-
 // space while the chest turns, and a long Hermite interval swept the straight
 // authored arm through the chest on the fastest trunk turns.
 keys[2].interpolation='linear';keys[3].interpolation='linear';
 applyPushOff(keys);
 const doc:WorkshopDoc={...base,keys};
 const torso=(i:number)=>torsoAt(doc,keys[i].time);
 const racket=(i:number,shape:TorsoArm,scale=armScale):ArmPose=>
  placeRacketArm(torso(i),racketArm,shape,{reachScale:scale});
 const off=(i:number,shape:TorsoArm,scale=1):ArmPose=>placeOffArm(torso(i),offArm,torso(i).offShoulder,
  {...shape,reach:shape.reach*scale});
 // 准备: relaxed ready; the off hand starts half-way to its authored guard.
 setHand(keys[0].pose.handR,racket(0,READY_RACKET));
 setHand(keys[0].pose.handL,blendArm(off(0,OFF_TAKE_UP),off(0,OFF_TAKE_DROP),.25));
 // 引拍 / 落拍: authored shapes with a lighter lateral wrist (video match).
 const takeUp=wristAdjust(TAKE_UP,.72,.96);
 const takeDrop=wristAdjust(TAKE_DROP,.78,.96);
 const ball=wristAdjust(BALL,.88,1.0);
 setHand(keys[1].pose.handR,racket(1,takeUp));
 setHand(keys[1].pose.handL,off(1,OFF_TAKE_UP));
 setHand(keys[2].pose.handR,racket(2,takeDrop));
 setHand(keys[2].pose.handL,off(2,OFF_TAKE_DROP,OFF_REACH_SCALE));
 // 前挥: a real mid key makes the long off arm follow the chest turn. The
 // racket arm interpolates the (adjusted) drop → ball coefficients in torso space;
 // the off arm tucks slightly and swings its elbow outside the chest.
 const swingR=interpolateTorsoArm(takeDrop,ball,.35);
 setHand(keys[3].pose.handR,racket(3,swingR));
 setHand(keys[3].pose.handL,off(3,OFF_SWING));
 // 击球: authored pose with a slightly less extreme lateral wrist.
 setHand(keys[4].pose.handR,racket(4,ball));
 setHand(keys[4].pose.handL,off(4,OFF_BALL,OFF_REACH_SCALE));
 // 延伸: the racket starts climbing after the authored ball pose.
 const extend=racket(5,EXTEND_RACKET,Math.min(1.02,armScale));
 setHand(keys[5].pose.handR,extend);
 // 折肘 / 随挥 / 恢复: designed fold to the off shoulder.
 const fold=racket(6,FOLD_RACKET,finishReach);
 const finish=racket(7,FINISH_RACKET,finishReach);
 const settle=racket(8,SETTLE_RACKET,finishReach);
 setHand(keys[6].pose.handR,fold);
 setHand(keys[7].pose.handR,finish);
 setHand(keys[8].pose.handR,settle);
 // Off arm after the ball: retract toward the racket throat with the elbow
 // swung outside through the middle.
 const offBall=handPose(keys[4].pose.handL);
 setHand(keys[5].pose.handL,offTransition(torso(5),offBall,offReach(torso(5),offArm),.55));
 setHand(keys[6].pose.handL,offTransition(torso(6),offReach(torso(6),offArm),
  offCatch(torso(6),offArm,racketOf(fold)),.60));
 setHand(keys[7].pose.handL,offCatch(torso(7),offArm,racketOf(finish)));
 setHand(keys[8].pose.handL,offCatch(torso(8),offArm,racketOf(settle)));
 // Lower body: every key takes its pelvis height from the measured video depth.
 // This runs after the arms so the solved hip position sees the final foot and
 // trunk targets; the hands are then carried with the pelvis (below).
 // The arms were placed on the trunk the solver produced, which includes its
 // own posterior pelvis correction — so the carry below measures the SOLVED
 // pelvis, not the authored root: a correction present at placement (deep
 // seed crouch) and gone after the depth change left Cilic/Federer's racket
 // wrist 4–5 mm out of reach.
 const solvedPelvis=(d:WorkshopDoc)=>d.keys.map(key=>{
  rig.reset();solveEffectiveFrame(rig,frameAt(d,key.time,restRoot));
  return rig.point('root');
 });
 const placedPelvis=solvedPelvis(doc);
 const depth=applyMeasuredDepth(doc,measuredTargets(player.id)?.targets??UNMEASURED_DEPTH);
 const guard=guardDoc(doc);
 // Hand targets/poles are stored in world space, so the pelvis moves above
 // would pull the trunk away from the arms placed on it. Carry each key's
 // hands by its own solved-pelvis delta: the arms keep their authored
 // torso-relative shape (the root is a rigid translation of the trunk;
 // neither the yaw nor the spine changed).
 const finalPelvis=solvedPelvis(guard.doc);
 guard.doc.keys.forEach((key,i)=>{
  const d=finalPelvis[i].clone().sub(placedPelvis[i]);
  for(const hand of [key.pose.handL,key.pose.handR])for(const p of [hand.target,hand.pole]){
   const round6=(n:number)=>Math.round(n*1e6)/1e6;
   p.x=round6(p.x+d.x);p.y=round6(p.y+d.y);p.z=round6(p.z+d.z);
  }
 });
 const finished=player.side==='L'?mirrorDoc(guard.doc):guard.doc;
 // Canonicalize AFTER the last write. canonicalizeHands projects forward/normal
 // onto an orthonormal pair; a frame that is not already a fixed point of that
 // projection drifts by ~1 ULP when the library re-canonicalizes it on reload,
 // which breaks byte/strict equality between the shipped asset and the
 // rehydrated document. Doing it here makes every shipped key a fixed point.
 for(const key of finished.keys)canonicalizeHands(key.pose);
 return {doc:normalizeDoc(finished),guard,depth};
}

/** Stored hand → ArmPose, for feeding an already-written key back into an
 * interpolation. */
function handPose(hand:{target:{x:number;y:number;z:number};pole:{x:number;y:number;z:number};forward:{x:number;y:number;z:number};normal:{x:number;y:number;z:number}}):ArmPose{
 const v=(a:{x:number;y:number;z:number})=>new Vector3(a.x,a.y,a.z);
 return {target:v(hand.target),pole:v(hand.pole),forward:v(hand.forward),normal:v(hand.normal)};
}
/** Racket wrist and head axis of a placed racket-arm pose. */
function racketOf(pose:ArmPose){return {wrist:pose.target.clone(),axis:handAxis(pose,'R')};}

for(const player of players){
 const frames=player.frames.join(', ');
 const excerpt=`${player.frames[0]}–${player.frames.at(-1)}s`;
 const duplicateNote=player.name==='Novak Djokovic'
  ?'优先选用专属高清片段；合辑中也有较低分辨率重复画面。'
  :['Carlos Alcaraz','Alexander Zverev','Daniil Medvedev','Ben Shelton'].includes(player.name)
   ?'优先选用合辑中较长、全身较清楚的一段，开头另有短暂重复预览。'
   :'';
 const {doc:document,guard,depth}=buildDoc(player);
 const measured=measuredTargets(player.id);
 const shift=guardShiftCm(guard);
 console.log(`  ${player.id}: takeback ${depth[1].depth} cm (target ${depth[1].target.toFixed(1)}), contact ${depth[4].depth} cm; ankle peak ${guard.peak.toFixed(2)}° ${guard.side} @ ${guard.time.toFixed(2)}s, pelvis back ≤ ${shift.toFixed(1)} cm`);
 const phaseName:Record<string,string>={ready:'准备',contact:'击球',follow:'随挥',recover:'恢复'};
 const depthNote=measured
  ?`下肢深度来自源视频 MediaPipe worldLandmarks 的三维测量（evidence/forehand-depth.json）：引拍髋部比站立参考下降 ${measured.takeback.toFixed(1)} cm，求解后 ${depth[1].depth.toFixed(1)} cm；各键实测/求解（cm）${depth.map(d=>`${d.target.toFixed(1)}/${d.depth.toFixed(1)}`).join('、')}。${measured.fallback.length?`${measured.fallback.map(n=>phaseName[n]).join('、')}窗口在视频中不可测（脚出画或遮挡），取各球员该阶段中位数（不超过引拍深度）。`:''}站姿下双腿无法完全伸直，浅于站姿下限（约 0.3–2 cm）的目标按下限求解。`
  :'源视频不可测（髋/膝/踝出画或遮挡，见 evidence/forehand-depth.json），下肢深度沿用手设模板，并非视频测量值。';
 const guardNote=shift>.05
  ?`背屈校准：把求解器的骨盆后移写入关键帧，并在支撑切换处最多再后移 ${GUARD_MAX_EXTRA*100} cm（本动作最大后移 ${shift.toFixed(1)} cm），骨盆高度不变，后脚踝背屈峰值 ≤ ${ANKLE_MAX}°（工程门限 20°）。`
  :'';
 const envelope={
  schemaVersion:1,kind:'workshop-motion',order:player.order,id:player.id,name:player.name,english:player.name,
  duration:player.duration,
  description:'手臂姿态以工作台手捏正手（引拍1 / 引拍2 / 击球）为参考，按各球员躯干转角在躯干坐标系中重建：引拍时球拍立起于肩侧，落拍时拍头下坠到体侧最低点、非持拍臂横在胸前，击球时球拍接近水平且指向体侧（手捏姿态的肘角约 48°，并非直臂），随后折肘把球拍带到非持拍肩前、拍头竖直于肩上方，非持拍手在拍喉接住球拍。手臂目标不来自视频关键点，未估计单目深度或球拍朝向。',
  method:'工作台手捏正手 · 躯干系手臂重建 + 球员参数化（视频关键帧仅作时序参考）',focus:player.focus,
  phases:[{time:0,label:'准备'},{time:player.back,label:'引拍'},{time:player.contact,label:'击球区'},{time:player.follow,label:'随挥'},{time:player.duration,label:'恢复'}],
  notes:[`参考 ${player.video} @ ${excerpt}；关键帧秒数：${frames}。${duplicateNote}`,'手臂来自手捏参考姿态的躯干系系数（不是 2D 关键点）：单目视频关节点无法决定三维手臂目标，此前的映射把持拍臂折进躯干（见 docs/reports/forehand-video-retargeting.md）。后脚蹬地枢转与重心左右移是骨架近似；持拍腕在引拍/落拍/击球处按二维关节点的侧向偏差对躯干系系数做了轻度内收（非二维重映射），球拍朝向仍是近似。',depthNote,...(guardNote?[guardNote]:[])],
  license:'Project-authored motion approximation; source video frames are not redistributed.',oneShot:true,
  capabilities:{prop:{kind:'racket',trail:true,handView:true,...(player.side?{side:player.side}:{})}},
  document,
 };
 const file=path.join(root,'assets/motions',`${player.id}.json`);
 fs.writeFileSync(file,`${JSON.stringify(envelope,null,2)}\n`);
 console.log(`wrote ${path.relative(root,file)}`);
}
