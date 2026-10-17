import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
// Browser plugin not available; use the project's installed Playwright + Chrome.
// Flow: select walking -> change view / seek -> inspect shoulder-elbow chain
// -> record continuous playback across several cycles and the camera switch.
const browser=await chromium.launch({headless:true,channel:process.env.QA_BROWSER_CHANNEL||'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1536,height:1024}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>window.__LAB__?.ready);
 assert.match(await page.title(),/KINESIS/);assert.equal(await page.locator('vite-error-overlay').count(),0);
 await page.locator('.motion-row').filter({hasText:'行走'}).click();
 assert.equal(await page.locator('.viewport-heading h2').textContent(),'行走');
 const frames=[];
 for(const view of ['front','side','back'])for(const time of [.14,.56]){
  await page.evaluate(({time,view})=>{const e=window.__LAB__;e.setPlaying(false);e.seek(time);e.setView(view);},{time,view});
  await page.waitForTimeout(150);const file=`evidence/walk-${view}-${time}.png`;await page.screenshot({path:file});frames.push({view,time,file});
 }
 await page.evaluate(()=>{const e=window.__LAB__;e.loop=true;e.speed=1;e.setView('side')});
 const bytes=await page.evaluate(async()=>{
  const e=window.__LAB__,stream=e.renderer.domElement.captureStream(30),chunks=[];
  const mimeType=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
  const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:4500000});
  recorder.ondataavailable=ev=>chunks.push(ev.data);
  const done=new Promise(resolve=>recorder.onstop=async()=>{const buffer=await new Blob(chunks).arrayBuffer();stream.getTracks().forEach(t=>t.stop());resolve(Array.from(new Uint8Array(buffer)));});
  recorder.start();e.replay();setTimeout(()=>e.setView('front'),2800);setTimeout(()=>recorder.stop(),5600);return done;
 });
 fs.writeFileSync('evidence/walk.webm',Buffer.from(bytes));assert.deepEqual(errors,[]);
 fs.writeFileSync('evidence/walk-review.json',JSON.stringify({date:'2026-10-16',browser:await browser.version(),viewport:[1536,1024],flow:'walk selection, side/front/back key poses, continuous shoulder-elbow FK playback',frames,errors,video:'walk.webm',videoBytes:bytes.length},null,2));
 console.log({frames:frames.length,errors,videoBytes:bytes.length});
}finally{await browser.close();}
