#!/usr/bin/env bash
# Run the S2 observation benchmark for one clip: run_benchmark.sh VIDEO NAME OUT_DIR
# Writes OUT_DIR/obs/*.json (per-method observations) and OUT_DIR/metrics/metrics-NAME.json.
# Set PY to the interpreter that has the requirements.txt packages installed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
py="${PY:-python3}"
video="$1"; name="$2"; out="$3"
mkdir -p "$out/obs" "$out/metrics"
"$py" "$here/extract_mediapipe.py" "$video" "$out/obs/mediapipe-$name.json"
"$py" "$here/extract_rtmpose.py" "$video" "$out/obs/rtmpose-$name.json"
"$py" "$here/compare.py" "$out/obs/mediapipe-$name.json" "$out/obs/rtmpose-$name.json" --out "$out/metrics/metrics-$name.json"
