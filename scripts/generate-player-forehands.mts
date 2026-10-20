import fs from 'node:fs';
import path from 'node:path';
import {Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig,frameAt,mirrorDoc,normalizeDoc,solveEffectiveFrame,type RigInfo,type WorkshopDoc} from '@human3d/motion-core';
import {blendHand,handAxis,offArm,offReach,offTransition,racketArm,racketPath,torsoFrame,type HandLike} from './lib/forehand-arms.mts';

type PlayerPreset={
 id:string;name:string;order:number;side?:'L';video:string;frames:[number,number,number,number,number];
 duration:number;back:number;contact:number;follow:number;
 hipTurn:number;shoulderTurn:number;reach:number;armHeight:number;depth:number;
 dip:number;forward:number;stance:number;stagger:number;finishLift:number;balance:number;
 step?:number;
 focus:[string,string,string];
};

/** Every preset is a parametric variant of the workshop forehand seed
 * (spec/examples/forehand-study.request.json). `frames` are the source-video
 * timestamps (seconds) of the five reference stills; they become the keys'
 * `videoTime` provenance and the timing/amplitude parameters were authored
 * against those stills. No 2D landmark is mapped onto the rig: uncalibrated
 * monocular keypoints cannot place a 3D wrist/elbow target, and doing so folded
 * every player's racket arm into the torso (docs/reports/forehand-video-retargeting.md). */
