import type {WorkshopDoc} from '@human3d/motion-core';
import {blankDocument,canonicalizeHands,defaultDocument,MOTION_FILES,newDocId,normalizeDoc,parseDoc} from '@human3d/motion-core';
import type {Vector3} from 'three';

/** Motion library: the workshop's persistent store. Multiple named documents
 * live under one namespaced localStorage key; the injected StorageLike keeps
 * the store testable and side-effect free outside the browser.
 *
 * Stored documents that fail validation are moved to `quarantine` with the
 * reason and the original JSON. They stay in storage and can be exported, so
 * a document is never silently lost. */

/** A stored document that could not be admitted. `raw` is the original JSON value. */
export interface QuarantineEntry{id:string;name:string;reason:string;raw:unknown}
export interface LibraryFile{schemaVersion:2;activeId:string;docs:WorkshopDoc[];quarantine:QuarantineEntry[]}
export interface StorageLike{getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem?(k:string):void}
export const LIBRARY_KEY='kinesis-workshop-library';
/** Only bundled trajectories have editable workshop keys. */
export const WORKSHOP_PRESETS=MOTION_FILES.filter(f=>f.kind==='workshop-motion'&&f.document);
/** The library's lead group: reusable basic actions (≤3 keys each) that the
 * workshop inserts at the playhead. */
export const BASIC_PRESETS=WORKSHOP_PRESETS.filter(f=>f.category==='basic');
/** Tennis motions that declare the racket prop; the racket is a plugin they opt into. */
export const RACKET_PRESETS=WORKSHOP_PRESETS.filter(f=>f.capabilities?.prop?.kind==='racket');
/** Older bundled motions without a basic or racket tag (idle, reach, squat, ready). */
export const OTHER_PRESETS=WORKSHOP_PRESETS.filter(f=>f.category!=='basic'&&!f.capabilities?.prop);

