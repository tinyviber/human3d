import {createHash} from 'node:crypto';
import {VRM_SEMANTIC_MAP} from './semantic-map';
export const RIG_ID='makehuman-body';
export interface RigJsonBone{name:string;sourceName:string;parent:string|null;head:number[];tail:number[]}
export interface RigJsonFile{height:number;bones:RigJsonBone[];vertices:number;triangles:number;license:string}
// Sorted-key JSON stringify; sufficient for fingerprints on our own data
// (ASCII keys, plain numbers). Not full RFC 8785 but deterministic.
export const canonical=(v:unknown):string=>JSON.stringify(v,(_k,val)=>
 val&&typeof val==='object'&&!Array.isArray(val)
  ?Object.fromEntries(Object.entries(val as Record<string,unknown>).sort(([a],[b])=>a<b?-1:a>b?1:0))
  :val);
export const sha256=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export function buildRigManifest(rig:RigJsonFile,sourceHash:string){
 const bySemantic=new Map(Object.entries(VRM_SEMANTIC_MAP).map(([sem,bone])=>[bone,sem]));
 const headOf=new Map(rig.bones.map(b=>[b.name,b.head]));
 const bones=rig.bones.map(b=>{
  const parent=b.parent??null,ph=parent?headOf.get(parent)!:null;
  // GLB nodes carry translation only: rest local rotation is the identity
  // quaternion [0,0,0,1] and rest scale is [1,1,1] by construction.
  const restLocal={
   translation:ph?[b.head[0]-ph[0],b.head[1]-ph[1],b.head[2]-ph[2]]:b.head,
   rotation:[0,0,0,1],scale:[1,1,1]};
  return {name:b.name,parent,restLocal,head:b.head,tail:b.tail,
   semantic:bySemantic.get(b.name)??'extra'};
 });
 const manifest={
  schemaVersion:1,kind:'rig-manifest',id:RIG_ID,
  units:{length:'meter',angle:'radian'},
  frame:{handedness:'right',up:'+Y',forward:'+Z'},
  height:rig.height,bones,
  semantics:{vocabulary:'vrm-humanoid-1.0',mapped:bySemantic.size,extra:bones.length-bySemantic.size},
  license:{rig:'CC0',source:'MakeHuman community assets',note:'Pose data derived from this rig inherits the rig license only; motion-source licenses are per-action.'},
 };
 return {...manifest,manifestSHA256:sha256(canonical(manifest)),sourceSHA256:sourceHash};
}
export type RigManifest=ReturnType<typeof buildRigManifest>;