const players:PlayerPreset[]=[
 {id:'novak-djokovic-forehand',name:'Novak Djokovic',order:8,video:'德约正手.mp4',frames:[0,3,6,7,8],duration:2.05,back:.77,contact:1.16,follow:1.52,hipTurn:1.02,shoulderTurn:1.08,reach:.96,armHeight:.98,depth:.94,dip:.02,forward:.025,stance:1.14,stagger:.035,finishLift:.13,balance:.012,step:.1,focus:['开放式站位','紧凑引拍','平衡回位']},
 {id:'roger-federer-forehand',name:'Roger Federer',order:9,video:'费德勒正手.mp4',frames:[130,131,132,133,135],duration:2.04,back:.73,contact:1.13,follow:1.5,hipTurn:.98,shoulderTurn:1.02,reach:1.13,armHeight:1.03,depth:1.04,dip:.01,forward:.012,stance:1.02,stagger:.035,finishLift:-.1,balance:.016,step:.11,focus:['舒展引拍','向前延伸击球','肩上结束']},
 {id:'carlos-alcaraz-forehand',name:'Carlos Alcaraz',order:10,video:'多人正手.mp4',frames:[90,92,93,94,95],duration:1.92,back:.7,contact:1.08,follow:1.47,hipTurn:1.12,shoulderTurn:1.13,reach:1.04,armHeight:1.04,depth:1.08,dip:.04,forward:.04,stance:1.12,stagger:-.015,finishLift:.105,balance:.02,step:.12,focus:['低位准备','快速躯干转动','高位随挥']},
 {id:'alexander-zverev-forehand',name:'Alexander Zverev',order:11,video:'多人正手.mp4',frames:[132,135,138,141,144],duration:2.06,back:.82,contact:1.19,follow:1.56,hipTurn:.98,shoulderTurn:1.03,reach:1.12,armHeight:1.06,depth:1.05,dip:.015,forward:.02,stance:1.06,stagger:.02,finishLift:.045,balance:.012,focus:['高位准备','舒展击球点','稳定回位']},
 {id:'daniil-medvedev-forehand',name:'Daniil Medvedev',order:12,video:'多人正手.mp4',frames:[162,165,168,171,174],duration:2.1,back:.85,contact:1.2,follow:1.58,hipTurn:.94,shoulderTurn:.95,reach:.94,armHeight:.96,depth:.94,dip:.012,forward:.015,stance:1.1,stagger:-.01,finishLift:.012,balance:.01,focus:['紧凑引拍','平直向前击球','快速重置']},
 {id:'ben-shelton-forehand',name:'Ben Shelton',order:13,side:'L',video:'多人正手.mp4',frames:[186,189,192,195,198],duration:2,back:.78,contact:1.12,follow:1.52,hipTurn:1.1,shoulderTurn:1.08,reach:1.12,armHeight:1.08,depth:1.06,dip:.03,forward:.04,stance:1.1,stagger:.02,finishLift:.1,balance:.018,focus:['左手引拍','充分躯干转动','高位随挥']},
 {id:'alexander-bublik-forehand',name:'Alexander Bublik',order:14,video:'多人正手.mp4',frames:[216,219,222,225,228],duration:2.12,back:.86,contact:1.24,follow:1.62,hipTurn:.91,shoulderTurn:.93,reach:1.05,armHeight:.96,depth:.98,dip:.006,forward:.006,stance:1.01,stagger:.025,finishLift:.025,balance:.01,focus:['放松准备','宽幅引拍','流动随挥']},
 {id:'frances-tiafoe-forehand',name:'Frances Tiafoe',order:15,video:'多人正手.mp4',frames:[240,243,246,249,252],duration:1.98,back:.75,contact:1.11,follow:1.5,hipTurn:1.08,shoulderTurn:1.12,reach:1.03,armHeight:1.01,depth:1.04,dip:.04,forward:.03,stance:1.15,stagger:.03,finishLift:.08,balance:.02,focus:['宽站位','前侧手平衡','躯干带动挥拍']},
 {id:'holger-rune-forehand',name:'Holger Rune',order:16,video:'多人正手.mp4',frames:[267,270,273,276,279],duration:1.96,back:.72,contact:1.09,follow:1.48,hipTurn:1.08,shoulderTurn:1.06,reach:1.03,armHeight:1.05,depth:1,dip:.032,forward:.03,stance:1.07,stagger:.015,finishLift:.08,balance:.015,focus:['低重心准备','快速前送','紧凑回位']},
 {id:'alex-de-minaur-forehand',name:'Alex de Minaur',order:17,video:'多人正手.mp4',frames:[285,288,291,294,297],duration:1.9,back:.68,contact:1.05,follow:1.4,hipTurn:.97,shoulderTurn:.98,reach:.93,armHeight:.95,depth:.95,dip:.05,forward:.035,stance:1.01,stagger:.012,finishLift:.025,balance:.01,focus:['快速准备','紧凑引拍','快速回位']},
 {id:'alejandro-davidovich-fokina-forehand',name:'Alejandro Davidovich Fokina',order:18,video:'多人正手.mp4',frames:[312,315,318,321,324],duration:2.02,back:.74,contact:1.13,follow:1.51,hipTurn:1.1,shoulderTurn:1.08,reach:1.01,armHeight:1.02,depth:1.04,dip:.04,forward:.032,stance:1.16,stagger:-.012,finishLift:.085,balance:.018,focus:['开放站位','低位平衡','延伸随挥']},
 {id:'flavio-cobolli-forehand',name:'Flavio Cobolli',order:19,video:'多人正手.mp4',frames:[330,333,336,339,342],duration:2.01,back:.75,contact:1.14,follow:1.51,hipTurn:1.04,shoulderTurn:1.04,reach:1.02,armHeight:1.01,depth:1.01,dip:.026,forward:.026,stance:1.05,stagger:.02,finishLift:.052,balance:.012,focus:['连续引拍','前送击球','稳定结束']},
 {id:'marin-cilic-forehand',name:'Marin Cilic',order:20,video:'多人正手.mp4',frames:[345,348,351,354,356],duration:2.1,back:.81,contact:1.21,follow:1.59,hipTurn:1,shoulderTurn:1.07,reach:1.14,armHeight:1.1,depth:1.08,dip:.012,forward:.02,stance:1.08,stagger:.035,finishLift:.11,balance:.01,focus:['长幅引拍','延伸击球点','高位结束']},
 {id:'karen-khachanov-forehand',name:'Karen Khachanov',order:21,video:'多人正手.mp4',frames:[360,363,366,369,372],duration:2.08,back:.8,contact:1.18,follow:1.59,hipTurn:1.08,shoulderTurn:1.1,reach:1.1,armHeight:1.08,depth:1.03,dip:.026,forward:.032,stance:1.14,stagger:.02,finishLift:.095,balance:.012,focus:['深幅引拍','开放站位','伸展随挥']},
 {id:'jakub-mensik-forehand',name:'Jakub Mensik',order:22,video:'多人正手.mp4',frames:[384,387,390,393,396],duration:2.02,back:.77,contact:1.15,follow:1.53,hipTurn:1.05,shoulderTurn:1.05,reach:1.1,armHeight:1.08,depth:1.05,dip:.026,forward:.035,stance:1.11,stagger:.025,finishLift:.09,balance:.014,focus:['长幅引拍','前侧击球','肩上随挥']},
 {id:'ignacio-buse-forehand',name:'Ignacio Buse',order:23,video:'多人正手.mp4',frames:[417,420,423,426,429],duration:1.96,back:.71,contact:1.09,follow:1.46,hipTurn:1,shoulderTurn:1.01,reach:.97,armHeight:.98,depth:.98,dip:.035,forward:.03,stance:1.04,stagger:.01,finishLift:.04,balance:.01,focus:['紧凑引拍','稳定支撑','快速回位']},
 {id:'felix-auger-aliassime-forehand',name:'Felix Auger-Aliassime',order:24,video:'多人正手.mp4',frames:[441,447,453,459,465],duration:2.02,back:.76,contact:1.15,follow:1.54,hipTurn:1.09,shoulderTurn:1.09,reach:1.09,armHeight:1.06,depth:1.04,dip:.032,forward:.04,stance:1.12,stagger:.02,finishLift:.095,balance:.018,focus:['宽站位','充分转体','高位随挥']},
];

