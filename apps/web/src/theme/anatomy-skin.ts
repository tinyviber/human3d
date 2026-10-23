import {BufferAttribute,Color,MeshStandardMaterial,Vector3,type SkinnedMesh} from 'three';
import {handFrame,type HumanRig} from '@human3d/motion-core';

/** Écorché-style display skin for the continuous MakeHuman surface: each
 * vertex is coloured by the muscle group its dominant skin bone and rest
 * normal imply, muscle bellies fade into pale tendon toward their segment
 * ends, group borders get a dark groove, and a shader adds fibre striation
 * along each limb axis plus a cool rim light. Display only: geometry, skin
 * weights and every solve/export path stay untouched (exports re-parse the
 * clean GLB). shortcut: groups are a weight+normal heuristic, not a muscle atlas; replace with authored masks if anatomy accuracy matters. */
const C={bone:0xeee8dc,tendon:0xf4efe4,red:0xc9483e,blue:0x3f76cc,green:0x3c9b6b,yellow:0xe0ae3a,hand:0xe9e1d2};
type Seg=[string,string];
interface Region{id:number;color:number;seg?:Seg;muscle:number}

function classify(bone:string,n:Vector3,p:Vector3,u:(seg:Seg)=>number,palm:Record<'L'|'R',Vector3>):Region{
 const side=(bone.match(/_(L|R)$/)?.[1]??'') as 'L'|'R'|'';
 const s=side||'R',sid=side==='L'?1:0;
 const inward=s==='R'?n.x:-n.x;
 const r=(base:number,color:number,seg?:Seg,muscle=1):Region=>({id:base*2+sid,color,seg,muscle});
 const arm:Seg=[`upperarm01_${s}`,`lowerarm01_${s}`],fore:Seg=[`lowerarm01_${s}`,`wrist_${s}`];
 const thigh:Seg=[`upperleg01_${s}`,`lowerleg01_${s}`],shank:Seg=[`lowerleg01_${s}`,`foot_${s}`];
 const torso:Seg=['root','neck01'];
 // Spans the buttock so its belly sits mid-segment instead of fading to tendon.
 const glute:Seg=['spine02',`lowerleg01_${s}`];
 if(/^(shoulder01|clavicle)_/.test(bone))return r(1,C.red,[`clavicle_${s}`,`lowerarm01_${s}`]);
 if(/^upperarm0[12]_/.test(bone)){
  if(u(arm)<.32)return r(1,C.red,[`clavicle_${s}`,`lowerarm01_${s}`]); // deltoid cap
  return n.z>0?r(2,C.blue,arm):r(3,C.green,arm);
 }
 if(/^lowerarm0[12]_/.test(bone))return n.dot(palm[s])>0?r(4,C.yellow,fore):r(5,C.green,fore);
 if(/^(wrist|finger|metacarpal)/.test(bone))return r(20,C.hand,undefined,0);
 if(/^(root|spine|breast|pelvis)/.test(bone)){
  // Torso groups follow rest-height bands (rest y in metres, 1.78 m body),
  // which keeps borders level instead of tracing the spine-bone weight field.
  const y=p.y,ax=Math.abs(p.x);
  if(n.z>.15){
   if(y>1.235)return r(6,C.red,torso);                     // pectoralis
   if(y>.985)return ax<.072?r(8,C.yellow,torso):r(9,C.green,torso); // rectus / obliques
   return ax<.075?r(23,C.tendon,undefined,0):r(13,C.blue,thigh); // pubic / hip flexors
  }
  if(n.z<-.15){
   if(ax<.018&&y>.99&&y<1.5)return r(23,C.bone,undefined,0);  // spinous processes
   if(y>1.29)return r(7,C.blue,torso);                      // trapezius
   if(y>1.06)return r(10,C.green,torso);                    // latissimus
   if(y>.975)return r(23,C.tendon,undefined,0);             // thoracolumbar fascia
   return r(12,C.red,glute);                                // gluteus maximus
  }
  return y>1.04?r(9,C.green,torso):r(11,C.red,glute);       // serratus·oblique / gluteus medius
 }
 if(/^upperleg0[12]_/.test(bone)){
  if(u(thigh)<.16&&n.z<0)return r(12,C.red,glute); // gluteal fold
  return inward>.5?r(15,C.yellow,thigh):n.z>0?r(13,C.blue,thigh):r(14,C.red,thigh);
 }
 if(/^lowerleg0[12]_/.test(bone)){
  if(n.z>-.05&&inward>.1)return r(21,C.bone,shank,0); // subcutaneous tibia
  return n.z>-.05?r(16,C.yellow,shank):r(17,C.green,shank);
 }
 if(/^(foot|toe)/.test(bone))return r(22,C.bone,undefined,0);
 if(/^neck/.test(bone))return n.z>0?r(18,C.red,['neck01','head']):r(19,C.blue,['neck01','head']);
 return r(23,C.bone,undefined,0);
}

