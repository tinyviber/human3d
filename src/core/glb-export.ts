import {AnimationClip,KeyframeTrack,QuaternionKeyframeTrack,VectorKeyframeTrack,type Object3D} from 'three';
import type {PosePackage} from './pose-package';

/** Pose-package → glTF conversion. Pure three + the package contract — no
 * Node, no DOM of its own — so the workshop button, the Node CLI and vitest
 * all run the identical code path. GLTFExporter is the only DOM-shaped
 * dependency (FileReader on the binary path); under Node callers install the
 * shared shim first (scripts/lib/filereader-shim.mts). */

/** A delivered pose package as an AnimationClip: one quaternion track per
 * rotation track plus the root translation track, all keyed on the package's
 * own `timeline.timestamps` verbatim — the non-uniform final interval
 * (`timestamps.at(-1) === duration`) survives instead of being resampled onto
 * a uniform grid. Track names address glTF nodes by bone name; bones the
 * package omits carry no channel and keep the exported node's rest TRS, which
 * is the `poseMode:'local-trs'` contract (identity local rotation on this
 * rig). `name` defaults to the artifact id so the clip is self-describing. */
export function posePackageToClip(pkg:PosePackage,name=pkg.id):AnimationClip{
 const times=pkg.timeline.timestamps;
 const tracks:KeyframeTrack[]=[];
 for(const tr of pkg.tracks.rotations)
  tracks.push(new QuaternionKeyframeTrack(`${tr.bone}.quaternion`,times,tr.values));
 tracks.push(new VectorKeyframeTrack(`${pkg.tracks.translation.bone}.position`,times,pkg.tracks.translation.values));
 return new AnimationClip(name,pkg.timeline.duration,tracks);
}

/** Export a model plus the clip as binary glTF (GLB). The exporter is
 * dynamically imported so it never lands in a page's initial bundle; the same
 * chunk resolves instantly under Node. `binary:true` resolves an ArrayBuffer —
 * anything else means the exporter silently took the JSON path, which is a
 * hard failure here, not a deliverable. */
export async function exportGlb(model:Object3D,clip:AnimationClip):Promise<ArrayBuffer>{
 const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
 model.updateMatrixWorld(true);
 const out=await new GLTFExporter().parseAsync(model,{binary:true,animations:[clip]});
 if(!(out instanceof ArrayBuffer))throw new Error('GLTFExporter 未产出二进制 GLB');
 return out;
}
