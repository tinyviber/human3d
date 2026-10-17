import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.QA_BROWSER_CHANNEL?{channel:process.env.QA_BROWSER_CHANNEL}:{})});
let svc; // spawned pose service (if not already running); killed in finally
try {
const page=await browser.newPage({viewport:{width:1536,height:1024},deviceScaleFactor:1});
const errors=[],warnings=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>window.__LAB__?.ready,{timeout:60000});await page.locator('.loading-state').waitFor({state:'hidden'});
assert.match(await page.title(),/KINESIS/);assert.equal(await page.locator('.motion-row').count(),8);assert.equal(await page.locator('vite-error-overlay').count(),0);
const names={idle:'自然站立',walk:'行走',reach:'抬手与转身',squat:'下蹲',ready:'持拍准备',forehand:'正手挥拍'};
async function choose(id,t=0,view='front'){
 await page.locator('.motion-row').filter({hasText:names[id]}).click();
 await page.evaluate(t=>{window.__LAB__.setPlaying(false);window.__LAB__.seek(t);},t);
 const views={front:'正面',side:'侧面',back:'背面',threeQuarter:'45°',hand:'手部特写'};
 if(view==='hand')await page.getByRole('button',{name:views[view],exact:true}).click();else await page.locator('.camera-toolbar').getByRole('button',{name:views[view],exact:true}).click();
 await page.waitForTimeout(250);assert.equal(await page.locator('.viewport-heading h2').textContent(),names[id]);
}
const poses=[['idle',0,'front','front'],['idle',0,'side','side'],['idle',0,'back','back'],['walk',.34,'threeQuarter','walk'],['reach',2.7,'front','reach'],['squat',2.7,'side','squat-side'],['squat',2.7,'front','squat'],['ready',0,'threeQuarter','ready'],['ready',0,'hand','grip'],['forehand',1.3,'threeQuarter','backswing'],['forehand',2.55,'front','contact'],['forehand',3.35,'threeQuarter','follow-through']];
const result={date:'2026-10-17',browser:await browser.version(),viewport:[1536,1024],poses:[],checks:{}};
for(const [id,t,view,name]of poses){await choose(id,t,view);await page.screenshot({path:`evidence/${name}.png`});result.poses.push({id,t,view,file:`${name}.png`,metrics:await page.evaluate(()=>window.__LAB__.diagnostics())});}
await choose('squat',2.7,'threeQuarter');
for(const label of ['骨骼与关节','关节坐标轴','IK 端点']){await page.getByRole('switch',{name:label,exact:true}).click();assert.equal(await page.getByRole('switch',{name:label,exact:true}).getAttribute('aria-checked'),'true');}
await page.waitForTimeout(250);await page.screenshot({path:'evidence/debug.png'});
await page.getByRole('switch',{name:'人体表面',exact:true}).click();await page.screenshot({path:'evidence/skeleton.png'});
assert.equal(await page.evaluate(()=>{let visible=false;window.__LAB__.model.traverse(o=>{if(o.isSkinnedMesh&&o.visible)visible=true;});return visible;}),false);
for(const label of ['人体表面','骨骼与关节','关节坐标轴','IK 端点'])await page.getByRole('switch',{name:label,exact:true}).click();
result.checks.debug=true;
await choose('idle',0,'front');await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForTimeout(300);assert((await page.evaluate(()=>window.__LAB__.time))>.1);
await page.getByRole('button',{name:'暂停',exact:true}).click();const before=await page.evaluate(()=>window.__LAB__.time);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.__LAB__.time),before);result.checks.pause=true;
await page.getByLabel('播放速度',{exact:true}).fill('1.75');assert.equal(await page.evaluate(()=>window.__LAB__.speed),1.75);result.checks.speed=true;
await page.getByLabel('动作进度',{exact:true}).fill('2.4');assert(Math.abs((await page.evaluate(()=>window.__LAB__.time))-2.4)<.001);result.checks.seek=true;
// The reset starts playing immediately; allow automation/render latency, while
// requiring a clear reset from the previous 2.4s position.
await page.getByRole('button',{name:'重播',exact:true}).click();assert((await page.evaluate(()=>window.__LAB__.time))<1);result.checks.replay=true;
await page.getByRole('switch',{name:'循环播放',exact:true}).click();await page.evaluate(()=>{const e=window.__LAB__;e.speed=1;e.seek(4.7);e.setPlaying(true);});await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.__LAB__.playing),false);assert((await page.evaluate(()=>window.__LAB__.time))>4.79);result.checks.singlePlayback=true;
await page.getByRole('switch',{name:'循环播放',exact:true}).click();await page.getByLabel('播放速度',{exact:true}).fill('1');
// Real pointer orbit and wheel zoom, while preserving animation time.
await choose('idle',0,'front');const canvas=page.locator('canvas'),bounds=await canvas.boundingBox();const oldCam=await page.evaluate(()=>window.__LAB__.camera.position.toArray());
await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+bounds.height*.53,{steps:12});await page.mouse.up();await page.mouse.wheel(0,-170);await page.waitForTimeout(300);assert.notDeepEqual(await page.evaluate(()=>window.__LAB__.camera.position.toArray()),oldCam);result.checks.orbitZoom=true;
await page.getByRole('button',{name:'资料与许可'}).click();assert(await page.locator('dialog').isVisible());assert.match(await page.locator('dialog').innerText(),/CC0/);await page.getByRole('button',{name:'关闭',exact:true}).click();result.checks.sources=true;
// Sample the real per-source state (including interpolation) for numerical review.
result.samples=await page.evaluate(()=>{const e=window.__LAB__,out={};for(const id of ['idle','walk','reach','squat','ready','forehand']){e.setMotion(id,false);e.setPlaying(false);const d=e.source.duration,frames=[];for(let i=0;i<80;i++){e.seek(i/80*d);frames.push({time:i/80*d,...e.diagnostics()});}out[id]=frames;}return out;});
for(const [id,samples]of Object.entries(result.samples)){assert(samples.every(s=>s.knee<=135.1&&s.elbow<=145.1));if(id==='forehand')assert(samples.every(s=>s.gripError<1e-8));}
result.checks.motionSamples=true;
// Responsive surface, including controls that move below the main canvas.
await page.setViewportSize({width:390,height:844});await choose('ready',0,'front');await page.screenshot({path:'evidence/mobile.png'});await page.locator('.inspector').scrollIntoViewIfNeeded();await page.screenshot({path:'evidence/mobile-settings.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);result.checks.mobileOverflow=false;
await page.setViewportSize({width:1366,height:900});await choose('idle',0,'front');await page.screenshot({path:'evidence/laptop.png'});
await page.setViewportSize({width:1536,height:1024});await choose('forehand',0,'threeQuarter');
await page.getByRole('switch',{name:'球拍运动轨迹',exact:true}).click();await page.evaluate(()=>{window.__LAB__.loop=false;window.__LAB__.speed=1;});
// Record the live WebGL canvas at 30fps, without synthetic frame generation.
const recorded=await page.evaluate(async()=>{const e=window.__LAB__,stream=e.renderer.domElement.captureStream(30);const type=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';const recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:4500000}),chunks=[];recorder.ondataavailable=ev=>chunks.push(ev.data);const done=new Promise(resolve=>recorder.onstop=async()=>{const data=await new Blob(chunks,{type:'video/webm'}).arrayBuffer();stream.getTracks().forEach(t=>t.stop());resolve(Array.from(new Uint8Array(data)));});recorder.start();e.replay();const poll=setInterval(()=>{if(!e.playing){clearInterval(poll);setTimeout(()=>recorder.stop(),200);}},50);setTimeout(()=>{if(recorder.state==='recording'){clearInterval(poll);recorder.stop();}},15000);return done;});
fs.writeFileSync('evidence/forehand.webm',Buffer.from(recorded));result.checks.liveVideo=true;
// --- Pose-package E2E: the real service solves a real package, delivered
// through the real file input, decoded by the lab's PosePackageSource.
try{await fetch('http://127.0.0.1:8788/v1/capabilities');}
catch{
 const {spawn}=await import('node:child_process');
 svc=spawn('npx',['tsx','src/server/serve.ts'],{stdio:'ignore'});
 for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:8788/v1/capabilities');break;}catch{await new Promise(r=>setTimeout(r,300));if(i===99){svc.kill();throw new Error('motion service did not start on 127.0.0.1:8788');}}}
}
const pkgResponse=await fetch('http://127.0.0.1:8788/v1/motions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:{id:'idle'}})});
assert.equal(pkgResponse.status,200,'POST /v1/motions should return a pose package');
const pkg=await pkgResponse.json();
assert.equal(pkg.kind,'pose-package');assert.equal(pkg.rig.bones,163);
await page.locator('input[type=file]').setInputFiles({name:'idle.pose.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pkg))});
await page.waitForTimeout(300);
// The temp entry joins the list: 8 bundled motions + the opened package.
assert.equal(await page.locator('.motion-row').count(),9);
assert.equal(await page.locator('.viewport-heading h2').textContent(),'idle');
const pkgDiag=await page.evaluate(()=>{const e=window.__LAB__;e.setPlaying(false);e.seek(1.2);return {diagnostics:e.diagnostics(),status:e.source.status,error:e.source.error};});
assert.equal(pkgDiag.status,'ready');assert.equal(pkgDiag.diagnostics.bones,163);assert(pkgDiag.diagnostics.root.every(Number.isFinite),'pose-package root must be finite');
await page.screenshot({path:'evidence/pose-package.png'});result.checks.posePackage=true;
await choose('idle',0,'front'); // restore a bundled motion before the workshop section
// NOTE: svc stays up — the workshop export assertions below POST the same
// document to the real service for the byte-parity check.
// --- Workshop E2E: real pointer drag → save → reload keeps the edited pose.
await page.goto('http://127.0.0.1:5173/workshop.html');
await page.waitForFunction(()=>window.__WS__?.ready,{timeout:60000});
assert.equal(await page.locator('.ws-key').count(),5);
assert.equal(await page.locator('canvas').count(),1);
await page.locator('.ws-newname').fill('QA 测试动作');
await page.getByRole('button',{name:'新建',exact:true}).click();
assert.equal(await page.locator('.ws-key').count(),2);
const handScreen=await page.evaluate(()=>{
 const e=window.__WS__;e.setPlaying(false);e.seek(0);
 const p=e.rig.point('wrist_R').project(e.camera);
 const r=e.renderer.domElement.getBoundingClientRect();
 return {x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};
});
const seedTarget=await page.evaluate(()=>JSON.parse(localStorage.getItem('kinesis-workshop-library')).docs.find(d=>d.name==='QA 测试动作').keys[0].pose.handR.target);
await page.mouse.move(handScreen.x,handScreen.y);await page.mouse.down();
await page.mouse.move(handScreen.x+60,handScreen.y-90,{steps:8});await page.mouse.up();
const moved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kinesis-workshop-library')).docs.find(d=>d.name==='QA 测试动作').keys[0].pose.handR.target);
assert(Math.hypot(moved.x-seedTarget.x,moved.y-seedTarget.y,moved.z-seedTarget.z)>.005,'drag edit was not persisted to storage');
const wristBefore=await page.evaluate(()=>{const e=window.__WS__;e.setPlaying(false);e.seek(0);return e.rig.point('wrist_R').toArray();});
await page.reload();await page.waitForFunction(()=>window.__WS__?.ready,{timeout:60000});
const libNames=await page.locator('.ws-lib-row .ws-lib-name span').allTextContents();
assert(libNames.some(n=>n.includes('QA 测试动作')));
// Reloading must restore the dragged wrist pose, not just the motion name:
// verify the persisted document, the live in-memory doc AND the solved bone
// position all match the pre-reload edit.
const persisted=await page.evaluate(()=>JSON.parse(localStorage.getItem('kinesis-workshop-library')).docs.find(d=>d.name==='QA 测试动作').keys[0].pose.handR.target);
assert.deepEqual(persisted,moved,'stored handR.target changed across reload — drag edit was not persisted');
// The workshop auto-plays on load: pin the playhead to t=0 before reading the
// wrist position, or a slow machine reads a frame after the compare pose.
const live=await page.evaluate(()=>{const e=window.__WS__;e.setPlaying(false);e.seek(0);return {target:e.getDoc().keys[0].pose.handR.target,wrist:e.rig.point('wrist_R').toArray()};});
assert.deepEqual(live.target,moved,'live doc handR.target differs from the persisted edit');
assert(live.wrist.every((v,i)=>Math.abs(v-wristBefore[i])<.01),'solved wrist position changed across reload');
result.checks.workshopDragPersist=true;
// --- Workshop pose-package export: the in-browser builder must download a
// package that matches what POST /v1/motions {workshop-doc} serves — field
// by field (strings/structure exact, solved floats to ~1e-12; see below) —
// so the real service stays alive through this block for the peer comparison.
// This runs BEFORE the foot/swing edits below on purpose: those edits leave
// the document in a state the semantic validator rejects (the pelvis
// correction releasing mid-swing overshoots the root-acceleration limit —
// verified: 45.7 m/s² > 40), and a 422 artifact rightly has no download.
// The QA document id is random — the artifact id is compared to the service
// response, never asserted against a constant.
const wsExportFps=Number(await page.getByLabel(/采样率/).inputValue());
const [download]=await Promise.all([
 page.waitForEvent('download'),
 page.getByRole('button',{name:'导出姿态包',exact:true}).click(),
]);
const exportedText=fs.readFileSync(await download.path(),'utf8');
const exported=JSON.parse(exportedText);
const wireConsts=await page.evaluate(async()=>{const m=await import('/src/core/package-const.ts');return {kind:m.POSE_PACKAGE_KIND,schemaVersion:m.POSE_PACKAGE_SCHEMA_VERSION};});
assert.equal(exported.kind,wireConsts.kind);
assert.equal(exported.schemaVersion,wireConsts.schemaVersion);
assert.equal(exported.timeline.timestamps.at(-1),exported.timeline.duration,'last timestamp is not exactly duration');
// The download name is content-addressed: <docId>.<artifactId>.pose.json.
const wsDoc=await page.evaluate(()=>window.__WS__.getDoc());
assert.equal(download.suggestedFilename(),`${wsDoc.id}.${exported.id}.pose.json`,'download filename is not the content-addressed name');
// The lab decoder's own structural check must accept the exported package.
const shapeProblems=await page.evaluate(async pkg=>{
 const {checkPosePackageShape}=await import('/src/core/motion-source.ts');
 return checkPosePackageShape(pkg,new Set(window.__WS__.rig.bones.keys()));
},exported);
assert.deepEqual(shapeProblems,[],`shape check rejected the exported package: ${shapeProblems[0]??''}`);
// Peer parity: the same document through the real service must produce the
// same body — id, fingerprint, tracks, events and quality included.
// Structure, array lengths and every string field (artifact id, hashes,
// codes, labels) compare EXACTLY. Finite numbers get a small relative
// tolerance: the two solves run on two V8 builds (the page's Chrome vs this
// Node's), and ECMAScript does not pin transcendental functions to identical
// last ulps — observed drift is ~1e-17 on quaternion components. The
// same-engine byte-identity half of this contract is pinned separately by
// src/core/package-export.test.ts (buildPosePackageLocal vs handleRequest
// under one Node process, toEqual on the full body).
const peerResponse=await fetch('http://127.0.0.1:8788/v1/motions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:{id:'workshop-doc',parameters:{document:wsDoc}},sample:{fps:wsExportFps}})});
assert.equal(peerResponse.status,200,'service POST /v1/motions rejected the workshop document');
const peerPkg=await peerResponse.json();
const nearEqual=(a,b,path='$')=>{
 if(typeof a==='number'||typeof b==='number')return (typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=1e-12*Math.max(1,Math.abs(a),Math.abs(b)))?null:`${path}: ${a} != ${b}`;
 if(typeof a!==typeof b)return `${path}: ${typeof a} != ${typeof b}`;
 if(Array.isArray(a)||Array.isArray(b)){if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return `${path}: array shape differs`;for(let i=0;i<a.length;i++){const r=nearEqual(a[i],b[i],`${path}[${i}]`);if(r)return r;}return null;}
 if(a&&b&&typeof a==='object'){const ka=Object.keys(a),kb=Object.keys(b);if(ka.length!==kb.length||ka.some(k=>!(k in b)))return `${path}: object keys differ`;for(const k of ka){const r=nearEqual(a[k],b[k],`${path}.${k}`);if(r)return r;}return null;}
 return Object.is(a,b)?null:`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
};
const drift=nearEqual(exported,peerPkg);
assert.equal(drift,null,`browser-built package differs from the service response: ${drift}`);
// Everything except computed floats is bit-exact: strip numbers and require
// a literal deep-equal on the remaining skeleton (ids, hashes, enums).
const nonNumeric=v=>JSON.parse(JSON.stringify(v,(_k,x)=>typeof x==='number'?0:x));
assert.deepEqual(nonNumeric(exported),nonNumeric(peerPkg),'package skeleton (ids/hashes/labels) differs from the service response');
// Round-trip closure: the downloaded .pose.json must decode through the lab's
// real file input — the same path the service-built package used above.
await page.goto('http://127.0.0.1:5173/');
await page.waitForFunction(()=>window.__LAB__?.ready,{timeout:60000});
await page.locator('.loading-state').waitFor({state:'hidden'});
await page.locator('input[type=file]').setInputFiles({name:download.suggestedFilename(),mimeType:'application/json',buffer:Buffer.from(exportedText)});
await page.waitForTimeout(300);
const roundtrip=await page.evaluate(()=>{const e=window.__LAB__;e.setPlaying(false);return {status:e.source.status,error:e.source.error,kind:e.source.kind};});
assert.equal(roundtrip.kind,'pose-package','exported package did not open as a pose-package source');
assert.equal(roundtrip.status,'ready',`exported package failed to load in the lab: ${roundtrip.error??''}`);
result.checks.workshopPackageExport=true;
svc?.kill();svc=undefined; // every service-dependent assertion is done
// Back to the workshop for the remaining pinned edits — the library
// persists the QA doc's active selection across the navigation.
await page.goto('http://127.0.0.1:5173/workshop.html');
await page.waitForFunction(()=>window.__WS__?.ready,{timeout:60000});
assert((await page.evaluate(()=>window.__WS__.getDoc().name)).includes('QA 测试动作'),'QA doc lost the active selection across navigation');
// Foot-height editing through the real UI: add a mid key, unplant the left
// foot on it — the key then starts a swing interval and its stored target is
// the mid-swing waypoint — then set the lift slider and confirm the solved
// foot actually leaves the ground inside that interval.
await page.evaluate(()=>{const e=window.__WS__;e.setPlaying(false);e.seek(.5);});
await page.waitForTimeout(150); // let the React frame state flush before addKey reads it
await page.getByRole('button',{name:'添加关键帧',exact:true}).click();
assert.equal(await page.locator('.ws-key').count(),3);
await page.locator('.ws-key').nth(1).click();
const liftSlider=page.locator('.ws-slider').filter({hasText:'左脚抬升高度'}).locator('input');
assert(await liftSlider.isDisabled(),'lift slider should be disabled while the foot is planted');
await page.locator('.ws-check').filter({hasText:'左脚支撑锁定'}).locator('input').uncheck();
assert(!(await liftSlider.isDisabled()),'lift slider did not enable after unplanting the foot');
await liftSlider.evaluate(el=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,'0.35');el.dispatchEvent(new Event('input',{bubbles:true}));});
await page.waitForTimeout(200);
const lift=await page.evaluate(()=>{const e=window.__WS__;const ks=[...e.getDoc().keys].sort((a,b)=>a.time-b.time);const mid=ks[1];e.seek((mid.time+ks[2].time)/2);e.solveCurrent();return {target:mid.pose.footL.target.y,yaw:mid.pose.footL.yaw,pitch:mid.pose.footL.pitch,planted:mid.constraints.plantL,footY:e.rig.point('foot_L').y};});
assert.equal(lift.planted,false,'plantL did not toggle off via the UI');
// The slider sets sole lift; the stored value is ankle height — convert back
// with the same footLift() the UI uses instead of comparing raw target.y.
const soleLift=await page.evaluate(async l=>{const {footLift}=await import('/src/workshop/foot.ts');return footLift(window.__WS__.footGeometry('L'),l.target,l.yaw,l.pitch);},lift);
assert(Math.abs(soleLift-.35)<1e-3,`UI slider did not write sole lift .35 (got ${soleLift})`);
assert(lift.footY>.15,`solved foot did not leave the ground mid-swing (y=${lift.footY})`);
result.checks.workshopFootHeight=true;
// Waypoint 3D drag: during a release interval the actual-foot handle becomes
// passive and a separate swing-point handle carries the stored target —
// dragging it must move stored target, handle and the solved mid-swing foot
// together (the previous behaviour wrote the target but the handle never
// followed the mouse).
const wpBefore=await page.evaluate(()=>{
 const e=window.__WS__,ks=[...e.getDoc().keys].sort((a,b)=>a.time-b.time);
 e.seek((ks[1].time+ks[2].time)/2);e.solveCurrent();
 const sw=e.handles.find(x=>x.kind==='swing'&&x.side==='L'),foot=e.handles.find(x=>x.kind==='foot'&&x.side==='L');
 const p=sw.mesh.position.clone().project(e.camera),r=e.renderer.domElement.getBoundingClientRect();
 return {swVisible:sw.mesh.visible,footPassive:foot.passive===true,target:{...ks[1].pose.footL.target},footY:e.rig.point('foot_L').y,
   x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};
});
assert(wpBefore.swVisible,'swing waypoint handle not visible during a release interval');
assert(wpBefore.footPassive,'foot handle should be passive during a release interval');
await page.mouse.move(wpBefore.x,wpBefore.y);await page.mouse.down();
await page.mouse.move(wpBefore.x+40,wpBefore.y-70,{steps:8});await page.mouse.up();
await page.waitForTimeout(150);
const wpAfter=await page.evaluate(()=>{
 const e=window.__WS__,ks=[...e.getDoc().keys].sort((a,b)=>a.time-b.time);
 e.seek((ks[1].time+ks[2].time)/2);e.solveCurrent();
 const sw=e.handles.find(x=>x.kind==='swing'&&x.side==='L');
 return {target:{...ks[1].pose.footL.target},handleY:sw.mesh.position.y,footY:e.rig.point('foot_L').y};
});
assert(wpAfter.target.y>wpBefore.target.y+.02,`waypoint drag did not raise stored target (${wpBefore.target.y}→${wpAfter.target.y})`);
assert(Math.abs(wpAfter.handleY-wpAfter.target.y)<1e-3,'swing handle did not track the stored target');
assert(wpAfter.footY>wpBefore.footY,'solved mid-swing foot did not move with the waypoint');
result.checks.workshopWaypointDrag=true;
result.errors=errors;result.warnings=warnings;assert.deepEqual(errors,[]);
fs.writeFileSync('evidence/browser-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks,errors,warnings,poses:result.poses.length,videoBytes:recorded.length},null,2));

} finally {svc?.kill();await browser.close();}
