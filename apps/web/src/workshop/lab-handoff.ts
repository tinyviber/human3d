import {motionFileById} from '@human3d/motion-core';
import type {MotionFile} from '@human3d/motion-core';

/** The `?from=<motion-id>` parameter the lab passes when handing the motion
 * the user was watching over to the workshop. Read-only view-layer concern
 * (same convention as matchMedia): hosts without a URL just yield null. */

export const HANDOFF_PARAM='from';

/** What the lab handed over:
 * - `preset` — a bundled workshop-motion: the workshop can offer a
 *   duplicate-to-edit copy via the existing library preset flow.
 * - `external` — a known motion without workshop keys (dynamics replay or
 *   external clip): explain the limitation, never fabricate editable data.
 * - `unknown` — a malformed or foreign id: no card, the workshop opens as usual. */
export type LabHandoff=
 |{kind:'preset';file:MotionFile}
 |{kind:'external';file:MotionFile}
 |{kind:'unknown';id:string};

export const resolveLabHandoff=(search:string):LabHandoff|null=>{
 const id=new URLSearchParams(search).get(HANDOFF_PARAM)?.trim();
 if(!id)return null;
 const file=motionFileById(id);
 if(!file)return{kind:'unknown',id};
 return file.kind==='workshop-motion'&&file.document?{kind:'preset',file}:{kind:'external',file};
};

/** A preset creation (card button or the regular 从预设开始) reconciles the
 * pending handoff only when it created the OFFERED preset — any other preset
 * leaves the offer standing. */
export const handoffConsumedByCreate=(handoff:LabHandoff|null,createdPresetId:string):boolean=>
 handoff?.kind==='preset'&&handoff.file.id===createdPresetId;

/** The offer card renders for preset and external handoffs; unknown ids
 * render nothing — and must not raise the phone sheet either. Single source
 * of truth for both the card JSX and the compact auto-open effect. */
export const handoffHasCard=(handoff:LabHandoff|null):handoff is Exclude<LabHandoff,{kind:'unknown'}>=>
 handoff!==null&&handoff.kind!=='unknown';

/** Drop the handoff parameter from the URL (history-only — no reload) so a
 * refresh or a shared link does not re-offer an already-handled motion. */
export const clearLabHandoff=()=>{
 try{
  const url=new URL(globalThis.location.href);
  if(!url.searchParams.has(HANDOFF_PARAM))return;
  url.searchParams.delete(HANDOFF_PARAM);
  globalThis.history.replaceState(null,'',url);
 }catch{/* hosts without history/location keep the offer for this session only */}
};
