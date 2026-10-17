"""Export the pinned MyoSim model, retaining upstream masses, inertias, muscle
paths, wrapping geometry, activation and force-length-velocity parameters.
Visual meshes alone are removed; their compiled inertias are made explicit.
Experiments use bilateral fixed foot supports and fixed fingers / left guard.
"""
from pathlib import Path
import xml.etree.ElementTree as ET
import json, shutil, hashlib, copy
import numpy as np
import mujoco, myo_sim

OUT=Path('public/dynamics');OUT.mkdir(exist_ok=True,parents=True)
spec=myo_sim.load_spec('myofullbody');original=spec.compile()
xml=ET.fromstring(spec.to_xml())
compiler=xml.find('compiler');compiler.attrib.clear();compiler.set('angle','radian');compiler.set('balanceinertia','true')
for parent in xml.iter():
 for child in list(parent):
  if child.tag in ['asset','sensor','keyframe'] or (child.tag=='geom' and ('mesh' in child.attrib or child.get('type')=='mesh')):parent.remove(child)
 for attr in ['material','mesh','texture']:parent.attrib.pop(attr,None)
# Normalize anonymous sub-defaults emitted by MjSpec.attach(); MJCF only
# permits the outermost default to be unnamed. Preserve inherited attributes.
for parent in list(xml.iter('default')):
 for child in list(parent):
  if child.tag=='default' and not child.get('class'):
   common=[e for e in child if e.tag!='default']
   for named in child.findall('default'):
    for c in common:
     own=named.find(c.tag)
     if own is None:named.insert(0,copy.deepcopy(c))
     else:own.attrib.update({k:v for k,v in c.attrib.items()if k not in own.attrib})
    parent.append(named)
   parent.remove(child)
# Deduplicate identical inherited default classes emitted by MjSpec.attach().
seen=set()
for parent in xml.iter('default'):
 for child in list(parent):
  if child.tag=='default' and child.get('class'):
   name=child.get('class')
   if name in seen:parent.remove(child)
   else:seen.add(name)
for b in xml.iter('body'):
 bid=mujoco.mj_name2id(original,mujoco.mjtObj.mjOBJ_BODY,b.get('name',''))
 for old in list(b.findall('inertial')):b.remove(old)
 if bid>=0 and original.body_mass[bid]>0:
  fmt=lambda v:' '.join(f'{float(x):.12g}'for x in v)
  b.insert(0,ET.Element('inertial',{'pos':fmt(original.body_ipos[bid]),'quat':fmt(original.body_iquat[bid]),'mass':str(original.body_mass[bid]),'diaginertia':fmt(original.body_inertia[bid])}))
option=xml.find('option')
if option is None:option=ET.SubElement(xml,'option')
option.attrib.update({'timestep':'.002','integrator':'implicitfast','solver':'Newton','iterations':'50','tolerance':'1e-9','jacobian':'dense','gravity':'0 0 -9.81'})
option.append(ET.Element('flag',{'energy':'enable'}))
# Preserve a self-contained, dynamically complete MyoSim snapshot before the
# experiment adds collision proxies, reduces joints, or creates foot fixtures.
# Visual mesh assets are removed above, but the source inertias, 123 joints,
# all 416 muscles, 424 tendon routes and 51 source joint equalities remain intact.
full_xml=copy.deepcopy(xml)
ET.indent(full_xml)
full_text=ET.tostring(full_xml,encoding='unicode')
full_path=Path('assets/source/dynamics/myofullbody-complete.xml')
full_path.write_text(full_text)
full_model=mujoco.MjModel.from_xml_string(full_text)
full_actuators=[]
actuator_xml=full_xml.find('actuator')
tendon_xml=full_xml.find('tendon')
for i,act in enumerate(full_model.actuator(i) for i in range(full_model.nu)):
 raw=next((a for a in actuator_xml if a.get('name')==act.name),None)
 tendon_id=int(full_model.actuator_trnid[i,0])
 full_actuators.append({'id':i,'name':act.name,'tendon':full_model.tendon(tendon_id).name if tendon_id>=0 else None,
  'dynamicsType':int(full_model.actuator_dyntype[i]),'gainType':int(full_model.actuator_gaintype[i]),'biasType':int(full_model.actuator_biastype[i]),
  'controlRange':full_model.actuator_ctrlrange[i].tolist(),'forceRange':full_model.actuator_forcerange[i].tolist(),
  'gainParameters':full_model.actuator_gainprm[i].tolist(),'biasParameters':full_model.actuator_biasprm[i].tolist(),
  'activationParameters':full_model.actuator_dynprm[i].tolist(),'activationAddress':int(full_model.actuator_actadr[i]),
  'xml':dict(raw.attrib) if raw is not None else {}})
