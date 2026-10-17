import fs from 'node:fs';
import path from 'node:path';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from '../core/rig';
import {authoredMotionById,isKeyframedId} from '../core/authored-motions';
import {keyframedDefinition} from '../core/authoring';
import {parseDoc} from '../workshop/document';
import {buildRigManifest,RIG_ID,canonical,sha256,type RigManifest} from './rig-manifest';
import {actionDefinitionHash,solveKeyframed,solveWorkshop,type PosePackage} from './pose-package';
export const SERVICE_VERSION='0.1.0';
export const LIMITS_SVC={maxFps:60,defaultFps:40,maxWorkshopDuration:10,maxWorkshopKeys:120,maxBodyBytes:1<<20,
 idempotencyMaxKeys:256,idempotencyTtlSeconds:900} as const;
interface IdempotentEntry{fingerprint:string;status:number;body:unknown;at:number}
export interface ServiceContext{rig:HumanRig;manifest:RigManifest;idempotent:Map<string,IdempotentEntry>}
export async function createService(assetDir:string):Promise<ServiceContext>{
 const glb=fs.readFileSync(path.join(assetDir,'models/human.glb'));
 const rigJson=fs.readFileSync(path.join(assetDir,'models/rig.json'));
 const gltf=await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
 const parsed:Parameters<typeof buildRigManifest>[0]=JSON.parse(rigJson.toString('utf8'));
 return {rig:new HumanRig(gltf.scene,parsed),manifest:buildRigManifest(parsed,sha256(rigJson)),
  idempotent:new Map()};
}
interface ActionDescriptor{
 id:string;revision:string;title:string;english:string;kind:'keyframed'|'workshop-doc';
 durationSeconds:number|null;parameters:Record<string,unknown>;outputs:{kind:string;format:string}[];
 phases?:{time:number;label:string}[];provenance:{source:string;license:string;upstreamLicense?:string};
 notes?:string[];
}
const WORKSHOP_DOC_PARAMS={
 type:'object',additionalProperties:false,
 properties:{
  document:{type:'object',description:`WorkshopDoc JSON (schemaVersion 1): named keyframes with pose targets + constraints (plantL/plantR/grip/contact). Solved by the kinematic FK/IK pipeline; max ${LIMITS_SVC.maxWorkshopDuration}s and ${LIMITS_SVC.maxWorkshopKeys} keys.`},
  sampleHz:{type:'number',minimum:1,maximum:LIMITS_SVC.maxFps},
 },required:['document']};
export function actionCatalog():ActionDescriptor[]{
 const out:ActionDescriptor[]=['idle','reach','squat','ready','forehand'].map(id=>{
  const spec=authoredMotionById(id)!;
  return {id,revision:'keyframed-v1',title:spec.name,english:spec.english,kind:'keyframed' as const,
   durationSeconds:spec.duration,
   parameters:{type:'object',additionalProperties:false,properties:{}},
   outputs:[{kind:'motion',format:'pose-json'}],phases:spec.phases,
   provenance:{source:'authored-keyframes',license:'MIT (project-authored motion data)'},
   notes:id==='forehand'?['documented-defect: upper arm/torso interpenetration in strike zone']:[]
  };
 });
 out.push({id:'workshop-doc',revision:'workshop-doc-v1',title:'自定义动作文档',english:'CUSTOM WORKSHOP DOCUMENT',kind:'workshop-doc',
  durationSeconds:null,parameters:WORKSHOP_DOC_PARAMS,
  outputs:[{kind:'motion',format:'pose-json'}],
  provenance:{source:'client-supplied WorkshopDoc',license:'caller-owned; service asserts no rights'},
  notes:['kinematic solve only — no dynamics validation']});
 return out;
}
function err(status:number,code:string,message:string,extra:Record<string,unknown>={}){return {status,body:{error:{code,message,...extra}}};}
const json=(body:unknown,status=200)=>({status,body});
/** What the client sent — request identity for idempotent replay only. */
function fingerprint(body:unknown){return sha256(canonical(body));}
/** What the artifact IS — binds the request to the exact action definition,
 * rig manifest and solver that produced it. A solver or rig upgrade yields a
 * new id for the same request, so caches never conflate two trajectories. */
