import {Bone,DoubleSide,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,SkinnedMesh,Vector3,BufferGeometry,type Object3D} from 'three';

/**
 * skin-swap.ts — 一键换肤（画板 ui-restyle round 6）：'default' 现有蒙皮，
 * 'ssj' 超赛风格（上身裸 + 蓝色短裤 + 靴子 + 金发尖刺）。
 *
 * 实现：HumanSurface 顶点色分带（绑定空间 y 带，与 shape-preset 同一局部
 * 空间）+ 挂在 head 骨上的程序化金发锥簇（世界空间设计→头骨局部）。
 * 与 shape-preset 顶点塑形正交（先塑形后换肤，或反之均可）；material 仅
 * 翻 vertexColors/color，不与解剖系统抢材质（surface 开关只做显隐）。
 * 默认皮肤 = 移除顶点色并还原 GLB 材质原色；两态幂等，可反复切换。
 */

export type SkinId='default'|'ssj';

const SKIN=[0.914,0.733,0.549], SHORTS=[0.196,0.392,0.639], BOOT=[0.078,0.216,0.278],
  SOLE=[0.910,0.886,0.816], BELT=[0.137,0.196,0.298], TRIM=[0.898,0.286,0.208];

/** 站姿皮肤网格判据：局部 bbox 顶 ≈1.78m。 */
const SKIN_TOP=1.7;
/** 分带（绑定空间 y）：靴沿 0.315、短裤下摆 0.62、腰带 0.94——按 55k 顶点
 * 密度在 ~1-2cm 过渡，手机/桌面均不明显锯齿。 */
const BANDS={sole:0.035,boot:0.28,trim:0.315,hem:0.62,belt:0.94,beltTop:0.995};

const materialState=new WeakMap<MeshStandardMaterial,{color:number}>();
const hairByRoot=new WeakMap<Object3D,Group>();

function skinMeshes(root:Object3D):SkinnedMesh[]{
  const list:SkinnedMesh[]=[];
  root.traverse(o=>{
    if(!(o instanceof SkinnedMesh))return;
    o.geometry.computeBoundingBox();
    const bb=o.geometry.boundingBox;
    if(bb&&bb.max.y>=SKIN_TOP)list.push(o);
  });
  return list;
}

function paintSkin(ss:SkinnedMesh[]):void{
  const mat=ss[0].material as MeshStandardMaterial;
  if(!materialState.has(mat))materialState.set(mat,{color:mat.color.getHex()});
  for(const sm of ss){
    const pos=sm.geometry.attributes.position;
    const n=pos.count;
    const col=new Float32Array(n*3);
    for(let i=0;i<n;i++){
      const y=pos.getY(i);
      let cc=SKIN;
      if(y<BANDS.sole)cc=SOLE;else if(y<BANDS.boot)cc=BOOT;else if(y<BANDS.trim)cc=TRIM;
      else if(y>=BANDS.hem&&y<BANDS.belt)cc=SHORTS;else if(y>=BANDS.belt&&y<BANDS.beltTop)cc=BELT;
      col[i*3]=cc[0];col[i*3+1]=cc[1];col[i*3+2]=cc[2];
    }
    sm.geometry.setAttribute('color',new Float32BufferAttribute(col,3));
    const mm=sm.material as MeshStandardMaterial;
    mm.vertexColors=true;mm.color.set(0xffffff);mm.needsUpdate=true;
  }
}

function clearPaint(ss:SkinnedMesh[]):void{
  const mat=ss[0].material as MeshStandardMaterial;
  const orig=materialState.get(mat);
  for(const sm of ss){
    const mm=sm.material as MeshStandardMaterial;
    sm.geometry.deleteAttribute('color');
    mm.vertexColors=false;
    if(orig)mm.color.setHex(orig.color);
    mm.needsUpdate=true;
  }
}

