"""Restore hm08 UVs without Blender; bake authored superficial-muscle patches.
Run after build-human.py. Existing triangle positions, normals and skin weights
are copied exactly; only UV seams duplicate render vertices. rig.json remains
unchanged (its vertices field counts the original welded surface).
"""
import argparse, hashlib, json, pathlib, struct, zlib
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1]

def load_glb(path):
    raw=path.read_bytes(); size=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+size]); start=20+size
    return doc,raw[start+8:start+8+struct.unpack_from('<I',raw,start)[0]]

def read_acc(doc,binary,i):
    a=doc['accessors'][i]; v=doc['bufferViews'][a['bufferView']]
    dtype={5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']]
    width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
    return np.frombuffer(binary,dtype=dtype,count=a['count']*width,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,width).copy()

def source_surface():
    uv=[];faces=[];corners=[];group=''
    for line in (ROOT/'assets/source/base.obj').read_text().splitlines():
        f=line.split()
        if not f:continue
        if f[0]=='vt':uv.append(list(map(float,f[1:3])))
        elif f[0]=='g':group=f[1]
        elif f[0]=='f' and group=='body':
            pairs=[list(map(int,x.split('/')[:2])) for x in f[1:]]
            faces.append([x[0]-1 for x in pairs]);corners.append([x[1]-1 for x in pairs])
    used=sorted({i for face in faces for i in face});remap={old:new for new,old in enumerate(used)}
    return len(used),np.array(uv),[[remap[i] for i in f] for f in faces],corners

def subdivide(nv,uv,faces,corners):
    edges={}
    for face in faces:
        for a,b in zip(face,face[1:]+face[:1]):
            key=tuple(sorted((a,b)))
            if key not in edges:edges[key]=len(edges)
    quads=[];tex=[]
    for fi,(face,corner) in enumerate(zip(faces,corners)):
        fuv=uv[corner];mid=fuv.mean(axis=0)
        for k,a in enumerate(face):
            b=face[(k+1)%len(face)];prev=face[k-1]
            quads.append([a,nv+edges[tuple(sorted((a,b)))],nv+len(edges)+fi,nv+edges[tuple(sorted((prev,a)))]])
            tex.append([fuv[k],(fuv[k]+fuv[(k+1)%len(face)])/2,mid,(fuv[k-1]+fuv[k])/2])
    return nv+len(edges)+len(faces),quads,np.array(tex)

def restore_uv(doc,binary):
    primitive=doc['meshes'][0]['primitives'][0];attrs=primitive['attributes']
    # Idempotent reruns reuse the stored UVs; build-human.py makes a fresh base.
    if 'TEXCOORD_0' in attrs:return binary
    position=read_acc(doc,binary,attrs['POSITION']);indices=read_acc(doc,binary,primitive['indices']).ravel()
    nv,uv,faces,corners=source_surface();point_count,quads,tex=subdivide(nv,uv,faces,corners)
    # Blender's limit-surface evaluation changes coordinates slightly. Recover
    # the correspondence from topology instead of guessing nearest positions:
    # originals first, edge points next, face points last (one subdivision).
    ne=point_count-nv-len(faces)
    edge_neighbors={}
    for tri in indices.reshape(-1,3):
        originals=[int(i) for i in tri if i<nv]
        for i in tri:
            if nv<=i<nv+ne:edge_neighbors.setdefault(int(i),set()).update(originals)
    source_edges={}
    for face in faces:
        for a,b in zip(face,face[1:]+face[:1]):
            key=tuple(sorted((a,b)))
            if key not in source_edges:source_edges[key]=nv+len(source_edges)
    nearest=list(range(nv))+[None]*(ne+len(faces))
    for i,neighbors in edge_neighbors.items():nearest[i]=source_edges.get(tuple(sorted(neighbors)))
    for i in range(nv+ne,point_count):nearest[i]=i
    if len(position)!=point_count or any(i is None for i in nearest) or len(set(nearest))!=point_count:
        raise ValueError('source subdivision does not match human.glb topology')
    # Each existing triangle belongs to one refined source quad. Its winding and
    # diagonal are retained, regardless of Blender's internal vertex ordering.
    lookup={}
    for q,coords in zip(quads,tex):
        for omit in range(4):lookup[tuple(sorted(q[:omit]+q[omit+1:]))]={a:t for a,t in zip(q,coords)}
    source_index=list(range(len(position)));new_uv=[None]*len(position);variants={};out=[]
    for tri in indices.reshape(-1,3):
        ids=[nearest[i] for i in tri];mapping=lookup.get(tuple(sorted(ids)))
        if mapping is None:raise ValueError(f'triangle missing from source UV topology: {ids}')
        for old,sid in zip(tri,ids):
            # OBJ V goes up; glTF texture V goes down.
            u,v=mapping[sid];t=(float(u),float(1-v));key=(int(old),round(t[0],8),round(t[1],8))
            if key not in variants:
                if new_uv[old] is None:idx=int(old);new_uv[idx]=t
                else:idx=len(source_index);source_index.append(int(old));new_uv.append(t)
                variants[key]=idx
            out.append(variants[key])
    if any(t is None for t in new_uv):raise ValueError('unreferenced source vertex')
    data=bytearray(binary)
    def append(array,kind,component,bounds=False):
        data.extend(b'\0'*((-len(data))%4));offset=len(data);raw=array.tobytes();data.extend(raw)
        doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(raw)})
        a={'bufferView':len(doc['bufferViews'])-1,'componentType':component,'count':len(array),'type':kind}
        if bounds:a.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
        doc['accessors'].append(a);return len(doc['accessors'])-1
    for key,i in list(attrs.items()):
        a=doc['accessors'][i];array=read_acc(doc,binary,i)[source_index]
        attrs[key]=append(array,a['type'],a['componentType'],key=='POSITION')
    attrs['TEXCOORD_0']=append(np.array(new_uv,dtype='<f4'),'VEC2',5126)
    if len(position)>65536:raise ValueError('source topology exceeds uint16 vertex identity')
    attrs['_SOURCE_VERTEX']=append(np.array(source_index,dtype='<u2').reshape(-1,1),'SCALAR',5123)
    primitive['indices']=append(np.array(out,dtype='<u4').reshape(-1,1),'SCALAR',5125)
    doc['buffers'][0]['byteLength']=len(data)
    doc['asset']['extras']={'uvSource':'MakeHuman hm08 face-varying UVs, bilinear subdivision','weldedVertices':len(position),'uvSeamVertices':len(source_index)-len(position)}
    print('UV restored:',len(source_index),'render vertices; verified original topology')
    return bytes(data)

