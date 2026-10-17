"""Computed muscle control experiment on the pinned MyoSim full body.
Capture directions are a tracking reference, NOT the simulated qpos output.
Only muscle excitation is applied during integration; no reserve motors,
qfrc_applied, prescribed kinematic bodies, or per-step pose writes are used.
"""
import json,time,sys
from pathlib import Path
import numpy as np
from scipy.optimize import least_squares,lsq_linear
from scipy.spatial.transform import Rotation,RotationSpline
import mujoco

OUT=Path('assets/dynamics');OUT.mkdir(exist_ok=True,parents=True);MOTION_DIR=Path('assets/motions')
captures=json.loads(Path('assets/source/dynamics/capture-reference.json').read_text())['captures']
meta={};m=None;q0=np.array([]);ind=[];jmap={};current_spec={};MODEL_XML='';MODEL_META='';CONTROLLED=np.array([],dtype=int);DT=.002;CONTROL_STEP=2
def configure_action(action_id):
 global meta,m,q0,ind,jmap,current_spec,MODEL_XML,MODEL_META,CONTROLLED,DT,CONTROL_STEP
 path=MOTION_DIR/f'{action_id}.json'
 if not path.exists():raise FileNotFoundError(f'Missing motion envelope: {path}')
 envelope=json.loads(path.read_text())
 if envelope.get('kind')!='dynamics-motion':raise ValueError(f'{path}: not a dynamics-motion envelope')
 current_spec=envelope['dynamics']['action']
 if current_spec.get('id')!=action_id:raise ValueError(f'Action id mismatch in {path}')
 MODEL_XML=current_spec['model']['xml'];MODEL_META=current_spec['model']['metadata']
 meta=json.loads(Path(MODEL_META).read_text());m=mujoco.MjModel.from_xml_path(MODEL_XML)
 if m.nu!=416:raise ValueError(f'{action_id}: expected all 416 MyoSim actuators, got {m.nu}')
 q0=np.array(meta['initialQpos']);ind=meta['independent'];jmap={j['name']:j for j in meta['joints']}
 ranges=current_spec['controller']['controlledActuatorRanges']
 CONTROLLED=np.array([i for a,b in ranges for i in range(a,min(b,m.nu))],dtype=int)
 if len(set(CONTROLLED.tolist()))!=len(CONTROLLED):raise ValueError(f'{action_id}: duplicate actuator ranges')
 DT=float(current_spec['simulation']['stepSeconds']);CONTROL_STEP=max(1,int(round(1/(current_spec['simulation']['controllerHz']*DT))))
 if not np.isclose(DT,m.opt.timestep,atol=1e-9):raise ValueError(f'{action_id}: simulation step must match the model timestep')
def unit(v):return v/max(np.linalg.norm(v),1e-12)
def mjv(v):return np.array([v[0],-v[2],v[1]])
def qadr(n):return jmap[n]['qpos']
def dadr(n):return jmap[n]['dof']
def couple(q):
 for _ in range(2):
  for c in meta['couplings']:q[qadr(c['joint1'])]=np.polynomial.polynomial.polyval(q[qadr(c['joint2'])],np.fromstring(c.get('polycoef','0 1 0 0 0'),sep=' '))
def hermite(times,values,t):
 times=np.asarray(times);values=np.asarray(values)
 if t<=times[0]:return values[0].copy()
 if t>=times[-1]:return values[-1].copy()
 i=int(np.searchsorted(times,t)-1);h=times[i+1]-times[i];u=(t-times[i])/h
 tangent=np.zeros_like(values)
 delta=times[2:]-times[:-2]
 if values.ndim>1:delta=delta.reshape((-1,)+(1,)*(values.ndim-1))
 tangent[1:-1]=(values[2:]-values[:-2])/delta
 tangent[0]=0;tangent[-1]=0
 h00=2*u**3-3*u**2+1;h10=u**3-2*u**2+u;h01=-2*u**3+3*u**2;h11=u**3-u**2
 return h00*values[i]+h10*h*tangent[i]+h01*values[i+1]+h11*h*tangent[i+1]