/** 金发锥簇：在头骨局部空间（y 以头骨原点起算，baseY≈头顶上方）。 */
function buildHair(baseY:number):Group{
  const gold=new MeshStandardMaterial({color:0xffd54a,emissive:0xcc7a00,emissiveIntensity:0.34,roughness:0.45,metalness:0.05,side:DoubleSide});
  const verts:number[]=[];
  const cone=(bx:number,by:number,bz:number,dx:number,dy:number,dz:number,len:number,r:number)=>{
    const dl=Math.sqrt(dx*dx+dy*dy+dz*dz);dx/=dl;dy/=dl;dz/=dl;
    let ux=0,uy=0,uz=1;if(Math.abs(dz)>0.9){ux=1;uy=0;uz=0;}
    let ax=dy*uz-dz*uy,ay=dz*ux-dx*uz,az=dx*uy-dy*ux;
    const al=Math.sqrt(ax*ax+ay*ay+az*az);ax/=al;ay/=al;az/=al;
    const cx=dy*az-dz*ay,cy=dz*ax-dx*az,cz2=dx*ay-dy*ax;
    const sides=5,ring=verts.length/3;
    for(let s=0;s<sides;s++){const ang=s/sides*Math.PI*2;
      verts.push(bx+(ax*Math.cos(ang)+cx*Math.sin(ang))*r,by+(ay*Math.cos(ang)+cy*Math.sin(ang))*r,bz+(az*Math.cos(ang)+cz2*Math.sin(ang))*r);}
    const apex=verts.length/3;verts.push(bx+dx*len,by+dy*len,bz+dz*len);
    for(let t=0;t<sides;t++){const i0=ring+t,i1=ring+(t+1)%sides;
      verts.push(verts[i0*3],verts[i0*3+1],verts[i0*3+2],verts[i1*3],verts[i1*3+1],verts[i1*3+2],verts[apex*3],verts[apex*3+1],verts[apex*3+2]);}
  };
  const R=0.075,CY=baseY+0.015;
  for(let k=0;k<10;k++){
    const ang=k/10*Math.PI*2;
    const ox=Math.cos(ang)*R*0.85,oz=Math.sin(ang)*R*0.75;
    cone(ox,CY+(k%2)*0.015,oz,ox*1.3,0.95,oz*1.3-0.22,0.12+0.04*(k%3),0.028);
  }
  cone(0,CY+0.02,0.02,0,1,0.12,0.20,0.045);
  cone(0.028,CY+0.012,-0.02,0.09,0.95,-0.38,0.15,0.036);
  cone(-0.028,CY+0.012,-0.02,-0.09,0.95,-0.38,0.15,0.036);
  const g=new BufferGeometry();
  g.setAttribute('position',new Float32BufferAttribute(verts,3));
  g.computeVertexNormals();g.computeBoundingSphere();
  const group=new Group();group.name='ssj-hair';
  const mesh=new Mesh(g,gold);mesh.frustumCulled=false;
  group.add(mesh);
  return group;
}

function BufferGeometryOf(verts:number[]):BufferGeometry{
  const g=new BufferGeometry();
  g.setAttribute('position',new Float32BufferAttribute(verts,3));
  return g;
}

export function applySkin(root:Object3D,skin:SkinId):void{
  const ss=skinMeshes(root);
  if(!ss.length)return;
  const head=(()=>{
    let h:Bone|null=null;
    for(const b of ss[0].skeleton.bones){if(b.name==='head'&&!h)h=b;}
    return h;
  })();
  const existing=hairByRoot.get(root);
  if(skin==='ssj'){
    paintSkin(ss);
    if(head&&(!existing)){
      root.updateWorldMatrix(true,true);
      const crown=ss[0].geometry.boundingBox!.max.y;
      const originY=head.getWorldPosition(new Vector3()).y;
      const hair=buildHair(crown-originY+0.005);
      head.add(hair);
      hairByRoot.set(root,hair);
    }
    if(existing)existing.visible=true;
  }else{
    clearPaint(ss);
    if(existing)existing.visible=false;
  }
}
