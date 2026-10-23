// Decode the pinned, Z-Anatomy-derived GLBs with the project's existing Three.js
// Draco decoder. This importer copies geometry/identity, never source app code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {Matrix4,Quaternion,Vector3} from 'three';
const require=createRequire(import.meta.url),root=process.cwd(),input=process.argv[2],output=process.argv[3];
if(!input||!output)throw new Error('usage: node scripts/import-z-anatomy.mjs <source-dir> <output-prefix>');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'human3d-draco-'));
fs.copyFileSync(path.join(root,'node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js'),path.join(dir,'decoder.cjs'));
const draco=await require(path.join(dir,'decoder.cjs'))({});
const chunks=[],items=[];let offset=0;
function append(array){const start=offset,b=Buffer.from(array.buffer,array.byteOffset,array.byteLength);chunks.push(b);offset+=b.length;return start;}
try{
 for(const kind of ['muscles','skeleton','skin']){
  const raw=fs.readFileSync(path.join(input,`z-${kind}.glb`)),n=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+n).toString()),binary=raw.subarray(28+n);
  for(const node of doc.nodes){
   if(node.mesh===undefined)continue;
   const matrix=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3().fromArray(node.translation??[0,0,0]),new Quaternion().fromArray(node.rotation??[0,0,0,1]),new Vector3().fromArray(node.scale??[1,1,1]));
   for(const primitive of doc.meshes[node.mesh].primitives){
    const ext=primitive.extensions.KHR_draco_mesh_compression,view=doc.bufferViews[ext.bufferView],encoded=binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
    const decoder=new draco.Decoder(),buffer=new draco.DecoderBuffer(),mesh=new draco.Mesh();buffer.Init(new Int8Array(encoded.buffer,encoded.byteOffset,encoded.byteLength),encoded.length);
    const status=decoder.DecodeBufferToMesh(buffer,mesh);if(!status.ok())throw new Error(`invalid Draco mesh: ${node.name}`);
    const attr=decoder.GetAttributeByUniqueId(mesh,ext.attributes.POSITION),values=new draco.DracoFloat32Array();decoder.GetAttributeFloatForAllPoints(mesh,attr,values);
    const positions=new Float32Array(mesh.num_points()*3),point=new Vector3();
    for(let i=0;i<mesh.num_points();i++){point.set(values.GetValue(i*3),values.GetValue(i*3+1),values.GetValue(i*3+2)).applyMatrix4(matrix);positions.set(point.toArray(),i*3);}
    const indices=new Uint32Array(mesh.num_faces()*3),face=new draco.DracoInt32Array();
    for(let i=0;i<mesh.num_faces();i++){decoder.GetFaceFromMesh(mesh,i,face);for(let k=0;k<3;k++)indices[i*3+k]=face.GetValue(k);}
    items.push({kind:kind==='muscles'?'muscle':kind==='skeleton'?'bone':'skin',name:node.extras?.zname??node.name,group:node.extras?.zgroup??'',material:node.extras?.zmat??'',nodeName:node.name,positions:append(positions),vertexCount:mesh.num_points(),indices:append(indices),triangleCount:mesh.num_faces()});
    for(const obj of [face,values,mesh,buffer,decoder])draco.destroy(obj);
   }
  }
 }
 fs.writeFileSync(output+'.bin',Buffer.concat(chunks));fs.writeFileSync(output+'.json',JSON.stringify({items,files:['muscles','skeleton','skin'].map(kind=>({file:`z-${kind}.glb`,sha256:createHash('sha256').update(fs.readFileSync(path.join(input,`z-${kind}.glb`))).digest('hex')}))},null,2)+'\n');
 console.log('Decoded meshes:',items.length,'raw bytes:',offset);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