def task_keyframe_references(id):
 spec=current_spec['reference'];keyframes=spec.get('keyframes',[])
 if len(keyframes)<2:raise ValueError(f'{id}: task-keyframes needs at least two keyframes')
 times=np.array([k['timeSeconds'] for k in keyframes],dtype=float)
 if np.any(np.diff(times)<=0):raise ValueError(f'{id}: keyframe times must increase')
 arm_control=spec.get('armControl','endpoint-keyframes')
 if arm_control not in ('endpoint-keyframes','joint-keyframes'):raise ValueError(f'{id}: unsupported armControl {arm_control}')
 if arm_control=='endpoint-keyframes' and any(len(k.get('elbow',[]))!=3 or len(k.get('hand',[]))!=3 for k in keyframes):raise ValueError(f'{id}: each endpoint keyframe needs elbow and hand targets')
 if arm_control=='joint-keyframes' and any(len(k.get('rightShoulderRotvecRad',[]))!=3 or not np.isfinite(k.get('rightElbowFlexionRad',np.nan)) for k in keyframes):raise ValueError(f'{id}: each joint keyframe needs a shoulder rotation vector and elbow angle')
 left_targets=any('leftElbow'in k or 'leftHand'in k for k in keyframes)
 if left_targets and any(len(k.get('leftElbow',[]))!=3 or len(k.get('leftHand',[]))!=3 for k in keyframes):raise ValueError(f'{id}: every keyframe must define both leftElbow and leftHand targets')
 d=mujoco.MjData(m);scratch=mujoco.MjData(m);ball_adr=qadr('shoulder_ball_r');elbow_adr=qadr('elbow_flexion_r')
 last_rot=Rotation.from_quat(q0[ball_adr:ball_adr+4][[1,2,3,0]]).as_rotvec();last_elbow=q0[elbow_adr]
 left_names=['shoulder_elv_l','elv_angle_l','shoulder_rot_l'];left_elbow_adr=qadr('elbow_flexion_l')
 last_left=np.array([q0[qadr(n)]for n in left_names]);last_left_elbow=q0[left_elbow_adr]
 foot_names=[n+'_'+s for s in ['r','l']for n in ['hip_flexion','hip_adduction','hip_rotation','knee_angle','ankle_angle']]
 anchors_data=mujoco.MjData(m);anchors_data.qpos[:]=q0;mujoco.mj_kinematics(m,anchors_data)
 anchors=[(anchors_data.xpos[m.body('calcn_'+s).id].copy(),anchors_data.xmat[m.body('calcn_'+s).id].reshape(3,3).copy())for s in ['r','l']]
 joints={}
 for name in set().union(*(k.get('jointTargetsDeg',{}).keys()for k in keyframes)):
  if name not in jmap:raise ValueError(f'{id}: unknown joint target {name}')
  if jmap[name]['dofCount']!=1:raise ValueError(f'{id}: jointTargetsDeg supports scalar joints; use pelvisYawDeg for the root')
  baseline=float(q0[qadr(name)])
  joints[name]=np.array([np.deg2rad(k.get('jointTargetsDeg',{}).get(name,np.rad2deg(baseline)))for k in keyframes])
 yaw_values=np.deg2rad([k.get('pelvisYawDeg',0)for k in keyframes])
 elbows=np.asarray([k['elbow']for k in keyframes],dtype=float)if arm_control=='endpoint-keyframes'else None
 hands=np.asarray([k['hand']for k in keyframes],dtype=float)if arm_control=='endpoint-keyframes'else None
 right_rotation_curve=RotationSpline(times,Rotation.from_rotvec([k['rightShoulderRotvecRad']for k in keyframes]))if arm_control=='joint-keyframes'else None
 right_elbow_values=np.asarray([k['rightElbowFlexionRad']for k in keyframes],dtype=float)if arm_control=='joint-keyframes'else None
 left_elbows=np.asarray([k['leftElbow']for k in keyframes],dtype=float)if left_targets else None
 left_hands=np.asarray([k['leftHand']for k in keyframes],dtype=float)if left_targets else None
 pelvis_body=m.body('sacrum').id;upper_body=m.body('humerus_r').id;elbow_body=m.body('ulna_r').id;hand_body=m.body('lunate_r').id
 left_elbow_body=m.body('ulna_l').id;left_hand_body=m.body('lunate_l').id
 clearance_pairs=[(m.geom('radius_coll_r').id,m.geom(n).id)for n in ['thorax_coll1','thorax_coll3','thorax_clearance']]
 left_clearance_pairs=[(m.geom('radius_coll_l').id,m.geom(n).id)for n in ['thorax_coll1','thorax_coll3','thorax_clearance']]
 def project_feet(q,yaw):
  initial=np.r_[q[:3],0.,0.,[q[qadr(n)]for n in foot_names]];prior=initial.copy()
  def residual(x):
   q[:3]=x[:3];rq=Rotation.from_euler('xyz',[x[3],x[4],yaw]).as_quat();q[3:7]=rq[[3,0,1,2]]
   for name,value in zip(foot_names,x[5:]):q[qadr(name)]=value
   d.qpos[:]=q;mujoco.mj_kinematics(m,d);out=[]
   for side,(position,rotation)in zip(['r','l'],anchors):
    bid=m.body('calcn_'+side).id;out.extend((d.xpos[bid]-position)*10);out.extend(Rotation.from_matrix(rotation.T@d.xmat[bid].reshape(3,3)).as_rotvec()*2)
   return np.r_[out,(x-prior)*.02]
  lo=np.r_[q0[:3]-.5,-.15,-.15,[m.jnt_range[m.joint(n).id,0]+.005 for n in foot_names]]
  hi=np.r_[q0[:3]+.5,.15,.15,[m.jnt_range[m.joint(n).id,1]-.005 for n in foot_names]]
  fit=least_squares(residual,np.clip(initial,lo,hi),bounds=(lo,hi),max_nfev=35,ftol=1e-6,xtol=1e-6,gtol=1e-6)
  residual(fit.x)
 def fit_arm(q,elbow_local,hand_local,yaw):
  nonlocal last_rot,last_elbow
  root_rotation=Rotation.from_quat(q[3:7][[1,2,3,0]]).as_matrix();root_position=q[:3]
  target_elbow=root_position+root_rotation@elbow_local;target_hand=root_position+root_rotation@hand_local
  ball_limit=float(m.jnt_range[m.joint('shoulder_ball_r').id,1])
  def residual(x):
   magnitude=np.linalg.norm(x[:3]);rotation=x[:3]if magnitude<=ball_limit else x[:3]*(ball_limit/magnitude)
   q[ball_adr:ball_adr+4]=Rotation.from_rotvec(rotation).as_quat()[[3,0,1,2]];q[elbow_adr]=x[3]
   d.qpos[:]=q;mujoco.mj_kinematics(m,d)
   clearance=[mujoco.mj_geomDistance(m,d,a,b,1.,np.zeros(6))for a,b in clearance_pairs]
   return np.r_[(d.xpos[elbow_body]-target_elbow)*5,(d.xpos[hand_body]-target_hand)*5,.025*(x[:3]-last_rot),.02*(x[3]-last_elbow),max(0,magnitude-ball_limit)*100,np.maximum(0,.005-np.asarray(clearance))*100]
  fit=least_squares(residual,np.r_[last_rot,last_elbow],bounds=(np.r_[np.full(3,-2.8),.02],np.r_[np.full(3,2.8),2.25]),max_nfev=80,ftol=1e-6,xtol=1e-6,gtol=1e-6)
  magnitude=np.linalg.norm(fit.x[:3]);last_rot=fit.x[:3].copy()if magnitude<=ball_limit else fit.x[:3]*(ball_limit/magnitude);last_elbow=float(fit.x[3])
  q[ball_adr:ball_adr+4]=Rotation.from_rotvec(last_rot).as_quat()[[3,0,1,2]];q[elbow_adr]=last_elbow;d.qpos[:]=q;mujoco.mj_kinematics(m,d)
  result=np.r_[(d.xpos[elbow_body]-target_elbow)*5,(d.xpos[hand_body]-target_hand)*5]
  clearance=min(mujoco.mj_geomDistance(m,d,a,b,1.,np.zeros(6))for a,b in clearance_pairs)
  return float(np.linalg.norm(result[:3])/5),float(np.linalg.norm(result[3:6])/5),float(clearance)
 def fit_left_arm(q,elbow_local,hand_local):
  nonlocal last_left,last_left_elbow
  root_rotation=Rotation.from_quat(q[3:7][[1,2,3,0]]).as_matrix();root_position=q[:3]
  target_elbow=root_position+root_rotation@elbow_local;target_hand=root_position+root_rotation@hand_local
  lower=np.array([m.jnt_range[m.joint(n).id,0]+.005 for n in left_names]+[m.jnt_range[m.joint('elbow_flexion_l').id,0]+.005])
  upper=np.array([m.jnt_range[m.joint(n).id,1]-.005 for n in left_names]+[m.jnt_range[m.joint('elbow_flexion_l').id,1]-.005])
  prior=np.r_[last_left,last_left_elbow]
  def residual(x):
   for name,value in zip(left_names,x[:3]):q[qadr(name)]=value
   q[left_elbow_adr]=x[3];couple(q);d.qpos[:]=q;mujoco.mj_kinematics(m,d)
   clearance=[mujoco.mj_geomDistance(m,d,a,b,1.,np.zeros(6))for a,b in left_clearance_pairs]
   return np.r_[(d.xpos[left_elbow_body]-target_elbow)*5,(d.xpos[left_hand_body]-target_hand)*5,.025*(x[:3]-last_left),.02*(x[3]-last_left_elbow),np.maximum(0,.005-np.asarray(clearance))*100]
  fit=least_squares(residual,np.clip(prior,lower,upper),bounds=(lower,upper),max_nfev=80,ftol=1e-6,xtol=1e-6,gtol=1e-6)
  last_left=fit.x[:3].copy();last_left_elbow=float(fit.x[3]);residual(fit.x)
  result=np.r_[(d.xpos[left_elbow_body]-target_elbow)*5,(d.xpos[left_hand_body]-target_hand)*5]
  clearance=min(mujoco.mj_geomDistance(m,d,a,b,1.,np.zeros(6))for a,b in left_clearance_pairs)
  return float(np.linalg.norm(result[:3])/5),float(np.linalg.norm(result[3:6])/5),float(clearance)
 # Shape-preserving phase parameters become smooth, non-cyclic target curves.
 simulation=current_spec['simulation'];lead=float(simulation.get('leadSeconds',0));tail=float(simulation.get('tailSeconds',0));scale=float(simulation.get('referenceSpeedScale',1));rate=float(simulation.get('sampleHz',100))
 motion_duration=times[-1]/scale;references=[];arm_errors=[]
 # Generate only the scaled motion segment here. The lead-in and tail are
 # added below; iterating over total duration as well would duplicate both.
 for local_t in np.arange(0,motion_duration+1e-8,1/rate):
  source_t=min(times[-1],local_t*scale);q=q0.copy()
  for name,values in joints.items():q[qadr(name)]=float(hermite(times,values,source_t))
  yaw=float(hermite(times,yaw_values,source_t));cq,sq=np.cos(yaw/2),np.sin(yaw/2);q[3:7]=[cq,0,0,sq]
  project_feet(q,yaw)
  if arm_control=='joint-keyframes':
   shoulder=right_rotation_curve(source_t).as_quat();q[ball_adr:ball_adr+4]=shoulder[[3,0,1,2]]
   q[elbow_adr]=float(hermite(times,right_elbow_values,source_t));couple(q);d.qpos[:]=q;mujoco.mj_kinematics(m,d)
   clearance=min(mujoco.mj_geomDistance(m,d,a,b,1.,np.zeros(6))for a,b in clearance_pairs)
   right_error=(0.,0.,float(clearance))
  else:
   elbow_target=hermite(times,elbows,source_t);hand_target=hermite(times,hands,source_t)
   right_error=fit_arm(q,elbow_target,hand_target,yaw)
  if left_targets:
   left_error=fit_left_arm(q,hermite(times,left_elbows,source_t),hermite(times,left_hands,source_t))
   arm_errors.append((*right_error,*left_error))
  else:arm_errors.append(right_error)
  references.append(q.copy())
 if not references:raise RuntimeError(f'{id}: no task-keyframe samples generated')
 # Some actions begin already in a task-specific guard/chamber. Their lead-in
 # and recovery tail hold the first keyframe; neutral-start actions retain q0.
 start_pose=simulation.get('startPose','neutral')
 if start_pose not in ('neutral','first-keyframe'):raise ValueError(f'{id}: unsupported simulation.startPose {start_pose}')
 lead_pose=references[0]if start_pose=='first-keyframe'else q0
 count=round(lead*rate);refs=np.vstack([np.repeat(lead_pose[None,:],count,axis=0),np.asarray(references)])
 if tail>0:
  count=round(tail*rate);end=refs[-1].copy();qtail=np.array([end*(1-i/count)+lead_pose*(i/count)for i in range(1,count+1)])
  refs=np.vstack([refs,qtail])
 refs[:,3:7]/=np.linalg.norm(refs[:,3:7],axis=1)[:,None]
 for q in refs: q[ball_adr:ball_adr+4]/=np.linalg.norm(q[ball_adr:ball_adr+4])
 vel=[]
 for i in range(len(refs)):
  v=np.zeros(m.nv);lo=max(0,i-1);hi=min(len(refs)-1,i+1);mujoco.mj_differentiatePos(m,v,(hi-lo)/rate,refs[lo],refs[hi]);vel.append(v)
 vel=np.asarray(vel);acc=np.gradient(vel,1/rate,axis=0)
 source_urls=current_spec['reference']['source'].get('urls',[])
 return {'source':current_spec['reference']['source']['name'],'sourceUrl':source_urls[0] if source_urls else None,
  'sourceStart':0.,'sourceEnd':float(times[-1]),'referenceSpeedRatio':scale,'rate':rate,'duration':(len(refs)-1)/rate,'armControl':arm_control,
  'qref':refs,'vref':vel,'aref':acc,'keyframes':keyframes,'initialQpos':refs[0].copy(),'maxElbowTargetErrorM':max((e[0] for e in arm_errors),default=0.),
  'maxHandTargetErrorM':max((e[1] for e in arm_errors),default=0.),'maxArmTargetErrorM':max((np.linalg.norm(e[:2]) for e in arm_errors),default=0.),'minArmClearanceM':min((min(e[2],e[5]) if len(e)>5 else e[2] for e in arm_errors),default=0.),
  'maxLeftElbowTargetErrorM':max((e[3] for e in arm_errors if len(e)>5),default=0.),'maxLeftHandTargetErrorM':max((e[4] for e in arm_errors if len(e)>5),default=0.),
  'armTargetErrors':np.asarray(arm_errors,dtype=float)}

