import type {WorkshopDoc} from './document';
import {blankDocument,defaultDocument,newDocId,parseDoc} from './document';
import type {Vector3} from 'three';

/** Motion library: the workshop's persistent store. Multiple named documents
 * live under one namespaced localStorage key; the injected StorageLike keeps
 * the store testable and side-effect free outside the browser. */

export interface LibraryFile{schemaVersion:1;activeId:string;docs:WorkshopDoc[]}
export interface StorageLike{getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem?(k:string):void}
export const LIBRARY_KEY='kinesis-workshop-library';

function docIdTaken(docs:WorkshopDoc[],id:string){return docs.some(d=>d.id===id);}
function validateDoc(d:WorkshopDoc):d is WorkshopDoc{
  return d.schemaVersion===1&&typeof d.id==='string'&&typeof d.name==='string'&&typeof d.duration==='number'&&d.duration>0&&Array.isArray(d.keys)&&d.keys.length>=2&&d.keys.every(k=>typeof k.time==='number'&&!!k.pose&&!!k.constraints);
}
export class MotionLibrary{
  docs:WorkshopDoc[]=[];activeId='';
  constructor(private rest:ReadonlyMap<string,Vector3>,private store?:StorageLike|null){}
  load(){
    let parsed:LibraryFile|undefined;
    try{const raw=this.store?.getItem(LIBRARY_KEY);if(raw)parsed=JSON.parse(raw) as LibraryFile;}catch{/* corrupted storage → reseed */}
    if(parsed?.schemaVersion===1&&Array.isArray(parsed.docs)){
      this.docs=parsed.docs.filter(validateDoc);
      this.activeId=this.docs.some(d=>d.id===parsed.activeId)?parsed.activeId:this.docs[0]?.id??'';
    }
    if(!this.docs.length){this.docs=[defaultDocument(this.rest)];this.activeId=this.docs[0].id;this.save();}
    return this;
  }
  save(){
    if(!this.store)return;
    try{this.store.setItem(LIBRARY_KEY,JSON.stringify({schemaVersion:1,activeId:this.activeId,docs:this.docs} satisfies LibraryFile));}catch{/* quota/private mode — keep working in memory */}
  }
  active(){return this.docs.find(d=>d.id===this.activeId)??this.docs[0];}
  select(id:string){if(docIdTaken(this.docs,id)){this.activeId=id;this.save();}return this.active();}
  /** Create a blank custom motion from the stance template and select it. */
  create(name:string){
    const trimmed=name.trim()||`新动作 ${this.docs.length+1}`;
    let id=newDocId(trimmed);while(docIdTaken(this.docs,id))id=newDocId(trimmed);
    const doc=blankDocument(this.rest,trimmed,id);
    this.docs.push(doc);this.activeId=id;this.save();return doc;
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
    if(wasActive)this.activeId=this.docs[Math.min(idx,this.docs.length-1)]?.id??'';
    if(!this.docs.length)this.create('新动作');
    this.save();
  }
  rename(id:string,name:string){const d=this.docs.find(x=>x.id===id);if(d){d.name=name;this.save();}}
  /** Insert a parsed import; regenerates the id when it clashes. */
  add(doc:WorkshopDoc){
    if(docIdTaken(this.docs,doc.id))doc.id=newDocId(doc.name);
    this.docs.push(doc);this.activeId=doc.id;this.save();return doc;
  }
}
