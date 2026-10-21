#!/usr/bin/env python3
"""Compare MediaPipe and RTMPose observations on a shared 16-joint limb/foot subset.

These are observation diagnostics: detection coverage, frame-to-frame jitter,
cross-method agreement, hip-centre path in the image, MediaPipe bone-length CV,
and a heel-contact proxy. None of them measures accuracy against ground truth,
and none of them validates world-space root motion.
"""
import argparse
import sys

import numpy as np

from common import read_json, write_json

# name, MediaPipe index, Halpe-26 index
COMMON = [
    ("l_shoulder", 11, 5), ("r_shoulder", 12, 6),
    ("l_elbow", 13, 7), ("r_elbow", 14, 8),
    ("l_wrist", 15, 9), ("r_wrist", 16, 10),
    ("l_hip", 23, 11), ("r_hip", 24, 12),
    ("l_knee", 25, 13), ("r_knee", 26, 14),
    ("l_ankle", 27, 15), ("r_ankle", 28, 16),
    ("l_heel", 29, 24), ("r_heel", 30, 25),
    ("l_toe", 31, 20), ("r_toe", 32, 21),
]
MP_IDX = [c[1] for c in COMMON]
RT_IDX = [c[2] for c in COMMON]
LIMB = list(range(12))            # shoulders .. ankles
L_SH, R_SH, L_HIP, R_HIP = 0, 1, 6, 7
HEEL = [12, 13]
SEGMENTS = [("upper_arm_l", 11, 13), ("forearm_l", 13, 15), ("thigh_l", 23, 25),
            ("shin_l", 25, 27), ("torso_side_l", 11, 23)]   # MediaPipe world indices
AGREE_DISAGREE = 0.10             # torso lengths
OUTLIER = 0.25                    # torso lengths
HEEL_BAND = 0.03                  # fraction of image height above the lowest heel


def image_arrays(obs, idx):
    frames = obs["frames"]
    n = len(frames)
    thr = float(obs["method"]["min_confidence"])
    P = np.full((n, len(idx), 2), np.nan)
    C = np.zeros((n, len(idx)))
    det = np.zeros(n, dtype=bool)
    for t, f in enumerate(frames):
        if f["detected"]:
            det[t] = True
            rows = np.asarray(f["image"], float)
            P[t] = rows[idx, :2]
            C[t] = rows[idx, 2]
    ok = det[:, None] & (C >= thr)
    P = np.where(ok[:, :, None], P, np.nan)
    return P, ok, det


def world_arrays(obs):
    frames = obs["frames"]
    n = len(frames)
    W = np.full((n, 33, 3), np.nan)
    V = np.zeros((n, 33))
    for t, f in enumerate(frames):
        if f["detected"] and f.get("world"):
            rows = np.asarray(f["world"], float)
            W[t] = rows[:, :3]
            V[t] = rows[:, 3]
    return W, V


def stat(values, q=None):
    v = np.asarray(values, float)
    v = v[~np.isnan(v)]
    if v.size == 0:
        return None
    return float(np.median(v)) if q is None else float(np.percentile(v, q))


def torso_len(P, ok):
    valid = ok[:, L_SH] & ok[:, R_SH] & ok[:, L_HIP] & ok[:, R_HIP]
    mid_sh = (P[:, L_SH] + P[:, R_SH]) / 2
    mid_hip = (P[:, L_HIP] + P[:, R_HIP]) / 2
    return np.where(valid, np.linalg.norm(mid_sh - mid_hip, axis=1), np.nan)


def jitter(P, ok, S, t_idx):
    n = P.shape[0]
    t = t_idx[(t_idx >= 1) & (t_idx <= n - 2)]
    if t.size == 0:
        return None, None
    acc = np.linalg.norm(P[t + 1] - 2 * P[t] + P[t - 1], axis=2) / S
    valid = ok[t + 1] & ok[t] & ok[t - 1]
    vals = acc[valid]
    return stat(vals, None), stat(vals, 95)


def hip_path(P, ok, S, t_idx):
    centre = (P[:, L_HIP] + P[:, R_HIP]) / 2
    valid = ok[:, L_HIP] & ok[:, R_HIP]
    idx = np.array([t for t in t_idx if valid[t]], dtype=int)
    if idx.size < 2:
        return None, None
    c = centre[idx]
    steps = np.linalg.norm(np.diff(c, axis=0), axis=1)
    consecutive = np.diff(idx) == 1
    return float(steps[consecutive].sum() / S), float(np.linalg.norm(c[-1] - c[0]) / S)