def compact(doc,binary):
    """Drop the replaced accessors so UV restoration does not double file size."""
    references=[]
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            references.extend((p['attributes'],k) for k in p['attributes']);references.append((p,'indices'))
    references.extend((s,'inverseBindMatrices') for s in doc.get('skins',[]))
    arrays={i:read_acc(doc,binary,i) for obj,key in references for i in [obj[key]]}
    old=doc['accessors'];doc['accessors']=[];doc['bufferViews']=[];data=bytearray();mapping={}
    for i,array in arrays.items():
        data.extend(b'\0'*((-len(data))%4));offset=len(data);raw=array.tobytes();data.extend(raw)
        doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(raw)})
        a={k:v for k,v in old[i].items() if k not in ['bufferView','byteOffset']};a['bufferView']=len(doc['bufferViews'])-1
        mapping[i]=len(doc['accessors']);doc['accessors'].append(a)
    for obj,key in references:obj[key]=mapping[obj[key]]
    doc['buffers'][0]['byteLength']=len(data)
    return bytes(data)

def png(width,height,pixels):
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    rows=b''.join(b'\0'+row.tobytes() for row in pixels)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b'')

def bake(doc,binary):
    from lib.anatomy_atlas import project_labels
    size=1024
    p=doc['meshes'][0]['primitives'][0];positions=read_acc(doc,binary,p['attributes']['POSITION']);uv=read_acc(doc,binary,p['attributes']['TEXCOORD_0']);indices=read_acc(doc,binary,p['indices']).ravel()
    xyz=np.zeros((size,size,3),dtype=np.float32);valid=np.zeros((size,size),dtype=bool)
    for tri in indices.reshape(-1,3):
        t=uv[tri]*size-.5;lo=np.maximum(0,np.ceil(t.min(axis=0)).astype(int));hi=np.minimum(size-1,np.floor(t.max(axis=0)).astype(int))
        if np.any(lo>hi):continue
        x,y=np.meshgrid(np.arange(lo[0],hi[0]+1),np.arange(lo[1],hi[1]+1));a,b,c=t;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-12:continue
        w0=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;w1=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;w2=1-w0-w1;inside=(w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)
        weights=np.stack([w0,w1,w2],axis=-1);ys=slice(lo[1],hi[1]+1);xs=slice(lo[0],hi[0]+1)
        xyz[ys,xs][inside]=(weights@positions[tri])[inside];valid[ys,xs]|=inside
    values,regions,registration,source=project_labels(xyz[valid],positions)
    ids=np.zeros((size,size),dtype=np.uint16);ids[valid]=values
    # IDs span more than 255 anatomical structures. R/G store the exact low/high
    # bytes; B is coverage. CPU and shader use nearest sampling of the same ID.
    coverage=np.full((size,size),255,dtype=np.uint8);edge=np.zeros_like(valid)
    for dy,dx in [(-1,0),(1,0),(0,-1),(0,1)]:edge|=ids!=np.roll(ids,(dy,dx),(0,1))
    coverage[edge]=150
    pixels=np.stack([(ids&255).astype(np.uint8),(ids>>8).astype(np.uint8),coverage,np.full_like(coverage,255)],axis=-1)
    counts=np.bincount(ids.ravel(),minlength=len(regions)+1)
    for r in regions:r['surfaceTexels']=int(counts[r['id']])
    meta={'version':2,'encoding':'rg16-b-coverage','width':size,'height':size,'regions':regions,
        'source':{'name':source['dataset'],'url':source['primaryURL'],'license':source['license'],'licenseURL':source['licenseURL'],
            'attribution':'Z-Anatomy — Gauthier Kervyn; derived from BodyParts3D © DBCLS. Adapted muscle surface atlas, CC BY-SA 4.0.',
            'conversionCommit':source['conversionCommit'],'geometrySHA256':source['geometrySHA256'],
            'muscleComponentCount':sum(i['kind']=='muscle' for i in source['items'])},
        'coverage':{'muscleRegions':len(regions),'surfaceRegions':int(np.count_nonzero(counts[1:])),
            'skinTexels':int(np.sum(valid)),'muscleTexels':int(np.sum(ids>0)),
            'unrepresented':'Zero-texel structures are retained in the inventory, not painted through the surface. This cross-model projection is approximate.'},
        'registration':registration,'surfaceSHA256':hashlib.sha256(binary).hexdigest()}
    return png(size,size,pixels),json.dumps(meta,ensure_ascii=False,indent=2).encode()+b'\n',meta['coverage']

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    path=ROOT/'public/models/human.glb';doc,binary=load_glb(path);binary=compact(doc,restore_uv(doc,binary))
    raw=json.dumps(doc,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);binary+=b'\0'*((-len(binary))%4)
    glb=struct.pack('<III',0x46546c67,2,28+len(raw)+len(binary))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary
    mask,meta,counts=bake(doc,binary)
    for file,data in [(path,glb),(ROOT/'public/models/anatomy-mask.png',mask),(ROOT/'public/models/anatomy-regions.json',meta)]:
        if args.check:
            if not file.exists() or file.read_bytes()!=data:raise ValueError(f'stale anatomy asset: {file}')
        else:file.write_bytes(data)
    print('Muscle mask:',counts)
if __name__=='__main__':main()
