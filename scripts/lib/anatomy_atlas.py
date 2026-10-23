"""Transfer a labelled anatomical surface envelope onto the existing skin UVs.
Anatomical boundaries come from Z-Anatomy mesh surfaces. Landmark registration
changes only the query correspondence, never the rig, motion or source labels.
"""
import hashlib,json,pathlib,re
import numpy as np
from scipy.interpolate import RBFInterpolator
from scipy.spatial import cKDTree
ROOT=pathlib.Path(__file__).resolve().parents[2]
DATA=ROOT/'assets/anatomy/z-anatomy'

ALIASES={'pectoralis_major':'pectoralis','biceps_brachii':'biceps','triceps_brachii':'triceps','rectus_abdominis':'rectus','external_abdominal_oblique':'obliques','latissimus_dorsi':'latissimus','gluteus_maximus':'gluteus','tibialis_anterior':'tibialis'}

def canonical(name):
    match=re.search(r'\.([lr])$',name);side=match[1].upper() if match else 'C';base=name[:match.start()] if match else name
    base=base.strip('()');base=re.sub(r'^(?:.*? heads?|.*? bell(?:y|ies)|.*? parts?) of ','',base,flags=re.I)
    base=re.sub(r'\bmuscles?\b','',base,flags=re.I).strip(' ()');base=re.sub(r'\s+',' ',base)
    key=re.sub(r'[^a-z0-9]+','_',base.lower()).strip('_');key=ALIASES.get(key,key)
    return key+'_'+side,base,side

class AnatomySource:
    def __init__(self):
        self.meta=json.loads((DATA/'source.json').read_text());raw=(DATA/'geometry.npz').read_bytes()
        if hashlib.sha256(raw).hexdigest()!=self.meta['geometrySHA256']:raise ValueError('source geometry checksum mismatch')
        d=np.load(DATA/'geometry.npz');self.vertices=d['vertices'];self.faces=d['faces'];self.mesh=d['mesh'];self.items=self.meta['items'];self.offsets=np.cumsum([0]+[i['vertexCount'] for i in self.items])
        self.named={item['name']:i for i,item in enumerate(self.items)};self.regions=[];lookup={};self.labels=np.zeros(len(self.items),dtype=np.uint16)
        glossary=json.loads((ROOT/'assets/anatomy/muscle-names.json').read_text())
        for i,item in enumerate(self.items):
            if item['kind']!='muscle':continue
            key,english,side=canonical(item['name'])
            if key not in lookup:
                rid=len(self.regions)+1;lookup[key]=rid;stem=key.rsplit('_',1)[0];chinese=glossary.get(stem,english)
                self.regions.append({'id':rid,'key':key,'name':({'L':'左','R':'右','C':''}[side]+chinese) if stem in glossary else english+({'L':' (left)','R':' (right)','C':''}[side]),'englishName':english,'side':side,'sourceObjects':[]})
            rid=lookup[key];self.labels[i]=rid;self.regions[rid-1]['sourceObjects'].append({'name':item['name'],'node':item['nodeName'],'group':item['group']})
        self.skin_mesh=np.array([i['kind']=='skin' and i['material']=='Skin' for i in self.items]);self.envelope_mesh=np.array([i['kind'] in ['muscle','bone','connective'] or i['material'] in ['Eye','Iris','Cornea','Nail'] for i in self.items])
    def points(self,name):
        i=self.named[name];return self.vertices[self.offsets[i]:self.offsets[i+1]]
    def pole(self,name,upper):
        v=self.points(name);mask=v[:,1]>=np.quantile(v[:,1],.88) if upper else v[:,1]<=np.quantile(v[:,1],.12);return v[mask].mean(axis=0)
    def skin(self):
        return np.concatenate([self.vertices[self.offsets[i]:self.offsets[i+1]] for i in range(len(self.items)) if self.skin_mesh[i]])

class SurfaceIndex:
    def __init__(self,vertices,faces,labels=None):
        self.triangles=vertices[faces];self.labels=labels
        # Dense source meshes; four interior/boundary samples also account for
        # the larger triangles of broad muscles in the reduced export.
        t=self.triangles;points=np.concatenate([t.mean(axis=1),(t[:,0]+t[:,1])/2,(t[:,1]+t[:,2])/2,(t[:,2]+t[:,0])/2]);self.tree=cKDTree(points);self.count=len(t)
    def closest(self,points,k=16):
        out=np.empty_like(points,dtype=np.float64);distance=np.empty(len(points));ids=np.empty(len(points),dtype=np.int64)
        for start in range(0,len(points),2048):
            q=points[start:start+2048];_,candidates=self.tree.query(q,k=k,workers=1);candidates%=self.count;t=self.triangles[candidates]
            result=closest_on_triangles(q[:,None,:],t);ds=np.sum((result-q[:,None,:])**2,axis=-1);which=ds.argmin(axis=1);rows=np.arange(len(q))
            out[start:start+len(q)]=result[rows,which];distance[start:start+len(q)]=np.sqrt(ds[rows,which]);ids[start:start+len(q)]=candidates[rows,which]
        return out,distance,ids

