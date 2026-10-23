import {Box3,Matrix4,Quaternion,Vector3} from 'three';
import type {HumanRig} from '@human3d/motion-core';
import {angleAt,DEG,LIMITS} from '@human3d/motion-core';
import type {SkinnedMesh} from 'three';

type Side='L'|'R';
type TriangleRecord={face:number;indices:[number,number,number];sourceIndices:[number,number,number];bounds:Box3};
type TriangleHit={first:TriangleRecord;second:TriangleRecord;position:[number,number,number]};
type IntersectionSummary={side:Side;count:number;bones:string[];triangles:[number,number][];position:[number,number,number]|null;truncated:boolean};
export type PoseValidityCheck={code:string;ok:boolean;bones:string[];value:number;limit:number;unit:string;detail:string};
export interface PoseValidityReport{
 status:'valid'|'invalid'|'indeterminate';
 checks:PoseValidityCheck[];
 intersections:IntersectionSummary[];
 uncertainIntersections:IntersectionSummary[];
 regions:{armTriangles:{L:number;R:number};torsoTriangles:number;ambiguousTriangles:{L:number;R:number}};
 limitations:string[];
}

const ARM=/^(upperarm\d*|lowerarm\d*|wrist)_([LR])$/;
const TORSO=/^(root|pelvis_[LR]|spine\d+|neck\d+|head|clavicle_[LR]|shoulder\d*_[LR]|breast_[LR])$/;
const CELL=.06;
const SHOULDER_DIRECTION_LIMIT=155;
const NUMERIC_EPS=1e-3;
const MAX_HITS=256;

function projectTriangle(axis:Vector3,a:Vector3,b:Vector3,c:Vector3){
 const x=a.dot(axis),y=b.dot(axis),z=c.dot(axis);
 return [Math.min(x,y,z),Math.max(x,y,z)] as const;
}
function separates(axis:Vector3,a:Vector3,b:Vector3,c:Vector3,d:Vector3,e:Vector3,f:Vector3){
 if(axis.lengthSq()<1e-16)return false;
 const [amin,amax]=projectTriangle(axis,a,b,c),[bmin,bmax]=projectTriangle(axis,d,e,f);
 const tolerance=1e-9*Math.max(1,Math.abs(amin),Math.abs(amax),Math.abs(bmin),Math.abs(bmax));
 return amax<bmin-tolerance||bmax<amin-tolerance;
}
/** 3D triangle SAT, including in-plane axes so coplanar overlap is detected. */
function trianglesIntersect(a:Vector3,b:Vector3,c:Vector3,d:Vector3,e:Vector3,f:Vector3){
 const edgesA=[b.clone().sub(a),c.clone().sub(b),a.clone().sub(c)];
 const edgesB=[e.clone().sub(d),f.clone().sub(e),d.clone().sub(f)];
 const normalA=new Vector3().crossVectors(edgesA[0],c.clone().sub(a));
 const normalB=new Vector3().crossVectors(edgesB[0],f.clone().sub(d));
 if(separates(normalA,a,b,c,d,e,f)||separates(normalB,a,b,c,d,e,f))return false;
 for(const edgeA of edgesA){
  for(const edgeB of edgesB)if(separates(new Vector3().crossVectors(edgeA,edgeB),a,b,c,d,e,f))return false;
  if(separates(new Vector3().crossVectors(normalA,edgeA),a,b,c,d,e,f))return false;
 }
 for(const edgeB of edgesB)if(separates(new Vector3().crossVectors(normalB,edgeB),a,b,c,d,e,f))return false;
 return true;
}
function cellRange(box:Box3){
 return [
  Math.floor(box.min.x/CELL),Math.floor(box.min.y/CELL),Math.floor(box.min.z/CELL),
  Math.floor(box.max.x/CELL),Math.floor(box.max.y/CELL),Math.floor(box.max.z/CELL),
 ] as const;
}
const cellKey=(x:number,y:number,z:number)=>`${x},${y},${z}`;
function addToGrid(grid:Map<string,number[]>,box:Box3,index:number){
 const [x0,y0,z0,x1,y1,z1]=cellRange(box);
 // Production rig triangles are small. Do not let malformed geometry make the
 // broad phase allocate an unbounded number of cell references.
 if((x1-x0+1)*(y1-y0+1)*(z1-z0+1)>64)throw new Error('triangle bounds exceed pose-validity grid budget');
 for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++){
  const key=cellKey(x,y,z),bucket=grid.get(key);if(bucket)bucket.push(index);else grid.set(key,[index]);
 }
}
function vertexRegion(mesh:SkinnedMesh,index:number){
 const skinIndex=mesh.geometry.getAttribute('skinIndex'),skinWeight=mesh.geometry.getAttribute('skinWeight');
 if(!skinIndex||!skinWeight)throw new Error('production mesh has no skinIndex/skinWeight');
 const result={L:0,R:0,torso:0};
 for(let slot=0;slot<4;slot++){
  const name=mesh.skeleton.bones[skinIndex.getComponent(index,slot)]?.name;
  const weight=skinWeight.getComponent(index,slot);
  const arm=name?.match(ARM);
  if(arm)result[arm[2] as Side]+=weight;
  else if(name&&TORSO.test(name))result.torso+=weight;
 }
 return result;
}
function classifyFace(mesh:SkinnedMesh,indices:[number,number,number]){
 const v=indices.map(index=>vertexRegion(mesh,index));
 const weight=(key:'L'|'R'|'torso')=>v.reduce((sum,r)=>sum+r[key],0)/3;
 const left=weight('L'),right=weight('R'),torso=weight('torso');
 if(left>=.58&&right<.12&&torso<.18)return {region:'L' as const};
 if(right>=.58&&left<.12&&torso<.18)return {region:'R' as const};
 if(torso>=.58&&left<.12&&right<.12)return {region:'torso' as const};
 return {ambiguousSides:(['L','R'] as const).filter(side=>(side==='L'?left:right)>=.12&&torso>=.12)};
}
function sharesVertex(a:TriangleRecord,b:TriangleRecord){return a.sourceIndices.some(index=>b.sourceIndices.includes(index));}

