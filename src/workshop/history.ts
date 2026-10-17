import type {WorkshopDoc} from './document';
import {normalizeDoc,serializeDoc} from './document';

/** Snapshot undo/redo for one motion. Each entry is the full serialized
 * document, so restoring is exact and independent of how the edit was made
 * (pointer drag, key insert, retime, label). Callers record the state BEFORE
 * an edit; a new edit clears the redo stack. */
export const HISTORY_LIMIT=100;
export class DocHistory{
  private past:string[]=[];private future:string[]=[];
  constructor(private limit=HISTORY_LIMIT){}
  /** Remember the state before an edit. Repeated identical snapshots collapse. */
  record(doc:WorkshopDoc){
    const snap=serializeDoc(doc);
    if(this.past[this.past.length-1]===snap)return;
    this.past.push(snap);if(this.past.length>this.limit)this.past.shift();
    this.future=[];
  }
  canUndo(){return this.past.length>0;}
  canRedo(){return this.future.length>0;}
  /** Step back: returns the restored document, or undefined when nothing is left. */
  undo(current:WorkshopDoc):WorkshopDoc|undefined{
    const prev=this.past.pop();if(prev===undefined)return undefined;
    this.future.push(serializeDoc(current));if(this.future.length>this.limit)this.future.shift();
    return normalizeDoc(JSON.parse(prev));
  }
  /** Step forward again after an undo. */
  redo(current:WorkshopDoc):WorkshopDoc|undefined{
    const next=this.future.pop();if(next===undefined)return undefined;
    this.past.push(serializeDoc(current));if(this.past.length>this.limit)this.past.shift();
    return normalizeDoc(JSON.parse(next));
  }
  clear(){this.past=[];this.future=[];}
}
/** One history per motion id, so undo never crosses between motions. */
export class HistoryBook{
  private books=new Map<string,DocHistory>();
  of(id:string){let h=this.books.get(id);if(!h){h=new DocHistory();this.books.set(id,h);}return h;}
  drop(id:string){this.books.delete(id);}
}