const root=process.cwd();
const request=JSON.parse(fs.readFileSync(path.join(root,'spec/examples/forehand-study.request.json'),'utf8'));
const source=request.action.parameters.document as WorkshopDoc;
// The support arm is placed from SOLVED shoulders (it must follow the trunk
// turn), so the generator runs the production rig — same load as
// scripts/measure-player-forehands.mts.
const glb=fs.readFileSync(path.join(root,'public/models/human.glb'));
const gltf=await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const rig=new HumanRig(gltf.scene,JSON.parse(fs.readFileSync(path.join(root,'public/models/rig.json'),'utf8')) as RigInfo);
const restRoot=rig.rest.get('root')!;
const armLengths=(side:'L'|'R')=>({upper:rig.rest.get(`upperarm01_${side}`)!.distanceTo(rig.rest.get(`lowerarm01_${side}`)!),fore:rig.rest.get(`lowerarm01_${side}`)!.distanceTo(rig.rest.get(`wrist_${side}`)!)});
const v3=(a:{x:number;y:number;z:number})=>new Vector3(a.x,a.y,a.z);
const phaseWeights=[0,.72,1,.62,.24];
const dipWeights=[0,1,.34,.08,0];
const travelWeights=[0,.2,1,.58,.12];
const finishWeights=[0,0,0,1,.38];
const supportWeights=[0,.35,1,.72,.2];
// Follow-through/recovery elbow-pole clearance (see buildDoc).
const clearWeights=[0,0,.25,.75,1];
const leadFootPath=[0,1,1,.9,.68];
const rootStepPath=[0,.12,.4,.75,.35];
const swingLift=[0,.06,0,.045,0];
const floorY=.073646096;
const rootRestY=.941043915;
const rootRestZ=-.057132936;

