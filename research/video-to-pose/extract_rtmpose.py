#!/usr/bin/env python3
"""RTMPose via rtmlib BodyWithFeet (mode=balanced: YOLOX-m + RTMPose-m, Halpe-26) -> v1 observation JSON.

One person per frame: the detection whose confident keypoints span the largest box.
Halpe-26 index check: neck (18) should sit near the shoulder midpoint (5, 6), pelvis (19) near the hip midpoint (11, 12).
"""
import argparse
import hashlib
import importlib.metadata as md
import os

import numpy as np
from rtmlib import BodyWithFeet

from common import HALPE_26, SCHEMA, iter_frames, source_block, video_info, write_json

SCORE_MIN = 0.3
CHECKPOINT_DIR = os.path.expanduser("~/.cache/rtmlib/hub/checkpoints")
DET_FILE = "yolox_m_8xb8-300e_humanart-c2c7a14a.onnx"
POSE_FILE = "rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.onnx"


def pick_person(kps, scores):
    best = None
    for k, s in zip(kps, scores):
        keep = s >= SCORE_MIN
        if keep.sum() < 5:
            continue
        pts = k[keep]
        area = float((pts[:, 0].max() - pts[:, 0].min()) * (pts[:, 1].max() - pts[:, 1].min()))
        if best is None or area > best[0]:
            best = (area, k, s)
    return None if best is None else (best[1], best[2])


def sha256_or_none(path):
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--source-url", default=None)
    args = ap.parse_args()

    info = video_info(args.video)
    body = BodyWithFeet(mode="balanced", backend="onnxruntime", device="cpu")
    frames = []
    neck_err, pelvis_err = [], []
    for i, bgr in iter_frames(args.video):
        kps, scores = body(bgr)
        pick = pick_person(np.asarray(kps), np.asarray(scores)) if len(kps) else None
        t_s = round(i / info["fps"], 4)
        if pick is None:
            frames.append({"i": i, "t_s": t_s, "detected": False, "image": None, "world": None})
            continue
        k, s = pick
        if np.all(s[[5, 6, 11, 12, 18, 19]] >= SCORE_MIN):
            neck_err.append(float(np.linalg.norm(k[18] - (k[5] + k[6]) / 2)))
            pelvis_err.append(float(np.linalg.norm(k[19] - (k[11] + k[12]) / 2)))
        image = [[round(float(x), 1), round(float(y), 1), round(float(c), 2)] for (x, y), c in zip(k, s)]
        frames.append({"i": i, "t_s": t_s, "detected": True, "image": image, "world": None})

    obs = {
        "schema": SCHEMA,
        "source": source_block(args.video, args.source_url),
        "method": {
            "id": "rtmlib-body-with-feet-balanced",
            "library": "rtmlib",
            "library_version": md.version("rtmlib"),
            "onnxruntime_version": md.version("onnxruntime"),
            "detector": {"file": DET_FILE, "sha256": sha256_or_none(os.path.join(CHECKPOINT_DIR, DET_FILE))},
            "pose": {"file": POSE_FILE, "sha256": sha256_or_none(os.path.join(CHECKPOINT_DIR, POSE_FILE))},
            "running_mode": "per-frame (no temporal tracking)",
            "person_selection": "largest keypoint box among detections",
            "min_confidence": SCORE_MIN,
            "coordinates": {"image": "pixels, origin top-left, x right, y down"},
        },
        "joint_format": {
            "id": "halpe-26",
            "names": HALPE_26,
            "index_check": {
                "frames": len(neck_err),
                "neck_vs_shoulder_mid_px_median": round(float(np.median(neck_err)), 2) if neck_err else None,
                "pelvis_vs_hip_mid_px_median": round(float(np.median(pelvis_err)), 2) if pelvis_err else None,
            },
        },
        "frames": frames,
    }
    write_json(args.out, obs)
    detected = sum(f["detected"] for f in frames)
    print(f"rtmpose: {detected}/{len(frames)} frames with a person -> {args.out}")
    print("index_check:", obs["joint_format"]["index_check"])


if __name__ == "__main__":
    main()
