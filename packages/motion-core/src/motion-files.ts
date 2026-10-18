import {normalizeMotionFile,type MotionFile} from './motion-file';
import idle from '../../../assets/motions/idle.json';
import walk from '../../../assets/motions/walk.json';
import reach from '../../../assets/motions/reach.json';
import squat from '../../../assets/motions/squat.json';
import ready from '../../../assets/motions/ready.json';
import forehand from '../../../assets/motions/forehand.json';
import baseballThrow from '../../../assets/motions/baseball-throw.json';
import punch from '../../../assets/motions/punch.json';

/** The bundled motion envelopes, normalized once at module load and kept in
 * display order. Plain static imports — node-safe, so the service, the lab
 * and the scripts all read the same assets/motions/ files; dynamics-motion
 * envelopes normalize their display fields out of `dynamics.action`. */
export const MOTION_FILES:MotionFile[]=[idle,walk,reach,squat,ready,forehand,baseballThrow,punch]
 .map(f=>normalizeMotionFile(f))
 .sort((a,b)=>a.order-b.order);

export const motionFileById=(id:string)=>MOTION_FILES.find(f=>f.id===id);