export class PoseValidityChecker{
 private positions:Vector3[];
 private readonly arm:{L:TriangleRecord[];R:TriangleRecord[]}={L:[],R:[]};
 private readonly torso:TriangleRecord[]=[];
 private readonly ambiguous:{L:TriangleRecord[];R:TriangleRecord[]}={L:[],R:[]};
 private readonly worldMatrix=new Matrix4();
 constructor(private mesh:SkinnedMesh,private rig:HumanRig){
  const position=mesh.geometry.getAttribute('position'),index=mesh.geometry.index,sourceVertex=mesh.geometry.getAttribute('_source_vertex');
  if(!position)throw new Error('production mesh has no position attribute');
  this.positions=Array.from({length:position.count},()=>new Vector3());
  const count=index?index.count:position.count;
  if(count%3!==0)throw new Error('production mesh index count is not triangular');
  for(let i=0;i<count;i+=3){
   const indices:[number,number,number]=index?[index.getX(i),index.getX(i+1),index.getX(i+2)]:[i,i+1,i+2];
   // UV seams duplicate render vertices without separating the actual surface.
   // Preserve adjacency using the authored source identity, never spatial welds
   // which could hide real contact between otherwise disconnected surfaces.
   const sourceIndices=indices.map(i=>sourceVertex?sourceVertex.getX(i):i) as [number,number,number];
   const classification=classifyFace(mesh,indices),record={face:i/3,indices,sourceIndices,bounds:new Box3()};
   if(!('region'in classification)){
    for(const side of classification.ambiguousSides)this.ambiguous[side].push(record);
   }else if(classification.region==='torso')this.torso.push(record);
   else if(classification.region==='L'||classification.region==='R')this.arm[classification.region].push(record);
  }
  if(!this.arm.L.length||!this.arm.R.length||!this.torso.length)throw new Error('production mesh arm/torso skin regions are incomplete');
 }
 inspect():PoseValidityReport{
  this.mesh.updateMatrixWorld(true);this.worldMatrix.copy(this.mesh.matrixWorld);
  for(let i=0;i<this.positions.length;i++)this.mesh.getVertexPosition(i,this.positions[i]).applyMatrix4(this.worldMatrix);
  const records=new Set([...this.torso,...this.arm.L,...this.arm.R,...this.ambiguous.L,...this.ambiguous.R]);
  for(const triangle of records)this.updateBounds(triangle);
  const intersections=(['L','R'] as const).map(side=>this.findIntersections(side,this.arm[side],this.torso));
  // Mixed shoulder/axilla skin is not assigned to either surface. Only report
  // uncertainty when one of those transition triangles geometrically meets the
  // classified torso; ordinary blended attachment alone does not invalidate
  // otherwise testable poses.
  const uncertain=(['L','R'] as const).map(side=>this.findIntersections(side,this.ambiguous[side],this.torso));
  const checks=this.jointChecks();
  const definiteHit=intersections.some(x=>x.hits.length>0);
  const uncertainHit=uncertain.some(x=>x.hits.length>0||x.truncated);
  const invalid=definiteHit||checks.some(x=>!x.ok);
  const summary=(items:typeof intersections)=>items.map(({side,hits,truncated})=>({side,count:hits.length,
   bones:[...new Set(hits.flatMap(h=>[...this.bonesForTriangle(h.first),...this.bonesForTriangle(h.second)]))],
   triangles:hits.slice(0,24).map(h=>[h.first.face,h.second.face] as [number,number]),
   position:hits[0]?.position??null,truncated}));
  return {
   status:invalid?'invalid':uncertainHit?'indeterminate':'valid',checks,
   intersections:summary(intersections),uncertainIntersections:summary(uncertain),
   regions:{armTriangles:{L:this.arm.L.length,R:this.arm.R.length},torsoTriangles:this.torso.length,
    ambiguousTriangles:{L:this.ambiguous.L.length,R:this.ambiguous.R.length}},
   limitations:[
    'Surface crossing is checked at this solved sample only; enclosed-volume containment and between-sample crossings are not classified.',
    'Mixed skin-weight shoulder and axilla faces yield indeterminate only when they intersect a classified surface; other unclassified topology is outside this check.',
    'Triangle intersection proves a surface crossing but does not provide penetration depth; reported position is the intersecting triangle-pair centroid.',
   ],
  };
 }
 private updateBounds(triangle:TriangleRecord){
  triangle.bounds.makeEmpty();for(const i of triangle.indices)triangle.bounds.expandByPoint(this.positions[i]);
 }
 private bonesForTriangle(triangle:TriangleRecord){
  const totals=new Map<string,number>(),skinIndex=this.mesh.geometry.getAttribute('skinIndex'),skinWeight=this.mesh.geometry.getAttribute('skinWeight');
  for(const index of triangle.indices)for(let slot=0;slot<4;slot++){
   const name=this.mesh.skeleton.bones[skinIndex.getComponent(index,slot)]?.name;
   if(name)totals.set(name,(totals.get(name)??0)+skinWeight.getComponent(index,slot));
  }
  return [...totals].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([name])=>name);
 }
 private findIntersections(side:Side,firstSet:TriangleRecord[],secondSet:TriangleRecord[]){
  const grid=new Map<string,number[]>();
  secondSet.forEach((triangle,index)=>addToGrid(grid,triangle.bounds,index));
  const seen=new Uint32Array(secondSet.length),hits:TriangleHit[]=[];
  for(let ai=0;ai<firstSet.length;ai++){
   const a=firstSet[ai],[x0,y0,z0,x1,y1,z1]=cellRange(a.bounds),token=ai+1;
   for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++){
    const candidates=grid.get(cellKey(x,y,z));if(!candidates)continue;
    for(const ti of candidates){
     if(seen[ti]===token)continue;seen[ti]=token;
     const b=secondSet[ti];
     if(!a.bounds.intersectsBox(b.bounds)||a.face===b.face||sharesVertex(a,b))continue;
     const [p0,p1,p2]=a.indices.map(i=>this.positions[i]),[q0,q1,q2]=b.indices.map(i=>this.positions[i]);
     if(!trianglesIntersect(p0,p1,p2,q0,q1,q2))continue;
     const point=new Vector3().add(p0).add(p1).add(p2).add(q0).add(q1).add(q2).multiplyScalar(1/6);
     hits.push({first:a,second:b,position:point.toArray() as [number,number,number]});
     if(hits.length>=MAX_HITS)return {side,hits,truncated:true};
    }
   }
  }
  return {side,hits,truncated:false};
 }
 private jointChecks(){
  const checks:PoseValidityCheck[]=[],invTorso=new Quaternion(),restDir=new Vector3(),armDir=new Vector3(),local=new Vector3(),down=new Vector3(0,-1,0);
  for(const side of ['L','R'] as const){
   const shoulder=`upperarm01_${side}`,elbow=`lowerarm01_${side}`,wrist=`wrist_${side}`;
   const s=this.rig.point(shoulder),e=this.rig.point(elbow),w=this.rig.point(wrist);
   const upper=armDir.subVectors(e,s).normalize(),bend=angleAt(s,e,w);
   const torsoQ=this.rig.bone('spine01').getWorldQuaternion(new Quaternion());invTorso.copy(torsoQ).invert();
   local.copy(upper).applyQuaternion(invTorso);
   restDir.copy(this.rig.rest.get(elbow)!).sub(this.rig.rest.get(shoulder)!).normalize();
   const deviation=local.angleTo(restDir)/DEG,elevation=upper.angleTo(down)/DEG;
   checks.push({code:`shoulder-direction-${side}`,ok:deviation<=SHOULDER_DIRECTION_LIMIT+NUMERIC_EPS,
    bones:[shoulder,elbow,'spine01'],value:deviation,limit:SHOULDER_DIRECTION_LIMIT,unit:'deg',detail:`肩臂相对躯干静止方向偏转 ${deviation.toFixed(1)}° / ≤${SHOULDER_DIRECTION_LIMIT}°`});
   checks.push({code:`shoulder-elevation-${side}`,ok:elevation<=LIMITS.shoulderElevation[1]+NUMERIC_EPS,
    bones:[shoulder,elbow],value:elevation,limit:LIMITS.shoulderElevation[1],unit:'deg',detail:`肩上抬 ${elevation.toFixed(1)}° / ≤${LIMITS.shoulderElevation[1]}°`});
   checks.push({code:`elbow-flexion-${side}`,ok:bend>=LIMITS.elbowFlexion[0]-NUMERIC_EPS&&bend<=LIMITS.elbowFlexion[1]+NUMERIC_EPS,
    bones:[shoulder,elbow,wrist],value:bend,limit:LIMITS.elbowFlexion[1],unit:'deg',detail:`肘屈曲 ${bend.toFixed(1)}° / ${LIMITS.elbowFlexion[0]}–${LIMITS.elbowFlexion[1]}°`});
  }
  return checks;
 }
}