def bone_cv(W, V, thr, t_idx):
    per = {}
    Wt, Vt = W[t_idx], V[t_idx]
    for name, a, b in SEGMENTS:
        valid = (Vt[:, a] >= thr) & (Vt[:, b] >= thr)
        L = np.linalg.norm(Wt[valid, a] - Wt[valid, b], axis=1)
        if L.size >= 3:
            per[name] = float(L.std() / L.mean())
    return (float(np.median(list(per.values()))) if per else None), per


def contact_labels(P, ok, H):
    labels = np.zeros((P.shape[0], 2), dtype=bool)
    valid = ok[:, HEEL]
    for k, j in enumerate(HEEL):
        y = P[:, j, 1]
        if np.all(np.isnan(y)):
            continue
        labels[:, k] = (y >= np.nanmax(y) - HEEL_BAND * H) & valid[:, k]
    return labels, valid


def heel_slip(P, labels, S, t_idx):
    vals = []
    for k, j in enumerate(HEEL):
        for t in t_idx:
            if t >= 1 and labels[t, k] and labels[t - 1, k]:
                vals.append(np.linalg.norm(P[t, j] - P[t - 1, j]) / S)
    return stat(vals)


def ranges(indices):
    out = []
    for t in sorted(int(x) for x in indices):
        if out and t == out[-1][1] + 1:
            out[-1][1] = t
        else:
            out.append([t, t])
    return out


def outside_frame(obs, idx, sel, t_idx, width, height):
    """Share of detected frames in t_idx where a selected joint lies outside the image (confidence ignored)."""
    hits = total = 0
    cols = [idx[j] for j in sel]
    for t in t_idx:
        f = obs["frames"][int(t)]
        if not f["detected"]:
            continue
        total += 1
        xy = np.asarray(f["image"], float)[cols, :2]
        if np.any((xy[:, 0] < 0) | (xy[:, 0] >= width) | (xy[:, 1] < 0) | (xy[:, 1] >= height)):
            hits += 1
    return hits / total if total else None


def raw_conf(obs, idx):
    """Per-frame visibility (MediaPipe) or score (RTMPose) of the shared joints; NaN where no detection."""
    out = np.full((len(obs["frames"]), len(idx)), np.nan)
    for t, f in enumerate(obs["frames"]):
        if f["detected"]:
            out[t] = np.asarray(f["image"], float)[idx, 2]
    return out


