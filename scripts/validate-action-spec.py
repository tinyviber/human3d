"""Validate parameter-only muscle-action specifications and the full MyoSim archive."""
import hashlib
import json
import math
from pathlib import Path
import re
import mujoco
import numpy as np
from scipy.spatial.transform import Rotation

ROOT = Path(__file__).resolve().parents[1]
MOTION_DIR = ROOT / 'assets/motions'
PUBLIC = ROOT / 'public'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def model_name(model, kind, index):
    obj = getattr(model, kind)(index)
    return obj.name


def validate_archive():
    xml_path = ROOT / 'assets/source/dynamics/myofullbody-complete.xml'
    manifest_path = ROOT / 'assets/source/dynamics/myofullbody-parameters.json'
    manifest = json.loads(manifest_path.read_text())
    xml = xml_path.read_text()
    model = mujoco.MjModel.from_xml_string(xml)
    actual = (model.nq, model.nv, model.njnt, model.nu, model.ntendon,
              int((model.eq_type == mujoco.mjtEq.mjEQ_JOINT).sum()))
    expected = (129, 128, 123, 416, 424, 51)
    require(actual == expected, f'Full MyoSim dimensions {actual} != {expected}')
    require(manifest['complete'] is True, 'Full model manifest must be marked complete')
    require(manifest['xmlSHA256'] == hashlib.sha256(xml.encode()).hexdigest(), 'Full model XML hash mismatch')
    require(len(manifest['muscleActuatorsData']) == 416, 'Expected all 416 muscle actuator parameter sets')
    require(len(manifest['tendonPathData']) == 424, 'Expected all 424 tendon route parameter sets')
    require(len(manifest['jointCouplingsAndEqualities']) == 51, 'Expected all 51 source joint couplings')
    require(len(manifest['bodyInertias']) == 104, 'Expected mass/inertia values for all 104 bodies')
    return model


