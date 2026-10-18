import type {Vector3,Quaternion} from 'three';
import type {MotionCapabilities} from './motion-file';
import type {WorkshopDoc} from '../workshop/document';
export type AuthoredMotionId='idle'|'walk'|'reach'|'squat'|'ready'|'forehand';
export type MotionId=AuthoredMotionId|(string & {});
export type ViewId='front'|'side'|'back'|'threeQuarter'|'hand'|'free';
export interface BoneInfo{name:string;sourceName:string;parent:string|null;head:number[];tail:number[]}
export interface RigInfo{height:number;bones:BoneInfo[];vertices:number;triangles:number;license:string}
/** Where a spec's trajectory comes from: an external clip asset, an inline
 * workshop document, a dynamics replay, or a delivered pose package. */
export type MotionSourceSpec=
 |{kind:'clip';clip:string;meta?:string}
 |{kind:'document';document:WorkshopDoc}
 |{kind:'dynamics'}
 |{kind:'pose-package';package:unknown};
export interface MotionSpec{id:MotionId;name:string;english:string;duration:number;description:string;method:string;focus:string[];phases:{time:number;label:string}[];capabilities?:MotionCapabilities;source?:MotionSourceSpec;oneShot?:boolean;objectDescription?:string}
export interface Pose {root:Vector3;rotations:Map<string,Quaternion>}
export interface DebugOptions{surface:boolean;skeleton:boolean;axes:boolean;targets:boolean;trail:boolean;muscles:boolean}
