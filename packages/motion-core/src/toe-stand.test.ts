import {describe,expect,it} from 'vitest';
import {frameAt,mirrorDoc,normalizeDoc,validateDocShape,type WorkshopDoc} from './document';
import {motionFileById} from './motion-files';

/* ADR-0010 toe-stand. The bundled lunge is the reference: its rear foot (R)
 * pitches 20° onto its toes at keys 1 and 2 (toeStandR), and key 0 is flat. */
const lunge=()=>structuredClone(motionFileById('basic-lunge')!.document!) as WorkshopDoc;

describe('toe-stand contact (ADR-0010)',()=>{
 it('a toe-stand key keeps its own ankle x, y, z and pitch across its run; yaw comes from the run start',()=>{
  const doc=lunge();
  expect(doc.keys[1].constraints.toeStandR).toBe(true);
  // The ankle travels with its authored x/z (the generator compensates them so
  // the toe stays on its spot): shifting both toe keys moves the whole run.
  doc.keys[1].pose.footR.target.z+=.05;
  doc.keys[2].pose.footR.target.z+=.05;
  const mid=frameAt(doc,(doc.keys[1].time+doc.keys[2].time)/2).pose.footR;
  expect(mid.pitch).toBeCloseTo(doc.keys[1].pose.footR.pitch,6);
  expect(mid.pitch).toBeGreaterThan(19);
  expect(mid.target.y).toBeCloseTo(doc.keys[1].pose.footR.target.y,6);
  expect(mid.target.z).toBeCloseTo(doc.keys[1].pose.footR.target.z,6);
  expect(mid.target.x).toBeCloseTo(doc.keys[1].pose.footR.target.x,6);
  expect(mid.yaw).toBeCloseTo(doc.keys[0].pose.footR.yaw,6);
 });

 it('without the toe flag the planted foot keeps the flat contact (control)',()=>{
  const doc=lunge();
  for(const k of doc.keys)delete k.constraints.toeStandR;
  const mid=frameAt(doc,(doc.keys[1].time+doc.keys[2].time)/2).pose.footR;
  expect(mid.pitch).toBeCloseTo(doc.keys[0].pose.footR.pitch,6);
  expect(mid.target.y).toBeCloseTo(doc.keys[0].pose.footR.target.y,6);
 });

 it('a released toe-stand keeps its height and pitch at the first unplanted key (no teleport)',()=>{
  const doc=lunge();
  doc.keys[2].constraints.plantR=false;
  delete doc.keys[2].constraints.toeStandR;
  expect(validateDocShape(doc)).toEqual([]);
  const released=frameAt(doc,doc.keys[2].time).pose.footR;
  expect(released.pitch).toBeCloseTo(doc.keys[1].pose.footR.pitch,6);
  expect(released.target.y).toBeCloseTo(doc.keys[1].pose.footR.target.y,6);
 });

 it('validation: a toe flag needs its plant flag, and must be a boolean',()=>{
  const unplanted=lunge();
  unplanted.keys[1].constraints.plantR=false;
  expect(validateDocShape(unplanted).some(e=>e.includes('toeStandR 需要 plantR 为真'))).toBe(true);
  const notBool=lunge();
  (notBool.keys[1].constraints as unknown as Record<string,unknown>).toeStandR='yes';
  expect(validateDocShape(notBool).some(e=>e.includes('toeStandR 必须是布尔值'))).toBe(true);
  expect(validateDocShape(lunge())).toEqual([]);
 });

 it('normalize folds an explicit false toe flag back to absent',()=>{
  const doc=lunge();
  doc.keys[0].constraints.toeStandR=false;
  const normalized=normalizeDoc(structuredClone(doc));
  expect(normalized.keys[0].constraints).not.toHaveProperty('toeStandR');
  expect(normalized.keys[1].constraints.toeStandR).toBe(true);
 });

 it('mirroring swaps the toe flags with the plant flags and round-trips',()=>{
  const doc=lunge();
  const mirrored=mirrorDoc(doc);
  expect(mirrored.keys[1].constraints.toeStandL).toBe(true);
  expect(mirrored.keys[1].constraints).not.toHaveProperty('toeStandR');
  expect(mirrored.keys[1].constraints.plantL).toBe(doc.keys[1].constraints.plantR);
  const back=mirrorDoc(mirrored);
  expect(back.keys[1].constraints.toeStandR).toBe(true);
  expect(back.keys[1].constraints).not.toHaveProperty('toeStandL');
 });
});
