import {describe,it,expect,beforeAll,vi} from 'vitest';
import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from './rig';
import {buildManifestLocal,buildPosePackageLocal,subtleDigest,type PackageEnv} from './package-export';
import {canonical,WORKSHOP_REVISION,type RigManifest} from './protocol';
import type {PosePackage} from './pose-package';
import {sha256} from '../server/rig-manifest';
import {createService,handleRequest,type ServiceContext} from '../server/service';
import {blankDocument,defaultDocument,serializeDoc} from '../workshop/document';
import {mulberry32,randomDoc} from '../workshop/random-document';

/** Peer-parity contract: the browser-side builder (buildPosePackageLocal)
 * must produce the exact bodies POST /v1/motions {workshop-doc} serves —
 * package bytes, artifact id, fingerprint, tracks, events, quality and error
 * details — with hashing swapped from node:crypto to crypto.subtle. Every
 * case runs both real paths (parseDoc → solveWorkshop → validatePosePackage
 * vs handleRequest) on the same wire document and compares the full body. */
let rig:HumanRig,ctx:ServiceContext,manifest:RigManifest;
beforeAll(async()=>{
 const bytes=fs.readFileSync('public/models/human.glb');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const rigJsonBytes=fs.readFileSync('public/models/rig.json'),rigJson=JSON.parse(rigJsonBytes.toString('utf8'));
 rig=new HumanRig(gltf.scene,rigJson);
 // The browser-side manifest build (WebCrypto digest) must equal the
 // service's node:crypto assembly — asserted against ctx.manifest below.
 manifest=await buildManifestLocal(rigJson,sha256(rigJsonBytes));
 ctx=await createService('public');
},30000);

const env=():PackageEnv=>({rig,manifest}); // digest defaults to crypto.subtle
const serve=(document:unknown,fps=40)=>
 handleRequest(ctx,'POST','/v1/motions',{action:{id:'workshop-doc',parameters:{document}},sample:{fps}});
const local=(document:unknown,fps=40)=>buildPosePackageLocal(document,fps,env());
const wire=(d:Parameters<typeof serializeDoc>[0])=>JSON.parse(serializeDoc(d));

/** Run one document through both paths and require identical status+body. */
async function parity(document:unknown,fps=40){
 const served=serve(document,fps),built=await local(document,fps);
 expect(built.status).toBe(served.status);
 expect(built.body).toEqual(served.body);
 return {served,built};
}

describe('WebCrypto digest parity',()=>{
 it('subtleDigest hashes canonical JSON byte-identically to node:crypto',async()=>{
  const s=canonical({schema:WORKSHOP_REVISION,document:{b:2,a:[1.5,'x'],n:{z:true,y:null}}});
  await expect(subtleDigest(s)).resolves.toBe(sha256(s));
  // The session manifest built through WebCrypto equals the service's.
  expect(manifest.manifestSHA256).toBe(ctx.manifest.manifestSHA256);
 });
 it('refuses to fabricate a hash when crypto.subtle is unavailable',async()=>{
  vi.stubGlobal('crypto',undefined);
  try{
   await expect(buildPosePackageLocal(wire(blankDocument(rig.rest,'d','d')),40,env()))
    .rejects.toThrow(/https 或 localhost/);
  }finally{vi.unstubAllGlobals();}
 });
});

describe('peer parity — document shapes',()=>{
 it('defaultDocument',()=>parity(wire(defaultDocument(rig.rest))));
 it('pelvis handFrames with rotated pelvis',()=>{
  const d=blankDocument(rig.rest,'骨盆系','pelvis-frames');
  d.keys[0].pose.yaw=38;d.keys[1].pose.yaw=-20;
  d.handFrames={L:'pelvis',R:'pelvis'};
  return parity(wire(d));
 });
 it('loop:true document',()=>{
  const d=blankDocument(rig.rest,'循环','loop-doc');
  d.loop=true;d.duration=1.2;
  return parity(wire(d));
 });
 it('inbetweens:false document',()=>{
  const d=blankDocument(rig.rest,'阶梯','stepped');
  d.inbetweens=false;
  return parity(wire(d));
 });
 it('unicode document name',()=>{
  return parity(wire(blankDocument(rig.rest,'正手·挥拍🎾','uni-doc')));
 });
 it('fps 1 and fps 7 (non-integer duration×fps grids)',async()=>{
  await parity(wire(defaultDocument(rig.rest)),1);
  await parity(wire(blankDocument(rig.rest,'短','short')),7);
 });
});

describe('peer parity — rejection bodies',()=>{
 it('422 details equal the service error.details verbatim',async()=>{
  const req=JSON.parse(fs.readFileSync('spec/examples/rejected-pelvis-fold.request.json','utf8'));
  const {served,built}=await parity(req.action.parameters.document,req.sample?.fps??40);
  expect(served.status).toBe(422);
  expect((built.body as {error:{details:string[]}}).error.details)
   .toEqual((served.body as {error:{details:string[]}}).error.details);
 });
 it('oversized documents get the service 400 body',async()=>{
  const d=blankDocument(rig.rest,'超长','long-doc');
  d.duration=99; // past WORKSHOP_LIMITS.maxDuration — parseDoc refuses first
  await parity(wire(d));
 });
});

describe('ad-hoc action.parameters presentation',()=>{
 it('marks prop for grip documents and loop for looping ones',async()=>{
  const {built}=await parity(wire(defaultDocument(rig.rest)));
  const params=(built.body as PosePackage).action.parameters;
  expect(params).toEqual({documentName:'正手挥拍 · 工作区',presentation:{prop:'racket',loop:false}});
  const d=blankDocument(rig.rest,'循环','loop-doc');d.loop=true;d.duration=1.2;
  const noGrip=await buildPosePackageLocal(wire(d),40,env());
  expect((noGrip.body as PosePackage).action.parameters)
   .toEqual({documentName:'循环',presentation:{loop:true}});
 });
 it('a cached env yields identical packages across calls',async()=>{
  const e=env(),doc=wire(defaultDocument(rig.rest));
  const a=await buildPosePackageLocal(doc,40,e),b=await buildPosePackageLocal(doc,40,e);
  expect(b).toEqual(a);
  expect(a.status).toBe(200);
 });
});

describe('peer parity — seeded random documents',()=>{
 for(const seed of [11,23])
  it(`seed ${seed}: every service-200 package matches byte-for-byte`,async()=>{
   const rng=mulberry32(seed);
   for(let di=0;di<8;di++){
    const doc=wire(randomDoc(rng,ctx.rig.rest));
    const served=serve(doc);
    if(served.status!==200)continue; // 422 parity is pinned by the fixture case
    const built=await local(doc);
    expect(built.status).toBe(200);
    expect(built.body).toEqual(served.body);
   }
  },60000);
});
