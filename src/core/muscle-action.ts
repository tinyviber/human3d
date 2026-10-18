/** The muscle-action parameter payload carried at `dynamics.action` inside a
 * `dynamics-motion` envelope (assets/motions/<id>.json). This is the validated
 * shape the Python tooling checks against
 * assets/motions/dynamics-action.schema.json. */
export interface MuscleActionFile{
 id:string;title:string;schemaVersion:number;
 model:{carriedObject?:{massKg:number;radiusM:number;body:string}|null};
 simulation:{referenceSpeedScale?:number;leadSeconds?:number;tailSeconds?:number;sampleHz:number;stepSeconds:number;startPose?:'neutral'|'first-keyframe'};
 reference:{kind:'task-keyframes'|'captured-points';armControl?:'endpoint-keyframes'|'joint-keyframes';keyframes?:{timeSeconds:number;phase:string;elbow?:number[];hand?:number[];leftElbow?:number[];leftHand?:number[];rightShoulderRotvecRad?:number[];rightElbowFlexionRad?:number;jointTargetsDeg?:Record<string,number>}[];source:{frameRangeSeconds?:[number,number]}};
 display:{english:string;description:string;method:string;focus:string[];oneShot?:boolean;durationSeconds?:number;phases?:{time:number;label:string}[];objectDescription?:string;handPoseSource?:'muscle-state'|'task-keyframe-retarget';leftGuardHandPoseDeg?:{thumb:{cmcFlexion:number;cmcOpposition:number;mcp:number;ip:number};fingers:Record<'2'|'3'|'4'|'5',{mcp:number;pip:number;dip:number}>}};
}
/** One exported forward-simulation record on the web server: the meta JSON and
 * the float32 blob it describes. */
export interface DynamicsRecordRef{meta:string;data:string}
/** Per-capacity-case record locations. `baseline` is required; the re-solved
 * weakened-muscle control case `weak` is optional. Records carry their own
 * `modelMeta`/`modelXml` pointers, so the envelope stores no model field. */
export interface DynamicsRecords{baseline:DynamicsRecordRef;weak?:DynamicsRecordRef}
