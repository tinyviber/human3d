import fs from 'node:fs';
import path from 'node:path';
import {Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {
 HumanRig,canonicalizeHands,frameAt,mirrorDoc,normalizeDoc,solveEffectiveFrame,type RigInfo,type WorkshopDoc,type WorkshopKey,
} from '@human3d/motion-core';
import {
 armLengths,blendArm,handAxis,interpolateTorsoArm,offCatch,offReach,offTransition,placeOffArm,placeRacketArm,
 readReference,setHand,torsoFrame,
 EXTEND_RACKET,FINISH_RACKET,FOLD_RACKET,OFF_SWING,READY_RACKET,SETTLE_RACKET,
 type ArmPose,TorsoArm,
} from './lib/forehand-arms.mts';

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
 {id:'jakub-mensik-forehand',name:'Jakub Mensik',order:22,video:'多人正手.mp4',frames:[384,387,390,393,396],duration:2.02,back:.77,contact:1.15,follow:1.53,hipTurn:1.05,shoulderTurn:1.05,reach:1.1,dip:.026,forward:.035,stance:1.11,stagger:.025,balance:.014,focus:['长幅引拍','前侧击球','肩上随挥']},
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
const LAND_SCALE=.7;
/** Uniform reach scale for the transferred OFF-arm swing shapes. The off arm
 * carries no racket, so shrinking it about its own shoulder keeps the authored
 * direction and just bends the elbow more. At the full authored reach the
 * straight-across ball shape grazed the chest and the catch sat beyond the
 * solve's reach on the wider presets. */
const OFF_REACH_SCALE=.90;
const stepOf=(p:PlayerPreset)=>p.step??(.075+Math.max(0,p.stance-1)*.055+p.dip*.12);

/** Torso frame of `doc` at `time`. Reads only the two shoulders, so it is stable
 * while the hands are rewritten. Always right-handed: a left-handed player is
 * built the same way and mirrored at the end. */
function torsoAt(doc:WorkshopDoc,time:number){
 solveEffectiveFrame(rig,frameAt(doc,time,restRoot));
 return torsoFrame('R',rig.point('upperarm01_R'),rig.point('upperarm01_L'));
}

/** Parametric trunk/feet/timing skeleton: the workshop seed retimed to this
 * player's phases with measured rotations, stance, dip and split step applied.
 * Arms are irrelevant here — every key's arms are placed afterwards. */
function skeleton(player:PlayerPreset):WorkshopDoc{
 const doc=normalizeDoc(structuredClone(seed));
 doc.id=player.id;doc.name=player.name;doc.english=player.name;
 doc.duration=player.duration;
 const step=stepOf(player);
 const times=[0,player.back,player.contact,player.follow,player.duration];
 const travel=[0,.2,1,.58,.12],dip=[0,1,.34,.08,0],leadZ=[0,.45,1,1,1];
 doc.keys.forEach((key,i)=>{
  const pose=key.pose;
  key.time=times[i];
  pose.yaw*=player.hipTurn;pose.chest*=player.shoulderTurn;pose.side*=player.shoulderTurn;
  pose.lean+=player.dip*100*[0,.14,.2,.1,0][i];
  pose.root.y-=player.dip*dip[i];
  // The player's forward drive only. A separate per-key `rootStep` curve used
  // to add a pelvis lurch on top of this; combined with the dorsiflexion
  // correction it produced 41–48 m/s² root acceleration at the 击球 plant
  // transition (the service's limit is 40). The step itself is carried by the
  // lead FOOT targets below, where it belongs.
  pose.root.z+=player.forward*travel[i];
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

/** Build one preset in right-handed geometry; a left-hander is mirrored. */
function buildDoc(player:PlayerPreset):WorkshopDoc{
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
 const doc:WorkshopDoc={...base,keys};
 const torso=(i:number)=>torsoAt(doc,keys[i].time);
 const racket=(i:number,shape:TorsoArm,scale=armScale):ArmPose=>
  placeRacketArm(torso(i),racketArm,shape,{reachScale:scale});
 const off=(i:number,shape:TorsoArm,scale=1):ArmPose=>placeOffArm(torso(i),offArm,torso(i).offShoulder,
  {...shape,reach:shape.reach*scale});
 // 准备: relaxed ready; the off hand starts half-way to its authored guard.
 setHand(keys[0].pose.handR,racket(0,READY_RACKET));
 setHand(keys[0].pose.handL,blendArm(off(0,OFF_TAKE_UP),off(0,OFF_TAKE_DROP),.25));
 // 引拍 / 落拍: the user's AUTHORED shapes.
 setHand(keys[1].pose.handR,racket(1,TAKE_UP));
 setHand(keys[1].pose.handL,off(1,OFF_TAKE_UP));
 setHand(keys[2].pose.handR,racket(2,TAKE_DROP));
 setHand(keys[2].pose.handL,off(2,OFF_TAKE_DROP,OFF_REACH_SCALE));
 // 前挥: a real mid key makes the long off arm follow the chest turn. The
 // racket arm interpolates the authored drop → ball coefficients in torso space;
 // the off arm tucks slightly and swings its elbow outside the chest.
 const swingR=interpolateTorsoArm(TAKE_DROP,BALL,.35);
 setHand(keys[3].pose.handR,racket(3,swingR));
 setHand(keys[3].pose.handL,off(3,OFF_SWING));
 // 击球 is the user's authored racket/off-arm pose.
 setHand(keys[4].pose.handR,racket(4,BALL));
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
 // Canonicalize AFTER the last write. canonicalizeHands projects forward/normal
 // onto an orthonormal pair; a frame that is not already a fixed point of that
 // projection drifts by ~1 ULP when the library re-canonicalizes it on reload,
 // which breaks byte/strict equality between the shipped asset and the
 // rehydrated document. Doing it here makes every shipped key a fixed point.
 const finished=player.side==='L'?mirrorDoc(doc):doc;
 for(const key of finished.keys)canonicalizeHands(key.pose);
 return normalizeDoc(finished);
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
 const envelope={
  schemaVersion:1,kind:'workshop-motion',order:player.order,id:player.id,name:player.name,english:player.name,
  duration:player.duration,
  description:'手臂姿态以工作台手捏正手（引拍1 / 引拍2 / 击球）为参考，按各球员躯干转角在躯干坐标系中重建：引拍时球拍立起于肩侧，落拍时拍头下坠到体侧最低点、非持拍臂横在胸前，击球时球拍接近水平且指向体侧（手捏姿态的肘角约 48°，并非直臂），随后折肘把球拍带到非持拍肩前、拍头竖直于肩上方，非持拍手在拍喉接住球拍。手臂目标不来自视频关键点，未估计单目深度或球拍朝向。',
  method:'工作台手捏正手 · 躯干系手臂重建 + 球员参数化（视频关键帧仅作时序参考）',focus:player.focus,
  phases:[{time:0,label:'准备'},{time:player.back,label:'引拍'},{time:player.contact,label:'击球区'},{time:player.follow,label:'随挥'},{time:player.duration,label:'恢复'}],
  notes:[`参考 ${player.video} @ ${excerpt}；关键帧秒数：${frames}。${duplicateNote}`,'手臂来自手捏参考姿态的躯干系系数（不是 2D 关键点）：单目视频关节点无法决定三维手臂目标，此前的映射把持拍臂折进躯干（见 docs/reports/forehand-video-retargeting.md）。脚步是带摆动中点的骨架内近似；深度、手腕朝向与球拍姿态仍是近似，未将视频帧或模型写入动作资产。'],
  license:'Project-authored motion approximation; source video frames are not redistributed.',oneShot:true,
  capabilities:{prop:{kind:'racket',trail:true,handView:true,...(player.side?{side:player.side}:{})}},
  document:buildDoc(player),
 };
 const file=path.join(root,'assets/motions',`${player.id}.json`);
 fs.writeFileSync(file,`${JSON.stringify(envelope,null,2)}\n`);
 console.log(`wrote ${path.relative(root,file)}`);
}