export function applyAnatomySkin(mesh:SkinnedMesh,rig:HumanRig){
 const g=mesh.geometry,pos=g.getAttribute('position'),nor=g.getAttribute('normal');
 const si=g.getAttribute('skinIndex'),sw=g.getAttribute('skinWeight'),index=g.index;
 const count=pos.count,colors=new Float32Array(count*3),fiber=new Float32Array(count*4),ids=new Int16Array(count),muscle=new Uint8Array(count);
 const palm={L:handFrame(rig.rest,'L').normal,R:handFrame(rig.rest,'R').normal};
 const p=new Vector3(),n=new Vector3(),d=new Vector3(),e1=new Vector3(),e2=new Vector3(),col=new Color(),tendon=new Color(C.tendon);
 const rest=(name:string)=>rig.rest.get(name)!;
 const along=(seg:Seg)=>{const a=rest(seg[0]),b=rest(seg[1]);d.copy(b).sub(a);return Math.min(1,Math.max(0,p.clone().sub(a).dot(d)/d.lengthSq()));};
 for(let i=0;i<count;i++){
  p.fromBufferAttribute(pos,i);n.fromBufferAttribute(nor,i).normalize();
  let best=0,w=-1;for(let k=0;k<4;k++){const x=sw.getComponent(i,k);if(x>w){w=x;best=si.getComponent(i,k);}}
  const region=classify(mesh.skeleton.bones[best]?.name??'',n,p,along,palm);
  ids[i]=region.id;muscle[i]=region.muscle;col.setHex(region.color);
  if(region.seg){
   const a=rest(region.seg[0]),axis=rest(region.seg[1]).clone().sub(a).normalize();
   const u=along(region.seg);
   // Belly → tendon toward both ends of the segment.
   if(region.muscle)col.lerp(tendon,.85*(1-Math.min(1,Math.min(u,1-u)/.12)));
   e1.crossVectors(axis,Math.abs(axis.z)<.9?new Vector3(0,0,1):new Vector3(1,0,0)).normalize();e2.crossVectors(axis,e1);
   d.copy(p).sub(a);fiber.set([d.dot(e1),d.dot(e2),u,region.muscle],i*4);
  }
  colors.set([col.r,col.g,col.b],i*3);
 }
 // Groove: darken vertices on a border between two groups (at least one muscle).
 if(index){
  const seam=new Uint8Array(count);
  for(let t=0;t<index.count;t+=3){
   const a=index.getX(t),b=index.getX(t+1),c=index.getX(t+2);
   if((ids[a]!==ids[b]||ids[b]!==ids[c])&&(muscle[a]|muscle[b]|muscle[c]))seam[a]=seam[b]=seam[c]=1;
  }
  for(let i=0;i<count;i++)if(seam[i])for(let k=0;k<3;k++)colors[i*3+k]*=.58;
 }
 g.setAttribute('color',new BufferAttribute(colors,3));
 g.setAttribute('fiber',new BufferAttribute(fiber,4));
 mesh.material=anatomyMaterial();
}

function anatomyMaterial(){
 const m=new MeshStandardMaterial({vertexColors:true,roughness:.5,metalness:0});
 m.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nattribute vec4 fiber;\nvarying vec4 vFiber;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvFiber=fiber;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\nvarying vec4 vFiber;')
   // Integer frequencies keep sin(k·atan) continuous across the ±π wrap.
   .replace('#include <color_fragment>',`#include <color_fragment>
    float th=atan(vFiber.y,vFiber.x);
    float stripe=.5+.5*sin(th*72.);float fine=.5+.5*sin(th*197.);
    diffuseColor.rgb*=mix(1.,.84+.1*stripe+.06*fine,vFiber.w);`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.36,vFiber.w);')
   .replace('#include <opaque_fragment>',`outgoingLight+=vec3(.55,.7,1.)*pow(1.-saturate(dot(normal,normalize(vViewPosition))),3.)*.2;
    #include <opaque_fragment>`);
 };
 m.customProgramCacheKey=()=>'h3d-anatomy-skin-v1';
 return m;
}
