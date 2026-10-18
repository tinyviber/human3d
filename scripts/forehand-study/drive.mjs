// WP-C forehand-study authoring driver — every document mutation goes through
// the workshop's REAL UI write paths (learning[4]/[5]): named panel sliders
// and fields via real input events, canvas handles via real pointer drags on
// the camera-facing drag planes. No direct JSON/doc injection (the ticket's
// editing discipline). Reads a cumulative ops recipe, applies it to the seeded
// default document in a fresh browser profile, then saves the live document.
//
// Usage: node scripts/forehand-study/drive.mjs <ops.json> <out.doc.json>
//   ops.json: {"rename"?,"duration"?,"ops":[...],"exportDownload"?:"path"}
//   ops entries (applied in order; each selects the key by label or id first):
//     {"key":"<id|label>","time":<s>}              — 时间 s field (setKeyTime)
//     {"key":"..","label":"<text>"}                — 标签 field
//     {"key":"..","sliders":{"<label>":<v>}}       — 躯干与骨盆/脚部 range sliders
//     {"key":"..","wrist":{"side":"R","moves":[[axis,delta],…]}} — ordered delta-slider
//       sets (axis: flex|dev|twist; on ±60°/±90° range exhaustion the panel is
//       remounted so the delta control re-zeroes, then the sequence continues)
//     {"key":"..","hand":{"side":"R","to":[x,y,z]}}      — 2-view pointer drag (front x,y → side z,y)
//     {"key":"..","poleArm":{"side":"R","to":[x,y,z]}}   — elbow-pole drag, same scheme
//     {"key":"..","contactTip":[x,y,z]}            — drag the yellow contact marker
//     {"key":"..","check":{constraint:bool}}       — 约束 checkboxes (plant/grip/contact)
import {chromium} from 'playwright';
import fs from 'node:fs';

const [opsPath,outPath]=process.argv.slice(2);
if(!opsPath||!outPath){console.error('usage: drive.mjs <ops.json> <out.doc.json>');process.exit(2);}
const ops=JSON.parse(fs.readFileSync(opsPath,'utf8'));
const browser=await chromium.launch({headless:true,channel:process.env.QA_BROWSER_CHANNEL??'chrome'});
const page=await browser.newPage({viewport:{width:1536,height:1024},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const log=[];

await page.goto('http://127.0.0.1:5173/workshop.html');
await page.waitForFunction(()=>window.__WS__?.ready,{timeout:60000});
await page.evaluate(()=>window.__WS__.setPlaying(false));

const field=(label)=>page.locator('.ws-field').filter({hasText:label}).locator('input').first();
const setRange=async(scope,label,value)=>{
 const loc=scope.locator('.ws-slider').filter({hasText:label}).locator('input');
 await loc.evaluate((el,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
 await page.waitForTimeout(90);
};
const keyButton=(key)=>page.locator('.ws-track-labels button').filter({hasText:key}).first();
const selectKey=async(key)=>{await keyButton(key).click();await page.waitForTimeout(120);};
const selectKeyByIndex=async(i)=>{await page.locator('.ws-track-labels button').nth(i).click();await page.waitForTimeout(120);};
const view=async(name)=>{await page.locator('.ws-cameras button').filter({hasText:name}).first().click();await page.waitForTimeout(160);};
const worldToScreen=(P)=>page.evaluate(P=>{const e=window.__WS__;const v=new e.camera.position.constructor(...P).project(e.camera);const r=e.renderer.domElement.getBoundingClientRect();return {x:r.left+(v.x+1)/2*r.width,y:r.top+(1-v.y)/2*r.height};},P);
const handleScreen=(kind,side)=>page.evaluate(({kind,side})=>{const e=window.__WS__;e.solveCurrent();const h=e.handles.find(x=>x.kind===kind&&x.side===side);const w=h.mesh.getWorldPosition(new h.mesh.position.constructor());const p=w.project(e.camera);const r=e.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};},{kind,side});
const markerScreen=()=>page.evaluate(()=>{const e=window.__WS__;const m=e.contactMarkers[0];const p=m.position.clone().project(e.camera);const r=e.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};});
const drag=async(from,to)=>{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:10});await page.mouse.up();await page.waitForTimeout(140);};

// Doc-level ops first (rename/duration retime — the same fields a user edits).
if(ops.rename!==undefined){await field('名称').fill(ops.rename);await page.waitForTimeout(120);log.push(`rename → ${ops.rename}`);}
if(ops.duration!==undefined){await field('时长').fill(String(ops.duration));await page.waitForTimeout(150);log.push(`duration → ${ops.duration}s (retimeKeys via 时长 field)`);}
if(ops.handFrames){for(const side of ['L','R']){const sel=page.locator('.ws-field').filter({hasText:side==='L'?'左手坐标系':'右手坐标系'}).locator('select');await sel.selectOption(ops.handFrames[side]);}await page.waitForTimeout(120);log.push(`handFrames → ${JSON.stringify(ops.handFrames)}`);}

