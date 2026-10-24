import {useSyncExternalStore} from 'react';

/** Stable useSyncExternalStore binding for a media query: one persistent
 * MediaQueryList and callback set per query string, so re-renders never
 * resubscribe (both pages re-render per frame while playing). */
interface Binding{subscribe:(cb:()=>void)=>()=>void;get:()=>boolean}
const bindings=new Map<string,Binding>();
function binding(query:string):Binding{
  let b=bindings.get(query);
  if(!b){
    const m=matchMedia(query),subs=new Set<()=>void>();
    m.addEventListener('change',()=>{for(const cb of subs)cb();});
    b={subscribe:cb=>{subs.add(cb);return()=>{subs.delete(cb);};},get:()=>m.matches};
    bindings.set(query,b);
  }
  return b;
}

export function useMediaMatches(query:string):boolean{
  const b=binding(query);
  return useSyncExternalStore(b.subscribe,b.get,b.get);
}