def scalar_joint_tracks(frames):
 if not frames:return None
 times=np.asarray([float(frame['timeSeconds'])for frame in frames],dtype=float)
 if len(frames)<2 or np.any(np.diff(times)<=0):raise ValueError(f"{current_spec['id']}: scalarJointKeyframes times must strictly increase")
 names=set(frames[0].get('targetsDeg',{}))
 if not names or any(set(frame.get('targetsDeg',{}))!=names for frame in frames):raise ValueError(f"{current_spec['id']}: every scalar joint frame must define the same targetsDeg")
 tracks={}
 for name in names:
  if name not in jmap or jmap[name]['dofCount']!=1:raise ValueError(f"{current_spec['id']}: scalar joint target {name} must be an active scalar joint")
  jid=mujoco.mj_name2id(m,mujoco.mjtObj.mjOBJ_JOINT,name);lo,hi=m.jnt_range[jid]
  values=np.deg2rad([float(frame['targetsDeg'][name])for frame in frames])
  if np.any(values<lo-1e-8)or np.any(values>hi+1e-8):raise ValueError(f"{current_spec['id']}: {name} scalar joint target exceeds the MyoSim limit")
  tracks[name]=values
 return times,tracks

def references(id):
 if current_spec['reference']['kind']=='task-keyframes':return task_keyframe_references(id)
 capture_id=current_spec['reference'].get('captureId',id);cap=captures[capture_id];d=mujoco.MjData(m);qs=[];ball_adr=qadr('shoulder_ball_r');last=Rotation.from_quat(q0[ball_adr:ball_adr+4][[1,2,3,0]]).as_rotvec();left_names=['shoulder_elv_l','elv_angle_l','shoulder_rot_l'];last_left=np.array([q0[qadr(n)]for n in left_names])
 scalar_tracks=scalar_joint_tracks(current_spec['reference'].get('scalarJointKeyframes',[]))
 for idx,sample in enumerate(cap['samples'][::2]):
  p={n:np.array(v)for n,v in sample['points'].items()};q=q0.copy()
  pelvis=unit(p['LeftUpLeg']-p['RightUpLeg']);chest=unit(p['LeftArm']-p['RightArm'])
  # Keep the measured pelvis coil that the previous ±14° clamp erased. The
  # fixed-foot model cannot represent a full pitcher pivot, so bound the
  # in-place retarget to ±32° and keep hip counter-rotation inside its range.
  yaw=np.clip(-np.arctan2(pelvis[2],pelvis[0]),-.55,.55);cy,sy=np.cos(yaw/2),np.sin(yaw/2);q[3:7]=[cy,0,0,sy]
  q[qadr('axial_rotation')]=np.clip((-np.arctan2(chest[2],chest[0])-yaw),-.4,.4)
  # BVH points are Y-up while the MyoSim trunk frame uses the opposite
  # sagittal flexion sign. Keep the torso forward hinge with the source lean;
  # the previous minus sign turned the captured pitching load into a backbend.
  up=unit(p['Neck1']-p['Hips']);q[qadr('flex_extension')]=np.clip(np.arctan2(up[2],up[1]),-.3,.52)
  for side,pre in [('r','Right'),('l','Left')]:
   thigh=unit(p[pre+'Leg']-p[pre+'UpLeg']);shank=unit(p[pre+'Foot']-p[pre+'Leg']);knee=np.clip(np.arccos(np.clip(thigh@shank,-1,1)),.12,.65);hip=np.clip(np.arctan2(thigh[2],-thigh[1]),-.1,.45)
   q[qadr('knee_angle_'+side)]=knee;q[qadr('hip_flexion_'+side)]=hip;q[qadr('ankle_angle_'+side)]=np.clip(knee-hip,-.25,.4);q[qadr('hip_rotation_'+side)]=yaw
  u=mjv(unit(p['RightForeArm']-p['RightArm']));v=mjv(unit(p['RightHand']-p['RightForeArm']));elbow=np.clip(np.arccos(np.clip(u@v,-1,1)),.4,2.22);q[qadr('elbow_flexion_r')]=elbow
  if scalar_tracks:
   pose_times,pose_values=scalar_tracks
   for name,values in pose_values.items():q[qadr(name)]=float(hermite(pose_times,values,float(sample['time'])))
  def residual(x):
   quat=Rotation.from_rotvec(x).as_quat()[[3,0,1,2]];q[ball_adr:ball_adr+4]=quat
   couple(q);d.qpos[:]=q;mujoco.mj_kinematics(m,d)
   du=unit(d.xpos[m.body('ulna_r').id]-d.xpos[m.body('humerus_r').id]);dv=unit(d.xpos[m.body('lunate_r').id]-d.xpos[m.body('ulna_r').id])
   return np.r_[du-u,dv-v,.05*(x-last),max(0,np.linalg.norm(x)-2.7)*5]
  fit=least_squares(residual,last,bounds=(-np.ones(3)*2.8,np.ones(3)*2.8),max_nfev=40,ftol=1e-6,xtol=1e-6,gtol=1e-6)
  last=fit.x.copy();residual(last)
  # Keep the non-throwing arm in the measured counterbalance path. Freezing it
  # in a guard pose made a baseball pitch read as a one-arm sweep and prevented
  # the captured torso/shoulder sequence from closing its kinetic chain.
  ul=mjv(unit(p['LeftForeArm']-p['LeftArm']));vl=mjv(unit(p['LeftHand']-p['LeftForeArm']))
  left_elbow=np.clip(np.arccos(np.clip(ul@vl,-1,1)),.08,2.22);q[qadr('elbow_flexion_l')]=left_elbow
  left_bodies=(m.body('humerus_l').id,m.body('ulna_l').id)
  left_lo=np.array([m.jnt_range[m.joint(n).id,0]+.005 for n in left_names])
  left_hi=np.array([m.jnt_range[m.joint(n).id,1]-.005 for n in left_names])
  def left_residual(x):
   for name,value in zip(left_names,x):q[qadr(name)]=value
   couple(q);d.qpos[:]=q;mujoco.mj_kinematics(m,d)
   lu=unit(d.xpos[left_bodies[1]]-d.xpos[left_bodies[0]])
   # The captured direction crosses an Euler branch near follow-through. Keep
   # the shoulder on the nearby anatomical solution; a weak prior allowed a
   # 200-degree equivalent-angle jump that the muscle model could not track.
   return np.r_[lu-ul,.3*(x-last_left)]
  left_fit=least_squares(left_residual,np.clip(last_left,left_lo,left_hi),bounds=(left_lo,left_hi),max_nfev=35,ftol=1e-6,xtol=1e-6,gtol=1e-6)
  last_left=left_fit.x.copy();left_residual(last_left)
  # Project the captured lower-limb request into the fixed-foot experiment's
  # feasible configuration manifold. Ground anchors must agree with the pose;
  # an infeasible reference makes a muscle controller fight its own supports.
  foot_names=[n+'_'+s for s in ['r','l']for n in ['hip_flexion','hip_adduction','hip_rotation','knee_angle','ankle_angle']]
  initial_leg=np.r_[q[:3],0.,0.,[q[qadr(n)]for n in foot_names]]
  prior=initial_leg.copy();dd=mujoco.MjData(m);dd.qpos[:]=q0;mujoco.mj_kinematics(m,dd)
  anchors=[(dd.xpos[m.body('calcn_'+s).id].copy(),dd.xmat[m.body('calcn_'+s).id].reshape(3,3).copy())for s in ['r','l']]
  def leg_residual(x):
   q[:3]=x[:3];quat=Rotation.from_euler('xyz',[x[3],x[4],yaw]).as_quat();q[3:7]=quat[[3,0,1,2]]
   for n,vv in zip(foot_names,x[5:]):q[qadr(n)]=vv
   couple(q);d.qpos[:]=q;mujoco.mj_kinematics(m,d);out=[]
   for side,(pos,rot)in zip(['r','l'],anchors):
    bid=m.body('calcn_'+side).id;out.extend((d.xpos[bid]-pos)*10);out.extend(Rotation.from_matrix(rot.T@d.xmat[bid].reshape(3,3)).as_rotvec()*2)
   return np.r_[out,(x-prior)*.02]
  lo=np.r_[q0[:3]-.5,-.15,-.15,[m.jnt_range[m.joint(n).id,0]+.005 for n in foot_names]]
  hi=np.r_[q0[:3]+.5,.15,.15,[m.jnt_range[m.joint(n).id,1]-.005 for n in foot_names]]
  fit_leg=least_squares(leg_residual,np.clip(initial_leg,lo,hi),bounds=(lo,hi),max_nfev=30,ftol=1e-6,xtol=1e-6,gtol=1e-6)
  leg_residual(fit_leg.x)
  previous=qs[-1]if qs else q0
  if q[ball_adr:ball_adr+4]@previous[ball_adr:ball_adr+4]<0:q[ball_adr:ball_adr+4]*=-1
  qs.append(q.copy())
 # A low-speed, empty-hand trial, not a professional maximum-speed prediction.
 # Initial/final transitions affect controller requests only, never qpos.
 simulation=current_spec['simulation'];ratio=float(simulation.get('referenceSpeedScale',1));times=np.arange(len(qs))/60*ratio;lead=float(simulation.get('leadSeconds',0));tail=float(simulation.get('tailSeconds',0));duration=lead+times[-1]+tail
 ref=[];rate=float(simulation.get('sampleHz',100))
 for t in np.arange(0,duration+.001,1/rate):
  if t<lead:
   w=np.clip(t/lead,0,1);w=w*w*(3-2*w);q=q0+(qs[0]-q0)*w
  elif t<=lead+times[-1]:
   v=(t-lead)/ratio*60;i=min(len(qs)-2,int(v));w=v-i;q=qs[i]*(1-w)+qs[i+1]*w
  else:
   w=np.clip((t-lead-times[-1])/tail,0,1);w=w*w*(3-2*w);q=qs[-1]*(1-w)+q0*w
  q[3:7]/=np.linalg.norm(q[3:7]);q[ball_adr:ball_adr+4]/=np.linalg.norm(q[ball_adr:ball_adr+4]);couple(q);ref.append(q)
 ref=np.array(ref);vel=[]
 for i in range(len(ref)):
  v=np.zeros(m.nv);lo=max(0,i-1);hi=min(len(ref)-1,i+1);mujoco.mj_differentiatePos(m,v,(hi-lo)/rate,ref[lo],ref[hi]);vel.append(v)
 vel=np.array(vel);acc=np.gradient(vel,1/rate,axis=0)
 return {'source':cap['source'],'sourceStart':cap['start'],'sourceEnd':cap['end'],'sourceUrl':cap['sourceUrl'],'referenceSpeedRatio':ratio,'rate':rate,'duration':(len(ref)-1)/rate,'qref':ref,'vref':vel,'aref':acc}

