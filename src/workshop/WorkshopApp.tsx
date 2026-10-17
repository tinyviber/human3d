import {useEffect,useRef,useState} from 'react';
import {Vector3} from 'three';
import {Activity,ArrowLeft,Camera,Check,Download,Film,Pause,Play,Plus,Redo2,RotateCcw,Sparkles,Trash2,Undo2,Upload,Video,X} from 'lucide-react';
import {WorkshopEngine} from './engine';
import type {WorkshopFrame} from './engine';
import type {HandFrame,WorkshopDoc,WorkshopKey} from './document';
import {contactStartKey,defaultDocument,ensureKey,isReleaseKey,keyAt,loopBlockers,nearestKey,parseDoc,retimeKeys,serializeDoc,setKeyTime,sortedKeys} from './document';
import {MotionLibrary} from './library';
import {HistoryBook,RecordGate} from './history';
import {clampDuration,WORKSHOP_LIMITS} from './limits';
import {ankleYForLift,footLift,type Side} from './foot';
import {rotateHandFrame} from './solver';
import type {RigInfo,ViewId} from '../core/types';

const fmt=(t:number)=>`${Math.floor(t/60)}:${(Math.floor(t%60)).toString().padStart(2,'0')}.${Math.floor(t*100%100).toString().padStart(2,'0')}`;