full_tendons=[]
for i in range(full_model.ntendon):
 t=full_model.tendon(i)
 raw=next((x for x in tendon_xml if x.get('name')==t.name),None)
 full_tendons.append({'id':i,'name':t.name,'limited':bool(full_model.tendon_limited[i]),'lengthRange':full_model.tendon_range[i].tolist(),
  'stiffness':float(full_model.tendon_stiffness[i]),'damping':float(full_model.tendon_damping[i]),
  'springLength':full_model.tendon_lengthspring[i].tolist(),'xml':ET.tostring(raw,encoding='unicode') if raw is not None else ''})
full_bodies=[]
for i in range(full_model.nbody):
 full_bodies.append({'id':i,'name':full_model.body(i).name,'parent':int(full_model.body_parentid[i]),
  'massKg':float(full_model.body_mass[i]),'inertiaDiagonalKgM2':full_model.body_inertia[i].tolist(),
  'inertialPositionM':full_model.body_ipos[i].tolist(),'inertialQuaternionWXYZ':full_model.body_iquat[i].tolist(),
  'jointPositionM':full_model.body_pos[i].tolist(),'jointQuaternionWXYZ':full_model.body_quat[i].tolist()})
full_joints=[]
for i in range(full_model.njnt):
 jid=int(full_model.jnt_bodyid[i])
 dof_count=6 if full_model.jnt_type[i]==mujoco.mjtJoint.mjJNT_FREE else 3 if full_model.jnt_type[i]==mujoco.mjtJoint.mjJNT_BALL else 1
 dof_start=int(full_model.jnt_dofadr[i])
 full_joints.append({'id':i,'name':full_model.joint(i).name,'body':full_model.body(jid).name,
  'type':int(full_model.jnt_type[i]),'qposAddress':int(full_model.jnt_qposadr[i]),'dofAddress':int(full_model.jnt_dofadr[i]),
  'limited':bool(full_model.jnt_limited[i]),'rangeRad':full_model.jnt_range[i].tolist(),
  'axis':full_model.jnt_axis[i].tolist(),'positionM':full_model.jnt_pos[i].tolist(),
  'armature':full_model.dof_armature[dof_start:dof_start+dof_count].tolist(),
  'damping':full_model.dof_damping[dof_start:dof_start+dof_count].tolist(),
  'frictionLoss':full_model.dof_frictionloss[dof_start:dof_start+dof_count].tolist(),
  'stiffness':float(full_model.jnt_stiffness[i])})
full_constraints=[{'kind':e.tag,**dict(e.attrib)} for e in full_xml.find('equality')]
full_manifest={'upstream':'MyoHub/myo_sim','version':myo_sim.__version__,'engine':mujoco.__version__,'license':'Apache-2.0',
 'xmlSHA256':hashlib.sha256(full_text.encode()).hexdigest(),'complete':True,'visualMeshesRemoved':True,
 'nq':int(full_model.nq),'nv':int(full_model.nv),'joints':int(full_model.njnt),'muscleActuators':int(full_model.nu),
 'tendons':int(full_model.ntendon),'equalities':int(full_model.neq),
 'jointCouplingCount':int(np.sum(full_model.eq_type==mujoco.mjtEq.mjEQ_JOINT)),'bodies':int(full_model.nbody),
 'totalMassKg':float(full_model.body_mass.sum()),'bodyInertias':full_bodies,'jointParameters':full_joints,
 'muscleActuatorsData':full_actuators,'tendonPathData':full_tendons,'jointCouplingsAndEqualities':full_constraints,
 'notes':'The complete XML preserves source joint coupling, mass/inertia and the MyoSim muscle/tendon model. The web replay is a separate reduced model.'}
