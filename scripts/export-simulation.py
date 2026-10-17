"""Export measured forward-simulation states for baseline and re-solved capacity cases."""
from pathlib import Path
import json,hashlib,sys
import numpy as np
import mujoco
OUT=Path('public/dynamics');RAW=Path('assets/dynamics');MOTION_DIR=Path('assets/motions')

def dynamics_ids():
 return sorted(p.stem for p in MOTION_DIR.glob('*.json')if json.loads(p.read_text()).get('kind')=='dynamics-motion')

def export(id,case='baseline'):
 if isinstance(case,bool):case='weak'if case else'baseline'
 if case not in ('baseline','weak'):raise ValueError(f'{id}: unknown capacity case {case}')
 run=json.loads((RAW/id/f'{case}.json').read_text());model_meta=run.get('modelMeta','public/dynamics/model.json').removeprefix('/');model_xml=run.get('modelXml','public/dynamics/musculoskeletal.xml').removeprefix('/')
 meta=json.loads(Path(model_meta).read_text());xml=Path(model_xml).read_text();controls=np.fromfile(RAW/id/f'{case}-excitation.bin',dtype='<f4').reshape(-1,run['nu']);m=mujoco.MjModel.from_xml_string(xml);d=mujoco.MjData(m)
 perturb=run.get('capacityPerturbation') or {'actuatorRange':[210,273],'strengthScale':.9}
 start,end=map(int,perturb['actuatorRange']);scale=float(run.get('capacityScaleApplied',1.))
 if scale<1:m.actuator_gainprm[start:end,2]*=scale;m.actuator_biasprm[start:end,2]*=scale
 state=run['initial'];d.qpos[:]=state['qpos'];d.qvel[:]=state['qvel'];d.act[:]=state['act'];d.qacc_warmstart[:]=state['warmstart'];d.ctrl[:]=controls[0];d.time=0
 score=np.mean(np.array([s['force']for s in run['samples']])*np.array([s['act']for s in run['samples']]),axis=0)
 pick=lambda ids,n:sorted(sorted(ids,key=lambda i:score[i],reverse=True)[:n])
 selected=pick(range(210),12)+list(range(210,273))+pick(range(336,376),12)+pick(range(376,416),12)
 offsets=[];blocks=[];zero=np.zeros(m.nv);idByName={b['name']:b['id']for b in meta['bodies']};qByName={j['name']:j['qpos']for j in meta['joints']};offset=0;metrics=[];identity=0.;minimumClearance=1.;maxAngleViolation=0.;referenceHandErrorMax=0.;referenceHandErrorSum=0.;referenceSamples=0
 referenceData=np.load(RAW/id/'reference.npz');qref=referenceData['qref'];referenceRate=float(referenceData['rate']);dref=mujoco.MjData(m)
 supportIds=[m.equality('foot_support_'+s).id for s in ['r','l']]
 def capture():
  nonlocal offset,identity,minimumClearance,maxAngleViolation,referenceHandErrorMax,referenceHandErrorSum,referenceSamples
  mujoco.mj_forward(m,d)
  poses=np.c_[d.xpos,d.xquat].reshape(-1);force=-d.actuator_force.copy();power=d.actuator_force*d.actuator_velocity
  identity=max(identity,abs(float(power.sum()-d.qfrc_actuator@d.qvel)))
  minimumClearance=min(minimumClearance,float(mujoco.mj_geomDistance(m,d,m.geom('radius_coll_r').id,m.geom('thorax_clearance').id,1,np.zeros(6))))
  for j in range(m.njnt):
   if m.jnt_type[j]in[2,3]and m.jnt_limited[j]:
    q=d.qpos[m.jnt_qposadr[j]];maxAngleViolation=max(maxAngleViolation,float(max(0,m.jnt_range[j,0]-q,q-m.jnt_range[j,1])))
  support=[]
  for eid in supportIds:
   rows=np.where((d.efc_type==0)&(d.efc_id==eid))[0];support.extend(d.efc_force[rows[:3]])
  jp=np.zeros((3,m.nv));jr=jp.copy();mujoco.mj_jacBody(m,d,jp,jr,idByName['3proxph_r']);speed=float(np.linalg.norm(jp@d.qvel))
  refIndex=min(int(round(d.time*referenceRate)),len(qref)-1);dref.qpos[:]=qref[refIndex];mujoco.mj_kinematics(m,dref)
  handError=float(np.linalg.norm(d.xpos[idByName['lunate_r']]-dref.xpos[idByName['lunate_r']]));referenceHandErrorMax=max(referenceHandErrorMax,handError);referenceHandErrorSum+=handError;referenceSamples+=1
  powers=[float(power[336:].sum()),float(power[:210].sum()),float(power[210:336].sum())]
  head=np.r_[d.qpos,d.qvel,poses,force,d.act,support,powers,speed]
  path=[];flat=d.wrap_xpos.reshape(-1)
  for i in selected:
   tendon=int(m.actuator_trnid[i,0]);a=int(d.ten_wrapadr[tendon]);n=int(d.ten_wrapnum[tendon]);points=flat[a*3:(a+n)*3].reshape(-1,3)
   for u,v in zip(points[:-1],points[1:]):path.extend([*u,*v,i])
  block=np.r_[head,path].astype('<f4');blocks.append(block);offsets.append({'time':float(d.time),'offset':offset,'segments':len(path)//7});offset+=len(block)
  metrics.append({'time':float(d.time),'speed':speed,'power':powers,'support':list(map(float,support)),'root':d.qpos[:3].tolist(),'hand':d.xpos[idByName['3proxph_r']].tolist(),'handTargetErrorM':handError})
 capture()
 for i,u in enumerate(controls):
  d.ctrl[:]=u;mujoco.mj_step(m,d)
  if (i+1)%5==0 or i==len(controls)-1:capture()
  assert np.isfinite(d.qpos).all()
  assert np.max(abs(d.qfrc_applied))==0 and np.max(abs(d.xfrc_applied))==0
 name=f'{id}/{case}';out_dir=OUT/id;out_dir.mkdir(exist_ok=True,parents=True);binary=np.concatenate(blocks).tobytes();(out_dir/f'{case}.bin').write_bytes(binary)
 layout={'qpos':m.nq,'qvel':m.nv,'bodies':m.nbody,'muscles':m.nu,'support':6,'powers':3,'speed':1};headLength=m.nq+m.nv+m.nbody*7+m.nu*2+10
 data={'id':id,'case':case,'duration':float(d.time),'fps':100,'engine':'MuJoCo '+mujoco.__version__,'source':run['source'],'modelMeta':'/'+model_meta.removeprefix('public/'),'modelXml':'/'+model_xml.removeprefix('public/'),'modelSHA256':meta['xmlSHA256'],'binarySHA256':hashlib.sha256(binary).hexdigest(),'layout':layout,'headLength':headLength,'frames':offsets,'selectedMuscles':selected,'metrics':metrics,'audit':{'externalAppliedForceMax':0,'virtualWorkErrorW':identity,'minimumForearmClearanceM':minimumClearance,'maxScalarJointLimitViolationRad':maxAngleViolation,'maxReferenceHandErrorM':referenceHandErrorMax,'meanReferenceHandErrorM':referenceHandErrorSum/max(1,referenceSamples),'maxControllerCoordinateError':float(run['peaks']['error']),'maxSupportDriftM':float(run['peaks']['supportDrift'])},'method':'Offline forward-simulation record; physical poses are integrated from neural excitation, not prescribed. Rendering interpolates recorded rigid-body states.','parameterScale':scale,'intervention':f"Right-arm active/passive Fmax scaled to {scale:.0%}; muscle control re-solved to the same task target"if case=='weak' else'Unmodified source muscle capacity'}
 (out_dir/f'{case}.json').write_text(json.dumps(data,separators=(',',':')))
 print(name,len(offsets),'frames',round(len(binary)/1e6,2),'MB',data['audit'],flush=True)
 return data
if __name__=='__main__':
 for id in sys.argv[1:]or dynamics_ids():
  export(id,'baseline');export(id,'weak')
