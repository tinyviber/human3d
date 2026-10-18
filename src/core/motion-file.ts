import {normalizeDoc,type WorkshopDoc} from '../workshop/document';

/** Motion-file envelope (schema v1): the asset on disk under assets/motions.
 * Everything the trajectory depends on lives in `document` (or the external
 * `clip` asset); order/capabilities/description/notes are envelope metadata —
 * they must never enter the definition hash. */
export type MotionFileKind='workshop-motion'|'clip-motion';
export interface MotionCapabilities{
  prop?:{kind:'racket';trail:boolean;handView:boolean};
  camera?:{targetHeight:number;distance:number};
  locomotion?:'in-place'|'follow';
}
export interface MotionFile{
  schemaVersion:1;kind:MotionFileKind;id:string;order:number;name:string;english:string;duration:number;
  description:string;method:string;focus:string[];phases:{time:number;label:string}[];
  notes?:string[];license?:string;oneShot?:boolean;capabilities?:MotionCapabilities;
  document?:WorkshopDoc;clip?:{url:string;meta?:string};
}

const isStr=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const isNum=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const isObj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

/** Structural check for the envelope. Required/type errors plus the kind
 * branch contract — mutually exclusive: a workshop-motion must carry its
 * document inline and may not point at an external clip; a clip-motion must
 * point at an external clip and may not embed a document. `document` content
 * itself is the WorkshopDoc validator's job (normalizeMotionFile runs it). */
export function validateMotionFileShape(raw:unknown):string[]{
 const e:string[]=[];
 if(!isObj(raw))return ['动作文件不是对象'];
 const f=raw as unknown as MotionFile;
 if(f.schemaVersion!==1)e.push('schemaVersion 必须为 1');
 if(f.kind!=='workshop-motion'&&f.kind!=='clip-motion')e.push('kind 必须是 workshop-motion 或 clip-motion');
 if(!isStr(f.id))e.push('缺少 id');
 if(!isNum(f.order))e.push('order 必须是有限数');
 if(typeof f.name!=='string')e.push('缺少 name');
 if(typeof f.english!=='string')e.push('english 必须是字符串');
 if(!isNum(f.duration))e.push('duration 必须是有限数');
 if(typeof f.description!=='string')e.push('description 必须是字符串');
 if(typeof f.method!=='string')e.push('method 必须是字符串');
 if(!Array.isArray(f.focus)||f.focus.some(x=>typeof x!=='string'))e.push('focus 必须是字符串数组');
 if(!Array.isArray(f.phases)||f.phases.some(p=>!isObj(p)||!isNum(p.time)||typeof p.label!=='string'))e.push('phases 必须是 {time,label} 数组');
 if(f.notes!==undefined&&(!Array.isArray(f.notes)||f.notes.some(x=>typeof x!=='string')))e.push('notes 必须是字符串数组');
 if(f.license!==undefined&&typeof f.license!=='string')e.push('license 必须是字符串');
 if(f.oneShot!==undefined&&typeof f.oneShot!=='boolean')e.push('oneShot 必须是布尔值');
 if(f.capabilities!==undefined){
  const c=f.capabilities;
  if(!isObj(c))e.push('capabilities 必须是对象');
  else{
   if(c.prop!==undefined&&(!isObj(c.prop)||c.prop.kind!=='racket'||typeof c.prop.trail!=='boolean'||typeof c.prop.handView!=='boolean'))e.push('capabilities.prop 必须是 {kind:\'racket\',trail,handView}');
   if(c.camera!==undefined&&(!isObj(c.camera)||!isNum(c.camera.targetHeight)||!isNum(c.camera.distance)))e.push('capabilities.camera 必须是 {targetHeight,distance}');
   if(c.locomotion!==undefined&&c.locomotion!=='in-place'&&c.locomotion!=='follow')e.push('capabilities.locomotion 必须是 in-place 或 follow');
  }
 }
 if(f.kind==='workshop-motion'){
  if(!isObj(f.document))e.push('workshop-motion 必须有 document');
  if(f.clip!==undefined)e.push('workshop-motion 不得有 clip（轨迹字段互斥）');
 }
 if(f.kind==='clip-motion'){
  if(!isObj(f.clip)||!isStr(f.clip.url))e.push('clip-motion 必须有 clip.url');
  if(f.document!==undefined)e.push('clip-motion 不得有 document（轨迹字段互斥）');
 }
 if(f.clip!==undefined&&(!isObj(f.clip)||!isStr(f.clip.url)||(f.clip.meta!==undefined&&typeof f.clip.meta!=='string')))e.push('clip 必须是 {url,meta?}');
 return e;
}

/** Validate, then normalize the embedded document through the same
 * upgrade/validate/canonicalize pipeline every WorkshopDoc takes. */
export function normalizeMotionFile(raw:unknown):MotionFile{
 const errs=validateMotionFileShape(raw);
 if(errs.length)throw new Error(`${errs[0]}${errs.length>1?`（共 ${errs.length} 处问题）`:''}`);
 const f={...(raw as MotionFile)};
 if(f.kind==='workshop-motion')f.document=normalizeDoc(f.document);
 return f;
}

/** Strip the envelope for consumers that take a bare WorkshopDoc. Non-envelope
 * input passes through unchanged; a clip-motion has no inline document — its
 * trajectory lives in the clip asset, so unwrapping is a hard error. */
export function unwrapMotionFile(raw:unknown):unknown{
 if(!isObj(raw))return raw;
 if(raw.kind==='workshop-motion')return raw.document;
 if(raw.kind==='clip-motion')throw new Error('clip-motion 没有内嵌 document：轨迹在外部 clip 资产中');
 return raw;
}

/** The solved-motion definition that enters the artifact hash: document plus
 * the phases/notes/license that give the package its semantics — never the
 * display-only envelope fields. */
export function motionDefinitionPayload(f:MotionFile){
 return {schema:'workshop-motion/v1' as const,id:f.id,document:f.document,phases:f.phases,notes:f.notes??[],license:f.license};
}
