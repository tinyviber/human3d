import {create} from 'zustand';
import type {DebugOptions, MotionId, MotionSpec, RigInfo, ViewId} from '@human3d/motion-core';
import type {FrameState} from './engine';

const initialFrame:FrameState={time:0, duration:4.8, phase:'呼气', playing:true, knee:0, elbow:0, gripError:0};

export interface LabUiState{
 id:MotionId;
 info:RigInfo|null;
 error:string;
 view:ViewId;
 frame:FrameState;
 debug:DebugOptions;
 speed:number;
 loop:boolean;
 dialog:'guide'|'sources'|'kinetics'|null;
 extras:MotionSpec[];
 setId:(id:MotionId)=>void;
 setInfo:(info:RigInfo|null)=>void;
 setError:(error:string)=>void;
 setView:(view:ViewId)=>void;
 setFrame:(frame:FrameState)=>void;
 patchDebug:(patch:Partial<DebugOptions>)=>void;
 setSpeed:(speed:number)=>void;
 setLoop:(loop:boolean)=>void;
 setDialog:(dialog:LabUiState['dialog'])=>void;
 setExtras:(extras:MotionSpec[]|((prev:MotionSpec[])=>MotionSpec[]))=>void;
}

/** Lab chrome state. The engine still owns playback; this store is what the
 * panels read, so a frame tick does not have to thread a dozen useState setters. */
export const useLabUi=create<LabUiState>((set)=>({
 id:'idle',
 info:null,
 error:'',
 view:'front',
 frame:initialFrame,
 debug:{surface:true, skeleton:false, axes:false, targets:false, trail:false, muscles:false},
 speed:1,
 loop:true,
 dialog:null,
 extras:[],
 setId:id=>set({id}),
 setInfo:info=>set({info}),
 setError:error=>set({error}),
 setView:view=>set({view}),
 setFrame:frame=>set({frame}),
 patchDebug:patch=>set(s=>({debug:{...s.debug, ...patch}})),
 setSpeed:speed=>set({speed}),
 setLoop:loop=>set({loop}),
 setDialog:dialog=>set({dialog}),
 setExtras:extras=>set(s=>({extras:typeof extras==='function'?extras(s.extras):extras})),
}));
