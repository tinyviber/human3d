import {describe,it,expect} from 'vitest';
import {MOTIONS} from '@human3d/motion-core';
import {workshopEditability} from './handoff';

describe('workshopEditability',()=>{
 it('offers navigation for bundled workshop-document motions, carrying the motion id',()=>{
  const forehand=MOTIONS.find(m=>m.id==='forehand')!;
  expect(forehand.source?.kind).toBe('document');
  expect(workshopEditability(forehand)).toEqual({editable:true,url:'/workshop.html?from=forehand'});
 });
 it('covers every editable motion with a from-parameterized url',()=>{
  const editable=MOTIONS.filter(m=>m.source?.kind==='document');
  expect(editable.length).toBeGreaterThan(20);
  for(const m of editable)
   expect(workshopEditability(m)).toEqual({editable:true,url:`/workshop.html?from=${encodeURIComponent(m.id)}`});
 });
 it('explains the limitation for the dynamics replay, external clip and pose-package sources',()=>{
  const throwMotion=MOTIONS.find(m=>m.id==='baseball-throw')!;
  expect(throwMotion.source?.kind).toBe('dynamics');
  const why=workshopEditability(throwMotion);
  expect(why.editable).toBe(false);
  if(!why.editable)expect(why.reason).toContain('肌骨正向仿真');

  const walk=MOTIONS.find(m=>m.id==='walk')!;
  expect(walk.source?.kind).toBe('clip');
  const walkWhy=workshopEditability(walk);
  expect(walkWhy.editable).toBe(false);
  if(!walkWhy.editable)expect(walkWhy.reason).toContain('外部剪辑');

  const pkgWhy=workshopEditability({...MOTIONS[0],id:'imported',source:{kind:'pose-package',package:{}}});
  expect(pkgWhy.editable).toBe(false);
  if(!pkgWhy.editable)expect(pkgWhy.reason).toContain('姿态包');
 });
 it('falls back to a generic explanation when the source is absent',()=>{
  const why=workshopEditability({...MOTIONS[0],source:undefined});
  expect(why.editable).toBe(false);
  if(!why.editable)expect(why.reason.length).toBeGreaterThan(0);
 });
});
