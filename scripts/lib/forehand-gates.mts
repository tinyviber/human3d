import crypto from 'node:crypto';
import {VALIDATION_LIMITS} from '@human3d/motion-core';

/** Single source for the forehand preset gates. The generator refuses to write
 * any asset that fails them (fail-closed), and scripts/forehand-depth.test.ts
 * checks the committed assets against the same numbers. Changing a number here
 * changes the receipt (evidence/forehand-presets.json), so the freshness test
 * forces a regeneration. */
export const GATES={
 /** Rear-ankle dorsiflexion (deg). The solver's own limit is DORSI_LIMIT_DEG = 20;
  * the guard aims at 20.05 to leave solve slack. */
 ankleMaxDeg:20.05,
 /** Takeback hip depth against its floored target (cm). */
 takebackTolCm:1.5,
 /** A key's solved depth may differ from its target (or, for a stance-floor fallback,
  * from its floor) by at most this (cm), in either direction. The per-key bound below is
  * the operative contact-phase guard: the old separate 0.6 cm contact-loss assertion was
  * strictly weaker than it and could never fail. */
 depthSlackCm:0.05,
 /** Highest stance floor (cm) a fallback may record. A deeper floor is a pose
  * problem, not a stance limit, and fails the gate. */
 stanceFloorMaxCm:4,
 /** Wrist residual (m): solved wrist against its hand target. */
 wristMaxM:0.001,
 /** Served root acceleration (m/s²). Kept below VALIDATION_LIMITS.rootAccelMPerS2 (40). */
 rootAccelMax:36,
 /** Served support slip (m). Kept below VALIDATION_LIMITS.supportSlipM (0.01). */
 slipMaxM:0.009,
 /** Served rates (Hz): the service default and its maximum. */
 rates:[40,60] as const,
 /** Engineering probe rate (Hz). The service never serves it. */
 probeHz:240,
} as const;

export interface ServiceFact{fps:number;schema:boolean;rejected:string[];rootAccel:number;slip:number}
export interface KeyFact{
 label:string;targetCm:number;solvedCm:number;
 /** Set when the stance floor, not the target, is the shallowest reachable depth
  * (the key is a recorded fallback). The floor is the reach limit of the shipped
  * pose, measured on its own and never taken from solvedCm; the key is held to it. */
 floorCm?:number;
}
export interface PresetFacts{
 takeback:{targetCm:number;solvedCm:number};
 /** Every key in document order, with its study-derived target. */
 keys:KeyFact[];
 ankleDeg:number;
 wristM:number;
 service:ServiceFact[];
}

const f2=(x:number)=>(Math.round(x*100)/100).toString();

/** Gate failures for one preset; an empty list means it passes. */
export function gateFailures(id:string,facts:PresetFacts):string[]{
 const out:string[]=[];
 const fail=(msg:string)=>out.push(`${id}: ${msg}`);
 for(const s of facts.service){
  if(!s.schema)fail(`${s.fps} Hz package fails the published schema`);
  for(const r of s.rejected)if(r!=='schema')fail(`${s.fps} Hz rejected by the semantic validator: ${r}`);
  if(s.rootAccel>GATES.rootAccelMax)fail(`${s.fps} Hz root acceleration ${f2(s.rootAccel)} m/s² > ${GATES.rootAccelMax}`);
  if(s.slip>GATES.slipMaxM)fail(`${s.fps} Hz support slip ${f2(s.slip*1000)} mm > ${GATES.slipMaxM*1000} mm`);
 }
 const {targetCm:tt,solvedCm:ts}=facts.takeback;
 if(Math.abs(ts-tt)>GATES.takebackTolCm)fail(`takeback ${f2(ts)} cm vs target ${f2(tt)} cm (tolerance ${GATES.takebackTolCm})`);
 for(const k of facts.keys){
  if(k.floorCm!==undefined){
   // Stance-floor fallback: the target is unreachable, so the key sits on its floor
   // (the reach limit), and the solved depth must match that floor from both sides.
   if(k.floorCm<=k.targetCm+GATES.depthSlackCm)fail(`${k.label} records stance floor ${f2(k.floorCm)} cm, not above its target ${f2(k.targetCm)} cm`);
   else if(k.floorCm>GATES.stanceFloorMaxCm)fail(`${k.label} stance floor ${f2(k.floorCm)} cm > ${GATES.stanceFloorMaxCm} cm`);
   if(Math.abs(k.solvedCm-k.floorCm)>GATES.depthSlackCm)fail(`${k.label} depth ${f2(k.solvedCm)} cm vs its stance floor ${f2(k.floorCm)} cm`);
   continue;
  }
  // A reachable target: the solved depth follows it from both sides. There is no
  // near-upright allowance; a key that cannot reach its target has a recorded floor.
  if(Math.abs(k.solvedCm-k.targetCm)>GATES.depthSlackCm)
   fail(`${k.label} depth ${f2(k.solvedCm)} cm vs target ${f2(k.targetCm)} cm`);
 }
 if(facts.ankleDeg>GATES.ankleMaxDeg)fail(`rear ankle dorsiflexion ${f2(facts.ankleDeg)}° > ${GATES.ankleMaxDeg}°`);
 if(facts.wristM>GATES.wristMaxM)fail(`wrist residual ${f2(facts.wristM*1000)} mm > ${GATES.wristMaxM*1000} mm`);
 return out;
}