def closest_on_triangles(p,t):
    a,b,c=t[...,0,:],t[...,1,:],t[...,2,:];ab=b-a;ac=c-a;ap=p-a
    dot=lambda x,y:np.sum(x*y,axis=-1)
    d1=dot(ab,ap);d2=dot(ac,ap);bp=p-b;d3=dot(ab,bp);d4=dot(ac,bp);cp=p-c;d5=dot(ab,cp);d6=dot(ac,cp)
    va=d3*d6-d5*d4;vb=d5*d2-d1*d6;vc=d1*d4-d3*d2
    den=va+vb+vc;den=np.where(np.abs(den)<1e-30,1,den);out=a+ab*(vb/den)[...,None]+ac*(vc/den)[...,None]
    def edge(mask,x,direction,num,den):
        nonlocal out
        fraction=np.divide(num,den,out=np.zeros_like(num),where=np.abs(den)>1e-30);out=np.where(mask[...,None],x+direction*fraction[...,None],out)
    edge((va<=0)&((d4-d3)>=0)&((d5-d6)>=0),b,c-b,d4-d3,(d4-d3)+(d5-d6))
    edge((vb<=0)&(d2>=0)&(d6<=0),a,ac,d2,d2-d6)
    edge((vc<=0)&(d1>=0)&(d3<=0),a,ab,d1,d1-d3)
    out=np.where(((d5>=0)&(d6<=d5))[...,None],c,out);out=np.where(((d3>=0)&(d4<=d3))[...,None],b,out);out=np.where(((d1<=0)&(d2<=0))[...,None],a,out)
    return out