def predict_activation(u,a,steps=2):
 # MuJoCo mju_muscleDynamics, Millard et al. 2013 time constants;
 # reproduce the engine's two 2ms explicit activation updates.
 a=a.copy()
 for _ in range(steps):
  k=.5+1.5*np.clip(a,0,1)
  tau=np.where(u>a,m.actuator_dynprm[:,0]*k,m.actuator_dynprm[:,1]/k)
  a=np.clip(a+DT*(u-a)/np.maximum(tau,1e-15),0,1)
 return a
def controller(d,scratch,qref,vref,aref,activation):
 err=np.zeros(m.nv);mujoco.mj_differentiatePos(m,err,1,d.qpos,qref)
 controller_spec=current_spec['controller'];desired_acc=np.clip(controller_spec['positionGain']*err+controller_spec['velocityGain']*(vref-d.qvel)+aref,-controller_spec['accelerationLimit'],controller_spec['accelerationLimit'])
 scratch.qpos[:]=d.qpos;scratch.qvel[:]=d.qvel;scratch.act[:]=0;mujoco.mj_forward(m,scratch)
 passive=scratch.actuator_force.copy();zero_acc=scratch.qacc.copy();scratch.act[:]=1;mujoco.mj_fwdActuation(m,scratch);gain=scratch.actuator_force-passive
 moment=np.zeros((m.nu,m.nv));nnz=int(np.sum(d.moment_rownnz));moment[np.repeat(np.arange(m.nu),d.moment_rownnz),d.moment_colind[:nnz]]=d.actuator_moment[:nnz]
 M=np.zeros((m.nv,m.nv));mujoco.mj_fullM(m,M,d.qM)
 Jc=scratch.efc_J.reshape(scratch.nefc,m.nv);mask=(scratch.efc_type==0)|(scratch.efc_state==1);Jc=Jc[mask];D=scratch.efc_D[mask]
 H=M+Jc.T@(D[:,None]*Jc)
 # Track the full inertial state, including compliant dependent coordinates.
 # Endpoint-only control can excite unobserved anatomical coupling modes.
 W=np.linalg.cholesky(M).T
 B=W@np.linalg.solve(H,moment.T[:,CONTROLLED]*gain[CONTROLLED]);target=W@(desired_acc-zero_acc)
 scale=1/np.maximum(np.linalg.norm(B,axis=1),1);B*=scale[:,None];target*=scale
 lower=predict_activation(np.zeros(m.nu),d.act);upper=predict_activation(np.ones(m.nu),d.act)
 allocation=lsq_linear(B,target,bounds=(lower[CONTROLLED],upper[CONTROLLED]),method='bvls',tol=1e-6,max_iter=100)
 a=lower.copy();a[CONTROLLED]=allocation.x
 lo=np.zeros(m.nu);hi=np.ones(m.nu)
 for _ in range(18):
  mid=(lo+hi)/2;pred=predict_activation(mid,d.act);lo=np.where(pred<a,mid,lo);hi=np.where(pred>=a,mid,hi)
 u=(lo+hi)/2;u[np.setdiff1d(np.arange(m.nu),CONTROLLED)]=0
 return u,a,float(np.linalg.norm(B@allocation.x-target)),err