def validate_action(path):
    envelope = json.loads(path.read_text())
    require(envelope.get('kind') == 'dynamics-motion', f'{path}: not a dynamics-motion envelope')
    records = envelope['dynamics']['records']
    for case, ref in records.items():
        for key in ('meta', 'data'):
            require((PUBLIC / ref[key].lstrip('/')).is_file(), f"{envelope['id']}: records.{case}.{key} target missing: {ref[key]}")
    spec = envelope['dynamics']['action']
    action_id = spec['id']
    require(action_id == envelope['id'], f'{path}: envelope id and action id differ')
    require(path.stem == action_id, f'{path}: file name and action id differ')
    require(spec['schemaVersion'] == 1, f'{action_id}: unsupported schema version')
    require(re.fullmatch(r'[a-z][a-z0-9-]*', action_id), f'{action_id}: invalid action id')
    require(spec.get('title'), f'{action_id}: missing title')
    display = spec.get('display', {})
    for key in ('english', 'description', 'method'):
        require(display.get(key), f'{action_id}: display.{key} is required')
    require(isinstance(display.get('focus'), list), f'{action_id}: display.focus must be a list')
    start_pose = spec['simulation'].get('startPose', 'neutral')
    require(start_pose in ('neutral', 'first-keyframe'), f'{action_id}: unsupported simulation.startPose')
    hand_pose_source = display.get('handPoseSource', 'muscle-state')
    require(hand_pose_source in ('muscle-state', 'task-keyframe-retarget'),
            f'{action_id}: unsupported display.handPoseSource')
    if display.get('durationSeconds') is not None:
        require(float(display['durationSeconds']) > 0, f'{action_id}: display.durationSeconds must be positive')
    for phase in display.get('phases', []):
        require(float(phase['time']) >= 0 and phase.get('label'), f'{action_id}: display phase needs a non-negative time and label')
    xml_path = ROOT / spec['model']['xml']
    meta_path = ROOT / spec['model']['metadata']
    require(xml_path.is_file() and meta_path.is_file(), f'{action_id}: model files are missing')
    model = mujoco.MjModel.from_xml_path(str(xml_path))
    model_meta = json.loads(meta_path.read_text())
    require(model.nu == 416, f'{action_id}: expected 416 actuators, found {model.nu}')
    require(model_meta['muscles'] == 416, f'{action_id}: model metadata muscle count mismatch')
    require(model_meta['nq'] == model.nq and model_meta['nv'] == model.nv, f'{action_id}: model dimensions mismatch')

    sim = spec['simulation']
    dt = float(sim['stepSeconds'])
    require(dt > 0 and math.isclose(dt, model.opt.timestep, abs_tol=1e-9), f'{action_id}: stepSeconds must match the model timestep')
    require(float(sim['sampleHz']) > 0 and float(sim['controllerHz']) > 0, f'{action_id}: sample/controller rate must be positive')
    require(math.isclose(1 / (dt * float(sim['controllerHz'])), round(1 / (dt * float(sim['controllerHz']))), abs_tol=1e-9), f'{action_id}: controllerHz must align to physics steps')
    if 'referenceSpeedScale' in sim:
        require(.1 <= float(sim['referenceSpeedScale']) <= 5, f'{action_id}: referenceSpeedScale outside supported range')

    controlled = []
    for start, end in spec['controller']['controlledActuatorRanges']:
        require(isinstance(start, int) and isinstance(end, int), f'{action_id}: actuator ranges must be integer pairs')
        require(0 <= start < end <= model.nu, f'{action_id}: actuator range [{start}, {end}) outside model')
        controlled.extend(range(start, end))
    require(len(controlled) == len(set(controlled)), f'{action_id}: overlapping actuator ranges')
    perturbation = spec['controller'].get('capacityPerturbation')
    if perturbation:
        start, end = perturbation['actuatorRange']
        require(0 <= start < end <= model.nu, f'{action_id}: capacity perturbation range is outside the actuator model')
        require(all(i in controlled for i in range(start, end)), f'{action_id}: capacity perturbation must target controlled actuators')
        require(0 < float(perturbation['strengthScale']) <= 1, f'{action_id}: capacity strengthScale must be in (0, 1]')

    ref = spec['reference']
    require(ref['kind'] in ('captured-points', 'task-keyframes'), f'{action_id}: unsupported reference kind')
    require(ref.get('coordinateFrame'), f'{action_id}: coordinate frame must be explicit')
    source = ref['source']
    urls = source.get('urls', [source.get('url')])
    require(source.get('name'), f'{action_id}: source name is required')
    require(any(urls) or (ref['kind'] == 'task-keyframes' and source.get('basis') == 'engineering-approximation'),
            f'{action_id}: provide source URLs or explicitly identify an engineering approximation')
    if ref['kind'] == 'captured-points':
        require(ref.get('captureId'), f'{action_id}: captured references need a captureId')
        require(source.get('motionFile') and (ROOT / source['motionFile']).is_file(), f'{action_id}: motion source file is missing')
        start, end = source.get('frameRangeSeconds', [0, 0])
        require(0 <= start < end, f'{action_id}: invalid source frame range')
        scalar_frames = ref.get('scalarJointKeyframes', [])
        if scalar_frames:
            times = [float(frame['timeSeconds']) for frame in scalar_frames]
            require(len(times) >= 2 and times[0] >= 0 and all(b > a for a, b in zip(times, times[1:])), f'{action_id}: scalar joint keyframe times must strictly increase')
            require(times[-1] <= end - start + 1e-6, f'{action_id}: scalar joint keyframes extend beyond the captured segment')
            target_names = set(scalar_frames[0].get('targetsDeg', {}))
            require(target_names and all(set(frame.get('targetsDeg', {})) == target_names for frame in scalar_frames), f'{action_id}: each scalar joint frame must define the same targetsDeg')
            for frame in scalar_frames:
                for name, degrees in frame['targetsDeg'].items():
                    joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
                    require(joint_id >= 0 and model.jnt_type[joint_id] == mujoco.mjtJoint.mjJNT_HINGE, f'{action_id}: scalar target {name} must exist as a hinge joint')
                    require(math.isfinite(float(degrees)), f'{action_id}: {name} target must be finite')
                    if model.jnt_limited[joint_id]:
                        lo, hi = model.jnt_range[joint_id]
                        value = math.radians(float(degrees))
                        require(lo <= value <= hi, f'{action_id}: {name} target {degrees}° exceeds [{math.degrees(lo):.1f}°, {math.degrees(hi):.1f}°]')
    else:
        arm_control = ref.get('armControl', 'endpoint-keyframes')
        require(arm_control in ('endpoint-keyframes', 'joint-keyframes'), f'{action_id}: unsupported armControl')
        keyframes = ref.get('keyframes', [])
        require(len(keyframes) >= 2, f'{action_id}: at least two task keyframes are required')
        times = [float(k['timeSeconds']) for k in keyframes]
        require(times[0] >= 0 and all(b > a for a, b in zip(times, times[1:])), f'{action_id}: keyframe times must strictly increase')
        has_left_targets = any('leftElbow' in frame or 'leftHand' in frame for frame in keyframes)
        for frame in keyframes:
            if arm_control == 'endpoint-keyframes':
                for name in ('elbow', 'hand'):
                    point = frame.get(name, [])
                    require(len(point) == 3 and all(math.isfinite(float(v)) for v in point), f"{action_id}: {frame['phase']} {name} target must be a finite XYZ triple")
            else:
                vector = frame.get('rightShoulderRotvecRad', [])
                elbow_angle = float(frame.get('rightElbowFlexionRad', math.nan))
                require(len(vector) == 3 and all(math.isfinite(float(v)) for v in vector), f"{action_id}: {frame['phase']} needs a finite shoulder rotation vector")
                require(math.isfinite(elbow_angle), f"{action_id}: {frame['phase']} needs a finite elbow target")
                shoulder_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, 'shoulder_ball_r')
                elbow_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, 'elbow_flexion_r')
                require(np.linalg.norm(vector) <= model.jnt_range[shoulder_id, 1] + 1e-6,
                        f"{action_id}: {frame['phase']} shoulder rotvec exceeds the ball-joint cone")
                lo, hi = model.jnt_range[elbow_id]
                require(lo <= elbow_angle <= hi, f"{action_id}: {frame['phase']} elbow target exceeds [{lo:.3f}, {hi:.3f}] radians")
            if has_left_targets:
                for name in ('leftElbow', 'leftHand'):
                    point = frame.get(name, [])
                    require(len(point) == 3 and all(math.isfinite(float(v)) for v in point), f"{action_id}: {frame['phase']} {name} target must be a finite XYZ triple")
            for name, degrees in frame.get('jointTargetsDeg', {}).items():
                joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
                require(joint_id >= 0 and model.jnt_type[joint_id] == mujoco.mjtJoint.mjJNT_HINGE, f'{action_id}: target joint {name} must exist and be scalar')
                if model.jnt_limited[joint_id]:
                    lo, hi = model.jnt_range[joint_id]
                    value = math.radians(float(degrees))
                    require(lo <= value <= hi, f'{action_id}: {name} target {degrees}° exceeds [{math.degrees(lo):.1f}°, {math.degrees(hi):.1f}°]')
    if hand_pose_source == 'task-keyframe-retarget':
        require(ref['kind'] == 'task-keyframes', f'{action_id}: hand retarget needs task keyframes')
        hand_joints = ['flexion_r','cmc_flexion','cmc_abduction','mp_flexion_r','ip_flexion_r',
                       'mcp2_flexion_r','pm2_flexion_r','md2_flexion_r','mcp3_flexion_r','pm3_flexion_r','md3_flexion',
                       'mcp4_flexion_r','pm4_flexion','md4_flexion_r','mcp5_flexion_r','pm5_flexion_r','md5_flexion_r']
        for frame in ref.get('keyframes', []):
            targets = frame.get('jointTargetsDeg', {})
            require(all(name in targets for name in hand_joints),
                    f"{action_id}: {frame['phase']} needs all finger targets for a continuous hand retarget")
    guard_pose = display.get('leftGuardHandPoseDeg')
    if guard_pose:
        require(set(guard_pose.get('thumb', {})) == {'cmcFlexion', 'cmcOpposition', 'mcp', 'ip'},
                f'{action_id}: left guard thumb needs CMC, MCP and IP targets')
        require(set(guard_pose.get('fingers', {})) == {'2', '3', '4', '5'},
                f'{action_id}: left guard pose must define all four fingers')
        values = list(guard_pose['thumb'].values())
        values += [angle for finger in guard_pose['fingers'].values() for angle in finger.values()]
        require(all(math.isfinite(float(v)) for v in values), f'{action_id}: left guard pose angles must be finite')
    if action_id == 'punch':
        punch_keys = {frame['phase']: frame for frame in ref.get('keyframes', [])}
        chamber = punch_keys['neutral']
        extension = punch_keys['full-extension']
        require(ref.get('armControl') == 'joint-keyframes', 'punch: the right arm should use bounded joint-space keyframes')
        require(chamber['rightElbowFlexionRad'] > extension['rightElbowFlexionRad'] + 1.0,
                'punch: the right arm should begin flexed in the rear/down chamber')
        require(display.get('leftGuardHandPoseDeg'),
                'punch: the lead hand needs a closed skin-rig guard fist')

        def root_relative_pose(frame):
            data = mujoco.MjData(model)
            q = np.array(model_meta['initialQpos'], dtype=float)
            for name, degrees in frame.get('jointTargetsDeg', {}).items():
                jid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
                q[model.jnt_qposadr[jid]] = math.radians(float(degrees))
            yaw = math.radians(float(frame.get('pelvisYawDeg', 0)))
            q[3:7] = [math.cos(yaw/2), 0, 0, math.sin(yaw/2)]
            rotvec = frame['rightShoulderRotvecRad']
            quaternion = Rotation.from_rotvec(rotvec).as_quat()
            shoulder = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, 'shoulder_ball_r')
            elbow = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, 'elbow_flexion_r')
            q[model.jnt_qposadr[shoulder]:model.jnt_qposadr[shoulder]+4] = quaternion[[3, 0, 1, 2]]
            q[model.jnt_qposadr[elbow]] = frame['rightElbowFlexionRad']
            data.qpos[:] = q
            mujoco.mj_forward(model, data)
            root = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, 'Full Body')
            root_position = data.xpos[root]
            root_rotation = data.xmat[root].reshape(3, 3)
            shoulder = data.xpos[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, 'humerus_r')]
            hand = data.xpos[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, 'lunate_r')]
            elbow_pos = data.xpos[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, 'ulna_r')]
            arm_geom = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, 'radius_coll_r')
            clearances = [mujoco.mj_geomDistance(model, data, arm_geom,
                          mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, name), 1., np.zeros(6))
                          for name in ('thorax_coll1', 'thorax_coll3', 'thorax_clearance')]
            return (root_rotation.T @ (shoulder-root_position),
                    root_rotation.T @ (elbow_pos-root_position),
                    root_rotation.T @ (hand-root_position), min(clearances))

        chamber_shoulder, chamber_elbow, chamber_hand, chamber_clearance = root_relative_pose(chamber)
        extension_shoulder, extension_elbow, extension_hand, extension_clearance = root_relative_pose(extension)
        forearm_length = float(np.linalg.norm(extension_hand-extension_elbow))
        require(chamber_hand[1] > chamber_shoulder[1] + 0.04
                and chamber_hand[2] < chamber_shoulder[2] - 0.15,
                'punch: the starting fist must sit behind and below its shoulder')
        require(extension_hand[1] < chamber_hand[1] - 0.35 and extension_hand[2] > chamber_hand[2] + 0.1,
                'punch: the rear/down chamber must travel clearly forward and upward into extension')
        require(abs(float(extension_hand[0]-chamber_hand[0])) < 0.08,
                'punch: the straight fist path must stay close to its starting shoulder lane')
        require(0.22 <= forearm_length <= 0.28,
                f'punch: extension forearm length is not anatomically reachable ({forearm_length:.3f} m)')
        require(min(chamber_clearance, extension_clearance) > 0.03,
                'punch: the arm collision proxy must clear the thorax in chamber and extension')
    obj = spec['model'].get('carriedObject')
    if obj:
        body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, obj['body'])
        require(body_id >= 0, f'{action_id}: carried object body is missing')
        require(model_meta.get('carriedObject', {}).get('body') == obj['body'], f'{action_id}: carried-object body metadata mismatch')
        require(math.isclose(float(model_meta['mass'] - json.loads((ROOT / 'public/dynamics/model.json').read_text())['mass']), float(obj['massKg']), rel_tol=0, abs_tol=.01), f'{action_id}: carried-object mass is not included in the model total')
    return action_id, len(controlled), len(ref.get('keyframes', []))


if __name__ == '__main__':
    validate_archive()
    results = [validate_action(path) for path in sorted(MOTION_DIR.glob('*.json'))
               if not path.name.endswith('.schema.json')
               and json.loads(path.read_text()).get('kind') == 'dynamics-motion']
    for action_id, count, keyframes in results:
        print(f'{action_id}: valid; {count}/416 controlled actuators; {keyframes} task keyframes')
    print('MyoSim archive: 416 actuators, 424 tendon routes, 51 source joint couplings, 104 body inertias')