def correspondence(source,target_vertices):
    rig=json.loads((ROOT/'public/models/rig.json').read_text());bones={b['name']:b for b in rig['bones']};head=lambda n:np.array(bones[n]['head']);tail=lambda n:np.array(bones[n]['tail'])
    src=[];dst=[];records=[]
    def add(name,target,reference):src.append(np.array(target));dst.append(np.array(reference));records.append({'name':name,'target':np.array(target).tolist(),'reference':np.array(reference).tolist()})
    source_skin=source.skin();joints={};segments=[]
    for side in ['L','R']:
        suffix='.'+side.lower();humerus='Humerus'+suffix;femur='Femur'+suffix;tibia='Tibia'+suffix
        shoulder=source.pole(humerus,True);elbow=source.pole(humerus,False);wrist=(source.pole('Radius'+suffix,False)+source.pole('Ulna'+suffix,False))/2
        hip=source.pole(femur,True);knee=(source.pole(femur,False)+source.pole(tibia,True))/2;ankle=source.points('Talus'+suffix).mean(axis=0)
        for key,ref in [('upperarm01',shoulder),('lowerarm01',elbow),('wrist',wrist),('upperleg01',hip),('lowerleg01',knee),('foot',ankle)]:add(key+'_'+side,head(key+'_'+side),ref);joints[key+'_'+side]=ref
        for a,b in [('upperarm01','lowerarm01'),('lowerarm01','wrist'),('upperleg01','lowerleg01'),('lowerleg01','foot')]:segments.append((head(a+'_'+side),head(b+'_'+side),joints[a+'_'+side],joints[b+'_'+side]))
        ordinals=['first','second','third','fourth','fifth']
        for finger,ordinal in enumerate(ordinals,1):
            prefix=f'finger{finger}-';metacarpal=ordinal.capitalize()+' metacarpal bone'+suffix
            for joint in [1,2,3]:
                if finger==1:name=metacarpal if joint==1 else f'{"Proximal" if joint==2 else "Distal"} phalanx of {ordinal} finger of hand'+suffix
                else:name=f'{["Proximal","Middle","Distal"][joint-1]} phalanx of {ordinal} finger of hand'+suffix
                add(prefix+str(joint)+'_'+side,head(prefix+str(joint)+'_'+side),source.pole(name,True))
            add(prefix+'tip_'+side,tail(prefix+'3_'+side),source.pole('Distal phalanx of '+ordinal+' finger of hand'+suffix,False))
        # Foot volume and forward direction; source toes remain close together,
        # target foot placement differs, so register on the actual skin surface.
        toe_candidates=[n for n in bones if n.startswith('toe') and n.endswith('_'+side)]
        toe=max(toe_candidates,key=lambda n:bones[n]['tail'][2]);source_toe=source.points('First metatarsal bone'+suffix)
        add('toe_'+side,tail(toe),source_toe[source_toe[:,2]>=np.quantile(source_toe[:,2],.9)].mean(axis=0))
    hip_y=np.mean([joints['upperleg01_'+s][1] for s in ['L','R']]);target_hip=np.mean([head('upperleg01_'+s)[1] for s in ['L','R']]);shoulder_y=np.mean([joints['upperarm01_'+s][1] for s in ['L','R']]);target_shoulder=np.mean([head('upperarm01_'+s)[1] for s in ['L','R']])
    target_top=target_vertices[:,1].max();source_top=source_skin[:,1].max()
    for y in [.83,.96,1.08,1.21,1.34,1.46,1.55,1.64,1.72]:
        sy=np.interp(y,[0,target_hip,target_shoulder,target_top],[0,hip_y,shoulder_y,source_top]);width=.20 if y<1.44 else .11
        pools=[]
        for v,h in [(target_vertices,y),(source_skin,sy)]:
            pool=v[(np.abs(v[:,1]-h)<.013)&(np.abs(v[:,0])<width)]
            if len(pool)<8:raise ValueError(f'insufficient registration ring: {y}')
            pools.append(pool)
        for k in range(8):
            direction=np.array([np.cos(k*np.pi/4),0,np.sin(k*np.pi/4)]);pair=[]
            for pool in pools:
                projection=pool@direction;pair.append(pool[projection>=np.quantile(projection,.98)].mean(axis=0))
            add(f'torso-ring-{y}-{k}',*pair)
    # Cross-section rings keep widths and forward orientation consistent while
    # the landmarks above account for A-pose vs anatomical rest pose.
    for si,(a,b,c,d) in enumerate(segments):
        pair_pools=[target_vertices,source_skin]
        frames=[]
        for p,q in [(a,b),(c,d)]:
            axis=q-p;length=np.linalg.norm(axis);axis/=length;u=np.cross(axis,[0,0,1]);u/=np.linalg.norm(u);v=np.cross(u,axis);frames.append((p,axis,length,u,v))
        for fraction in [.35,.7]:
            pools=[]
            for cloud,(p,axis,length,u,v) in zip(pair_pools,frames):
                delta=cloud-p;along=delta@axis;radial=delta-along[:,None]*axis;radius=.11 if si%4>=2 else .085
                pools.append(cloud[(np.abs(along-fraction*length)<.013)&(np.linalg.norm(radial,axis=1)<radius)])
            if min(map(len,pools))<8:continue
            for k in range(4):
                pair=[]
                for pool,(_,_,_,u,v) in zip(pools,frames):
                    direction=u*np.cos(k*np.pi/2)+v*np.sin(k*np.pi/2);projection=pool@direction;pair.append(pool[projection>=np.quantile(projection,.96)].mean(axis=0))
                add(f'limb-ring-{si}-{fraction}-{k}',*pair)
    src=np.array(src);dst=np.array(dst)
    # Smoothness stabilises closely spaced finger constraints and source cap
    # sampling; this is a visual inter-subject correspondence, not retargeting.
    fit=RBFInterpolator(src,dst,kernel='thin_plate_spline',smoothing=2e-5)
    return fit,records,float(np.max(np.linalg.norm(fit(src)-dst,axis=1)))

