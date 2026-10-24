import type {MotionSpec} from '@human3d/motion-core';

/** Lab → workshop handoff resolution for the CURRENT motion.
 *
 * A bundled motion is workshop-editable exactly when its source is an inline
 * workshop document — those ids are the same registry the workshop's
 * WORKSHOP_PRESETS reads, so the workshop can offer a duplicate-to-edit copy
 * of precisely this motion via `?from=<id>`. Everything else (dynamics
 * replays, external clips, imported pose packages) has no workshop keys;
 * the affordance explains the limitation instead of navigating. */

export type WorkshopEditability =
 |{editable:true;url:string}
 |{editable:false;reason:string};

const WHY:Partial<Record<NonNullable<MotionSpec['source']>['kind'],string>>={
 dynamics:'此动作来自肌骨正向仿真回放，暂不支持在动作工作台编辑。',
 clip:'此动作是外部剪辑动画，暂不支持在动作工作台编辑。',
 'pose-package':'姿态包是求解后的采样结果，暂不支持在动作工作台编辑。',
};

export const workshopEditability=(spec:MotionSpec):WorkshopEditability=>{
 if(spec.source?.kind==='document')
  return {editable:true,url:`/workshop.html?from=${encodeURIComponent(spec.id)}`};
 const reason=spec.source?WHY[spec.source.kind]:undefined;
 return {editable:false,reason:reason??'此动作暂不支持在动作工作台编辑。'};
};
