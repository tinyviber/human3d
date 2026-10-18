import type {MotionSpec} from './types';
import {MOTION_FILES} from './motion-files';

/** Bundled envelopes → lab specs: the trajectory source stays on `source`
 * (a clip asset reference, the inline document, or the dynamics payload:
 * the action parameters plus the per-case record URLs). Envelope notes are
 * service metadata; the spec keeps display fields only. A dynamics-motion's
 * display fields were already derived onto the envelope by
 * normalizeMotionFile; `objectDescription` stays display-side too. */
const fileMotions:MotionSpec[]=MOTION_FILES.map(f=>({
 id:f.id,name:f.name,english:f.english,duration:f.duration,description:f.description,method:f.method,
 focus:f.focus,phases:f.phases,oneShot:f.oneShot,capabilities:f.capabilities,
 objectDescription:f.kind==='dynamics-motion'?f.dynamics!.action.display.objectDescription:undefined,
 source:f.kind==='clip-motion'
  ?{kind:'clip' as const,clip:f.clip!.url,meta:f.clip!.meta}
  :f.kind==='dynamics-motion'
  ?{kind:'dynamics' as const,action:f.dynamics!.action,records:f.dynamics!.records}
  :{kind:'document' as const,document:f.document!},
}));
/** The muscle-action parameters behind a bundled dynamics-motion, looked up on
 * the envelope registry — the same registry the lab plays from. */
export const muscleActionById=(id:string)=>MOTION_FILES.find(f=>f.id===id)?.dynamics?.action;
export const MOTIONS:MotionSpec[]=fileMotions;
export const motionById=(id:string)=>MOTIONS.find(m=>m.id===id)??MOTIONS[0];
