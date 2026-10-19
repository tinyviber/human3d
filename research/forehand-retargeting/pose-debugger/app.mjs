import {FilesetResolver,PoseLandmarker} from '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';

const $=id=>document.getElementById(id);
const status=$('status'),score=$('score');
const names=['nose','leftShoulder','rightShoulder','leftElbow','rightElbow','leftWrist','rightWrist','leftHip','rightHip','leftKnee','rightKnee','leftAnkle','rightAnkle','leftHeel','rightHeel','leftFootIndex','rightFootIndex'];
const selected=[{i:11,n:'左肩'},{i:12,n:'右肩'},{i:13,n:'左肘'},{i:14,n:'右肘'},{i:15,n:'左腕'},{i:16,n:'右腕'},{i:23,n:'左髋'},{i:24,n:'右髋'},{i:25,n:'左膝'},{i:26,n:'右膝'},{i:27,n:'左踝'},{i:28,n:'右踝'},{i:29,n:'左脚跟'},{i:30,n:'右脚跟'},{i:31,n:'左脚尖'},{i:32,n:'右脚尖'}];
const links=[[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[12,14],[14,16],[16,18],[16,20],[16,22],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[27,31],[24,26],[26,28],[28,30],[28,32]];
let landmarker;
try{
 const wasm=await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
 landmarker=await PoseLandmarker.createFromOptions(wasm,{baseOptions:{modelAssetPath:'/models/pose_landmarker_lite.task'},runningMode:'IMAGE',numPoses:1,outputSegmentationMasks:false});
 status.textContent='模型就绪。素材只在本地浏览器内处理。';
}catch(e){status.textContent=`模型加载失败：${e.message}`;throw e;}

function drawPose(canvas,source,image,pose,color){
 canvas.width=source.videoWidth||source.naturalWidth||source.width;canvas.height=source.videoHeight||source.naturalHeight||source.height;
 const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,canvas.width,canvas.height);
 if(!pose)return;
 const pt=i=>pose[i]&&pose[i].visibility>=.18?[pose[i].x*canvas.width,pose[i].y*canvas.height]:null;
 ctx.lineWidth=Math.max(2,canvas.width/500);ctx.strokeStyle=color;ctx.fillStyle=color;
 for(const [a,b] of links){const p=pt(a),q=pt(b);if(!p||!q)continue;ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.stroke();}
 for(const {i} of selected){const p=pt(i);if(!p)continue;ctx.beginPath();ctx.arc(p[0],p[1],Math.max(3,canvas.width/180),0,Math.PI*2);ctx.fill();}
}
function loadImage(file){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=URL.createObjectURL(file);});}
function seek(video,t){return new Promise((resolve,reject)=>{const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(Error('无法读取视频帧'));},cleanup=()=>{video.removeEventListener('seeked',done);video.removeEventListener('error',fail);};video.addEventListener('seeked',done,{once:true});video.addEventListener('error',fail,{once:true});video.currentTime=Math.min(Math.max(0,t),Math.max(0,video.duration-.001));});}
async function drawInput(file,canvasId,time,isReference){
 const canvas=$(canvasId);let source,poseResult;
 if(file.type.startsWith('video/')){
  const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=URL.createObjectURL(file);
  await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('无法读取视频'));});
  await seek(video,time);source=video;poseResult=landmarker.detect(video);video.pause();
 }else{
  source=await loadImage(file);poseResult=landmarker.detect(source);
 }
 const pose=poseResult.landmarks?.[0]??null;drawPose(canvas,source,null,pose,isReference?'#54e58b':'#40d9ff');
 return {pose,world:poseResult.worldLandmarks?.[0]??null,width:source.videoWidth||source.naturalWidth||source.width,height:source.videoHeight||source.naturalHeight||source.height};
}
function torsoNormalized(pose){
 if(!pose)return null;
 const mid=(a,b)=>({x:(pose[a].x+pose[b].x)/2,y:(pose[a].y+pose[b].y)/2});
 const hip=mid(23,24),shoulder=mid(11,12),dx=shoulder.x-hip.x,dy=shoulder.y-hip.y,len=Math.hypot(dx,dy);
 if(!Number.isFinite(len)||len<.01)return null;
 const theta=Math.atan2(dx,-dy),c=Math.cos(theta),s=Math.sin(theta);
 return pose.map(p=>{const x=p.x-hip.x,y=p.y-hip.y;return{x:(x*c+y*s)/len,y:(-x*s+y*c)/len,visibility:p.visibility??1};});
}
function compare(a,b){
 const aa=torsoNormalized(a),bb=torsoNormalized(b);if(!aa||!bb)return {text:'姿态点不足，未计算分数。',errors:{}};
 const names={11:'左肩',12:'右肩',13:'左肘',14:'右肘',15:'左腕',16:'右腕',23:'左髋',24:'右髋',25:'左膝',26:'右膝',27:'左踝',28:'右踝',29:'左脚跟',30:'右脚跟',31:'左脚尖',32:'右脚尖'};
 const errors={};let sum=0,n=0;
 for(const [i,name] of Object.entries(names)){if((aa[i].visibility??1)<.18||(bb[i].visibility??1)<.18)continue;const d=Math.hypot(aa[i].x-bb[i].x,aa[i].y-bb[i].y);errors[name]=d;sum+=d;n++;}
 const arm=[13,14,15,16],foot=[25,26,27,28,29,30,31,32];
 const mean=ids=>{const vals=ids.map(i=>errors[names[i]]).filter(Number.isFinite);return vals.length?vals.reduce((x,y)=>x+y,0)/vals.length:null;};
 const armMean=mean(arm),footMean=mean(foot),all=n?sum/n:null;
 const fmt=x=>x==null?'n/a':`${x.toFixed(3)} × 肩髋中点距离`;
 return {errors,text:`Torso-normalized 2D landmark error (lower is closer)\nArms: ${fmt(armMean)}\nLegs/feet: ${fmt(footMean)}\nAll tracked joints: ${fmt(all)}\n\nPer point:\n${Object.entries(errors).map(([name,d])=>`${name.padEnd(5)} ${d.toFixed(3)}`).join('\n')}\n\n注意：此分数只比较二维骨架；相机方向、遮挡和模型对无纹理人体的置信度会影响结果。`};
}
window.__POSE_COMPARE__={last:null,analyze:null};
window.__POSE_COMPARE__.extractVideo=async(file,times)=>{
 const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=URL.createObjectURL(file);
 await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('无法读取视频'));});
 const rows=[];
 for(const time of times){await seek(video,time);const result=landmarker.detect(video);rows.push({time,landmarks:result.landmarks?.[0]??null,worldLandmarks:result.worldLandmarks?.[0]??null});}
 video.pause();return {duration:video.duration,width:video.videoWidth,height:video.videoHeight,rows};
};
async function analyze(){
 const a=$('referenceFile').files[0],b=$('generatedFile').files[0];if(!a||!b){status.textContent='请先选择参考素材和 h3d 截图。';return;}
 $('analyze').disabled=true;status.textContent='正在检测两张图像…';
 try{
  const time=Number($('referenceTime').value)||0;
  const ref=await drawInput(a,'referenceCanvas',time,true),gen=await drawInput(b,'generatedCanvas',0,false);
  const result=compare(ref.pose,gen.pose);
  score.textContent=result.text;window.__POSE_COMPARE__.last={time,reference:ref,generated:gen,errors:result.errors};
  status.textContent=ref.pose&&gen.pose?'检测完成；参考帧和 h3d 截图都识别到姿态。':`检测结束：参考 ${ref.pose?'OK':'未识别'}，h3d ${gen.pose?'OK':'未识别'}。`;
 }catch(e){status.textContent=`检测失败：${e.message}`;score.textContent=e.stack??String(e);}finally{$('analyze').disabled=false;}
}
$('analyze').addEventListener('click',analyze);
window.__POSE_COMPARE__.analyze=analyze;
