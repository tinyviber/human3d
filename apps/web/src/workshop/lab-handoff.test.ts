import {describe,it,expect} from 'vitest';
import {MOTION_FILES} from '@human3d/motion-core';
import {resolveLabHandoff} from './lab-handoff';

describe('resolveLabHandoff',()=>{
 it('resolves a bundled workshop-motion id to a preset handoff',()=>{
  const forehand=MOTION_FILES.find(f=>f.id==='forehand')!;
  expect(forehand.kind).toBe('workshop-motion');
  expect(resolveLabHandoff('?from=forehand')).toEqual({kind:'preset',file:forehand});
 });
 it('resolves an editable preset even when the param carries extra query fields',()=>{
  const handoff=resolveLabHandoff('?from=idle&other=1');
  expect(handoff?.kind).toBe('preset');
 });
 it('explains dynamics replays and external clips instead of fabricating editable data',()=>{
  for(const id of ['baseball-throw','punch','walk']){
   const file=MOTION_FILES.find(f=>f.id===id)!;
   const handoff=resolveLabHandoff(`?from=${id}`);
   expect(handoff).toEqual({kind:'external',file});
  }
 });
 it('returns unknown for a malformed or foreign motion id',()=>{
  expect(resolveLabHandoff('?from=bogus-id')).toEqual({kind:'unknown',id:'bogus-id'});
 });
 it('returns null without the parameter, on an empty value, or on a bare parameter',()=>{
  expect(resolveLabHandoff('')).toBeNull();
  expect(resolveLabHandoff('?other=1')).toBeNull();
  expect(resolveLabHandoff('?from=')).toBeNull();
  expect(resolveLabHandoff('?from=%20')).toBeNull();
 });
 it('covers every lab-editable motion id with a preset handoff and nothing else',()=>{
  const editable=MOTION_FILES.filter(f=>f.kind==='workshop-motion'&&f.document);
  expect(editable.length).toBeGreaterThan(20);
  for(const f of editable)expect(resolveLabHandoff(`?from=${encodeURIComponent(f.id)}`)?.kind).toBe('preset');
 });
});
