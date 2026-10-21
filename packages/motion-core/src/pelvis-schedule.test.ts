import {describe,it,expect} from 'vitest';
import {followShift,holdShift,scalarPeaks,PELVIS_FOLLOW_ACCEL,PELVIS_FOLLOW_SPEED,PELVIS_TRACK_STEP} from './pelvis-schedule';
import {VALIDATION_LIMITS} from './validate';

/** The documented fold: the argmin jumps ~8.8 cm between adjacent 100 Hz
 * samples and stays there. The follower has to make that ramp safe at 60 fps. */
function stepSeries(){
 const times:number[]=[];
 const target:number[]=[];
 for(let t=0;t<=2+1e-9;t+=PELVIS_TRACK_STEP){
  times.push(Math.min(2,t));
  target.push(t<0.3?0:0.088);
 }
 return {times,target};
}

describe('pelvis shift follower',()=>{
 it('tracks an already-slow signal without amplifying it',()=>{
  const times=[0,.1,.2,.3,.4];
  const target=[0,.01,.02,.03,.04];
  const out=followShift(times,target);
  const peaks=scalarPeaks(times,out);
  expect(peaks.speed).toBeLessThanOrEqual(PELVIS_FOLLOW_SPEED+1e-9);
  expect(peaks.accel).toBeLessThanOrEqual(PELVIS_FOLLOW_ACCEL+1e-6);
  expect(out[0]).toBe(0);
  expect(out[out.length-1]).toBeCloseTo(.04,2);
 });
 it('holds across an 8.8 cm basin jump instead of dragging the pelvis through it',()=>{
  const {times,target}=stepSeries();
  const raw=scalarPeaks(times,target);
  expect(raw.accel).toBeGreaterThan(VALIDATION_LIMITS.rootAccelMPerS2);
  const held=holdShift(times,target);
  expect(held[held.length-1]).toBe(0);
  const followed=followShift(times,held);
  const peaks=scalarPeaks(times,followed);
  expect(peaks.speed).toBeLessThanOrEqual(PELVIS_FOLLOW_SPEED+1e-9);
  expect(peaks.accel).toBeLessThanOrEqual(PELVIS_FOLLOW_ACCEL+1e-6);
  expect(followed.every(s=>s===0)).toBe(true);
 });
 it('keeps a ramp that fits in one speed-step per sample',()=>{
  const times:number[]=[],target:number[]=[];
  for(let t=0;t<=1+1e-9;t+=PELVIS_TRACK_STEP){times.push(Math.min(1,t));target.push(Math.min(1,t)*0.4);}
  const held=holdShift(times,target);
  expect(held[held.length-1]).toBeCloseTo(0.4,3);
 });
});