const WRIST_AXIS={flex:'屈 / 伸',dev:'尺桡偏',twist:'旋前'};
const WRIST_LIMIT={flex:60,dev:60,twist:90};

for(const op of ops.ops??[]){
 if(op.key!==undefined)await selectKey(op.key);
 if(op.label!==undefined){await field('标签').fill(op.label);log.push(`${op.key} label → ${op.label}`);}
 if(op.time!==undefined){await field('时间 s').fill(String(op.time));log.push(`${op.key} time → ${op.time}s (时间 field)`);}
 if(op.check)for(const [cname,v]of Object.entries(op.check)){
  const row=page.locator('.ws-check').filter({hasText:cname}).locator('input');
  await (v?row.check():row.uncheck());await page.waitForTimeout(90);
  log.push(`${op.key} constraint ${cname} → ${v}`);
 }
 if(op.sliders)for(const [label,v]of Object.entries(op.sliders)){
  await setRange(page.locator('.ws-sub').filter({hasText:'躯干与骨盆'}),label,v);
  log.push(`${op.key} slider ${label} → ${v}`);
 }
 if(op.wrist){
  const scope=page.locator('.ws-sub').filter({hasText:op.wrist.side==='L'?'左手腕姿态':'右手腕姿态'});
  const pos={flex:0,dev:0,twist:0};
  for(const [axis,delta]of op.wrist.moves){
   let next=pos[axis]+delta;
   if(next>WRIST_LIMIT[axis]||next<-WRIST_LIMIT[axis]){
    // Slider range exhausted: remount the panel (select another key and back)
    // so the delta control re-zeroes, then continue from 0.
    await selectKeyByIndex(0);await selectKey(op.key);
    pos.flex=0;pos.dev=0;pos.twist=0;next=delta;
   }
   await setRange(scope,WRIST_AXIS[axis],next);pos[axis]=next;
  }
  log.push(`${op.key} wrist ${op.wrist.side} moves ${op.wrist.moves.map(m=>m.join(':')).join(' ')} (ordered delta-slider sets)`);
 }
 for(const kind of ['hand','poleArm']){
  const spec=op[kind];
  if(!spec)continue;
  const {side,to}=spec;
  // `to` is a WORLD-space target — with handFrames:'pelvis' the STORED value
  // is itself world-space (pelvis only changes the interpolation frame), so
  // the drag target is the stored number verbatim.
  for(const v of ['正面','侧面']){
   await view(v);
   const h=await handleScreen(kind,side),t=await worldToScreen(to);
   await drag(h,t);
  }
  const got=await page.evaluate(({k,side,kind})=>{const ks=window.__WS__.getDoc().keys;const key=ks.find(x=>x.id===k)??ks.find(x=>x.label===k);const h=side==='L'?key.pose.handL:key.pose.handR;return kind==='poleArm'?h.pole:h.target;},{k:op.key,side,kind});
  log.push(`${op.key} ${kind}${side} drag → target now ${JSON.stringify(got)} (2-view pointer)`);
 }
 if(op.contactTip){
  for(const v of ['正面','侧面']){
   await view(v);
   const m=await markerScreen(),t=await worldToScreen(op.contactTip);
   await drag(m,t);
  }
  log.push(`${op.key} contactTip drag → ${JSON.stringify(op.contactTip)} (contact marker pointer)`);
 }
}

const doc=await page.evaluate(()=>window.__WS__.getDoc());
fs.writeFileSync(outPath,JSON.stringify(doc,null,2));
// Invariants this session must hold — fail loudly rather than ship a bad doc.
const problems=[];
if(doc.keys.length>5)problems.push(`keys ${doc.keys.length} > 5`);
for(const s of ['L','R'])if(doc.handFrames[s]!=='pelvis')problems.push(`handFrames.${s}=${doc.handFrames[s]}`);
if(doc.keys.filter(k=>k.constraints.contact).length!==1)problems.push('exactly one contact key required');
for(const k of doc.keys){if(!k.constraints.plantL||!k.constraints.plantR)problems.push(`key ${k.id}@${k.time} not planted`);}
const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('kinesis-workshop-library')).docs.find(d=>d.id===window.__WS__.getDoc().id));
if(JSON.stringify(stored)!==JSON.stringify(doc))problems.push('live doc differs from persisted localStorage copy');

if(ops.exportDownload){
 const [dl]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'导出 JSON',exact:true}).click()]);
 await dl.saveAs(ops.exportDownload);
 log.push(`导出 JSON download → ${ops.exportDownload} (${dl.suggestedFilename()})`);
}
console.log(JSON.stringify({ops:log,problems,errors,doc:{id:doc.id,name:doc.name,duration:doc.duration,keys:doc.keys.map(k=>({id:k.id,t:k.time,label:k.label,contact:k.constraints.contact,plantL:k.constraints.plantL,plantR:k.constraints.plantR,grip:k.constraints.grip}))}},null,1));
await browser.close();
if(problems.length||errors.length)process.exit(1);
