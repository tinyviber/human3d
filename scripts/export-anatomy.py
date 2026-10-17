"""MyoSim's actual anatomical meshes, indexed by physics body. No replacement
capsules are used as bones. MuJoCo's compiled mesh / geom transforms are retained.
Minimal glTF 2.0 binary writer; normals derived from the original triangle faces.
"""
import json,struct
from pathlib import Path
import numpy as np
import mujoco,myo_sim
m,d=myo_sim.load('myofullbody');mujoco.mj_forward(m,d)
g={'asset':{'version':'2.0','generator':'KINESIS MyoSim anatomical mesh exporter','copyright':'MyoSim 0.2.3 contributors; Apache-2.0'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'materials':[{'name':'Anatomical bone','pbrMetallicRoughness':{'baseColorFactor':[.83,.79,.70,1],'roughnessFactor':.62,'metallicFactor':0},'doubleSided':True}],'bufferViews':[],'accessors':[],'buffers':[{'byteLength':0}]};chunks=[];offset=0

def acc(a,typ,component,target):
 global offset
 a=np.ascontiguousarray(a);data=a.tobytes();pad=(-len(data))%4;view=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(data),'target':target});chunks.append(data+b'\0'*pad);offset+=len(data)+pad
 v={'bufferView':view,'componentType':component,'count':len(a),'type':typ}
 if typ=='VEC3':v.update(min=a.min(axis=0).astype(float).tolist(),max=a.max(axis=0).astype(float).tolist())
 g['accessors'].append(v);return len(g['accessors'])-1
meshids={}
for geom in range(m.ngeom):
 if m.geom_type[geom]!=mujoco.mjtGeom.mjGEOM_MESH:continue
 mi=int(m.geom_dataid[geom])
 if mi not in meshids:
  va=int(m.mesh_vertadr[mi]);vn=int(m.mesh_vertnum[mi]);fa=int(m.mesh_faceadr[mi]);fn=int(m.mesh_facenum[mi]);v=m.mesh_vert[va:va+vn].astype('<f4');f=m.mesh_face[fa:fa+fn].astype('<u4');normal=np.zeros_like(v);n=np.cross(v[f[:,1]]-v[f[:,0]],v[f[:,2]]-v[f[:,0]])
  for j in range(3):np.add.at(normal,f[:,j],n)
  normal/=np.maximum(np.linalg.norm(normal,axis=1,keepdims=True),1e-12)
  primitive={'attributes':{'POSITION':acc(v,'VEC3',5126,34962),'NORMAL':acc(normal.astype('<f4'),'VEC3',5126,34962)},'indices':acc(f.flatten(),'SCALAR',5125,34963),'material':0}
  meshids[mi]=len(g['meshes']);g['meshes'].append({'name':m.mesh(mi).name,'primitives':[primitive]})
body_nodes={}
for geom in range(m.ngeom):
 if m.geom_type[geom]!=mujoco.mjtGeom.mjGEOM_MESH:continue
 bid=int(m.geom_bodyid[geom]);mi=int(m.geom_dataid[geom])
 if bid not in body_nodes:
  node={'name':f'body-{bid}','translation':d.xpos[bid].tolist(),'rotation':d.xquat[bid][[1,2,3,0]].tolist(),'children':[]};body_nodes[bid]=len(g['nodes']);g['scenes'][0]['nodes'].append(body_nodes[bid]);g['nodes'].append(node)
 node={'name':m.geom(geom).name or f'geom-{geom}','mesh':meshids[mi],'translation':m.geom_pos[geom].tolist(),'rotation':m.geom_quat[geom][[1,2,3,0]].tolist()};g['nodes'][body_nodes[bid]]['children'].append(len(g['nodes']));g['nodes'].append(node)
g['buffers'][0]['byteLength']=offset;data=json.dumps(g,separators=(',',':')).encode();data+=b' '*((-len(data))%4);binary=b''.join(chunks);length=12+8+len(data)+8+len(binary)
Path('public/dynamics/anatomy.glb').write_bytes(struct.pack('<III',0x46546c67,2,length)+struct.pack('<II',len(data),0x4e4f534a)+data+struct.pack('<II',len(binary),0x004e4942)+binary)
print('Exported',len(g['meshes']),'original anatomical meshes /',len(body_nodes),'bodies,',length,'bytes')
for geom in range(m.ngeom):
 if m.geom_type[geom]!=mujoco.mjtGeom.mjGEOM_MESH and m.geom_group[geom]==0:print('analytic visual',m.body(int(m.geom_bodyid[geom])).name,m.geom(geom).name,m.geom_type[geom],m.geom_size[geom])
