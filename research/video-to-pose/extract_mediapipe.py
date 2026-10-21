#!/usr/bin/env python3
"""MediaPipe Pose Landmarker (Tasks API, VIDEO mode) -> v1 observation JSON.

Writes image-space landmarks (pixels) and world landmarks (metres, hip-centred).
World landmarks carry no global translation, so they cannot give root motion.
"""
import argparse
import os
import urllib.request

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from common import MEDIAPIPE_33, SCHEMA, iter_frames, sha256_file, source_block, video_info, write_json

MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
             "pose_landmarker_full/float16/latest/pose_landmarker_full.task")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--source-url", default=None)
    ap.add_argument("--model", default=os.path.expanduser("~/.cache/human3d-pose/pose_landmarker_full.task"))
    ap.add_argument("--min-confidence", type=float, default=0.5)
    args = ap.parse_args()

    if not os.path.exists(args.model):
        os.makedirs(os.path.dirname(args.model), exist_ok=True)
        urllib.request.urlretrieve(MODEL_URL, args.model)

    info = video_info(args.video)
    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=args.model),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=args.min_confidence,
        min_pose_presence_confidence=args.min_confidence,
        min_tracking_confidence=args.min_confidence,
    )
    frames = []
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        for i, bgr in iter_frames(args.video):
            rgb = bgr[:, :, ::-1].copy()
            ts_ms = int(round(i * 1000.0 / info["fps"]))
            res = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts_ms)
            t_s = round(i / info["fps"], 4)
            if res.pose_landmarks:
                img = [[round(p.x * info["width"], 1), round(p.y * info["height"], 1), round(p.visibility, 2)]
                       for p in res.pose_landmarks[0]]
                wld = [[round(p.x, 3), round(p.y, 3), round(p.z, 3), round(p.visibility, 2)]
                       for p in res.pose_world_landmarks[0]]
                frames.append({"i": i, "t_s": t_s, "detected": True, "image": img, "world": wld})
            else:
                frames.append({"i": i, "t_s": t_s, "detected": False, "image": None, "world": None})

    obs = {
        "schema": SCHEMA,
        "source": source_block(args.video, args.source_url),
        "method": {
            "id": "mediapipe-pose-landmarker-full",
            "library": "mediapipe",
            "library_version": mp.__version__,
            "model_file": os.path.basename(args.model),
            "model_url": MODEL_URL,
            "model_sha256": sha256_file(args.model),
            "running_mode": "VIDEO",
            "num_poses": 1,
            "min_confidence": args.min_confidence,
            "coordinates": {
                "image": "pixels, origin top-left, x right, y down",
                "world": "metres, origin at hip centre, no global translation",
            },
        },
        "joint_format": {"id": "mediapipe-33", "names": MEDIAPIPE_33},
        "frames": frames,
    }
    write_json(args.out, obs)
    detected = sum(f["detected"] for f in frames)
    print(f"mediapipe: {detected}/{len(frames)} frames with a pose -> {args.out}")


if __name__ == "__main__":
    main()