function docIdTaken(docs:WorkshopDoc[],id:string){return docs.some(d=>d.id===id);}
const nameOf=(raw:unknown)=>{const n=raw&&typeof raw==='object'?(raw as {name?:unknown}).name:undefined;return typeof n==='string'?n:'';};
const idOf=(raw:unknown)=>{const n=raw&&typeof raw==='object'?(raw as {id?:unknown}).id:undefined;return typeof n==='string'?n:'';};
export class MotionLibrary{
  docs:WorkshopDoc[]=[];activeId='';quarantine:QuarantineEntry[]=[];
  /** Set when the last save() failed (quota/private mode) — the UI must not
   * claim the motion was persisted when it only lives in memory. */
  lastError='';
  /** Fired after a document leaves the library — the app drops the doc's
   * undo book here so a later doc re-using the id can't inherit (and undo
   * into) the deleted doc's snapshots. */
  onRemoved?:(id:string)=>void;
  constructor(private rest:ReadonlyMap<string,Vector3>,private store?:StorageLike|null){}
  load(){
    let parsed:Partial<LibraryFile>|undefined,rawText:string|null=null,corrupt=false;
    try{rawText=this.store?.getItem(LIBRARY_KEY)??null;if(rawText!=null)parsed=JSON.parse(rawText) as Partial<LibraryFile>;}catch{corrupt=true;}
    const version=(parsed as {schemaVersion?:number}|undefined)?.schemaVersion;
    const file=(!corrupt&&version===2&&parsed&&Array.isArray(parsed.docs))?parsed:undefined;
    if(file){
      this.docs=[];this.quarantine=Array.isArray(file.quarantine)?file.quarantine.filter(q=>q&&typeof q==='object'):[];
      for(const raw of file.docs!){
        try{
          const doc=normalizeDoc(raw);
          if(docIdTaken(this.docs,doc.id))throw new Error(`重复的动作编号 ${doc.id}`);
          this.docs.push(doc);
        }catch(err){
          this.quarantine.push({id:idOf(raw),name:nameOf(raw),reason:err instanceof Error?err.message:String(err),raw});
        }
      }
      // Stored docs predate the orthonormal hand-frame contract — normalize on
      // rehydrate so sampled poses reproduce stored keys exactly.
      for(const d of this.docs)for(const k of d.keys)canonicalizeHands(k.pose);
      this.activeId=this.docs.some(d=>d.id===file.activeId)?file.activeId!:this.docs[0]?.id??'';
    }else if(rawText){
      // The stored file isn't a readable v2 library (corrupt JSON or an
      // unknown/future schemaVersion). Keep the raw string in quarantine and
      // skip the auto-save below — overwriting storage would destroy the only
      // copy of the user's data. It is rewritten only by an explicit save.
      this.quarantine=[{id:'library-file',name:'动作库文件',reason:corrupt?'动作库文件 JSON 无法解析':'无法识别的动作库格式（schemaVersion 不受支持）',raw:rawText}];
    }
    if(!this.docs.length){this.docs=[defaultDocument(this.rest)];this.activeId=this.docs[0].id;}
    if(file||!rawText)this.save();
    return this;
  }
  save(){
    if(!this.store)return;
    const file:LibraryFile={schemaVersion:2,activeId:this.activeId,docs:this.docs,quarantine:this.quarantine};
    try{this.store.setItem(LIBRARY_KEY,JSON.stringify(file));this.lastError='';}catch(err){this.lastError=err instanceof Error?err.message:String(err);}
  }
  /** Export one quarantined document as JSON text, so it can be repaired by hand or re-imported. */
  quarantineText(index:number){const q=this.quarantine[index];return q?typeof q.raw==='string'?q.raw:JSON.stringify(q.raw,null,2):'';}
  /** Remove a quarantined entry after the user has exported or repaired it. */
  discardQuarantine(index:number){if(index>=0&&index<this.quarantine.length){this.quarantine.splice(index,1);this.save();}}
  active(){return this.docs.find(d=>d.id===this.activeId)??this.docs[0];}
  select(id:string){if(docIdTaken(this.docs,id)){this.activeId=id;this.save();}return this.active();}
  /** Create a blank custom motion from the stance template and select it. */
  create(name:string){
    const trimmed=name.trim()||`新动作 ${this.docs.length+1}`;
    let id=newDocId(trimmed);while(docIdTaken(this.docs,id))id=newDocId(trimmed);
    const doc=blankDocument(this.rest,trimmed,id);
    this.docs.push(doc);this.activeId=id;this.save();return doc;
  }
  /** Start an independent manual motion without mutating the bundled preset. */
  createFromPreset(presetId:string,name=''){
    const preset=WORKSHOP_PRESETS.find(f=>f.id===presetId);
    if(!preset?.document)throw new Error('该预设没有可编辑的工作台轨迹，请选择关键帧动作。');
    const copy=structuredClone(preset.document);
    copy.name=name.trim()||`${preset.name} 副本`;
    do{copy.id=newDocId(copy.name);}while(docIdTaken(this.docs,copy.id));
    copy.keys.forEach((k,i)=>{k.id=`${copy.id}-k${i}`;});
    this.docs.push(copy);this.activeId=copy.id;this.save();return copy;
  }
  duplicate(id:string){
    const src=this.docs.find(d=>d.id===id);if(!src)return undefined;
    let nid=newDocId(`${src.name}-副本`);while(docIdTaken(this.docs,nid))nid=newDocId(`${src.name}-副本`);
    const copy=parseDoc(JSON.stringify(src)) as WorkshopDoc;
    copy.id=nid;copy.name=`${src.name} 副本`;copy.keys.forEach((k,i)=>{k.id=`${nid}-k${i}`;});
    this.docs.push(copy);this.activeId=nid;this.save();return copy;
  }
  remove(id:string){
    const idx=this.docs.findIndex(d=>d.id===id);if(idx<0)return;
    const wasActive=this.activeId===id;
    this.docs.splice(idx,1);
    this.onRemoved?.(id);
    if(wasActive)this.activeId=this.docs[Math.min(idx,this.docs.length-1)]?.id??'';
    if(!this.docs.length)this.create('新动作');
    this.save();
  }
  rename(id:string,name:string){const d=this.docs.find(x=>x.id===id);if(d){d.name=name;this.save();}}
  /** Move `activeId` to the slot occupied by `overId`. No-op when either id is missing. */
  reorder(activeId:string, overId:string){
   const from=this.docs.findIndex(d=>d.id===activeId), to=this.docs.findIndex(d=>d.id===overId);
   if(from<0||to<0||from===to)return;
   const [doc]=this.docs.splice(from, 1);
   this.docs.splice(to, 0, doc);
   this.save();
  }
  /** Insert a parsed import; regenerates the id when it clashes. */
  add(doc:WorkshopDoc){
    if(docIdTaken(this.docs,doc.id))doc.id=newDocId(doc.name);
    this.docs.push(doc);this.activeId=doc.id;this.save();return doc;
  }
}
