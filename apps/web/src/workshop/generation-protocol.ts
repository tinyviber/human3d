import type {ChannelGroup,MotionCandidate,MotionGenProgress,MotionGenResult,WorkshopDoc} from '@human3d/motion-core';

/** The UI review needs no per-frame probe payload. Keep the worker boundary
 * compact so a successful run does not clone thousands of ProbeFrame objects
 * back onto the main thread. */
export type MotionCandidateSummary=Pick<MotionCandidate,'doc'|'objective'|'verdict'|'metrics'|'constraints'>;
export type MotionGenSummary=Pick<MotionGenResult,'rejected'|'diagnostics'>&{candidates:MotionCandidateSummary[]};

export interface GenerateWorkerRequest{
 type:'generate';doc:WorkshopDoc;lockedKeyIds:string[];
 adjust:{time:boolean;phase:boolean;groups:ChannelGroup[]};
}

export type GenerateWorkerReply=
 |{type:'progress';progress:MotionGenProgress}
 |{type:'done';result:MotionGenSummary}
 |{type:'error';message:string};