Path('assets/source/dynamics/myofullbody-parameters.json').write_text(json.dumps(full_manifest,indent=2))
assert (full_model.nu,full_model.ntendon,full_model.njnt)==(416,424,123)
assert int(np.sum(full_model.eq_type==mujoco.mjtEq.mjEQ_JOINT))==51
# Preserve the upstream collision pairs and wrapping shapes. Conservative
# ribcage / arm collision proxies add soft-tissue clearance for these trials.
chest=next(b for b in xml.iter('body')if b.get('name')=='torso')
ET.SubElement(chest,'geom',{'name':'thorax_clearance','type':'capsule','fromto':'0 .18 0 0 .34 0','size':'.115','contype':'0','conaffinity':'0','group':'5'})
contact=xml.find('contact')
for side in ['r','l']:
 for name in ['radius_coll_'+side]:ET.SubElement(contact,'pair',{'geom1':name,'geom2':'thorax_clearance','condim':'3','margin':'.005'})
for e in xml.find('equality'):e.set('solref','.005 1')
for j in xml.iter('joint'):
 if j.get('name') and j not in list(xml.find('equality')):j.set('solreflimit','.005 1')
right_hand_joints=['pro_sup_r','deviation_r','flexion_r','cmc_flexion','cmc_abduction','mp_flexion_r','ip_flexion_r']
for finger,pm,dip in [(2,'pm2_flexion_r','md2_flexion_r'),(3,'pm3_flexion_r','md3_flexion'),(4,'pm4_flexion','md4_flexion_r'),(5,'pm5_flexion_r','md5_flexion_r')]:
 right_hand_joints.extend([f'mcp{finger}_flexion_r',f'mcp{finger}_abduction_r',pm,dip])
left_arm_joints=['shoulder_elv_l','elv_angle_l','shoulder_rot_l','elbow_flexion_l']
independent=['flex_extension','lat_bending','axial_rotation','shoulder_ball_r','elbow_flexion_r']+left_arm_joints+[n+'_'+s for s in ['r','l']for n in ['hip_flexion','hip_adduction','hip_rotation','knee_angle','ankle_angle']]+right_hand_joints
# Explicit reduction for a force-driven experiment: retain hip / knee / ankle,
# a three-axis trunk, ball-joint shoulder, elbow, radioulnar / wrist, and all
# right-hand thumb / finger articulation. Other source anatomy keeps its mass.
full_couplings=[dict(e.attrib)for e in xml.find('equality')if e.tag=='joint'and e.get('joint2')]
fixed=original.qpos0.copy()
def set_fixed(n,v):
 jid=mujoco.mj_name2id(original,mujoco.mjtObj.mjOBJ_JOINT,n)
 if jid>=0:fixed[original.jnt_qposadr[jid]]=v
for n,v in [('shoulder_elv_l',.62),('elv_angle_l',.9),('elbow_flexion_l',1.4)]:set_fixed(n,v)
for side in ['r','l']:
 for finger in range(2,6):
  for prefix,value in [('mcp',.3),('pm',.45),('md',.25)]:
   for name in [f'{prefix}{finger}_flexion_{side}',f'{prefix}{finger}_flexion']:
    if side=='r' or name.endswith('_l'):set_fixed(name,value)
