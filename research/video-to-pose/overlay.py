#!/usr/bin/env python3
"""Draw MediaPipe (magenta) and RTMPose (cyan) observations on chosen frames for visual QA."""
import argparse
import os

import cv2
import numpy as np

from common import iter_frames, read_json
from compare import LIMB, MP_IDX, RT_IDX

EDGES = [(0, 1), (0, 2), (2, 4), (1, 3), (3, 5), (0, 6), (1, 7), (6, 7), (6, 8), (8, 10),
         (7, 9), (9, 11), (10, 12), (12, 14), (11, 13), (13, 15)]


def points(frame_obs, idx, thr):
    if not frame_obs["detected"]:
        return None, None
    rows = np.asarray(frame_obs["image"], float)
    return rows[idx, :2], rows[idx, 2] >= thr


def draw(img, pts, ok, colour):
    for a, b in EDGES:
        if ok[a] and ok[b]:
            cv2.line(img, tuple(int(v) for v in pts[a]), tuple(int(v) for v in pts[b]), colour, 2, cv2.LINE_AA)
    for j in range(len(pts)):
        if ok[j]:
            cv2.circle(img, (int(pts[j][0]), int(pts[j][1])), 4, colour, -1, cv2.LINE_AA)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video")
    ap.add_argument("mediapipe_json")
    ap.add_argument("rtmpose_json")
    ap.add_argument("out_dir")
    ap.add_argument("--frames", required=True, help="comma-separated frame indices")
    ap.add_argument("--width", type=int, default=640)
    args = ap.parse_args()

    mp_obs, rt_obs = read_json(args.mediapipe_json), read_json(args.rtmpose_json)
    wanted = {int(x) for x in args.frames.split(",")}
    os.makedirs(args.out_dir, exist_ok=True)
    thr_mp, thr_rt = mp_obs["method"]["min_confidence"], rt_obs["method"]["min_confidence"]
    for i, bgr in iter_frames(args.video, stop_after=max(wanted)):
        if i not in wanted:
            continue
        img = bgr.copy()
        pm, okm = points(mp_obs["frames"][i], MP_IDX, thr_mp)
        pr, okr = points(rt_obs["frames"][i], RT_IDX, thr_rt)
        # RTMPose first, MediaPipe on top: otherwise cyan hides magenta wherever the two agree.
        if pr is not None:
            draw(img, pr, okr, (255, 255, 0))
        if pm is not None:
            draw(img, pm, okm, (255, 0, 255))
        cv2.putText(img, f"frame {i}: magenta=MediaPipe  cyan=RTMPose", (12, 32),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4, cv2.LINE_AA)
        cv2.putText(img, f"frame {i}: magenta=MediaPipe  cyan=RTMPose", (12, 32),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 1, cv2.LINE_AA)
        h, w = img.shape[:2]
        img = cv2.resize(img, (args.width, int(h * args.width / w)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(args.out_dir, f"overlay_{i:04d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print("overlays written to", args.out_dir)


if __name__ == "__main__":
    main()