function Row({label,checked,onChange,detail,disabled}:{label:string;checked:boolean;onChange:(v:boolean)=>void;detail?:string;disabled?:boolean}){
 return <label className="ws-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><span>{label}{detail?<small>{detail}</small>:null}</span></label>;
}
function Slider({label,value,min,max,step,unit,disabled,onChange}:{label:string;value:number;min:number;max:number;step:number;unit?:string;disabled?:boolean;onChange:(v:number)=>void}){
 return <label className="ws-slider"><span>{label}<output>{value.toFixed(unit==='m'?3:1)}{unit??'°'}</output></span><input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
/** Delta sliders for the stored wrist frame: the control resets to zero each
 * key, edits rotate the key's forward/normal pair by the slider delta. */
function WristPanel({k,side,edit}:{k:WorkshopKey;side:Side;edit:(fn:(key:WorkshopKey)=>void)=>void}){
 const [v,setV]=useState({flex:0,dev:0,twist:0});
 const turn=(kind:'flex'|'dev'|'twist',next:number)=>{
  const delta=next-v[kind];setV({...v,[kind]:next});
  edit(key=>{rotateHandFrame(side==='L'?key.pose.handL:key.pose.handR,kind,delta);});
 };
 return <div className="ws-sub"><h3>{side==='L'?'左':'右'}手腕姿态 <small>屈伸 / 侧偏 / 旋转</small></h3>
  <Slider label="屈 / 伸" value={v.flex} min={-60} max={60} step={1} onChange={x=>turn('flex',x)}/>
  <Slider label="尺桡偏" value={v.dev} min={-60} max={60} step={1} onChange={x=>turn('dev',x)}/>
  <Slider label="旋前 / 旋后" value={v.twist} min={-90} max={90} step={1} onChange={x=>turn('twist',x)}/>
 </div>;
}
function Timeline({doc,time,selected,onSelect,onSeek,onRetime}:{doc:WorkshopDoc;time:number;selected:string;onSelect:(id:string)=>void;onSeek:(t:number)=>void;onRetime:(id:string,t:number)=>void}){
 const track=useRef<HTMLDivElement>(null);
 const [dragKey,setDragKey]=useState<string|null>(null);
 const frac=(x:number)=>{const r=track.current!.getBoundingClientRect();return Math.max(0,Math.min(1,(x-r.left)/r.width));};
 const move=(ev:{clientX:number})=>{
  if(!dragKey||!track.current)return;
  const keys=sortedKeys(doc),i=keys.findIndex(k=>k.id===dragKey);
  const lo=(keys[i-1]?.time??0)+.01,hi=(keys[i+1]?.time??doc.duration)-.01;
  onRetime(dragKey,Math.max(lo,Math.min(hi,frac(ev.clientX)*doc.duration)));
 };
 return <div className="ws-track-wrap">
  <div ref={track} className="ws-track" onPointerDown={e=>{if(e.target===e.currentTarget)onSeek(frac(e.clientX)*doc.duration);}} onPointerMove={move} onPointerUp={()=>setDragKey(null)}>
   <div className="ws-progress" style={{width:`${time/doc.duration*100}%`}}/>
   <div className="ws-cursor" style={{left:`${time/doc.duration*100}%`}}/>
   {sortedKeys(doc).map(k=><button key={k.id} className={`ws-key ${k.id===selected?'sel':''} ${k.constraints.contact?'contact':''}`} style={{left:`${k.time/doc.duration*100}%`}}
     title={`${k.label||'关键帧'} · ${k.time.toFixed(2)}s`}
     onPointerDown={e=>{e.stopPropagation();onSelect(k.id);setDragKey(k.id);(e.target as HTMLElement).setPointerCapture(e.pointerId);}}
     onPointerMove={move} onPointerUp={()=>setDragKey(null)}
     onClick={()=>{onSelect(k.id);onSeek(k.time);}}/>)}
  </div>
  <div className="ws-track-labels">{sortedKeys(doc).map(k=><button key={k.id} className={k.id===selected?'sel':''} style={{left:`${k.time/doc.duration*100}%`}} onClick={()=>{onSelect(k.id);onSeek(k.time);}}>{k.label||fmt(k.time)}</button>)}</div>
 </div>;
}
export function WorkshopApp({info:rigInfo}:{info:RigInfo}){
 const mount=useRef<HTMLDivElement>(null),engine=useRef<WorkshopEngine|null>(null),video=useRef<HTMLVideoElement>(null),fileRef=useRef<HTMLInputElement>(null),importRef=useRef<HTMLInputElement>(null);
 const lib=useRef<MotionLibrary|null>(null);
 if(!lib.current)lib.current=new MotionLibrary(new Map(rigInfo.bones.map(b=>[b.name,new Vector3().fromArray(b.head)])),globalThis.localStorage).load();
 const [,bump]=useState(0);
 const [selected,setSelected]=useState('k-contact');
 const [newName,setNewName]=useState('');
 const [info,setInfo]=useState<RigInfo|null>(null),[error,setError]=useState('');
 const [frame,setFrame]=useState<WorkshopFrame>({time:0,duration:.8,playing:true,label:''});
 const [view,setView]=useState<ViewId>('threeQuarter');
 const books=useRef(new HistoryBook()),gate=useRef(new RecordGate()),wristEpoch=useRef(0),shortcuts=useRef<{undo:()=>void;redo:()=>void}>({undo:()=>{},redo:()=>{}});
 const [hint,setHint]=useState('');
 useEffect(()=>{if(!hint)return;const t=setTimeout(()=>setHint(''),6000);return()=>clearTimeout(t);},[hint]);
 const [opts,setOpts]=useState({handles:true,trajectories:true,balance:true});
 const [videoUrl,setVideoUrl]=useState('');const [sync,setSync]=useState(false);const syncOffset=useRef(0);const [videoPlaying,setVideoPlaying]=useState(false);
 useEffect(()=>{
  if(!mount.current)return;let e:WorkshopEngine;
  try{
   e=new WorkshopEngine(mount.current,()=>lib.current!.active());engine.current=e;
   e.onReady=setInfo;
   e.onError=err=>setError(err.message);
   e.onFrame=setFrame;
   e.onSelectKey=setSelected;
   let lastDragSave=0;
   // Persist drags throttled while moving and unconditionally at drag end;
   // before this, a pose edit could be lost if the page closed before the
   // next explicit save.
   e.onDocChanged=()=>{const now=performance.now();if(now-lastDragSave>500){lastDragSave=now;lib.current!.save();}bump(v=>v+1);};
   e.onEditEnd=()=>{lib.current!.save();bump(v=>v+1);};
   e.onBeginEdit=(time,prefer)=>{
    const d=lib.current!.active();
    // Snapshot before any key is inserted, so one drag is one undo step.
    books.current.of(d.id).record(d);gate.current.touch(d.id,performance.now());
    if(prefer){const k=keyAt(d,prefer);if(k)return k;}
    const k=ensureKey(d,time,e.restRoot());
    if(!k){setHint(`已达 ${WORKSHOP_LIMITS.maxKeys} 个关键帧上限：先删除不需要的帧，或在时间轴上选中既有帧再编辑。`);return null;}
    lib.current!.save();bump(v=>v+1);return k;
   };
   void e.load();
   if(import.meta.env.DEV)(window as unknown as {__WS__:WorkshopEngine}).__WS__=e;
  }catch(err){setError(err instanceof Error?err.message:String(err));return;}
  return()=>{engine.current=null;e.dispose();};
 },[]);
 // Video ↔ timeline sync.
 useEffect(()=>{
  const el=video.current;if(!el||!sync)return;
  const target=frame.time+syncOffset.current;
  if(frame.playing){el.playbackRate=engine.current?.speed??1;if(Math.abs(el.currentTime-target)>.15)el.currentTime=target;if(el.paused)void el.play();}
  else if(Math.abs(el.currentTime-target)>.05)el.currentTime=target;
 },[frame,sync]);
 const L=lib.current!;
 /** Snapshot before an edit. Edits within 600 ms on the SAME document (a slider
  * drag) share one undo step; another document or a gap always starts a new one. */
 const recordBefore=(doc:WorkshopDoc)=>{if(gate.current.should(doc.id,performance.now()))books.current.of(doc.id).record(doc);};
 const edit=(fn:(d:WorkshopDoc)=>void)=>{recordBefore(L.active());fn(L.active());L.save();engine.current?.setPlaying(false);engine.current?.markDirty();bump(v=>v+1);};
 const applyDoc=(next:WorkshopDoc)=>{const i=L.docs.findIndex(x=>x.id===next.id);if(i<0)return;L.docs[i]=next;L.save();gate.current.reset();wristEpoch.current++;const e=engine.current;e?.setPlaying(false);e?.markDirty();e?.seek(Math.min(frame.time,next.duration));if(!keyAt(next,selected))setSelected(sortedKeys(next)[0]?.id??'');bump(v=>v+1);};
 const undo=()=>{const cur=L.active();const prev=books.current.of(cur.id).undo(cur);if(prev)applyDoc(prev);};
 const redo=()=>{const cur=L.active();const next=books.current.of(cur.id).redo(cur);if(next)applyDoc(next);};
 shortcuts.current={undo,redo};
 useEffect(()=>{
  // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes. Text fields keep their native undo.
  const onKey=(ev:KeyboardEvent)=>{
   const t=ev.target as HTMLElement|null;
   if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return;
   if(!(ev.ctrlKey||ev.metaKey))return;
   const k=ev.key.toLowerCase();
   if(k==='z'&&!ev.shiftKey){ev.preventDefault();shortcuts.current.undo();}
   else if((k==='z'&&ev.shiftKey)||k==='y'){ev.preventDefault();shortcuts.current.redo();}
  };
  window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
 },[]);
 const exportQuarantine=(i:number)=>{const q=L.quarantine[i];if(!q)return;const blob=new Blob([L.quarantineText(i)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${q.id||'quarantined'}.quarantine.json`;a.click();URL.revokeObjectURL(a.href);};
 const liftOf=(side:Side,k:WorkshopKey)=>{const f=side==='L'?k.pose.footL:k.pose.footR;const g=engine.current?.footGeometry(side);return g?footLift(g,f.target.y,f.yaw,f.pitch):f.target.y;};
 const setLift=(side:Side,v:number)=>editSelected(k=>{const f=side==='L'?k.pose.footL:k.pose.footR;const g=engine.current?.footGeometry(side);f.target.y=g?ankleYForLift(g,v,f.yaw,f.pitch):v;});

 const editSelected=(fn:(k:WorkshopKey)=>void)=>{const k=keyAt(L.active(),selected);if(k)edit(()=>fn(k));};
 const d=L.active();
 const sel=keyAt(d,selected)??nearestKey(d,frame.time,1e9);
 const analysis=frame.analysis;
 const selectDoc=(id:string)=>{const doc=L.select(id);setSelected(sortedKeys(doc)[0].id);engine.current?.seek(0);engine.current?.setPlaying(false);engine.current?.markDirty();bump(v=>v+1);};
 const createDoc=()=>{const doc=L.create(newName);setNewName('');setSelected(sortedKeys(doc)[0].id);engine.current?.seek(0);engine.current?.markDirty();bump(v=>v+1);};
 const duplicateDoc=(id:string)=>{const doc=L.duplicate(id);if(doc)selectDoc(doc.id);};
 const removeDoc=(id:string)=>{const victim=L.docs.find(x=>x.id===id);if(victim&&!confirm(`删除动作「${victim.name}」？此操作不可撤销。`))return;L.remove(id);setSelected(sortedKeys(L.active())[0].id);engine.current?.seek(0);engine.current?.markDirty();bump(v=>v+1);};
 const addKey=()=>{
  if(d.keys.length>=WORKSHOP_LIMITS.maxKeys&&!nearestKey(d,frame.time)){setHint(`已达 ${WORKSHOP_LIMITS.maxKeys} 个关键帧上限，请先删除不再需要的关键帧。`);return;}
  recordBefore(d);const k=ensureKey(d,frame.time,engine.current?.restRoot());if(!k){setHint(`已达 ${WORKSHOP_LIMITS.maxKeys} 个关键帧上限，请先删除不再需要的关键帧。`);return;}
  setSelected(k.id);edit(()=>{});
 };
 const delKey=()=>{if(d.keys.length<=2||!sel)return;edit(dd=>{dd.keys=dd.keys.filter(k=>k.id!==sel.id);});setSelected(sortedKeys(d)[0].id);};
 const exportDoc=()=>{const blob=new Blob([serializeDoc(d)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${d.id}.workshop.json`;a.click();URL.revokeObjectURL(a.href);};
 const importDoc=async(f:File)=>{try{const next=parseDoc(await f.text());const added=L.add(next);selectDoc(added.id);}catch(e){setError(e instanceof Error?e.message:String(e));}};
 const loadVideo=(f:File)=>{if(videoUrl)URL.revokeObjectURL(videoUrl);setVideoUrl(URL.createObjectURL(f));};
 const alignVideo=()=>{if(video.current)syncOffset.current=video.current.currentTime-frame.time;};
 const stampVideo=()=>{if(video.current)editSelected(k=>{k.videoTime=video.current!.currentTime;});};
 return <div className="ws-shell">
  <header className="ws-header">
   <div className="brand"><Activity size={25} strokeWidth={2}/><span>KINESIS</span><i/><h1>动作工作台</h1><small>姿态优先 · 关键帧 + 约束</small></div>
   <nav><a href="/" className="ws-back"><ArrowLeft size={14}/>返回实验室</a></nav>
  </header>
  <main className="ws-main">
   <aside className="ws-left">
    <section className="ws-card"><h2>动作库 <small>{L.docs.length} 个动作</small></h2>
     <div className="ws-lib">
      {L.docs.map(doc=><div key={doc.id} className={`ws-lib-row ${doc.id===d.id?'sel':''}`}>
       <button className="ws-lib-name" onClick={()=>selectDoc(doc.id)} title={doc.id}><span>{doc.name}</span><small>{doc.keys.length} 关键帧 · {doc.duration.toFixed(2)}s</small></button>
       <button aria-label={`复制 ${doc.name}`} title="复制" onClick={()=>duplicateDoc(doc.id)}><Plus size={12}/></button>
       <button aria-label={`删除 ${doc.name}`} title="删除" onClick={()=>removeDoc(doc.id)}><Trash2 size={12}/></button>
      </div>)}
     </div>
     <div className="ws-row">
      <input className="ws-newname" value={newName} placeholder="新动作名称…" onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')createDoc();}}/>
      <button onClick={createDoc}><Plus size={13}/>新建</button>
     </div>
     <p className="ws-note" style={L.lastError?{color:'#c0392b'}:undefined}>{L.lastError?`保存失败（仅存于内存）：${L.lastError}`:'动作自动保存到本机浏览器；导出 JSON 可跨设备分享。'}</p>
     {L.quarantine.length?<div className="ws-quarantine"><p className="ws-note" style={{color:'#c0392b'}}>{L.quarantine.length} 个动作未通过校验，已隔离保存，不参与播放。导出后可修复再导入。</p>
      {L.quarantine.map((q,i)=><div key={`${q.id}-${i}`} className="ws-row"><small>{q.name||q.id||'未命名'}：{q.reason}</small><button onClick={()=>exportQuarantine(i)}><Download size={12}/>导出</button><button aria-label={`丢弃 ${q.name||q.id}`} onClick={()=>{if(confirm('丢弃这个隔离动作？此操作不可撤销。'))L.discardQuarantine(i);bump(v=>v+1);}}><Trash2 size={12}/></button></div>)}
     </div>:null}
    </section>
    <section className="ws-card"><h2>动作文档</h2>
     <label className="ws-field"><span>名称</span><input value={d.name} onChange={e=>edit(dd=>{dd.name=e.target.value;})}/></label>
     <label className="ws-field"><span>时长 s（{WORKSHOP_LIMITS.minDuration}–{WORKSHOP_LIMITS.maxDuration}）</span><input type="number" min={WORKSHOP_LIMITS.minDuration} max={WORKSHOP_LIMITS.maxDuration} step=".1" value={d.duration} onChange={e=>edit(dd=>retimeKeys(dd,clampDuration(Number(e.target.value))))}/></label>
     <p className="ws-note">{d.keys.length} 个关键帧 · {d.inbetweens?'Hermite 补间':'逐帧保持'}</p>
     <Row label="循环播放" detail={loopBlockers(d).join('；')||'首帧位于 0 s，末帧早于时长'} checked={d.loop} disabled={!d.loop&&loopBlockers(d).length>0} onChange={v=>edit(dd=>{if(v&&loopBlockers(dd).length)return;dd.loop=v;})}/>
     <label className="ws-field"><span>左手坐标系</span><select value={d.handFrames.L} onChange={e=>edit(dd=>{dd.handFrames.L=e.target.value as HandFrame;})}><option value="pelvis">骨盆坐标（推荐）</option><option value="world">世界坐标（旧版）</option></select></label>
     <label className="ws-field"><span>右手坐标系</span><select value={d.handFrames.R} onChange={e=>edit(dd=>{dd.handFrames.R=e.target.value as HandFrame;})}><option value="pelvis">骨盆坐标（推荐）</option><option value="world">世界坐标（旧版）</option></select></label>
     <Row label="抬肩辅助" detail="手高于胸口时锁骨与肩部随动上抬" checked={d.clavicleLift===true} onChange={v=>edit(dd=>{dd.clavicleLift=v||undefined;})}/>
     <div className="ws-row">
      <button onClick={exportDoc}><Download size={13}/>导出 JSON</button>
      <button onClick={()=>importRef.current?.click()}><Upload size={13}/>导入</button>
      <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void importDoc(f);e.target.value='';}}/>
     </div>
    </section>
    <section className="ws-card"><h2>参考视频 <small>WHAM 自动估计待接入</small></h2>
     {videoUrl?<video ref={video} src={videoUrl} muted loop playsInline onPlay={()=>setVideoPlaying(true)} onPause={()=>setVideoPlaying(false)}/>:
      <button className="ws-video-pick" onClick={()=>fileRef.current?.click()}><Video size={18}/>载入参考视频</button>}
     <input ref={fileRef} type="file" accept="video/*" hidden onChange={e=>{const f=e.target.files?.[0];if(f)loadVideo(f);e.target.value='';}}/>
     {videoUrl?<><div className="ws-row">
       <button onClick={()=>{const el=video.current!;el.paused?void el.play():el.pause();}}>{videoPlaying?<Pause size={13}/>:<Play size={13}/>}</button>
       <button onClick={()=>{if(video.current)video.current.currentTime=Math.max(0,video.current.currentTime-1/30);}}>-1帧</button>
       <button onClick={()=>{if(video.current)video.current.currentTime+=1/30;}}>+1帧</button>
       <button onClick={alignVideo} title="把视频当前帧对齐到时间轴当前位置"><Camera size={13}/>对齐</button>
      </div>
      <Row label="与时间轴同步" checked={sync} onChange={setSync}/>
      <button className="ws-mini" onClick={stampVideo} disabled={!sel}>记录视频帧到当前关键帧</button>
      <div className="ws-vkeys">{d.keys.filter(k=>k.videoTime!==undefined).map(k=><button key={k.id} onClick={()=>{engine.current?.seek(k.time);if(video.current)video.current.currentTime=k.videoTime!;setSelected(k.id);}}><Film size={11}/>{k.label||fmt(k.time)}<small>{fmt(k.videoTime!)}</small></button>)}</div>
     </>:null}
    </section>
    <section className="ws-card ws-legend"><h2>手柄</h2>
     <p><i style={{background:'#2469ee'}}/>髋部 / 根骨</p>
     <p><i style={{background:'#ec8c39'}}/>手腕（IK 末端）</p>
     <p><i style={{background:'#e2543a'}}/>脚踝（支撑贴地 · 离地可三维拖动）</p>
     <p><i style={{background:'#0891b2'}}/>摆动路径点（离地帧存储的脚位，摆动中点）</p>
     <p><i style={{background:'#4a9e6b'}}/>肘 / 膝极点</p>
     <p><i style={{background:'#d23c3c'}}/>拍头 · <em style={{color:'#f0b429'}}>触球点</em></p>
     <p className="ws-note">直接拖动末端，IK 自动解算整条链；在空白处拖动仍是旋转视角。</p>
    </section>
   </aside>
   <section className="ws-viewport">
    <div ref={mount} className="ws-canvas"/>
    <div className="ws-view-heading"><h2>{d.name}</h2><p>{frame.label||'—'} · {d.inbetweens?'连续补间预览':'关键帧步进'}</p></div>
    <div className="ws-cameras">{([['front','正面'],['side','侧面'],['threeQuarter','45°'],['back','背面']] as [ViewId,string][]).map(([v,l])=><button key={v} aria-pressed={view===v} onClick={()=>{setView(v);engine.current?.setView(v);}}>{l}</button>)}</div>
    <div className="ws-hint"><span className="status-dot"/>{info?'拖动彩色手柄调整姿态 · 编辑写入选中或自动新建的关键帧':'加载中'}</div>
    {!info?<div className="ws-loading"><div className="loading-orbit"/><strong>{error?'加载失败':'正在读取人体模型'}</strong><p>{error}</p></div>:null}
   </section>
   <aside className="ws-right">
    <section className="ws-card"><h2>选中关键帧 {sel?<small>@{sel.time.toFixed(2)}s</small>:null}</h2>
     {sel?<>
      <label className="ws-field"><span>标签</span><input value={sel.label} placeholder="阶段名，如 触球" onChange={e=>editSelected(k=>{k.label=e.target.value;})}/></label>
      <label className="ws-field"><span>时间 s</span><input type="number" min="0" max={d.duration} step=".02" value={sel.time} onChange={e=>edit(()=>setKeyTime(d,sel,Number(e.target.value)||0))}/></label>
      <div className="ws-sub"><h3>约束 <small>随关键帧保存，约束补间</small></h3>
       <Row label="左脚支撑锁定" detail="离地帧的脚位会作为摆动路径点" checked={sel.constraints.plantL} onChange={v=>editSelected(k=>{k.constraints.plantL=v;})}/>
       <Row label="右脚支撑锁定" detail="离地帧的脚位会作为摆动路径点" checked={sel.constraints.plantR} onChange={v=>editSelected(k=>{k.constraints.plantR=v;})}/>
       {(()=>{const ks=sortedKeys(d),si=ks.findIndex(k=>k.id===sel.id);
        return si===ks.length-1&&si>0&&((ks[si-1].constraints.plantL&&!sel.constraints.plantL)||(ks[si-1].constraints.plantR&&!sel.constraints.plantR))
          ?<p className="ws-note" style={{color:'#c0392b'}}>此离地帧位于动作末尾：没有后续区间，脚始终停在接触点 —— 请在其后添加关键帧，抬升高度才会形成摆动轨迹。</p>:null;})()}
       <Row label="右手握拍" checked={sel.constraints.grip} onChange={v=>editSelected(k=>{k.constraints.grip=v;})}/>
       <Row label="触球 / 接触事件" detail="记录拍头位置为接触点" checked={sel.constraints.contact} onChange={v=>editSelected(k=>{k.constraints.contact=v;})}/>
      </div>
      <div className="ws-sub"><h3>躯干与骨盆</h3>
       <Slider label="前倾" value={sel.pose.lean} min={-50} max={60} step={.5} onChange={v=>editSelected(k=>{k.pose.lean=v;})}/>
       <Slider label="转体" value={sel.pose.chest} min={-60} max={60} step={.5} onChange={v=>editSelected(k=>{k.pose.chest=v;})}/>
       <Slider label="侧弯" value={sel.pose.side} min={-30} max={30} step={.5} onChange={v=>editSelected(k=>{k.pose.side=v;})}/>
       <Slider label="朝向" value={sel.pose.yaw} min={-180} max={180} step={1} onChange={v=>editSelected(k=>{k.pose.yaw=v;})}/>
       <Slider label="骨盆升降" value={sel.pose.root.y} min={-.45} max={.15} step={.005} unit="m" onChange={v=>editSelected(k=>{k.pose.root.y=v;})}/>
       <Slider label="骨盆前后" value={sel.pose.root.z} min={-.4} max={.4} step={.005} unit="m" onChange={v=>editSelected(k=>{k.pose.root.z=v;})}/>
       <Slider label="骨盆左右" value={sel.pose.root.x} min={-.4} max={.4} step={.005} unit="m" onChange={v=>editSelected(k=>{k.pose.root.x=v;})}/>
      </div>
      <WristPanel key={`${d.id}:${sel.id}:L:${wristEpoch.current}`} side="L" k={sel} edit={editSelected}/>
      <WristPanel key={`${d.id}:${sel.id}:R:${wristEpoch.current}`} side="R" k={sel} edit={editSelected}/>
      <div className="ws-sub"><h3>脚部姿态 <small>离地帧的抬升高度即摆动路径点</small></h3>
       {(['L','R']as const).map(side=>{
        const planted=sel.constraints[side==='L'?'plantL':'plantR'],cn=side==='L'?'左':'右';
        // A contact holds (target, yaw, pitch) from the run's first key; a
        // release key inherits them at its instant. Only those two cases have
        // dead stored values — ordinary swing keys own their stored pose, so
        // they must edit sel directly (never reach back to the last plant).
        const ks=sortedKeys(d),si=ks.findIndex(k=>k.id===sel.id);
        let owner:WorkshopKey|undefined;
        if(planted)owner=contactStartKey(d,side,sel.time);
        else if(isReleaseKey(d,si,side)){const p=si>0?si-1:ks.length-1;owner=contactStartKey(d,side,ks[p].time)??ks[p];}
        owner??=sel;
        const foot=side==='L'?owner.pose.footL:owner.pose.footR;
        return <div key={side}>
         <Slider label={`${cn}脚抬升高度（脚底离地）`} value={liftOf(side,planted?owner:sel)} min={0} max={.8} step={.005} unit="m" disabled={planted} onChange={v=>setLift(side,v)}/>
         <Slider label={`${cn}脚俯仰`} value={foot.pitch} min={-40} max={40} step={1} onChange={v=>edit(()=>{foot.pitch=v;})}/>
         <Slider label={`${cn}脚朝向`} value={foot.yaw} min={-90} max={90} step={1} onChange={v=>edit(()=>{foot.yaw=v;})}/>
         {owner!==sel?<p className="ws-note" style={{color:'#8a6d1f'}}>{cn}脚此帧由 {owner.time.toFixed(2)}s 的支撑开始帧锁定：俯仰与朝向的修改写入该帧。</p>:null}
        </div>;
       })}
      </div>
      <button className="ws-mini danger" onClick={delKey} disabled={d.keys.length<=2}><Trash2 size={12}/>删除此关键帧</button>
     </>:<p className="ws-note">时间轴上选择或新建关键帧。</p>}
    </section>
    <section className="ws-card"><h2>合理性检查 <small>运动学 · 非动力学</small></h2>
     {analysis?<div className="ws-checks">{analysis.items.map((it,i)=><div key={i} className={it.ok?'':'warn'}>{it.ok?<Check size={12}/>:<X size={12}/>}<span>{it.label}</span><small>{it.detail}</small></div>)}</div>:<p className="ws-note">求解后显示关节限位、支撑与重心。</p>}
     <p className="ws-note">限位使用工程关节范围；重心为分段质量近似，支撑多边形来自锁定脚位。</p>
    </section>
    <section className="ws-card"><h2>显示</h2>
     <Row label="编辑手柄" checked={opts.handles} onChange={v=>{setOpts(o=>({...o,handles:v}));engine.current?.setOptions({handles:v});}}/>
     <Row label="运动轨迹线" checked={opts.trajectories} onChange={v=>{setOpts(o=>({...o,trajectories:v}));engine.current?.setOptions({trajectories:v});}}/>
     <Row label="重心 / 支撑" checked={opts.balance} onChange={v=>{setOpts(o=>({...o,balance:v}));engine.current?.setOptions({balance:v});}}/>
    </section>
   </aside>
  </main>
  <footer className="ws-footer">
   <div className="ws-transport">
    <button className="ws-play" aria-label={frame.playing?'暂停':'播放'} onClick={()=>engine.current?.setPlaying(!frame.playing)} disabled={!info}>{frame.playing?<Pause size={21} fill="currentColor"/>:<Play size={21} fill="currentColor"/>}</button>
    <button aria-label="回到开头" onClick={()=>engine.current?.seek(0)}><RotateCcw size={17}/></button>
    <button aria-label="撤销" title="撤销 (Ctrl+Z)" disabled={!books.current.of(d.id).canUndo()} onClick={undo}><Undo2 size={17}/></button>
    <button aria-label="重做" title="重做 (Ctrl+Shift+Z)" disabled={!books.current.of(d.id).canRedo()} onClick={redo}><Redo2 size={17}/></button>
    <span className="ws-time">{fmt(frame.time)}<i>/</i>{fmt(d.duration)}</span>
   </div>
   <Timeline doc={d} time={frame.time} selected={sel?.id??''} onSelect={id=>{setSelected(id);engine.current?.setPlaying(false);}} onSeek={t=>engine.current?.seek(t)} onRetime={(id,t)=>edit(()=>{const k=keyAt(d,id);if(k)setKeyTime(d,k,t);})}/>
   <div className="ws-actions">
    <button onClick={addKey}><Plus size={13}/>添加关键帧</button>
    <button aria-pressed={d.inbetweens} className={d.inbetweens?'on':''} onClick={()=>edit(dd=>{dd.inbetweens=!dd.inbetweens;})}><Sparkles size={13}/>{d.inbetweens?'中间帧已生成':'生成中间帧'}</button>
    {hint?<p className="ws-note" style={{color:'#c0392b'}}>{hint}</p>:null}
   </div>
  </footer>
 </div>;
}