for _ in range(3):
 for c in full_couplings:
  v=fixed[original.joint(c['joint2']).qposadr[0]];set_fixed(c['joint1'],np.polynomial.polynomial.polyval(v,np.fromstring(c.get('polycoef','0 1 0 0 0'),sep=' ')))
fd=mujoco.MjData(original);fd.qpos[:]=fixed;mujoco.mj_forward(original,fd)
from scipy.spatial.transform import Rotation
for body in xml.iter('body'):
 bid=mujoco.mj_name2id(original,mujoco.mjtObj.mjOBJ_BODY,body.get('name',''));pid=int(original.body_parentid[bid])
 Rp=fd.xmat[pid].reshape(3,3);Rb=fd.xmat[bid].reshape(3,3);pos=Rp.T@(fd.xpos[bid]-fd.xpos[pid]);quat=Rotation.from_matrix(Rp.T@Rb).as_quat()[[3,0,1,2]]
 body.attrib.pop('euler',None);body.set('pos',' '.join(map(str,pos)));body.set('quat',' '.join(map(str,quat)))
 for joint in list(body.findall('joint')):
  if joint.get('name')not in independent and joint.get('name')!='root':body.remove(joint)
humerus=next(b for b in xml.iter('body')if b.get('name')=='humerus_r')
ET.SubElement(humerus,'joint',{'name':'shoulder_ball_r','type':'ball','limited':'true','range':'0 2.8','damping':'1.05','armature':'.0001','solreflimit':'.005 1'})
xml.find('equality').clear()
base_xml=ET.tostring(xml,encoding='unicode');model=mujoco.MjModel.from_xml_string(base_xml);data=mujoco.MjData(model)
couplings=[]
q0=model.qpos0.copy()
def setq(n,x):
 jid=mujoco.mj_name2id(model,mujoco.mjtObj.mjOBJ_JOINT,n)
 if jid>=0:q0[model.jnt_qposadr[jid]]=x
# A stable guard / shallow knee flexion is the initial condition, not animation.
for s in ['r','l']:
 setq('hip_flexion_'+s,.14);setq('knee_angle_'+s,.28);setq('ankle_angle_'+s,.14);setq('hip_adduction_'+s,-.1)
 setq('elbow_flexion_'+s,1.4);setq('shoulder_elv_'+s,.62);setq('elv_angle_'+s,.9)
 for f in range(2,6):
  for prefix,val in [('mcp',.3),('pm',.45),('md',.25)]:
   name=next((model.joint(i).name for i in range(model.njnt)if model.joint(i).name in [f'{prefix}{f}_flexion_{s}',f'{prefix}{f}_flexion'] and (s=='r' or model.joint(i).name.endswith('_l'))),None)
   if name:setq(name,val)
# Quaternion shoulder initial condition from the upstream guard orientation.
guard=fixed.copy()
for n,v in [('shoulder_elv_r',.62),('elv_angle_r',.9),('elbow_flexion_r',1.4)]:guard[original.joint(n).qposadr[0]]=v
for _ in range(3):
 for c in full_couplings:
  v=guard[original.joint(c['joint2']).qposadr[0]];guard[original.joint(c['joint1']).qposadr[0]]=np.polynomial.polynomial.polyval(v,np.fromstring(c.get('polycoef','0 1 0 0 0'),sep=' '))
gd=mujoco.MjData(original);gd.qpos[:]=guard;mujoco.mj_forward(original,gd)
bid=original.body('humerus_r').id;delta=fd.xmat[bid].reshape(3,3).T@gd.xmat[bid].reshape(3,3);ball=Rotation.from_matrix(delta).as_quat()[[3,0,1,2]]
adr=model.joint('shoulder_ball_r').qposadr[0];q0[adr:adr+4]=ball
for _ in range(3):
 for c in couplings:
  v=q0[model.joint(c['joint2']).qposadr[0]];coef=np.fromstring(c.get('polycoef','0 1 0 0 0'),sep=' ')
  setq(c['joint1'],np.polynomial.polynomial.polyval(v,coef))
