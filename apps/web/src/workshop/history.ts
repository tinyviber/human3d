import type {WorkshopDoc} from '@human3d/motion-core';
import {normalizeDoc,serializeDoc} from '@human3d/motion-core';

/** Snapshot undo/redo for one motion. Each entry is the full serialized
 * document, so restoring is exact and independent of how the edit was made
 * (pointer drag, key insert, retime, label). Callers record the state BEFORE
 * an edit; a new edit clears the redo stack. */
const HISTORY_LIMIT=100;
export class DocHistory{
  private past:string[]=[];private future:string[]=[];
  constructor(private limit=HISTORY_LIMIT){}
  /** Remember the state before an edit. Repeated identical snapshots
   * collapse; returns whether a new step was pushed. */
  record(doc:WorkshopDoc){
    const snap=serializeDoc(doc);
    if(this.past[this.past.length-1]===snap)return false;
    this.past.push(snap);if(this.past.length>this.limit)this.past.shift();
    this.future=[];return true;
  }
  /** Forget the newest past step — a cancelled preview whose record() pushed it. */
  dropLast(){this.past.pop();}
  canUndo(){return this.past.length>0;}
  canRedo(){return this.future.length>0;}
  /** Step back: returns the restored document, or undefined when nothing is left. */
  undo(current:WorkshopDoc):WorkshopDoc|undefined{
    const prev=this.past.pop();if(prev===undefined)return undefined;
    this.pushFuture(current);
    return normalizeDoc(JSON.parse(prev));
  }
  /** Step forward again after an undo. */
  redo(current:WorkshopDoc):WorkshopDoc|undefined{
    const next=this.future.pop();if(next===undefined)return undefined;
    this.pushPast(current);
    return normalizeDoc(JSON.parse(next));
  }
  /** Deposit a snapshot on the past stack without clearing the future. The
   * one cross-document step (the mirror's undo restores the source document)
   * uses this to hand the state being left behind to the arriving document's
   * book, so undo/redo stay symmetric across the switch. */
  pushPast(doc:WorkshopDoc){const s=serializeDoc(doc);if(this.past[this.past.length-1]!==s)this.past.push(s);if(this.past.length>this.limit)this.past.shift();}
  /** Deposit a snapshot on the redo stack. Same collapse rule as record():
   * consecutive identical snapshots are one step. */
  pushFuture(doc:WorkshopDoc){const s=serializeDoc(doc);if(this.future[this.future.length-1]!==s)this.future.push(s);if(this.future.length>this.limit)this.future.shift();}
  clear(){this.past=[];this.future=[];}
}
/** One history per motion id, so undo never crosses between motions. */
export class HistoryBook{
  private books=new Map<string,DocHistory>();
  of(id:string){let h=this.books.get(id);if(!h){h=new DocHistory();this.books.set(id,h);}return h;}
  drop(id:string){this.books.delete(id);}
}
/** Merge window for consecutive edits: rapid changes on the SAME document
 * share one undo step (a slider drag is one step, not fifty). An edit on a
 * different document, or after the window elapsed, always starts a new step —
 * merging across documents would leave the second document's pre-edit state
 * unrecorded and unreachable via undo. */
export class RecordGate{
  private t=-Infinity;private id='';
  constructor(private windowMs=600){}
  /** True when this edit needs a fresh pre-edit snapshot. */
  should(docId:string,now:number){const fresh=this.id!==docId||now-this.t>this.windowMs;this.t=now;this.id=docId;return fresh;}
  /** Mark an edit recorded through another path (e.g. drag begin) so the next
   * edit on this document still merges into it. */
  touch(docId:string,now:number){this.t=now;this.id=docId;}
  /** Next edit always records — call after undo/redo restores a document. */
  reset(){this.t=-Infinity;this.id='';}
}
