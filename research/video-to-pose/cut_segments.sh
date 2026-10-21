#!/usr/bin/env bash
# Cut the three S2 benchmark segments from the forehand clips on main.
# Re-encodes (frame-accurate) and drops audio. Usage: bash cut_segments.sh [OUT_DIR]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../forehand-retargeting/videos"
dst="${1:-/data/video-pose-inputs/segments}"
mkdir -p "$dst"
cut() { ffmpeg -hide_banner -loglevel error -y -ss "$2" -i "$src/$3" -t "$4" \
  -c:v libx264 -preset veryfast -crf 18 -an "$dst/$1.mp4"; }
cut federer-127-136s 127 "费德勒正手.mp4" 9   # source ends at 135.49 s, so 254 frames
cut djokovic-0-8s 0 "德约正手.mp4" 8
cut zverev-131-141s 131 "多人正手.mp4" 10     # multi-player compilation; person selection needs overlay QA
