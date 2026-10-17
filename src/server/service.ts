import fs from 'node:fs';
import path from 'node:path';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanRig} from '../core/rig';
import {authoredMotionById,isKeyframedId} from '../core/authored-motions';
import {parseDoc} from '../workshop/document';
import {buildRigManifest,RIG_ID,canonical,sha256,type RigManifest} from './rig-manifest';
import {actionDefinitionHash,solveKeyframed,solveWorkshop,type PosePackage} from './pose-package';
export const SERVICE_VERSION='0.1.0';
export const LIMITS_SVC={maxFps:60,defaultFps:40,maxWorkshopDuration:10,maxWorkshopKeys:120,maxBodyBytes:1<<20} as const;
export interface ServiceContext{rig:HumanRig;manifest:RigManifest;idempotent:Map<string,{fingerprint:string;status:number;body:unknown}>}
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
function fingerprint(body:unknown){return sha256(canonical(body));}
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
function solveMotion(ctx:ServiceContext,body:unknown,headers:Record<string,string>){
 if(!body||typeof body!=='object')return err(400,'invalid_request','body must be a JSON object');
 const req=body as {action?:{id?:string;parameters?:Record<string,unknown>};rig?:string;outputs?:{kind:string;format:string}[];sample?:{fps?:number}};
 const actionId=req.action?.id;
 if(typeof actionId!=='string')return err(400,'invalid_request','action.id is required');
 const descriptor=actionCatalog().find(a=>a.id===actionId);
 if(!descriptor)return err(404,'unknown_action',`no action '${actionId}'`,{missing:['solver capability for this action'],available:actionCatalog().map(a=>a.id)});
 const rigId=req.rig??RIG_ID;
 if(rigId!==RIG_ID)return err(409,'unsupported_rig',`rig '${rigId}' cannot be served`,{missing:['retarget adapter'],available:[RIG_ID]});
 for(const o of req.outputs??[])if(o.format!=='pose-json')return err(400,'unsupported_output',`format '${o.format}' not implemented`,{available:['pose-json']});
 const fps=req.sample?.fps??(req.action?.parameters?.sampleHz as number|undefined)??LIMITS_SVC.defaultFps;
 if(!(typeof fps==='number'&&fps>=1&&fps<=LIMITS_SVC.maxFps))return err(400,'invalid_request',`sample fps must be 1..${LIMITS_SVC.maxFps}`);
 const fp=fingerprint(body);
 const key=headers['idempotency-key'];
 if(key){
  const seen=ctx.idempotent.get(key);
  if(seen)return seen.fingerprint===fp?{status:seen.status,body:seen.body}:err(409,'idempotency_conflict','Idempotency-Key reused with a different request body');
 }
 const motionId='mot_'+fp.slice(0,16);
 let pkg:PosePackage;
 if(descriptor.kind==='keyframed'){
  const spec=authoredMotionById(actionId)!;
  if(!isKeyframedId(actionId))return err(404,'unknown_action',`no keyframed action '${actionId}'`);
  pkg=solveKeyframed(ctx.rig,spec,fps,{motionId,manifestSHA256:ctx.manifest.manifestSHA256,bones:ctx.manifest.bones.length,
   action:{id:actionId,revision:descriptor.revision,parameters:{},definitionSHA256:actionDefinitionHash({keyframed:actionId,revision:descriptor.revision})},
   provenance:{solver:'keyframe-hermite-ik',solverRevision:SERVICE_VERSION,source:descriptor.provenance.source,
    license:{motion:descriptor.provenance.license,rig:'CC0'},parametersResolved:{fps}}});
 }else{
  const docRaw=(req.action!.parameters as Record<string,unknown>|undefined)?.document;
  if(docRaw===undefined)return err(400,'invalid_request','parameters.document is required for workshop-doc');
  let doc;try{doc=parseDoc(JSON.stringify(docRaw));}catch(e){return err(400,'validation_failed',`document rejected: ${e instanceof Error?e.message:e}`);}
  if(doc.duration>LIMITS_SVC.maxWorkshopDuration)return err(400,'validation_failed',`document duration ${doc.duration}s exceeds ${LIMITS_SVC.maxWorkshopDuration}s`);
  if(doc.keys.length>LIMITS_SVC.maxWorkshopKeys)return err(400,'validation_failed',`document has ${doc.keys.length} keys > ${LIMITS_SVC.maxWorkshopKeys}`);
  pkg=solveWorkshop(ctx.rig,doc,fps,{motionId,manifestSHA256:ctx.manifest.manifestSHA256,bones:ctx.manifest.bones.length,
   action:{id:'workshop-doc',revision:descriptor.revision,parameters:{documentName:doc.name},
    definitionSHA256:actionDefinitionHash(doc)},
   provenance:{solver:'workshop-hermite-fk-ik',solverRevision:SERVICE_VERSION,source:descriptor.provenance.source,
    license:{motion:descriptor.provenance.license,rig:'CC0'},parametersResolved:{fps,duration:doc.duration,keys:doc.keys.length}}});
 }
 const res=json(pkg);
 if(key)ctx.idempotent.set(key,{fingerprint:fp,status:res.status,body:res.body});
 return res;
}