def project_labels(target_points,target_vertices):
    source=AnatomySource();fit,landmarks,residual=correspondence(source,target_vertices)
    mapped=np.concatenate([fit(target_points[i:i+4096]) for i in range(0,len(target_points),4096)])
    skin_faces=source.faces[source.skin_mesh[source.mesh]];skin_index=SurfaceIndex(source.vertices,skin_faces)
    skin_points,skin_dist,_=skin_index.closest(mapped);del skin_index
    keep=source.envelope_mesh[source.mesh]
    faces=source.faces[keep];labels=source.labels[source.mesh[keep]];envelope=SurfaceIndex(source.vertices,faces)
    _,depth,which=envelope.closest(skin_points);ids=labels[which]
    # Outside registration support or anatomy too far below the reference skin
    # stays unassigned. Do not stretch muscle labels across unsupported areas.
    ids[(skin_dist>.07)|(depth>.045)]=0
    # Expose rectus muscle bellies beneath the aponeurotic extension included
    # in the source oblique meshes. The footprint is the actual projected
    # rectus triangles, not a manually drawn rectangle or an enlarged mask.
    peeled={}
    for side in ['L','R']:
        rectus=next(r for r in source.regions if r['key']=='rectus_'+side)
        walls=[r['id'] for r in source.regions if r['key'] in ['obliques_'+side,'internal_abdominal_oblique_'+side,'transversus_abdominis_'+side]]
        targets=np.flatnonzero(np.isin(ids,walls));q=skin_points[targets]
        mesh_ids=[i for i,item in enumerate(source.items) if item['name']==f'Rectus abdominis muscle.{side.lower()}']
        tri=source.vertices[source.faces[np.isin(source.mesh,mesh_ids)]];a,b,c=tri[:,0],tri[:,1],tri[:,2]
        den=(b[:,1]-c[:,1])*(a[:,0]-c[:,0])+(c[:,0]-b[:,0])*(a[:,1]-c[:,1]);tri=tri[np.abs(den)>1e-10]
        _,cand=cKDTree(tri[:,:,:2].mean(axis=1)).query(q[:,:2],k=32,workers=1);t=tri[cand];a,b,c=t[:,:,0],t[:,:,1],t[:,:,2]
        den=(b[:,:,1]-c[:,:,1])*(a[:,:,0]-c[:,:,0])+(c[:,:,0]-b[:,:,0])*(a[:,:,1]-c[:,:,1])
        w0=((b[:,:,1]-c[:,:,1])*(q[:,None,0]-c[:,:,0])+(c[:,:,0]-b[:,:,0])*(q[:,None,1]-c[:,:,1]))/den
        w1=((c[:,:,1]-a[:,:,1])*(q[:,None,0]-c[:,:,0])+(a[:,:,0]-c[:,:,0])*(q[:,None,1]-c[:,:,1]))/den;w2=1-w0-w1
        front=np.max(np.where((w0>=0)&(w1>=0)&(w2>=0),w0*a[:,:,2]+w1*b[:,:,2]+w2*c[:,:,2],-np.inf),axis=1)
        expose=np.isfinite(front)&(q[:,2]>=front-.002)&(q[:,2]-front<.045)
        ids[targets[expose]]=rectus['id'];peeled['rectus_'+side]=int(np.sum(expose))
    # Conservative display policy is separate from the complete source inventory.
    # Keep excluded geometry in the envelope as a neutral occluder: removing it
    # from the search would incorrectly expose the next deeper muscle instead.
    policy_path=ROOT/'assets/anatomy/surface-policy.json';policy_bytes=policy_path.read_bytes();policy=json.loads(policy_bytes)
    known_groups={o['group'] for r in source.regions for o in r['sourceObjects']};known_stems={r['key'].rsplit('_',1)[0] for r in source.regions}
    if set(policy['excludedGroups'])-known_groups or set(policy['excludedMuscles'])-known_stems:raise ValueError('unknown source identity in surface eligibility policy')
    excluded=[]
    for r in source.regions:
        stem=r['key'].rsplit('_',1)[0];reasons={policy['excludedGroups'][o['group']] for o in r['sourceObjects'] if o['group'] in policy['excludedGroups']}
        if stem in policy['excludedMuscles']:reasons.add(policy['excludedMuscles'][stem])
        if reasons:
            excluded.append(r['id']);r['surfaceExclusion']=' '.join(sorted(reasons))
    ids[np.isin(ids,excluded)]=0
    report={'method':'skeletal and skin-ring thin-plate-spline correspondence; closest source skin and muscle/bone/connective envelope, 16-candidate triangle queries',
        'rectusSheathPeel':{'method':'Expose the actual front-facing rectus footprint beneath source oblique aponeurosis; no hand-authored outline','surfaceTexels':peeled},
        'surfaceEligibility':{'policy':'assets/anatomy/surface-policy.json','sha256':hashlib.sha256(policy_bytes).hexdigest(),'excludedRegionCount':len(excluded),'scope':policy['scope']},'landmarkCount':len(landmarks),'landmarkResidualMaxM':residual,'skinDistanceP95M':float(np.quantile(skin_dist,.95)),'depthP95M':float(np.quantile(depth,.95)),'landmarks':landmarks,'sourceGeometrySHA256':source.meta['geometrySHA256']}
    return ids,source.regions,report,source.meta