def outside_per_joint(obs, idx, t_idx, width, height):
    """Per limb joint: share of detected frames in t_idx where that joint is outside the image (confidence ignored)."""
    cols = [idx[j] for j in LIMB]
    rows = [np.asarray(obs["frames"][int(t)]["image"], float)[cols, :2]
            for t in t_idx if obs["frames"][int(t)]["detected"]]
    if not rows:
        return {}
    xy = np.stack(rows)
    out = ((xy[..., 0] < 0) | (xy[..., 0] >= width) | (xy[..., 1] < 0) | (xy[..., 1] >= height)).mean(axis=0)
    return {COMMON[j][0]: _r(float(out[k])) for k, j in enumerate(LIMB)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mediapipe_json")
    ap.add_argument("rtmpose_json")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    mp_obs, rt_obs = read_json(args.mediapipe_json), read_json(args.rtmpose_json)
    if mp_obs["source"]["sha256"] != rt_obs["source"]["sha256"]:
        sys.exit("observations come from different videos")
    n = len(mp_obs["frames"])
    if n != len(rt_obs["frames"]):
        sys.exit("frame counts differ")
    H = mp_obs["source"]["height"]
    Wpx = mp_obs["source"]["width"]
    thr_mp = float(mp_obs["method"]["min_confidence"])
    thr_rt = float(rt_obs["method"]["min_confidence"])

    Pm, okm, detm = image_arrays(mp_obs, MP_IDX)
    Pr, okr, detr = image_arrays(rt_obs, RT_IDX)
    W, V = world_arrays(mp_obs)

    Tm, Tr = torso_len(Pm, okm), torso_len(Pr, okr)
    both = ~np.isnan(Tm) & ~np.isnan(Tr)
    S = float(np.median(((Tm + Tr) / 2)[both]))           # shared scale, px

    lab_m, val_m = contact_labels(Pm, okm, H)
    lab_r, val_r = contact_labels(Pr, okr, H)

    edges = [0, n // 3, 2 * n // 3, n]
    windows = {"all": np.arange(n), "w1": np.arange(edges[0], edges[1]),
               "w2": np.arange(edges[1], edges[2]), "w3": np.arange(edges[2], edges[3])}

    # per-frame disagreement over the shared limb joints
    d_all = np.linalg.norm(Pm - Pr, axis=2) / S
    d_limb = d_all[:, LIMB]
    d_limb_valid = okm[:, LIMB] & okr[:, LIMB]
    d_limb = np.where(d_limb_valid, d_limb, np.nan)
    with np.errstate(all="ignore"):
        frame_max_d = np.nanmax(np.where(np.isnan(d_limb), -1, d_limb), axis=1)
    outlier_frames = np.where(frame_max_d > OUTLIER)[0]

    result = {"source": mp_obs["source"], "scale_torso_px": round(S, 2), "frames": n,
              "thresholds": {"mediapipe": thr_mp, "rtmpose": thr_rt},
              "window_bounds": {"w1": [edges[0], edges[1] - 1], "w2": [edges[1], edges[2] - 1],
                                "w3": [edges[2], edges[3] - 1]},
              "windows": {}}

    for name, t_idx in windows.items():
        d_sub = d_all[t_idx][okm[t_idx] & okr[t_idx]]
        j_m, j95_m = jitter(Pm, okm, S, t_idx)
        j_r, j95_r = jitter(Pr, okr, S, t_idx)
        path_m, net_m = hip_path(Pm, okm, S, t_idx)
        path_r, net_r = hip_path(Pr, okr, S, t_idx)
        cv_med, cv_seg = bone_cv(W, V, thr_mp, t_idx)
        both_valid = val_m[t_idx] & val_r[t_idx]
        agree_contact = float((lab_m[t_idx] == lab_r[t_idx])[both_valid].mean()) if both_valid.any() else None
        result["windows"][name] = {
            "frames": int(t_idx.size),
            "detect_rate": {"mediapipe": round(float(detm[t_idx].mean()), 3),
                            "rtmpose": round(float(detr[t_idx].mean()), 3)},
            "limb_ok_rate": {"mediapipe": round(float(okm[t_idx][:, LIMB].all(axis=1).mean()), 3),
                             "rtmpose": round(float(okr[t_idx][:, LIMB].all(axis=1).mean()), 3)},
            "outside_frame_rate": {"mediapipe": _r(outside_frame(mp_obs, MP_IDX, LIMB, t_idx, Wpx, H)),
                                   "rtmpose": _r(outside_frame(rt_obs, RT_IDX, LIMB, t_idx, Wpx, H))},
            "outside_frame_per_joint": {"mediapipe": outside_per_joint(mp_obs, MP_IDX, t_idx, Wpx, H),
                                        "rtmpose": outside_per_joint(rt_obs, RT_IDX, t_idx, Wpx, H)},
            "jitter_torso": {"mediapipe": {"median": _r(j_m), "p95": _r(j95_m)},
                             "rtmpose": {"median": _r(j_r), "p95": _r(j95_r)}},
            "agreement_torso": {"median": _r(stat(d_sub)), "p90": _r(stat(d_sub, 90)),
                                "frac_over_0_10": _r(float((d_sub > AGREE_DISAGREE).mean()) if d_sub.size else None)},
            "hip_centre_path_torso": {"mediapipe": _r(path_m), "rtmpose": _r(path_r)},
            "hip_centre_net_torso": {"mediapipe": _r(net_m), "rtmpose": _r(net_r)},
            "bone_cv_world_mediapipe": {"median": _r(cv_med), "per_segment": {k: _r(v) for k, v in cv_seg.items()}},
            "heel_contact": {
                "contact_frac": {"mediapipe": _r(float(lab_m[t_idx][val_m[t_idx]].mean()) if val_m[t_idx].any() else None),
                                 "rtmpose": _r(float(lab_r[t_idx][val_r[t_idx]].mean()) if val_r[t_idx].any() else None)},
                "agreement": _r(agree_contact),
                "slip_torso": {"mediapipe": _r(heel_slip(Pm, lab_m, S, t_idx) / S if heel_slip(Pm, lab_m, S, t_idx) is not None else None),
                               "rtmpose": _r(heel_slip(Pr, lab_r, S, t_idx) / S if heel_slip(Pr, lab_r, S, t_idx) is not None else None)},
            },
        }

    all_idx = np.arange(n)
    result["failure_frames"] = {
        "mediapipe_no_pose": ranges(np.where(~detm)[0]),
        "rtmpose_no_person": ranges(np.where(~detr)[0]),
        "mediapipe_limb_below_threshold": ranges(np.where(detm & ~okm[:, LIMB].all(axis=1))[0]),
        "rtmpose_limb_below_threshold": ranges(np.where(detr & ~okr[:, LIMB].all(axis=1))[0]),
        "methods_disagree_over_0_25_torso": ranges(outlier_frames),
        "counts": {
            "mediapipe_no_pose": int((~detm).sum()), "rtmpose_no_person": int((~detr).sum()),
            "mediapipe_limb_below_threshold": int((detm & ~okm[:, LIMB].all(axis=1)).sum()),
            "rtmpose_limb_below_threshold": int((detr & ~okr[:, LIMB].all(axis=1)).sum()),
            "methods_disagree_over_0_25_torso": int(outlier_frames.size),
        },
    }
    cmc, crc = raw_conf(mp_obs, MP_IDX), raw_conf(rt_obs, RT_IDX)
    result["per_joint"] = {}
    for j in LIMB:
        name = COMMON[j][0]
        vm = cmc[:, j][~np.isnan(cmc[:, j])]
        vr = crc[:, j][~np.isnan(crc[:, j])]
        dj = d_all[:, j][~np.isnan(d_all[:, j])]
        ok_j = okm[:, j] & okr[:, j]
        off = [_r(v) for v in np.median((Pm - Pr)[ok_j, j], axis=0) / S] if ok_j.any() else [None, None]
        result["per_joint"][name] = {
            "mediapipe_visibility_below_thr": _r(float((vm < thr_mp).mean()) if vm.size else None),
            "mediapipe_visibility_median": _r(float(np.median(vm)) if vm.size else None),
            "rtmpose_score_below_thr": _r(float((vr < thr_rt).mean()) if vr.size else None),
            "rtmpose_score_median": _r(float(np.median(vr)) if vr.size else None),
            "disagreement_median_torso": _r(float(np.median(dj)) if dj.size else None),
            "disagreement_p90_torso": _r(float(np.percentile(dj, 90)) if dj.size else None),
            "offset_median_mp_minus_rt_xy_torso": off,
        }
    result["definitions"] = {
        "per_joint": "all frames with a detection; disagreement is MediaPipe vs RTMPose image distance in torso units over frames where both are ok; offset is the signed median (MediaPipe minus RTMPose) in torso units, a nonzero value suggests a definitional difference rather than noise",
        "torso_scale": "per frame, the mean of the two methods' shoulder-midpoint to hip-midpoint distance (where both are defined); the scale is the median over those frames",
        "jitter": "norm of second difference of joint image position / torso_scale, over frame triples with all three ok",
        "agreement": "norm of MediaPipe minus RTMPose image position / torso_scale, over shared joints ok in both",
        "hip_centre_path": "sum of consecutive hip-centre image steps / torso_scale; not camera-compensated",
        "bone_cv_world_mediapipe": "std/mean of segment length in MediaPipe world metres for left upper arm, left forearm, left thigh, left shin and left side torso, median over the five segments",
        "heel_contact": "heel within HEEL_BAND x image height of the clip's lowest heel point; proxy only",
        "outside_frame": "share of detected frames where any of the 12 limb joints (shoulders to ankles) lies outside the image; confidence ignored",
        "outside_frame_per_joint": "per limb joint: share of detected frames where that joint lies outside the image; confidence ignored",
        "windows": "three equal thirds of the clip by frame index",
    }
    write_json(args.out, result)
    print(f"torso scale {S:.1f}px over {n} frames -> {args.out}")


def _r(x):
    return None if x is None else round(float(x), 4)


if __name__ == "__main__":
    main()
