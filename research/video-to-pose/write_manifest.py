#!/usr/bin/env python3
"""Write out/manifest.json: source and segment hashes, model files, library versions, and run record.

Reads the observation and metrics files under OUT_DIR, so run it after run_benchmark.sh.
"""
import argparse
import glob
import importlib.metadata as md
import json
import os
import platform
import subprocess

from common import read_json, sha256_file

MODELS = [
    {"file": "~/.cache/human3d-pose/pose_landmarker_full.task",
     "url": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
     "note": "MediaPipe Pose Landmarker Full (Tasks API); extract_mediapipe.py downloads it to this path when missing"},
    {"file": "~/.cache/rtmlib/hub/checkpoints/yolox_m_8xb8-300e_humanart-c2c7a14a.onnx",
     "url": "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_m_8xb8-300e_humanart-c2c7a14a.zip",
     "note": "rtmlib balanced-mode detector; rtmlib downloads the zip and extracts the ONNX"},
    {"file": "~/.cache/rtmlib/hub/checkpoints/rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.onnx",
     "url": "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.zip",
     "note": "rtmlib balanced-mode pose model (Halpe-26); rtmlib downloads the zip and extracts the ONNX"},
]
PACKAGES = ["mediapipe", "rtmlib", "onnxruntime", "opencv-python-headless", "numpy"]
PARENT = {"federer-127-136s": "费德勒正手.mp4", "djokovic-0-8s": "德约正手.mp4", "zverev-131-141s": "多人正手.mp4"}


def git(*args):
    try:
        return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("out_dir")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    repo = git("-C", here, "rev-parse", "--show-toplevel") or os.path.abspath(os.path.join(here, "..", ".."))
    clips = []
    for mpath in sorted(glob.glob(os.path.join(args.out_dir, "obs", "mediapipe-*.json"))):
        name = os.path.basename(mpath)[len("mediapipe-"):-len(".json")]
        obs = read_json(mpath)
        clips.append({
            "name": name,
            # hashes come from the observation files, i.e. the exact input each run read
            "input": {k: obs["source"].get(k) for k in ("file", "url", "sha256", "bytes", "width", "height", "fps",
                                                         "frame_count", "duration_s")},
            "parent_in_repo": ("research/forehand-retargeting/videos/" + PARENT[name]) if name in PARENT else None,
            "reference_only": name not in PARENT,
            "observations": sorted(os.path.basename(p) for p in glob.glob(os.path.join(args.out_dir, "obs", "*-" + name + ".json"))),
            "metrics": os.path.join("metrics", "metrics-" + name + ".json"),
        })
    models = []
    for m in MODELS:
        path = os.path.expanduser(m["file"])
        models.append({**m, "file": m["file"], "bytes": os.path.getsize(path) if os.path.exists(path) else None,
                       "sha256": sha256_file(path) if os.path.exists(path) else None})
    manifest = {
        "schema": "human3d.video-pose-benchmark-manifest.v1",
        "generated_from_commit": git("-C", repo, "rev-parse", "HEAD"),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "packages": {p: md.version(p) for p in PACKAGES},
        "ffmpeg": (subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout.splitlines() or [None])[0],
        "clips": clips,
        "models": models,
        "commands": [
            "bash research/video-to-pose/cut_segments.sh",
            "PY=<venv>/bin/python bash research/video-to-pose/run_benchmark.sh <segment.mp4> <name> research/video-to-pose/out",
            "<venv>/bin/python research/video-to-pose/summarize.py research/video-to-pose/out/metrics",
            "<venv>/bin/python research/video-to-pose/write_manifest.py research/video-to-pose/out",
        ],
        "not_run": ["GVHMR (no GPU; SMPL/SMPL-X not available)", "WHAM", "Pose2Sim", "OpenCap",
                    "any accuracy comparison against ground truth (none available)"],
    }
    path = os.path.join(args.out_dir, "manifest.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print("wrote", path, "clips:", len(clips))


if __name__ == "__main__":
    main()
