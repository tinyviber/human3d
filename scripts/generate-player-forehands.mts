import fs from 'node:fs';
import path from 'node:path';
import {frameAt,mirrorDoc,normalizeDoc,type WorkshopDoc} from '@human3d/motion-core';

type PlayerPreset={
 id:string;name:string;order:number;side?:'L';video:string;frames:[number,number,number,number,number];
 duration:number;back:number;contact:number;follow:number;
 hipTurn:number;shoulderTurn:number;reach:number;armHeight:number;depth:number;
 dip:number;forward:number;stance:number;stagger:number;finishLift:number;balance:number;
 step?:number;
 focus:[string,string,string];
};
type ImageJoint={x:number;y:number;confidence:number};
type PlayerLandmarkData={profiles:Record<string,{frames:{time:number;joints:Record<string,ImageJoint>}[]}>};

/** Source keyframes were extracted from the user-provided clips. The paired
 * MediaPipe Lite landmarks are 2D image coordinates retargeted onto the same
 * rig; they are camera-space approximations, not 3D motion capture. */
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
const landmarkData=JSON.parse(fs.readFileSync(path.join(root,'scripts/player-forehand-landmarks.json'),'utf8')) as PlayerLandmarkData;
const phaseWeights=[0,.72,1,.62,.24];
const dipWeights=[0,1,.34,.08,0];
const travelWeights=[0,.2,1,.58,.12];
const finishWeights=[0,0,0,1,.38];
const supportWeights=[0,.35,1,.72,.2];
const leadFootPath=[0,1,1,.9,.68];
const rootStepPath=[0,.12,.4,.75,.35];
const swingLift=[0,.06,0,.045,0];
const floorY=.073646096;
const rootRestY=.941043915;
const rootRestZ=-.057132936;
const rigTorsoLength=.475;

function point(joints:Record<string,ImageJoint>,name:string,minConfidence=.2){
 const p=joints[name];return p&&p.confidence>=minConfidence?p:null;
}
function midpoint(a:ImageJoint,b:ImageJoint){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2,confidence:Math.min(a.confidence,b.confidence)};}
function mappedPoint(p:ImageJoint,hip:ImageJoint,scale:number,rootY:number,rootZ:number,side:'L'|'R'){
 return{x:side==='L'?.19:-.19,y:rootY+(hip.y-p.y)*scale,z:rootZ+(p.x-hip.x)*scale};
}
function blendPoint(target:{x:number;y:number;z:number},mapped:{x:number;y:number;z:number},amount:number){
 target.x+=(mapped.x-target.x)*amount;target.y+=(mapped.y-target.y)*amount;target.z+=(mapped.z-target.z)*amount;
}

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
 const track=landmarkData.profiles[player.id];
 if(!track||track.frames.length!==5)throw new Error(`Missing five-frame pose landmark data for ${player.id}`);
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

  // Fit wrist/elbow task-space goals to the same 2D landmarks used by the
  // standalone visual comparator. Shoulder-to-hip length normalizes zoom and
  // body size per frame. The source camera is uncalibrated, so lower-body
  // landmarks remain diagnostic input rather than absolute 3D targets.
  const joints=track.frames[i].joints;
  const hip=midpoint(joints.leftHip,joints.rightHip);
  const shoulder=midpoint(joints.leftShoulder,joints.rightShoulder);
  const torsoLength=Math.hypot(shoulder.x-hip.x,shoulder.y-hip.y);
  const scale=Math.min(3.6,Math.max(1.25,rigTorsoLength/Math.max(.12,torsoLength)));
  const rootY=rootRestY+pose.root.y;
  const rootZ=rootRestZ+pose.root.z;

  for(const side of ['L','R'] as const){
   const anatomical=side==='L'?'left':'right';
   const target=point(joints,`${anatomical}Wrist`),elbow=point(joints,`${anatomical}Elbow`);
   if(target&&elbow){
    const arm=side==='L'?pose.handL:pose.handR;
    const confidence=Math.min(.95,target.confidence,elbow.confidence);
    blendPoint(arm.target,mappedPoint(target,hip,scale,rootY,rootZ,side),confidence);
    blendPoint(arm.pole,mappedPoint(elbow,hip,scale,rootY,rootZ,side),confidence);
   }
  }
 }
 // Keyframe labels and time grid are kept aligned with the envelope's phase markers.
 [ready.label,back.label,hit.label,follow.label,recover.label]=['准备','引拍','触球','随挥','恢复'];
 // Add one authored mid-swing waypoint so the stepping foot can rotate into
 // toe-clearance after liftoff. A release key intentionally inherits the
 // planted foot's orientation at its instant; without an unplanted key after
 // it, the model has no writable foot-angle waypoint during swing.
 const swingTime=player.back+Math.min(.12,(player.contact-player.back)*.2);
 const swingFrame=frameAt(doc,swingTime,{x:0,y:rootRestY,z:rootRestZ});
 const swingPose=structuredClone(swingFrame.pose);
 const swingFoot=leadFoot==='L'?swingPose.footL:swingPose.footR;
 swingFoot.pitch+=12;
 doc.keys.splice(2,0,{id:`${player.id}-swing`,time:swingTime,label:'摆步',pose:swingPose,constraints:{...swingFrame.constraints}});
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
  description:'按视频关键帧的 MediaPipe 2D 人体点映射到项目骨架并重建为正手；未估计单目深度或球拍朝向。',
  method:'MediaPipe 2D 关键点重定向 · 摄像机空间近似',focus:player.focus,
  phases:[{time:0,label:'准备'},{time:player.back,label:'引拍'},{time:player.contact,label:'击球区'},{time:player.follow,label:'随挥'},{time:player.duration,label:'恢复'}],
  notes:[`参考 ${player.video} @ ${excerpt}；关键帧秒数：${frames}。${duplicateNote}`,'肘腕目标来自独立本地工具提取的 2D MediaPipe 关键点；脚步是带摆动中点的骨架内近似，不把未标定的髋踝像素直接当成 3D 目标。深度、手腕朝向与球拍姿态仍是近似，未将视频帧或模型写入动作资产。'],
  license:'Project-authored motion approximation; source video frames are not redistributed.',oneShot:true,
  capabilities:{prop:{kind:'racket',trail:true,handView:true,...(player.side?{side:player.side}:{})}},
  document:buildDoc(player),
 };
 const file=path.join(root,'assets/motions',`${player.id}.json`);
 fs.writeFileSync(file,`${JSON.stringify(envelope,null,2)}\n`);
 console.log(`wrote ${path.relative(root,file)}`);
}
