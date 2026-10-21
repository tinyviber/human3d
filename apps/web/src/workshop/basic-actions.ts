import {
  frameAt,keyAt,nearestKey,sortedKeys,WORKSHOP_LIMITS,
  type FootTarget,type KeyConstraints,type PoseParams,type V3,type WorkshopDoc,type WorkshopKey,
} from '@human3d/motion-core';
import type {Vector3} from 'three';

/** Keys this close to the playhead are the same instant: the insertion reuses
 * that key as its first frame instead of stacking a duplicate timestamp. */
export const BASIC_ANCHOR_EPS=.01;
/** A distinct key just after an authored anchor can express liftoff without
 * changing the support state at the user's original key. */
const BASIC_BOUNDARY_EPS=.001;

export interface BasicInsertion{keyIds:string[];time:number;span:number}

interface FootDelta{target:V3;pole:V3;yaw:number;pitch:number}
/** A basic action is a relative motion: every key is an offset from its first key. */
interface PoseDelta{root:V3;yaw:number;lean:number;chest:number;side:number;footL:FootDelta;footR:FootDelta}

const EPS=1e-9;
const sub=(a:V3,b:V3):V3=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const add=(a:V3,b:V3):V3=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const isZero=(v:V3)=>Math.abs(v.x)<EPS&&Math.abs(v.y)<EPS&&Math.abs(v.z)<EPS;
function footDelta(from:FootTarget,to:FootTarget):FootDelta{
  return {target:sub(to.target,from.target),pole:sub(to.pole,from.pole),yaw:to.yaw-from.yaw,pitch:to.pitch-from.pitch};
}
const footMoves=(d:FootDelta)=>!isZero(d.target)||!isZero(d.pole)||Math.abs(d.yaw)>EPS||Math.abs(d.pitch)>EPS;
function poseDelta(from:PoseParams,to:PoseParams):PoseDelta{
  return {root:sub(to.root,from.root),yaw:to.yaw-from.yaw,lean:to.lean-from.lean,chest:to.chest-from.chest,side:to.side-from.side,
   footL:footDelta(from.footL,to.footL),footR:footDelta(from.footR,to.footR)};
}
/** The state's pose with the action's offsets added. Hands are never offset:
 * a basic action leaves the arms exactly where the playhead found them. */
function applyDelta(base:PoseParams,d:PoseDelta):PoseParams{
  const foot=(f:FootTarget,e:FootDelta):FootTarget=>({target:add(f.target,e.target),pole:add(f.pole,e.pole),yaw:f.yaw+e.yaw,pitch:f.pitch+e.pitch});
  const pose=structuredClone(base);
  pose.root=add(base.root,d.root);pose.yaw=base.yaw+d.yaw;pose.lean=base.lean+d.lean;pose.chest=base.chest+d.chest;pose.side=base.side+d.side;
  pose.footL=foot(base.footL,d.footL);pose.footR=foot(base.footR,d.footR);
  return pose;
}
function sequenceOf(basic:WorkshopDoc){
  const keys=sortedKeys(basic);
  if(keys.length<2)throw new Error(`基础动作 ${basic.name} 至少需要两个关键帧`);
  return {keys,span:keys[keys.length-1].time-keys[0].time};
}
const ceilingOf=(doc:Pick<WorkshopDoc,'duration'|'loop'>)=>doc.duration-(doc.loop?WORKSHOP_LIMITS.loopGap:0);

/** Why this basic action cannot be inserted at `time`, or undefined when it can.
 * Pure: the UI shows the message and leaves the document untouched. */
export function basicInsertRefusal(doc:WorkshopDoc,basic:WorkshopDoc,time:number):string|undefined{
  const {keys,span}=sequenceOf(basic);
  const anchor=nearestKey(doc,Math.max(0,Math.min(ceilingOf(doc),time)),BASIC_ANCHOR_EPS);
  const reused=anchor&&!needsConstraintBoundary(anchor,keys)?1:0;
  const added=basic.keys.length-reused;
  if(doc.keys.length+added>WORKSHOP_LIMITS.maxKeys)
   return `插入「${basic.name}」需要 ${added} 个关键帧，已达 ${WORKSHOP_LIMITS.maxKeys} 个上限，请先删除不需要的帧。`;
  if(doc.duration+span>WORKSHOP_LIMITS.maxDuration+EPS)
   return `插入「${basic.name}」后动作时长将超过 ${WORKSHOP_LIMITS.maxDuration}s 上限。`;
  // A basic action's foot pitch (the lunge's toe-stand) is offset from the
  // state's pitch. That is exact only when the state's foot starts at the
  // action's own starting pitch; otherwise the offsets would stack (a 40° foot).
  const first=keys[0].pose,deltas=keys.map(k=>poseDelta(first,k.pose));
  const state=anchor?anchor.pose:frameAt(doc,Math.max(0,Math.min(ceilingOf(doc),time))).pose;
  const clash=(['L','R'] as const).find(side=>{
   const foot=side==='L'?'footL':'footR';
   return deltas.some(d=>Math.abs(d[foot].pitch)>EPS)&&Math.abs(state[foot].pitch-first[foot].pitch)>EPS;
  });
  if(clash)return `插入「${basic.name}」时${clash==='L'?'左':'右'}脚已处于不同的脚掌角度（例如脚尖支撑），请先把该脚放回平地再插入。`;
  return undefined;
}

