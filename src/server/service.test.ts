import {describe,it,expect,beforeAll} from 'vitest';
import http from 'node:http';
import {createService,handleRequest,actionCatalog,SERVICE_VERSION,type ServiceContext} from './service';
import {validatePosePackage} from './validate';
import {blankDocument} from '../workshop/document';
import type {PosePackage} from './pose-package';
let ctx:ServiceContext;
beforeAll(async()=>{ctx=await createService('public');},30000);
const post=(body:unknown,headers:Record<string,string>={})=>handleRequest(ctx,'POST','/v1/motions',body,headers);
describe('capability catalog',()=>{
 it('lists only honestly servable actions and the single rig',()=>{
  const r=handleRequest(ctx,'GET','/v1/capabilities');
  expect(r.status).toBe(200);
  const c=r.body as {service:{version:string};actions:{id:string;kind:string}[];rigs:{id:string}[];limits:{maxFps:number}};
  expect(c.service.version).toBe(SERVICE_VERSION);
  expect(c.actions.map(a=>a.id).sort()).toEqual(['forehand','idle','reach','ready','squat','workshop-doc']);
  expect(c.rigs[0].id).toBe('makehuman-body');
  expect(c.limits.maxFps).toBe(60);
 });
 it('never advertises muscle-dynamics or mocap actions it cannot serve at request time',()=>{
  const ids=actionCatalog().map(a=>a.id);
  for(const id of ['walk','punch','throw','baseball-throw','shotput'])expect(ids).not.toContain(id);
 });
 it('returns per-action descriptors and 404 for unknown ids',()=>{
  const ok=handleRequest(ctx,'GET','/v1/actions/forehand');
  expect(ok.status).toBe(200);
  expect((ok.body as {notes:string[]}).notes[0]).toContain('documented-defect');
  expect(handleRequest(ctx,'GET','/v1/actions/fly').status).toBe(404);
 });
});
describe('rig manifest',()=>{
 it('describes 163 bones with rest local TRS and VRM semantics',()=>{
  const r=handleRequest(ctx,'GET','/v1/rigs/makehuman-body');
  expect(r.status).toBe(200);
  const m=r.body as {bones:{name:string;parent:string|null;restLocal:{translation:number[];rotation:number[];scale:number[]};semantic:string}[];manifestSHA256:string;semantics:{mapped:number}};
  expect(m.bones.length).toBe(163);
  expect(m.manifestSHA256).toMatch(/^[0-9a-f]{64}$/);
  expect(m.semantics.mapped).toBeGreaterThanOrEqual(40);
  const wrist=m.bones.find(b=>b.name==='wrist_R')!;
  expect(wrist.semantic).toBe('rightHand');
  expect(wrist.restLocal.rotation).toEqual([0,0,0,1]);
  const upper=m.bones.find(b=>b.name==='upperleg01_L')!;
  const child=m.bones.find(b=>b.name==='lowerleg01_L')!;
  expect(child.restLocal.translation[1]).toBeCloseTo(-0.42,0);
 });
 it('rejects rigs it cannot serve',()=>{
  const r=post({action:{id:'idle'},rig:'smpl-24'});
  expect(r.status).toBe(409);
  expect((r.body as {error:{missing:string[]}}).error.missing).toContain('retarget adapter');
 });
});
describe('POST /v1/motions — keyframed actions',()=>{
 it('solves squat into a package that passes independent validation',()=>{
  const r=post({action:{id:'squat',parameters:{}}});
  expect(r.status).toBe(200);
  const pkg=r.body as PosePackage;
  expect(pkg.kind).toBe('pose-package');
  expect(pkg.id).toMatch(/^mot_[0-9a-f]{16}$/);
  expect(pkg.timeline.count).toBe(Math.round(5.6*40)+1);
  expect(pkg.tracks.rotations.length).toBeGreaterThan(20);
  expect(pkg.tracks.rotations.length).toBeLessThan(163);
  expect(pkg.tracks.rotations.every(t=>t.values.length===pkg.timeline.count*4)).toBe(true);
  expect(pkg.events.map(e=>e.label)).toContain('最低点');
  expect(validatePosePackage(pkg,ctx.manifest)).toEqual([]);
 });
 it('reports per-frame quality checks and the documented forehand defect',()=>{
  const pkg=post({action:{id:'forehand'}}).body as PosePackage;
  expect(pkg.quality.warnings[0]).toContain('穿插');
  const ids=pkg.quality.checks.map(c=>c.id);
  for(const s of ['L','R'])expect(ids).toEqual(expect.arrayContaining([`knee-flexion-${s}`,`elbow-flexion-${s}`,`shoulder-elevation-${s}`,`foot-clearance-${s}`]));
  expect(validatePosePackage(pkg,ctx.manifest)).toEqual([]);
 });
 it('honors requested sample fps',()=>{
  const pkg=post({action:{id:'idle'},sample:{fps:10}}).body as PosePackage;
  expect(pkg.timeline.fps).toBe(10);
  expect(pkg.timeline.count).toBe(Math.round(4.8*10)+1);
 });
});
describe('POST /v1/motions — workshop-doc action',()=>{
 it('solves a validated WorkshopDoc with constraint events and keyframe checks',()=>{
  const doc=blankDocument(ctx.rig.rest,'深蹲变体','test-doc');
  doc.keys[1].constraints.contact=true;doc.keys[1].label='触地';
  const r=post({action:{id:'workshop-doc',parameters:{document:doc}}});
  expect(r.status).toBe(200);
  const pkg=r.body as PosePackage;
  expect(pkg.events.some(e=>e.type==='contact')).toBe(true);
  expect(pkg.events.some(e=>e.type==='support-start')).toBe(true);
  expect(pkg.quality.checks.some(c=>c.id.startsWith('keyframe:'))).toBe(true);
  expect(validatePosePackage(pkg,ctx.manifest)).toEqual([]);
 });
 it('rejects malformed and oversized documents',()=>{
  expect(post({action:{id:'workshop-doc',parameters:{}}}).status).toBe(400);
  expect(post({action:{id:'workshop-doc',parameters:{document:{bogus:true}}}}).status).toBe(400);
  const doc=blankDocument(ctx.rig.rest,'超长','long-doc');doc.duration=99;
  const r=post({action:{id:'workshop-doc',parameters:{document:doc}}});
  expect(r.status).toBe(400);
  expect((r.body as {error:{code:string}}).error.code).toBe('validation_failed');
 });
});
describe('request semantics',()=>{
 it('rejects unknown actions, bad fps, unsupported outputs and non-object bodies',()=>{
  expect(post({action:{id:'teleport'}}).status).toBe(404);
  expect(post({action:{id:'idle'},sample:{fps:500}}).status).toBe(400);
  expect(post({action:{id:'idle'},outputs:[{kind:'motion',format:'fbx'}]}).status).toBe(400);
  expect(post('hello').status).toBe(400);
 });
 it('replays identical responses for the same Idempotency-Key and rejects reuse with a different body',()=>{
  const key='test-key-1';
  const a=post({action:{id:'reach'}},{'idempotency-key':key});
  const b=post({action:{id:'reach'}},{'idempotency-key':key});
  expect(b.body).toEqual(a.body);
  const c=post({action:{id:'squat'}},{'idempotency-key':key});
  expect(c.status).toBe(409);
  expect((c.body as {error:{code:string}}).error.code).toBe('idempotency_conflict');
 });
});
describe('HTTP transport smoke',()=>{
 it('serves capabilities and a motion over a real socket on an ephemeral port',async()=>{
  const server=http.createServer((req,res)=>{
   let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
    const out=handleRequest(ctx,req.method??'GET',new URL(req.url??'/','http://x').pathname,raw?JSON.parse(raw):undefined,{});
    const data=JSON.stringify(out.body);
    res.writeHead(out.status,{'content-type':'application/json'});res.end(data);
   });
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const port=(server.address() as {port:number}).port;
  try{
   const caps=await (await fetch(`http://127.0.0.1:${port}/v1/capabilities`)).json() as {service:{name:string}};
   expect(caps.service.name).toBe('human3d-motion');
   const res=await fetch(`http://127.0.0.1:${port}/v1/motions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:{id:'idle'},sample:{fps:5}})});
   expect(res.status).toBe(200);
   const pkg=await res.json() as PosePackage;
   expect(validatePosePackage(pkg,ctx.manifest)).toEqual([]);
  }finally{await new Promise(r=>server.close(r));}
 });
});
