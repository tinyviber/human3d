import {Vector3} from 'three';
import {footGeometry,type Side} from './foot';

/** A foot point counts as a floor contact while it stays this close (m) to the
 * rest sole plane for every sample of a support interval (ADR-0010). */
export const CONTACT_FLOOR_TOL_M=.01;

/** Slip of one planted foot over one support interval. `k` is the interval
 * sample where the worst drift occurs (0 = support start); `bone` the foot
 * point that drifted; `contacts` says whether the drift was measured on floor
 * contacts (horizontal x, z) or, when none touched the floor, on the ankle (3-D). */
export interface SupportDrift{value:number;bone:string;k:number;contacts:boolean}

/** Support slip of one planted foot over `n` consecutive samples (metres).
 * Shared by the semantic validator (validate.ts) and the quality probe
 * (quality-probe.ts) so the two cannot drift apart.
 *
 * A planted foot is held by its floor contacts, not by a pinned ankle. A foot
 * point (ankle or toe joint) is a contact when it stays within
 * CONTACT_FLOOR_TOL_M of the rest sole plane for every sample, and the slip is
 * the largest horizontal drift of any contact from its first sample. A flat
 * foot is therefore judged by its toes too, which catches a pivot about the
 * heel; a toe-stand (ankle raised, rear toe on the floor) is judged by its
 * toes, so the ankle may travel with the rocking foot. A foot with no contact
 * through the interval falls back to the ankle's 3-D drift. */
export function supportDrift(side:Side,rest:ReadonlyMap<string,Vector3>,n:number,at:(k:number,bone:string)=>Vector3):SupportDrift{
  const g=footGeometry(rest,side);
  if(n<1)return {value:0,bone:`foot_${side}`,k:0,contacts:false};
  const ceiling=g.groundY+CONTACT_FLOOR_TOL_M;
  const contacts=g.names.filter(b=>{for(let k=0;k<n;k++)if(at(k,b).y>ceiling)return false;return true;});
  const onContacts=contacts.length>0;
  const bones=onContacts?contacts:[`foot_${side}`];
  let best:SupportDrift={value:0,bone:bones[0],k:0,contacts:onContacts};
  for(const b of bones){
    const p0=at(0,b);
    for(let k=1;k<n;k++){
      const p=at(k,b);
      const d=onContacts?Math.hypot(p.x-p0.x,p.z-p0.z):p.distanceTo(p0);
      if(d>best.value)best={value:d,bone:b,k,contacts:onContacts};
    }
  }
  return best;
}
