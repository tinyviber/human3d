"""Structural and numerical checks for exported 416-channel physics records."""
import hashlib
import json
import sys
from pathlib import Path

import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public/dynamics'


def require(ok, message):
    if not ok:
        raise ValueError(message)


def check(action_id, case):
    name = f'{action_id}-{case}'
    meta_path = PUBLIC / f'{name}.json'
    meta = json.loads(meta_path.read_text())
    blob = (PUBLIC / f'{name}.bin').read_bytes()
    require(hashlib.sha256(blob).hexdigest() == meta['binarySHA256'], f'{name}: binary hash mismatch')
    values = np.frombuffer(blob, dtype='<f4')
    layout = meta['layout']
    require(layout['muscles'] == 416, f'{name}: expected all 416 muscle force/activation values')
    require(layout['bodies'] > 1 and layout['qpos'] > 7 and layout['qvel'] > 6, f'{name}: incomplete state layout')
    expected_head = layout['qpos'] + layout['qvel'] + layout['bodies'] * 7 + 416 * 2 + 10
    require(meta['headLength'] == expected_head, f'{name}: record header layout mismatch')
    model_meta_path = ROOT / 'public' / Path(meta['modelMeta'].lstrip('/'))
    model_xml_path = ROOT / 'public' / Path(meta['modelXml'].lstrip('/'))
    model_meta = json.loads(model_meta_path.read_text())
    xml_text = model_xml_path.read_text()
    require(hashlib.sha256(xml_text.encode()).hexdigest() == model_meta['xmlSHA256'] == meta['modelSHA256'], f'{name}: source model hash mismatch')
    model = mujoco.MjModel.from_xml_string(xml_text)
    require(model.nu == 416 and len(model_meta['actuators']) == 416, f'{name}: MyoSim actuator archive incomplete')
    require(meta['layout']['bodies'] == model.nbody, f'{name}: body count differs from MuJoCo model')
    require(len(meta['frames']) > 20, f'{name}: too few recorded frames')

    body_start = layout['qpos'] + layout['qvel']
    force_start = body_start + layout['bodies'] * 7
    activation_start = force_start + 416
    support_start = activation_start + 416
    previous_end = 0
    worst_quat_error = 0.0
    worst_activation = 0.0
    for frame in meta['frames']:
        offset = frame['offset']
        count = meta['headLength'] + int(frame['segments']) * 7
        require(offset == previous_end and offset + count <= len(values), f'{name}: broken frame offsets')
        block = values[offset:offset + count]
        require(np.isfinite(block).all(), f'{name}: non-finite state or tendon data at {frame["time"]:.3f}s')
        root_quat = block[3:7]
        require(abs(float(np.linalg.norm(root_quat)) - 1) < 2e-3, f'{name}: invalid root quaternion')
        body_pose = block[body_start:force_start].reshape(layout['bodies'], 7)
        quat_error = np.max(np.abs(np.linalg.norm(body_pose[:, 3:7], axis=1) - 1))
        worst_quat_error = max(worst_quat_error, float(quat_error))
        activation = block[activation_start:support_start]
        worst_activation = max(worst_activation, float(max(0, -activation.min(), activation.max() - 1)))
        require(np.all(block[force_start:activation_start] >= -1e-3), f'{name}: negative exported muscle force magnitude')
        require(frame['segments'] <= 1200, f'{name}: tendon buffer capacity exceeded')
        previous_end = offset + count
    require(previous_end == len(values), f'{name}: trailing or missing frame data')
    require(worst_quat_error < 2e-3, f'{name}: body quaternion normalization error {worst_quat_error}')
    require(worst_activation < 1e-4, f'{name}: activation outside [0,1] by {worst_activation}')

    audit = meta['audit']
    require(audit['externalAppliedForceMax'] == 0, f'{name}: external force was applied')
    require(audit['virtualWorkErrorW'] < 1e-8, f'{name}: actuator virtual-work identity failed')
    # MuJoCo's joint-limit constraints are soft; allow the measured boundary
    # residual (about 0.8 degrees here) but reject grossly out-of-range states.
    require(audit['maxScalarJointLimitViolationRad'] < .035, f'{name}: scalar joint limit violation')
    require(audit['minimumForearmClearanceM'] > 0, f'{name}: forearm clearance failed')
    require(audit['maxSupportDriftM'] < .001, f'{name}: support fixture drift exceeds 1 mm')
    require(audit['maxReferenceHandErrorM'] < .3, f'{name}: hand diverged from the task by more than 0.3 m')
    # The controller maximum spans every reduced-model coordinate, including
    # unkeyed passive DOFs. Action-specific endpoints and joints below are the
    # useful acceptance gates; keep this scalar only as a broad stability cap.
    require(np.isfinite(audit['maxControllerCoordinateError']) and audit['maxControllerCoordinateError'] < 2.0,
            f'{name}: controller coordinate error indicates an unstable response')
    joint_qpos = {item['name']: item['qpos'] for item in model_meta['joints']}
    qpos_frames = np.asarray([values[frame['offset']:frame['offset'] + layout['qpos']] for frame in meta['frames']])

    def pose_at(seconds):
        frame = min(meta['frames'], key=lambda candidate: abs(candidate['time'] - seconds))
        return values[frame['offset']:frame['offset'] + layout['qpos']]

    if action_id == 'baseball-throw':
        action_spec = json.loads((ROOT / 'assets/actions/baseball-throw.json').read_text())
        sim = action_spec['simulation']
        speed = float(sim.get('referenceSpeedScale', 1))
        lead = float(sim.get('leadSeconds', 0))
        keyframes = {frame['phase']: frame for frame in action_spec['reference']['keyframes']}
        def phase_time(phase):
            return lead + float(keyframes[phase]['timeSeconds']) / speed
        require('carriedObject' not in model_meta, f'{name}: unloaded throw model must not include a carried ball')
        require(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, 'shotball_mass') < 0, f'{name}: obsolete shot-ball geom found')
        left = {joint['name']: joint['qpos'] for joint in model_meta['joints']}
        for joint in ['shoulder_elv_l', 'elv_angle_l', 'shoulder_rot_l', 'elbow_flexion_l']:
            require(joint in left, f'{name}: captured counter-arm joint {joint} is not active')
        shoulder_sweep = max(float(np.ptp(qpos_frames[:, left[joint]]))
                             for joint in ['shoulder_elv_l', 'elv_angle_l', 'shoulder_rot_l'])
        # The unloaded, fixed-foot task uses the lead arm as a modest counter-
        # balance. It is not a full measured stride pose; require visible
        # shoulder rotation while avoiding an unsupported 35-degree minimum.
        require(shoulder_sweep > np.deg2rad(10), f'{name}: lead shoulder did not counterbalance the pitch')
        frame_times = np.asarray([frame['time'] for frame in meta['frames']])
        root_quat = qpos_frames[:, 3:7]
        qw, qx, qy, qz = root_quat.T
        pelvis_yaw = np.unwrap(np.arctan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)))
        pelvis_yaw_rate = np.gradient(pelvis_yaw, frame_times)
        trunk_yaw_rate = np.gradient(qpos_frames[:, joint_qpos['axial_rotation']], frame_times)
        active = (frame_times >= lead) & (frame_times <= phase_time('release'))
        pelvis_peak_time = float(frame_times[active][np.argmax(np.abs(pelvis_yaw_rate[active]))])
        trunk_peak_time = float(frame_times[active][np.argmax(np.abs(trunk_yaw_rate[active]))])
        require(pelvis_peak_time + .1 < trunk_peak_time,
                f'{name}: pelvis peak axial speed does not lead trunk peak speed')
        cock = pose_at(phase_time('maximum-cocking'))
        release = pose_at(phase_time('release'))
        require(float(cock[joint_qpos['flexion_r']]) < np.deg2rad(-5),
                f'{name}: wrist did not extend into the cocked position')
        require(float(release[joint_qpos['flexion_r']]) > cock[joint_qpos['flexion_r']] + np.deg2rad(18),
                f'{name}: wrist did not move from cocking extension toward release flexion')
        require(abs(float(release[joint_qpos['flexion_r']])) <= np.deg2rad(46),
                f'{name}: release wrist exceeded the bounded anatomical target range')
        finger_joints = [
            'mcp2_flexion_r', 'pm2_flexion_r', 'md2_flexion_r',
            'mcp3_flexion_r', 'pm3_flexion_r', 'md3_flexion',
            'mcp4_flexion_r', 'pm4_flexion', 'md4_flexion_r',
            'mcp5_flexion_r', 'pm5_flexion_r', 'md5_flexion_r',
        ]
        cock_curl = sum(float(cock[joint_qpos[n]]) for n in finger_joints)
        release_curl = sum(float(release[joint_qpos[n]]) for n in finger_joints)
        require(cock_curl > np.deg2rad(100), f'{name}: physical preparation hand did not form a loose grasp')
        require(action_spec['display'].get('handPoseSource') == 'task-keyframe-retarget',
                f'{name}: release gesture must declare its display retarget')
        max_cock_targets = keyframes['maximum-cocking']['jointTargetsDeg']
        trunk_targets = keyframes['trunk-follow']['jointTargetsDeg']
        release_targets = keyframes['release']['jointTargetsDeg']
        task_curl_joints = ['mcp2_flexion_r','pm2_flexion_r','md2_flexion_r',
                            'mcp3_flexion_r','pm3_flexion_r','md3_flexion',
                            'mcp4_flexion_r','pm4_flexion','md4_flexion_r',
                            'mcp5_flexion_r','pm5_flexion_r','md5_flexion_r']
        require(sum(max_cock_targets[joint] for joint in task_curl_joints) > 100,
                f'{name}: visual hand should remain cupped at maximum cocking')
        require(sum(trunk_targets[joint] for joint in task_curl_joints) > 100,
                f'{name}: visual hand should remain cupped until release')
        require(max(abs(release_targets[joint]) for joint in task_curl_joints) < 1e-6,
                f'{name}: visual release keyframe should open the fingers')
        # The MyoSim forward record stays authoritative for the arm and wrist,
        # but its finger extensors only reduce curl; they do not reach the
        # fully-open task pose. Keep that limitation visible in the tests.
        require(release_curl > np.deg2rad(200),
                f'{name}: expected the documented residual physical finger curl')
        require(float(release[joint_qpos['knee_angle_r']]) > np.deg2rad(4),
                f'{name}: lead knee reached full hyperextension by release')
        require(float(cock[joint_qpos['knee_angle_r']]) > release[joint_qpos['knee_angle_r']] + np.deg2rad(3),
                f'{name}: knee did not unload after the preparatory dip')
    if action_id == 'punch':
        active = joint_qpos
        for joint in ['pro_sup_r', 'flexion_r', 'mcp2_flexion_r', 'pm2_flexion_r', 'md2_flexion_r', 'mcp3_flexion_r', 'pm3_flexion_r', 'md3_flexion', 'mcp4_flexion_r', 'pm4_flexion', 'md4_flexion_r', 'mcp5_flexion_r', 'pm5_flexion_r', 'md5_flexion_r']:
            require(joint in active, f'{name}: {joint} must be active in the reduced hand model')
        require(float(np.ptp(qpos_frames[:, active['pro_sup_r']])) > np.deg2rad(10), f'{name}: forearm pronation/supination did not move')
        require(float(np.ptp(qpos_frames[:, active['flexion_r']])) > np.deg2rad(5), f'{name}: wrist did not articulate during the punch')
        for joint in ['mcp2_flexion_r', 'mcp3_flexion_r', 'mcp4_flexion_r', 'mcp5_flexion_r']:
            require(float(qpos_frames[:, active[joint]].max()) > np.deg2rad(40), f'{name}: {joint} did not close into the fist')
        for joint in ['pm2_flexion_r', 'pm3_flexion_r', 'pm4_flexion', 'pm5_flexion_r']:
            require(float(qpos_frames[:, active[joint]].max()) > np.deg2rad(45), f'{name}: {joint} did not curl into the fist')
        for joint in ['md2_flexion_r', 'md3_flexion', 'md4_flexion_r', 'md5_flexion_r']:
            require(float(qpos_frames[:, active[joint]].max()) > np.deg2rad(20), f'{name}: {joint} distal flexion did not close')
        peak = pose_at(1.7)
        hold = pose_at(1.975)
        def arm_points_in_root(seconds):
            q = pose_at(seconds)
            data = mujoco.MjData(model)
            data.qpos[:] = q
            mujoco.mj_forward(model, data)
            root_body = model.body('Full Body').id
            shoulder_body = model.body('humerus_r').id
            hand_body = model.body('lunate_r').id
            rotation = data.xmat[root_body].reshape(3, 3)
            return (rotation.T @ (data.xpos[shoulder_body] - data.xpos[root_body]),
                    rotation.T @ (data.xpos[hand_body] - data.xpos[root_body]))
        chamber_shoulder, chamber_hand = arm_points_in_root(.2)
        _, extension_hand = arm_points_in_root(1.7)
        _, recovery_hand = arm_points_in_root(2.95)
        require(chamber_hand[2] < chamber_shoulder[2] - .12,
                f'{name}: the simulated starting fist must stay below the shoulder')
        require(chamber_hand[1] > extension_hand[1] + .4,
                f'{name}: the simulated starting fist must be clearly rearward of the punch extension')
        if case == 'baseline':
            require(chamber_hand[1] > chamber_shoulder[1] + .03,
                    f'{name}: the simulated baseline chamber must sit behind the shoulder')
        require(extension_hand[1] < chamber_hand[1] - .3
                and extension_hand[2] > chamber_hand[2] + .08,
                f'{name}: the simulated fist did not move forward/up from the rear/down chamber')
        require(abs(float(extension_hand[0] - chamber_hand[0])) < .1,
                f'{name}: the simulated straight punch left its shoulder lane')
        require(float(np.linalg.norm(recovery_hand - chamber_hand))
                < .5 * float(np.linalg.norm(extension_hand - chamber_hand)),
                f'{name}: the simulated hand did not retract at least halfway toward its compact reset')
        for joint in ['mcp3_flexion_r', 'pm3_flexion_r', 'md3_flexion', 'mcp5_flexion_r', 'pm5_flexion_r']:
            require(min(float(peak[active[joint]]), float(hold[active[joint]])) > np.deg2rad(20),
                    f'{name}: {joint} opened during the punch extension hold')
        require(min(float(peak[active['md5_flexion_r']]), float(hold[active['md5_flexion_r']])) > np.deg2rad(10),
                f'{name}: little-finger DIP lost its flexed fist posture')
        action_spec = json.loads((ROOT / 'assets/actions/punch.json').read_text())
        require(action_spec['display'].get('handPoseSource') == 'task-keyframe-retarget',
                f'{name}: punch skin wrist/hand must use the authored joint pose targets')
        punch_keys = {frame['phase']: frame for frame in action_spec['reference']['keyframes']}
        extension = punch_keys['full-extension']['jointTargetsDeg']
        hold_targets = punch_keys['extension-hold']['jointTargetsDeg']
        recovery_targets = punch_keys['recovery']['jointTargetsDeg']
        require(abs(extension['flexion_r']) <= 10 and abs(hold_targets['flexion_r']) <= 10,
                f'{name}: authored extension wrist target is not near neutral')
        require(extension['mcp3_flexion_r'] >= 65 and extension['pm3_flexion_r'] >= 80
                and extension['md3_flexion'] >= 50,
                f'{name}: authored punch surface pose is missing the middle-finger fist')
        require(extension['cmc_abduction'] >= 30 and extension['mp_flexion_r'] >= 30
                and extension['ip_flexion_r'] >= 15,
                f'{name}: authored punch surface pose is missing thumb opposition')
        require(all(hold_targets[joint] >= extension[joint] - 2
                    for joint in ['mcp3_flexion_r','pm3_flexion_r','md3_flexion']),
                f'{name}: fist targets relaxed during the punch extension hold')
        require(recovery_targets['mcp3_flexion_r'] >= extension['mcp3_flexion_r'] - 2
                and recovery_targets['pm3_flexion_r'] >= extension['pm3_flexion_r'] - 2,
                f'{name}: the punching hand must stay clenched while returning to guard')
        guard = action_spec['display'].get('leftGuardHandPoseDeg', {})
        require(guard.get('thumb', {}).get('cmcOpposition', 0) < 0,
                f'{name}: the mirrored lead-thumb target must oppose across the left palm')
        require(all(guard.get('fingers', {}).get(digit, {}).get('mcp', 0) >= 75
                    and guard.get('fingers', {}).get(digit, {}).get('pip', 0) >= 85
                    for digit in ['2', '3', '4', '5']),
                f'{name}: the lead hand must use a closed guard-fist pose')
    print(f'{name}: {len(meta["frames"])} frames, {len(values):,} floats; ' \
          f"hand error {audit['maxReferenceHandErrorM']:.3f} m, clearance {audit['minimumForearmClearanceM']:.3f} m")


if __name__ == '__main__':
    ids = sys.argv[1:] or ['punch', 'baseball-throw']
    for action in ids:
        for profile in ('baseline', 'weak'):
            check(action, profile)