/** Ratchet metrics: values that may improve but must not silently worsen.
 * rootAccel240 peaks above 36 m/s² fell from 16 to 10 of 17 presets with the
 * 引拍→落拍 Hermite change; the remaining 10 are held by this ratchet, not fixed.
 * posteriorCm and stance are hidden compensations (pelvis setback, knee-boost
 * stance). A regression needs an explicit --rebaseline, which records the new
 * value as the ceiling. */
export const RATCHET_TOLERANCE={rootAccel240:0.05,posteriorCm:0.05,stance:0.005} as const;
export type Ratchet={rootAccel240:number;posteriorCm:number;stance:number};
export const RATCHET_KEYS=Object.keys(RATCHET_TOLERANCE) as (keyof Ratchet)[];

export function ratchetFailures(id:string,values:Ratchet,ceiling:Ratchet|undefined,rebaseline=false):string[]{
 if(!ceiling||rebaseline)return [];
 return RATCHET_KEYS.filter(k=>values[k]>ceiling[k]+RATCHET_TOLERANCE[k]).map(k=>
  `${id}: ${k} ${values[k]} exceeds its recorded ceiling ${ceiling[k]} (tolerance ${RATCHET_TOLERANCE[k]}); re-baseline with --rebaseline only if the increase is intended`);
}

/** The ceiling to record: a first run records the value; later runs keep the lower
 * of old and new (ratchet down) unless re-baselined. */
export function nextCeiling(values:Ratchet,ceiling:Ratchet|undefined,rebaseline:boolean):Ratchet{
 if(!ceiling||rebaseline)return {...values};
 return Object.fromEntries(RATCHET_KEYS.map(k=>[k,Math.min(ceiling[k],values[k])])) as Ratchet;
}

export const round=(x:number,digits=3)=>Math.round(x*10**digits)/10**digits;

export const sha256=(data:Buffer|string)=>crypto.createHash('sha256').update(data).digest('hex');

/** Structural comparison with a numeric tolerance (relative above 1). Solver output
 * can differ in the last bits across Node versions, so the freshness check compares
 * numbers with a tolerance and still catches any hand edit or stale input. */
export function jsonDiff(a:unknown,b:unknown,tol:number,at='$',out:string[]=[],limit=12):string[]{
 if(out.length>=limit)return out;
 if(typeof a==='number'&&typeof b==='number'){
  if(!(Math.abs(a-b)<=tol*Math.max(1,Math.abs(a),Math.abs(b))))out.push(`${at}: ${a} vs ${b}`);
  return out;
 }
 if(Array.isArray(a)&&Array.isArray(b)){
  if(a.length!==b.length)out.push(`${at}: length ${a.length} vs ${b.length}`);
  for(let i=0;i<Math.min(a.length,b.length);i++)jsonDiff(a[i],b[i],tol,`${at}[${i}]`,out,limit);
  return out;
 }
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
  const keys=new Set([...Object.keys(a),...Object.keys(b)]);
  for(const k of keys){
   if(!(k in (a as object))||!(k in (b as object))){out.push(`${at}.${k}: present on one side only`);continue;}
   jsonDiff((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k],tol,`${at}.${k}`,out,limit);
  }
  return out;
 }
 if(a!==b)out.push(`${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
 return out;
}

/** Service limits the gates must stay inside (checked by scripts/forehand-gates.test.ts). */
export const SERVICE_MARGINS={rootAccelMPerS2:VALIDATION_LIMITS.rootAccelMPerS2,supportSlipM:VALIDATION_LIMITS.supportSlipM};