function buildDoc(player:PlayerPreset):WorkshopDoc{
 let doc=normalizeDoc(structuredClone(source));
 if(player.side==='L')doc=mirrorDoc(doc);
 doc.id=player.id;doc.name=player.name;doc.english=player.name;
 doc.duration=player.duration;
 const dominant=player.side??'R';
 const handSide=dominant==='R'?'handR':'handL';
 const supportSide=dominant==='R'?'handL':'handR';
 const dominantSign=dominant==='R'?-1:1;
 const leadFoot=dominant==='R'?'L':'R';
 const step=player.step??(.075+Math.max(0,player.stance-1)*.055+player.dip*.12);
 const [ready,back,hit,follow,recover]=doc.keys;
 const times=[0,player.back,player.contact,player.follow,player.duration];
 for(let i=0;i<doc.keys.length;i++){
  const key=doc.keys[i];const pose=key.pose;const travel=travelWeights[i];
  key.id=`${player.id}-k${i}`;key.time=times[i];key.videoTime=player.frames[i];
  pose.yaw*=player.hipTurn;pose.chest*=player.shoulderTurn;pose.side*=player.shoulderTurn;
  pose.lean+=player.dip*100*([0,.14,.2,.1,0][i]);
  pose.root.y-=player.dip*dipWeights[i];
  pose.root.z+=player.forward*travel;
  pose.root.x+=player.forward*.18*travel;
  // The reference clips show short split/replace steps.  A planted run holds
  // its first contact by contract, so release the lead foot for the two
  // measured swing intervals and land it at a new ground contact.
  pose.root.z+=step*rootStepPath[i];
  for(const side of ['L','R'] as const){
   const foot=side==='L'?pose.footL:pose.footR;
   foot.target.x*=player.stance;foot.pole.x*=player.stance;
   foot.target.z+=(side==='L'?1:-1)*player.stagger;
   foot.yaw*=player.hipTurn;
   const key=doc.keys[i];
   const stepping=side===leadFoot;
   key.constraints[`plant${side}`]=!stepping||i%2===0;
   if(stepping&&i===0)foot.pitch+=2.5;
   if(stepping){
    const advance=step*leadFootPath[i];
    foot.target.z+=advance;
    foot.pole.z+=advance;
    if(!key.constraints[`plant${side}`]){
     foot.target.y+=swingLift[i];
     foot.pole.y+=swingLift[i]*.45;
    }
   }
  }
  const hand=pose[handSide],support=pose[supportSide];
  const supportPath=supportWeights[i];
  for(const point of [hand.target,hand.pole]){
   point.x=point.x*player.reach+dominantSign*player.balance*phaseWeights[i];
   point.y=1.1+(point.y-1.1)*player.armHeight+player.finishLift*finishWeights[i];
   point.z=.16+(point.z-.16)*player.depth+player.forward*.55*travel;
  }
  // The off-hand balances out in front of the trunk through load/contact;
  // previously every player inherited the same tucked hand from the seed.
  support.target.y+=.055*supportPath;
  support.target.z-=.2*supportPath;
  support.pole.y+=.025*supportPath;
  support.pole.z-=.096*supportPath;
  // Retarget the racket wrist through the contact window.  The racket remains
  // mounted to the solved wrist; these are authored task-space wrist goals.
  const contactPath=[0,.28,1,.5,.12][i];
  hand.target.y+=.12*contactPath;
  hand.target.z+=.045*contactPath;
  hand.pole.y+=.066*contactPath;
  hand.pole.z+=.0225*contactPath;
  support.target.x-=dominantSign*player.balance*.8*phaseWeights[i];
  support.pole.x-=dominantSign*player.balance*.35*phaseWeights[i];
  // The seed parks the elbow pole behind the trunk (z<0) while the wrist wraps
  // to the far side through follow-through and recovery. Scaled by reach and
  // armHeight that elbow can pass through the chest, so the pole moves forward
  // and keeps the elbow in front of the torso. Measured on the production skin
  // (scripts/measure-player-forehands.mts): removes the remaining arm–torso
  // crossings with the wrist residual unchanged.
  hand.pole.z+=.2*clearWeights[i];
 }
 // Arm choreography (scripts/lib/forehand-arms.mts), anchored on the SOLVED
 // shoulders so both arms follow the trunk turn. The racket arm's upper arm
 // goes DOWN first and then diagonally UP:
 //   racket arm  back: authored hand, elbow lifted · drop (added key): upper
 //               arm hanging down-back, racket head dropped · hit: straighten
 //               the authored contact direction (forearm catches up with the
 //               upper arm) · extend (added key): still straight, upper arm
 //               rising · fold (added key): half-way to the finish, chain
 //               space · follow: finish — upper arm above the shoulder line,
 //               forearm folded to the off shoulder, racket near vertical with
 //               the head above that shoulder · recover: held finish, settled
 //   off arm     back: guard across the chest · hit: tucked · extend/fold: on
 //               the way to the racket · follow/recover: catching the throat
 const offSide=dominant==='R'?'L':'R';
 const racketArmOpt={contactReach:.98,finishLift:player.finishLift};
 const frameAtKey=(time:number)=>{solveEffectiveFrame(rig,frameAt(doc,time,restRoot));return torsoFrame(dominant,rig.point(`upperarm01_${dominant}`),rig.point(`upperarm01_${offSide}`));};
 const racketPhase:(('takeback'|'contact'|'finish'|'settle')|undefined)[]=[undefined,'takeback','contact','finish','settle'];
 const offPhase:(('guard'|'tuck'|'catch')|undefined)[]=[undefined,'guard','tuck','catch','catch'];
 doc.keys.forEach((key,i)=>{
  const f=frameAtKey(key.time);
  const hand:HandLike=key.pose[handSide],support:HandLike=key.pose[supportSide];
  const rp=racketPhase[i];
  if(rp)blendHand(hand,racketArm(rp,f,armLengths(dominant),hand,racketArmOpt),1);
  const op=offPhase[i];
  if(op)blendHand(support,offArm(op,f,armLengths(offSide),{wrist:v3(hand.target),axis:handAxis(hand,dominant)}),1);
  // Ready: the seed's tucked hand sits behind the guard's elbow line; the
  // ready→guard interpolation then sweeps the upper arm across the pec on
  // the deeper, faster presets (Alcaraz). Carry the ready hand 35 % toward
  // the guard — still a relaxed ready, but the elbow already out.
  else if(i===0)blendHand(support,offArm('guard',f,armLengths(offSide)),.35);
 });
 // Two authored waypoints between contact and the finish. 延伸: the arm
 // stays nearly straight after the ball instead of folding on the chord
 // between the keys. 折肘: the fold half-way, computed in chain space so the
 // elbow travels an arc in front of the chest (a wrist-position chord lets
 // the two-bone solve pull the upper arm through the pec); the off hand is
 // on its way to the throat with its elbow swung out.
 const waypoints:{label:string;at:number;racket:(f:ReturnType<typeof frameAtKey>,hand:HandLike)=>void;off:number}[]=[
  {label:'延伸',at:.3,racket:(f,hand)=>blendHand(hand,racketArm('extend',f,armLengths(dominant),hand,racketArmOpt),1),off:.25},
  {label:'折肘',at:.65,racket:(f,hand)=>blendHand(hand,racketPath('extend','finish',.5,f,armLengths(dominant),hand,racketArmOpt),1),off:.65},
 ];
 const inserted=waypoints.map((wp,n)=>{
  const time=player.contact+(player.follow-player.contact)*wp.at;
  const frame=frameAt(doc,time,{x:0,y:rootRestY,z:rootRestZ});
  const pose=structuredClone(frame.pose);
  const f=frameAtKey(time);
  const hand:HandLike=pose[handSide],support:HandLike=pose[supportSide];
  wp.racket(f,hand);
  blendHand(support,offReach(f,armLengths(offSide),{wrist:v3(hand.target),axis:handAxis(hand,dominant)},wp.off),1);
  return {id:`${player.id}-fold${n}`,time,label:wp.label,pose,constraints:{...frame.constraints}};
 });
 doc.keys.splice(3,0,...inserted);
 // Takeback → contact in chain space. The shoulder takes the UPPER ARM down
 // first (the drop, bottom of the C — racket head below the hand) and then
 // diagonally up into the ball; the forearm opens only through the last
 // part. Waypoints are chain-space samples (scripts/lib/forehand-arms.mts
 // racketPath) so every key carries an exact elbow pole: lerping the
 // takeback and drop poles across the moving chord flipped the hinge
 // (measured 95–119 rad/s on the upper arm at 0.8–1.1 s on every preset).
 // The swing key doubles as the stepping foot's toe-clearance waypoint (a
 // release key inherits the planted foot's orientation; without an unplanted
 // key after it the model has no writable foot-angle waypoint in the swing).
 const swingTime=player.back+Math.min(.12,(player.contact-player.back)*.2);
 const span=player.contact-player.back;
 const through=[
  {id:'swing',label:'摆步',time:swingTime,from:'takeback' as const,to:'drop' as const},
  {id:'drop',label:'落拍',time:player.back+span*.5,from:'takeback' as const,to:'drop' as const},
  {id:'fwd1',label:'前挥',time:player.back+span*.68,from:'drop' as const,to:'contact' as const},
  {id:'fwd2',label:'近球',time:player.back+span*.85,from:'drop' as const,to:'contact' as const},
 ];
 const dropTime=player.back+span*.5;
 for(const wp of through){
  const frame=frameAt(doc,wp.time,{x:0,y:rootRestY,z:rootRestZ});
  const pose=structuredClone(frame.pose);
  if(wp.id==='swing'){const foot=leadFoot==='L'?pose.footL:pose.footR;foot.pitch+=12;}
  const f=frameAtKey(wp.time);
  const w=wp.from==='takeback'?(wp.time-player.back)/(dropTime-player.back):(wp.time-dropTime)/(player.contact-dropTime);
  const authored:HandLike=wp.from==='takeback'?back.pose[handSide]:hit.pose[handSide];
  blendHand(pose[handSide],racketPath(wp.from,wp.to,w,f,armLengths(dominant),authored,racketArmOpt),1);
  blendHand(pose[supportSide],offTransition(f,offArm('guard',f,armLengths(offSide)),offArm('tuck',f,armLengths(offSide)),(wp.time-player.back)/span),1);
  doc.keys.push({id:`${player.id}-${wp.id}`,time:wp.time,label:wp.label,pose,constraints:{...frame.constraints}});
 }
 doc.keys.sort((a,b)=>a.time-b.time);
 return normalizeDoc(doc);
}

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
  description:'以工作台正手基准为种子，按该球员视频关键帧的时序与站位、引拍、随挥幅度参数化生成；触球时持拍臂近直、随挥折肘把球拍带到非持拍肩前、拍头竖直于肩上方，非持拍臂引拍护在身前、随挥在拍喉接住球拍。手臂目标不来自视频关键点，未估计单目深度或球拍朝向。',
  method:'工作台正手种子 · 参数化变体（视频关键帧仅作时序参考）',focus:player.focus,
  phases:[{time:0,label:'准备'},{time:player.back,label:'引拍'},{time:player.contact,label:'击球区'},{time:player.follow,label:'随挥'},{time:player.duration,label:'恢复'}],
  notes:[`参考 ${player.video} @ ${excerpt}；关键帧秒数：${frames}。${duplicateNote}`,'手臂目标是种子动作的参数化缩放，不映射 2D 关键点：未标定单目视频的关节点无法决定三维手臂目标，此前的映射把持拍臂折进躯干（见 docs/reports/forehand-video-retargeting.md）。脚步是带摆动中点的骨架内近似；深度、手腕朝向与球拍姿态仍是近似，未将视频帧或模型写入动作资产。'],
  license:'Project-authored motion approximation; source video frames are not redistributed.',oneShot:true,
  capabilities:{prop:{kind:'racket',trail:true,handView:true,...(player.side?{side:player.side}:{})}},
  document:buildDoc(player),
 };
 const file=path.join(root,'assets/motions',`${player.id}.json`);
 fs.writeFileSync(file,`${JSON.stringify(envelope,null,2)}\n`);
 console.log(`wrote ${path.relative(root,file)}`);
}