function needsConstraintBoundary(anchor:WorkshopKey,seq:WorkshopKey[]):boolean{
 const deltas=seq.map(k=>poseDelta(seq[0].pose,k.pose));
 const movesFoot=(side:'L'|'R')=>deltas.some(d=>footMoves(side==='L'?d.footL:d.footR));
 return (['L','R'] as const).some(side=>{
  if(!movesFoot(side))return false;
  const flag=side==='L'?'plantL':'plantR';
  return anchor.constraints[flag]!==seq[0].constraints[flag];
 });
}

function newKeyId(doc:WorkshopDoc){
  let id='';
  do{id=`k${Math.random().toString(36).slice(2,8)}`;}while(keyAt(doc,id));
  return id;
}

/** Insert a basic action at the playhead, starting from the state there.
 *
 * - The action starts from the state at the playhead: an existing key within
 *   BASIC_ANCHOR_EPS is reused when its support flags match the action start;
 *   a distinct liftoff/plant boundary is added when they differ.
 * - Later keys are the state plus the action's offsets (root, spine, feet);
 *   hands are copied from the state, so the arms keep their pose.
 * - Keys after the insertion point move by the action's span and the
 *   duration grows by the same amount (one ripple insert, one undo step).
 * - A foot the action moves follows the action's plant flags and is released
 *   at the last key; a foot it leaves in place keeps the state's contact, so
 *   it neither slides nor lifts off the floor.
 *
 * `origin` must be the rest root the caller samples with (see ensureKey).
 * Returns undefined and leaves `doc` untouched when the insertion is refused. */
export function insertBasicAction(doc:WorkshopDoc,basic:WorkshopDoc,time:number,origin:V3|Vector3):BasicInsertion|undefined{
  if(!Number.isFinite(time)||basicInsertRefusal(doc,basic,time))return undefined;
  const {keys:seq,span}=sequenceOf(basic);
  const t=Math.max(0,Math.min(ceilingOf(doc),time));
  const anchor=nearestKey(doc,t,BASIC_ANCHOR_EPS);
  // Read the state before any mutation: the sampled pose uses the pre-insert timeline.
  const frame=anchor?undefined:frameAt(doc,t,origin);
  const start=anchor?anchor.time:t;
  const basePose=anchor?anchor.pose:frame!.pose;
  const baseCons=anchor?anchor.constraints:frame!.constraints;
  const deltas=seq.map(k=>poseDelta(seq[0].pose,k.pose));
  const last=seq.length-1;
  const movesFoot=(side:'L'|'R')=>deltas.some(d=>footMoves(side==='L'?d.footL:d.footR));
  const plant=(side:'L'|'R',j:number):boolean=>{
   const flag=side==='L'?'plantL':'plantR';
   if(!movesFoot(side))return baseCons[flag];
   return j<last&&seq[j].constraints[flag];
  };
  // Toe-stand flags follow the plant rule: a moved foot takes the action's
  // flag, an unmoved foot keeps the state's. Absent means false (ADR-0010).
  const toe=(side:'L'|'R',j:number):boolean=>{
   const flag=side==='L'?'toeStandL':'toeStandR';
   if(!movesFoot(side))return baseCons[flag]===true;
   return j<last&&seq[j].constraints[flag]===true;
  };
  const consFor=(j:number):KeyConstraints=>({plantL:plant('L',j),plantR:plant('R',j),
   ...(toe('L',j)?{toeStandL:true}:{}),...(toe('R',j)?{toeStandR:true}:{}),grip:baseCons.grip,contact:false});

  const keyIds:string[]=[];
  const boundary=anchor&&needsConstraintBoundary(anchor,seq);
  const insertedFrom=anchor?1:0;
  // The insertion point is the boundary: even keys only a few milliseconds
  // later belong to the old timeline and must ripple with the rest.
  const shifted=doc.keys.filter(k=>k!==anchor&&k.time>start);
  for(const k of shifted)k.time+=span;
  doc.duration+=span;
  if(anchor){
   if(boundary){
    // The original anchor remains authored exactly as-is. This adjacent key
    // starts the template's support state and gives contactPlan an explicit
    // liftoff/plant boundary before the action moves the foot.
    const key:WorkshopKey={id:newKeyId(doc),time:start+BASIC_BOUNDARY_EPS,
     label:`${basic.name} · ${seq[0].label}`,pose:applyDelta(basePose,deltas[0]),constraints:consFor(0)};
    doc.keys.push(key);keyIds.push(key.id);
   }else keyIds.push(anchor.id);
  }
  for(let j=insertedFrom;j<seq.length;j++){
   const key:WorkshopKey={id:newKeyId(doc),time:start+seq[j].time-seq[0].time,label:`${basic.name} · ${seq[j].label}`,
    pose:applyDelta(basePose,deltas[j]),constraints:consFor(j)};
   doc.keys.push(key);keyIds.push(key.id);
  }
  doc.keys.sort((a,b)=>a.time-b.time);
  return {keyIds,time:start,span};
}