export const artifactId=(request:string,definitionSHA256:string,ctx:ServiceContext,solver:string)=>
 'mot_'+sha256(canonical({protocol:'v1',requestFingerprint:request,definitionSHA256,
  rig:{id:RIG_ID,manifestSHA256:ctx.manifest.manifestSHA256},
  solver:{name:solver,revision:SERVICE_VERSION}})).slice(0,16);
export function handleRequest(ctx:ServiceContext,method:string,route:string,body?:unknown,headers:Record<string,string>={}){
 if(method==='GET'&&route==='/v1/capabilities')return json({
  service:{name:'human3d-motion',version:SERVICE_VERSION,protocol:'v1'},
  rigs:[{id:RIG_ID,manifestSHA256:ctx.manifest.manifestSHA256,bones:ctx.manifest.bones.length,height:ctx.manifest.height,semantics:ctx.manifest.semantics}],
  actions:actionCatalog().map(({phases,...a})=>({...a,phaseCount:phases?.length??0})),
  limits:{...LIMITS_SVC,maxTracks:164,payload:'gzip accepted (Content-Encoding: gzip)'},
  endpoints:['GET /v1/capabilities','GET /v1/actions/{actionId}','GET /v1/rigs/{rigId}','POST /v1/motions'],
 });
 if(method==='GET'&&route.startsWith('/v1/actions/')){
  const id=decodeURIComponent(route.slice('/v1/actions/'.length));
  const a=actionCatalog().find(x=>x.id===id);
  return a?json(a):err(404,'unknown_action',`no action '${id}'`,{available:actionCatalog().map(x=>x.id)});
 }
 if(method==='GET'&&route.startsWith('/v1/rigs/')){
  const id=decodeURIComponent(route.slice('/v1/rigs/'.length));
  return id===RIG_ID?json(ctx.manifest):err(404,'unknown_rig',`no rig '${id}'`,{available:[RIG_ID]});
 }
 if(method==='POST'&&route==='/v1/motions')return solveMotion(ctx,body,headers);
 return err(404,'not_found',`${method} ${route}`);
}
/** Prune expired idempotency entries, then evict oldest until under the cap.
 * Map iteration order is insertion order, so the first keys are the oldest. */
