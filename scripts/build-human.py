"""Reproducible CC0 MakeHuman -> glTF skin. Blender only interpolates the supplied
mesh/weights with one Catmull-Clark pass; no auto-rig or invented joint centers.
Run with python3 scripts/build-human.py (Blender on PATH)."""
import sys, pathlib, subprocess, json, struct
ROOT=pathlib.Path(__file__).resolve().parents[1]
if '--inside-blender' not in sys.argv:
    subprocess.run(['blender','--background','--factory-startup','--python',str(pathlib.Path(__file__).resolve()),'--','--inside-blender'],check=True)
    subprocess.run([sys.executable,str(ROOT/'scripts/build-anatomy-surface.py')],check=True)
    sys.exit()
import bpy
import numpy as np
source=ROOT/'assets/source'
verts=[]; faces=[]; group=''
for line in (source/'base.obj').read_text().splitlines():
    fields=line.split()
    if not fields: continue
    if fields[0]=='v': verts.append([float(v) for v in fields[1:4]])
    elif fields[0]=='g': group=fields[1]
    elif fields[0]=='f' and group=='body': faces.append([int(v.split('/')[0])-1 for v in fields[1:]])
v=np.array(verts)
for target,weight in [('caucasian-male-young.target',1),('universal-male-young-averagemuscle-averageweight.target',.35),('universal-male-young-maxmuscle-averageweight.target',.65)]:
    for line in (source/target).read_text().splitlines():
        if line and not line.startswith('#'):
            f=line.split();v[int(f[0])]+=weight*np.array([float(x) for x in f[1:]])
used=sorted(set(i for f in faces for i in f)); remap={old:new for new,old in enumerate(used)}
ymin=min(v[i,1] for i in used); ymax=max(v[i,1] for i in used); scale=1.78/(ymax-ymin)
v[:,1]-=ymin;v*=scale
rig=json.loads((source/'default.mhskel').read_text()); weights=json.loads((source/'default_weights.mhw').read_text())['weights']
# Topological sort keeps parents ahead of children.
names=[]
def visit(n):
    if n in names:return
    p=rig['bones'][n]['parent']
    if p:visit(p)
    names.append(n)
for n in rig['bones']:visit(n)
heads={n:v[rig['joints'][rig['bones'][n]['head']]].mean(axis=0) for n in names}
tails={n:v[rig['joints'][rig['bones'][n]['tail']]].mean(axis=0) for n in names}
mesh=bpy.data.meshes.new('MakeHuman continuous surface');mesh.from_pydata(v[used].tolist(),[],[[remap[i] for i in f] for f in faces]);mesh.update()
obj=bpy.data.objects.new('Human',mesh);bpy.context.collection.objects.link(obj);bpy.context.view_layer.objects.active=obj;obj.select_set(True)
for n in names:
    vg=obj.vertex_groups.new(name=n)
    for idx,w in weights.get(n,[]):
        if idx in remap:vg.add([remap[idx]],w,'REPLACE')
sub=obj.modifiers.new('Catmull-Clark surface refinement','SUBSURF');sub.levels=1
bpy.ops.object.modifier_apply(modifier=sub.name)
mesh=obj.data
positions=np.array([x.co[:] for x in mesh.vertices],dtype='<f4');normals=np.array([x.normal[:] for x in mesh.vertices],dtype='<f4')
indices=[]
for face in mesh.polygons:
    f=list(face.vertices)
    for i in range(1,len(f)-1):indices.extend([f[0],f[i],f[i+1]])
indices=np.array(indices,dtype='<u4')
joints=np.zeros((len(positions),4),dtype='<u2');skin=np.zeros((len(positions),4),dtype='<f4');max_discard=0
for vertex in mesh.vertices:
    influences=sorted([(g.group,g.weight) for g in vertex.groups if g.weight>0],key=lambda a:-a[1]);selected=influences[:4]
    if not selected:raise RuntimeError(f'Unweighted vertex {vertex.index}')
    total=sum(w for _,w in selected);max_discard=max(max_discard,sum(w for _,w in influences[4:]))
    for k,(bone,w) in enumerate(selected):joints[vertex.index,k]=bone;skin[vertex.index,k]=w/total
# Four glTF influences are interpolated from the original authored weight field.
binbuf=bytearray();views=[];accessors=[]
def acc(array,kind,component,bounds=False):
    while len(binbuf)%4:binbuf.append(0)
    offset=len(binbuf);data=array.tobytes();binbuf.extend(data);views.append({'buffer':0,'byteOffset':offset,'byteLength':len(data)})
    a={'bufferView':len(views)-1,'componentType':component,'count':len(array),'type':kind}
    if bounds:a.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
    accessors.append(a);return len(accessors)-1
pos=acc(positions,'VEC3',5126,True);nor=acc(normals,'VEC3',5126);joint=acc(joints,'VEC4',5123);wei=acc(skin,'VEC4',5126);ind=acc(indices,'SCALAR',5125)
ibm=[]
for n in names:
    m=np.eye(4,dtype='<f4');m[:3,3]=-heads[n];ibm.append(m.T.flatten())
ib=acc(np.array(ibm,dtype='<f4'),'MAT4',5126)
nodes=[{'name':'MakeHuman_CC0','children':[1,2]},{'name':'HumanSurface','mesh':0,'skin':0}]
for n in names:
    b=rig['bones'][n];p=b['parent'];translation=heads[n]-(heads[p] if p else 0)
    node={'name':n.replace('.','_'),'translation':translation.tolist(),'extras':{'makehumanBone':n,'tail':tails[n].tolist()}}
    children=[names.index(c)+2 for c in names if rig['bones'][c]['parent']==n]
    if children:node['children']=children
    nodes.append(node)
asset={'asset':{'version':'2.0','generator':'Kinesis / MakeHuman CC0 source + Blender Catmull-Clark','copyright':'MakeHuman Team, CC0'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':nodes,'meshes':[{'name':'ContinuousHuman','primitives':[{'attributes':{'POSITION':pos,'NORMAL':nor,'JOINTS_0':joint,'WEIGHTS_0':wei},'indices':ind,'material':0}]}],'materials':[{'name':'Anatomical clay','pbrMetallicRoughness':{'baseColorFactor':[.28,.39,.49,1],'metallicFactor':.08,'roughnessFactor':.48}}],'skins':[{'name':'MakeHuman default (163 bones)','joints':list(range(2,len(nodes))),'skeleton':2,'inverseBindMatrices':ib}],'bufferViews':views,'accessors':accessors,'buffers':[{'byteLength':len(binbuf)}]}
j=json.dumps(asset,separators=(',',':')).encode();j+=b' '*((-len(j))%4);binbuf+=b'\0'*((-len(binbuf))%4)
glb=struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(binbuf))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binbuf),0x004e4942)+binbuf
(ROOT/'public/models/human.glb').write_bytes(glb)
meta={'height':1.78,'bones':[{'name':n.replace('.','_'),'sourceName':n,'parent':rig['bones'][n]['parent'].replace('.','_') if rig['bones'][n]['parent'] else None,'head':heads[n].tolist(),'tail':tails[n].tolist()} for n in names],'vertices':len(positions),'triangles':len(indices)//3,'maxDiscardedWeight':max_discard,'license':'CC0'}
(ROOT/'public/models/rig.json').write_text(json.dumps(meta,indent=2))
print('EXPORTED',len(glb),'bytes;',len(positions),'vertices;',len(names),'bones; max discarded weight',max_discard)
