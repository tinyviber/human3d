import {useRef} from 'react';
import {DndContext, PointerSensor, useDraggable, useSensor, useSensors} from '@dnd-kit/core';
import type {DragEndEvent, DragMoveEvent, DragStartEvent} from '@dnd-kit/core';
import {SortableContext, useSortable, verticalListSortingStrategy} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';
import {GripVertical, Plus, Trash2} from 'lucide-react';
import {sortedKeys} from '@human3d/motion-core';
import type {WorkshopDoc} from '@human3d/motion-core';

const fmt=(t:number)=>`${Math.floor(t/60)}:${(Math.floor(t%60)).toString().padStart(2,'0')}.${Math.floor(t*100%100).toString().padStart(2,'0')}`;

function KeyDot({id, time, duration, selected, contact, title, onActivate}:{id:string;time:number;duration:number;selected:boolean;contact:boolean;title:string;onActivate:()=>void}){
 const {setNodeRef, listeners, attributes}=useDraggable({id});
 return <button ref={setNodeRef} className={`ws-key ${selected?'sel':''} ${contact?'contact':''}`} style={{left:`${time/duration*100}%`}} title={title} {...listeners} {...attributes} onClick={onActivate}/>;
}

/** Timeline keys are dnd-kit draggables. A short press still selects and seeks;
 * a drag past 6px retimes the key between its neighbors. */
export function Timeline({doc, time, selected, onSelect, onSeek, onRetime}:{doc:WorkshopDoc;time:number;selected:string;onSelect:(id:string)=>void;onSeek:(t:number)=>void;onRetime:(id:string, t:number)=>void}){
 const track=useRef<HTMLDivElement>(null);
 const origin=useRef<{id:string;time:number}|null>(null);
 const sensors=useSensors(useSensor(PointerSensor, {activationConstraint:{distance:6}}));
 const keys=sortedKeys(doc);
 const clamp=(id:string, t:number)=>{
  const list=sortedKeys(doc), i=list.findIndex(k=>k.id===id);
  const lo=(list[i-1]?.time??0)+.01, hi=(list[i+1]?.time??doc.duration)-.01;
  return Math.max(lo, Math.min(hi, t));
 };
 const onDragStart=(e:DragStartEvent)=>{
  const id=String(e.active.id);
  origin.current={id, time:keys.find(k=>k.id===id)?.time??0};
  onSelect(id);
 };
 const onDragMove=(e:DragMoveEvent)=>{
  const start=origin.current, width=track.current?.getBoundingClientRect().width??0;
  if(!start||!(width>0))return;
  onRetime(start.id, clamp(start.id, start.time+e.delta.x/width*doc.duration));
 };
 const onDragEnd=(e:DragEndEvent)=>{
  const id=String(e.active.id);
  if(Math.hypot(e.delta.x, e.delta.y)<6){const k=sortedKeys(doc).find(item=>item.id===id);if(k)onSeek(k.time);}
  origin.current=null;
 };
 const frac=(x:number)=>{const r=track.current!.getBoundingClientRect();return Math.max(0, Math.min(1, (x-r.left)/r.width));};
 return <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={()=>{origin.current=null;}}>
  <div className="ws-track-wrap">
   <div ref={track} className="ws-track" onPointerDown={e=>{if(e.target===e.currentTarget)onSeek(frac(e.clientX)*doc.duration);}}>
    <div className="ws-progress" style={{width:`${time/doc.duration*100}%`}}/>
    <div className="ws-cursor" style={{left:`${time/doc.duration*100}%`}}/>
    {keys.map(k=><KeyDot key={k.id} id={k.id} time={k.time} duration={doc.duration} selected={k.id===selected} contact={!!k.constraints.contact} title={`${k.label||'关键帧'} · ${k.time.toFixed(2)}s`} onActivate={()=>{onSelect(k.id);onSeek(k.time);}}/>)}
   </div>
   <div className="ws-track-labels">{keys.map(k=><button key={k.id} className={k.id===selected?'sel':''} style={{left:`${k.time/doc.duration*100}%`}} onClick={()=>{onSelect(k.id);onSeek(k.time);}}>{k.label||fmt(k.time)}</button>)}</div>
  </div>
 </DndContext>;
}

function LibRow({id, name, meta, selected, onSelect, onDuplicate, onRemove}:{id:string;name:string;meta:string;selected:boolean;onSelect:()=>void;onDuplicate:()=>void;onRemove:()=>void}){
 const {attributes, listeners, setNodeRef, transform, transition}=useSortable({id});
 return <div ref={setNodeRef} className={`ws-lib-row ${selected?'sel':''}`} style={{transform:CSS.Transform.toString(transform), transition}}>
  <button type="button" className="ws-drag" aria-label={`拖动排序 ${name}`} {...attributes} {...listeners}><GripVertical size={12}/></button>
  <button className="ws-lib-name" onClick={onSelect} title={id}><span>{name}</span><small>{meta}</small></button>
  <button aria-label={`复制 ${name}`} title="复制" onClick={onDuplicate}><Plus size={12}/></button>
  <button aria-label={`删除 ${name}`} title="删除" onClick={onRemove}><Trash2 size={12}/></button>
 </div>;
}

/** Library order is a sortable list. The name button stays a click target;
 * only the grip starts a drag, so QA's name click is unchanged. */
export function LibraryList({docs, activeId, onSelect, onDuplicate, onRemove, onReorder}:{docs:WorkshopDoc[];activeId:string;onSelect:(id:string)=>void;onDuplicate:(id:string)=>void;onRemove:(id:string)=>void;onReorder:(activeId:string, overId:string)=>void}){
 const sensors=useSensors(useSensor(PointerSensor, {activationConstraint:{distance:6}}));
 return <DndContext sensors={sensors} onDragEnd={e=>{const over=e.over?.id;if(over&&e.active.id!==over)onReorder(String(e.active.id), String(over));}}>
  <SortableContext items={docs.map(d=>d.id)} strategy={verticalListSortingStrategy}>
   <div className="ws-lib">
    {docs.map(doc=><LibRow key={doc.id} id={doc.id} name={doc.name} meta={`${doc.keys.length} 关键帧 · ${doc.duration.toFixed(2)}s`} selected={doc.id===activeId} onSelect={()=>onSelect(doc.id)} onDuplicate={()=>onDuplicate(doc.id)} onRemove={()=>onRemove(doc.id)}/>)}
   </div>
  </SortableContext>
 </DndContext>;
}