def simulate(id,ref,case='baseline'):
 if case not in ('baseline','weak'):raise ValueError(f'{id}: unknown capacity case {case}')
 perturb=current_spec['controller'].get('capacityPerturbation') or {'actuatorRange':[210,273],'strengthScale':.9}
 start,end=map(int,perturb['actuatorRange']);strength_scale=float(perturb['strengthScale'])if case=='weak'else 1.
 if case=='weak':m.actuator_gainprm[start:end,2]*=strength_scale;m.actuator_biasprm[start:end,2]*=strength_scale
 d=mujoco.MjData(m);scratch=mujoco.MjData(m);q_start=ref.get('initialQpos',q0);d.qpos[:]=q_start;a=np.zeros(m.nu);u=a.copy();ctrls=[];samples=[];start=time.time();peaks={'force':0.,'error':0.,'supportDrift':0.,'residual':0.,'maxSpeed':0.};initial=None
 # Settle under the same muscle controller; fixtures are the only support.
 settle=round(float(current_spec['simulation'].get('settleSeconds',.8))/DT)
 for step in range(settle+round(ref['duration']/DT)+1):
  mujoco.mj_step1(m,d)
  t=max(0,(step-settle)*DT);j=min(len(ref['qref'])-1,round(t*ref['rate']));qr=q_start if step<settle else ref['qref'][j];vr=np.zeros(m.nv)if step<settle else ref['vref'][j];ar=np.zeros(m.nv)if step<settle else ref['aref'][j]
  if step%CONTROL_STEP==0:u,a,residual,err=controller(d,scratch,qr,vr,ar,a)
  if step==settle:
   initial={'qpos':d.qpos.tolist(),'qvel':d.qvel.tolist(),'act':d.act.tolist(),'warmstart':d.qacc_warmstart.tolist()};d.time=0
  u=u.astype(np.float32).astype(float);d.ctrl[:]=u;mujoco.mj_step2(m,d)
  if not np.isfinite(d.qpos).all() or np.max(abs(d.qvel))>200:raise RuntimeError(f'{id} unstable at {t}')
  if step>=settle:
   ctrls.append(u.astype(np.float32).copy())
   if step%10==0:
    mujoco.mj_forward(m,d);force=np.abs(d.actuator_force);speed=np.linalg.norm(d.qvel)
    support=[]
    for s in ['r','l']:
     eid=m.equality('foot_support_'+s).id;rows=np.where((d.efc_type==mujoco.mjtConstraint.mjCNSTR_EQUALITY)&(d.efc_id==eid))[0];support.append(d.efc_force[rows[:3]].tolist());peaks['supportDrift']=max(peaks['supportDrift'],float(np.linalg.norm(d.xpos[m.body('calcn_'+s).id]-d.xpos[m.body('ground_support_'+s).id])))
    peaks['force']=max(peaks['force'],float(force.max()));peaks['error']=max(peaks['error'],float(np.max(abs(err[[dadr(n)for n in ind]]))));peaks['residual']=max(peaks['residual'],residual);peaks['maxSpeed']=max(peaks['maxSpeed'],float(speed))
   samples.append({'time':float(d.time),'qpos':d.qpos.tolist(),'qvel':d.qvel.tolist(),'force':force.tolist(),'act':d.act.tolist(),'support':support,'trackingError':float(np.linalg.norm(err[[dadr(n)for n in ind]])),'allocationResidual':residual,'energy':d.energy.tolist()})
  if step%500==0:print(id,step,'sim',round(t,2),'elapsed',round(time.time()-start,1),flush=True)
 out_dir=OUT/id;out_dir.mkdir(exist_ok=True,parents=True)