function storeIdempotent(ctx:ServiceContext,key:string,entry:IdempotentEntry){
 const now=Date.now(),ttl=LIMITS_SVC.idempotencyTtlSeconds*1000;
 for(const [k,v]of ctx.idempotent)if(now-v.at>ttl)ctx.idempotent.delete(k);
 while(ctx.idempotent.size>=LIMITS_SVC.idempotencyMaxKeys)ctx.idempotent.delete(ctx.idempotent.keys().next().value!);
 ctx.idempotent.set(key,entry);
}
function solveMotion(ctx:ServiceContext,body:unknown,headers:Record<string,string>){
 if(!body||typeof body!=='object'||Array.isArray(body))return err(400,'invalid_request','body must be a JSON object');
 const req=body as {action?:unknown;rig?:unknown;outputs?:unknown;sample?:unknown};
 const action=(req.action&&typeof req.action==='object'?req.action:undefined) as {id?:unknown;parameters?:unknown}|undefined;
 if(!action||typeof action.id!=='string')return err(400,'invalid_request','action.id is required');
 const actionId=action.id;
 const descriptor=actionCatalog().find(a=>a.id===actionId);
 if(!descriptor)return err(404,'unknown_action',`no action '${actionId}'`,{missing:['solver capability for this action'],available:actionCatalog().map(a=>a.id)});
 const params=(action.parameters===undefined?{}:action.parameters) as Record<string,unknown>;
 if(typeof params!=='object'||params===null||Array.isArray(params))return err(400,'invalid_request','action.parameters must be an object');
 if(req.rig!==undefined&&typeof req.rig!=='string')return err(400,'invalid_request','rig must be a string id');
 const rigId=(req.rig as string|undefined)??RIG_ID;
 if(rigId!==RIG_ID)return err(409,'unsupported_rig',`rig '${rigId}' cannot be served`,{missing:['retarget adapter'],available:[RIG_ID]});
 if(req.outputs!==undefined){
  if(!Array.isArray(req.outputs))return err(400,'invalid_request','outputs must be an array');
  for(const o of req.outputs){
   if(!o||typeof o!=='object')return err(400,'invalid_request','outputs entries must be objects');
   const {kind,format}=o as {kind?:unknown;format?:unknown};
   if(kind!=='motion')return err(400,'unsupported_output',`output kind '${String(kind)}' not implemented`,{available:['motion']});
   if(format!=='pose-json')return err(400,'unsupported_output',`format '${String(format)}' not implemented`,{available:['pose-json']});
  }
 }
 if(req.sample!==undefined&&(typeof req.sample!=='object'||req.sample===null))return err(400,'invalid_request','sample must be an object');
 const fps=(req.sample as {fps?:unknown}|undefined)?.fps??params.sampleHz??LIMITS_SVC.defaultFps;
 if(!(typeof fps==='number'&&Number.isFinite(fps)&&fps>=1&&fps<=LIMITS_SVC.maxFps))return err(400,'invalid_request',`sample fps must be 1..${LIMITS_SVC.maxFps}`);
 const fp=fingerprint(body);
 const key=headers['idempotency-key'];
 if(key){
  const seen=ctx.idempotent.get(key);
  if(seen&&Date.now()-seen.at<=LIMITS_SVC.idempotencyTtlSeconds*1000)
   return seen.fingerprint===fp?{status:seen.status,body:seen.body}:err(409,'idempotency_conflict','Idempotency-Key reused with a different request body');
  if(seen)ctx.idempotent.delete(key);
 }
 // Resolve the action definition BEFORE naming the artifact: the id must
 // change whenever the definition, rig or solver changes — a bare request
 // fingerprint would collide across solver/rig upgrades.
 let solver:string,parametersResolved:Record<string,unknown>,definitionSHA256:string;
 let actionParams:Record<string,unknown>,run:(motionId:string)=>PosePackage;
 if(descriptor.kind==='keyframed'){
  if(!isKeyframedId(actionId))return err(404,'unknown_action',`no keyframed action '${actionId}'`);
  const spec=authoredMotionById(actionId)!;
  solver='keyframe-hermite-ik';parametersResolved={fps};actionParams={};
  definitionSHA256=actionDefinitionHash({revision:descriptor.revision,duration:spec.duration,phases:spec.phases,definition:keyframedDefinition(actionId)});
  run=motionId=>solveKeyframed(ctx.rig,spec,fps,meta(motionId));
 }else{
  const docRaw=params.document;
  if(docRaw===undefined)return err(400,'invalid_request','parameters.document is required for workshop-doc');
  let doc:ReturnType<typeof parseDoc>;
  try{doc=parseDoc(JSON.stringify(docRaw));}catch(e){return err(400,'validation_failed',`document rejected: ${e instanceof Error?e.message:e}`);}
  if(doc.duration>LIMITS_SVC.maxWorkshopDuration)return err(400,'validation_failed',`document duration ${doc.duration}s exceeds ${LIMITS_SVC.maxWorkshopDuration}s`);
  if(doc.keys.length>LIMITS_SVC.maxWorkshopKeys)return err(400,'validation_failed',`document has ${doc.keys.length} keys > ${LIMITS_SVC.maxWorkshopKeys}`);
  solver='workshop-hermite-fk-ik';parametersResolved={fps,duration:doc.duration,keys:doc.keys.length};
  actionParams={documentName:doc.name};
  definitionSHA256=actionDefinitionHash({revision:descriptor.revision,document:doc});
  run=motionId=>solveWorkshop(ctx.rig,doc,fps,meta(motionId));
 }
 const meta=(motionId:string)=>({motionId,manifestSHA256:ctx.manifest.manifestSHA256,bones:ctx.manifest.bones.length,
  action:{id:actionId,revision:descriptor.revision,parameters:actionParams,definitionSHA256},
  provenance:{solver,solverRevision:SERVICE_VERSION,source:descriptor.provenance.source,requestFingerprint:fp,
   license:{motion:descriptor.provenance.license,rig:'CC0'},parametersResolved}});
 const res=json(run(artifactId(fp,definitionSHA256,ctx,solver)));
 if(key)storeIdempotent(ctx,key,{fingerprint:fp,status:res.status,body:res.body,at:Date.now()});
 return res;
}