data.qpos[:]=q0;mujoco.mj_forward(model,data)
# Shift vertically so upstream foot geoms rest on the existing ground plane.
q0[2]-=.02;data.qpos[:]=q0;mujoco.mj_forward(model,data)
eq=xml.find('equality');dependent={c['joint1']for c in couplings};frozen=[]
for i in range(model.njnt):
 name=model.joint(i).name
 if name=='root'or name in independent or name in dependent or name in ['Abs_t1','Abs_t2']:continue
 value=float(q0[model.jnt_qposadr[i]])
 ET.SubElement(eq,'joint',{'name':'fixture_'+name,'joint1':name,'polycoef':f'{value} 0 0 0 0','solref':'.005 1','solimp':'.9999 .9999 .001'});frozen.append(name)
world=xml.find('worldbody')
for s in ['r','l']:
 foot=model.body('calcn_'+s).id
 b=ET.SubElement(world,'body',{'name':'ground_support_'+s,'pos':' '.join(map(str,data.xpos[foot])),'quat':' '.join(map(str,data.xquat[foot]))})
 ET.SubElement(eq,'weld',{'name':'foot_support_'+s,'body1':'calcn_'+s,'body2':'ground_support_'+s,'relpose':'0 0 0 1 0 0 0','solref':'.005 1','solimp':'.9999 .9999 .001'})
ET.indent(xml);text=ET.tostring(xml,encoding='unicode')
(OUT/'musculoskeletal.xml').write_text(text)
model=mujoco.MjModel.from_xml_string(text);data=mujoco.MjData(model);data.qpos[:]=q0;mujoco.mj_forward(model,data)
manifest={'upstream':'MyoHub/myo_sim','version':myo_sim.__version__,'engine':mujoco.__version__,'license':'Apache-2.0','mass':float(model.body_mass.sum()),'sourceNV':int(original.nv),'reduction':'Active bilateral shoulders and elbows; right radioulnar, wrist, thumb and finger joints; three-axis trunk and bilateral hip/knee/ankle; bilateral feet remain fixture-supported.', 'nq':model.nq,'nv':model.nv,'muscles':model.nu,'initialQpos':q0.tolist(),'independent':independent,'frozenJoints':frozen,'couplings':couplings,'bodies':[{'id':i,'name':model.body(i).name,'parent':int(model.body_parentid[i]),'restPosition':data.xpos[i].tolist(),'restQuaternion':data.xquat[i].tolist(),'mass':float(model.body_mass[i])}for i in range(model.nbody)],'joints':[{'name':model.joint(i).name,'id':i,'qpos':int(model.jnt_qposadr[i]),'dof':int(model.jnt_dofadr[i]),'range':model.jnt_range[i].tolist(),'type':int(model.jnt_type[i]),'dofCount':(6 if model.jnt_type[i]==0 else 3 if model.jnt_type[i]==1 else 1)}for i in range(model.njnt)],'actuators':[{'id':i,'name':model.actuator(i).name,'tendon':int(model.actuator_trnid[i,0]),'fmax':float(model.actuator_gainprm[i,2])}for i in range(model.nu)],'xmlSHA256':hashlib.sha256(text.encode()).hexdigest(),'activationModel':'Upstream first-order muscle activation with force-length-velocity and passive force', 'boundary':'Bilateral fixed-foot support fixture; lumbar subdivisions constrained. Both shoulders and elbows are active; no projectile or impact model.'}
(OUT/'model.json').write_text(json.dumps(manifest,indent=2))
# Package license and provenance with the derivative asset.
license_path=Path(myo_sim.__file__).parents[1]/'myo_sim-0.2.3.dist-info/licenses/LICENSE'
if license_path.exists():shutil.copy(license_path,'assets/source/dynamics/MYO-SIM-LICENSE.txt')
print({k:manifest[k]for k in ['version','engine','mass','nq','nv','muscles']},'frozen',len(frozen),'XML bytes',len(text))