control=np.array(ctrls,dtype=np.float32);control.tofile(out_dir/f'{case}-excitation.bin')
 result={'id':id,'case':case,'engine':mujoco.__version__,'modelSHA256':meta['xmlSHA256'],'modelXml':MODEL_XML,'modelMeta':MODEL_META,'source':ref['source'],'sourceUrl':ref['sourceUrl'],'sourceStart':ref['sourceStart'],'sourceEnd':ref['sourceEnd'],'referenceSpeedRatio':ref['referenceSpeedRatio'],'maxArmTargetErrorM':ref.get('maxArmTargetErrorM'),'maxElbowTargetErrorM':ref.get('maxElbowTargetErrorM'),'maxHandTargetErrorM':ref.get('maxHandTargetErrorM'),'minArmClearanceM':ref.get('minArmClearanceM'),'capacityPerturbation':perturb,'capacityScaleApplied':strength_scale,'duration':float(len(control)*DT),'dt':DT,'frames':len(control),'nu':m.nu,'initial':initial,'peaks':peaks,'samples':samples,'method':'Constrained computed-muscle-control tracking; only bounded muscle excitations applied; zero reserve torques; bilateral fixed-foot support; state trajectory is a recorded forward simulation.'}
 (out_dir/f'{case}.json').write_text(json.dumps(result,separators=(',',':')))
 # Keep the desired trajectory separate for reproducible tracking / error audits.
 np.savez_compressed(out_dir/'reference.npz',qref=ref['qref'],vref=ref['vref'],aref=ref['aref'],rate=ref['rate'])
 print(id,'DONE',peaks,'elapsed',time.time()-start,flush=True)
 return result

if __name__=='__main__':
 ids=sys.argv[1:]or sorted(p.stem for p in MOTION_DIR.glob('*.json')if json.loads(p.read_text()).get('kind')=='dynamics-motion')
 for id in ids:
  configure_action(id);ref=references(id);print('reference',id,ref['duration'],'max arm target error',ref.get('maxArmTargetErrorM'),flush=True);simulate(id,ref,'baseline')
  configure_action(id);simulate(id,ref,'weak')
