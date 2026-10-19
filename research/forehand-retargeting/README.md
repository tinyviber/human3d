# Forehand video study

This folder preserves the inputs and offline analysis artifacts for the tennis forehand presets. It is research material; `apps/web`, `apps/server`, and `packages/motion-core` do not import or depend on it.

## Contents

- `videos/`: the three supplied source clips.
- `frames/`: selected still frames for the 17 player profiles, five timestamps per profile.
- `pose-debugger/`: a separate local browser tool and the 5.78 MB MediaPipe Pose Landmarker Lite model. The browser processes selected videos and screenshots locally.
- `evidence/`: same-model comparison screenshots and a footwork pose screenshot from the current implementation.
- `../../scripts/player-forehand-landmarks.json`: the compact 2D landmarks used by the motion generator.
- `../../scripts/generate-player-forehands.mts`: regenerate the motion preset JSON files.

## Recreate selected frames

Requires `ffmpeg` on `PATH`. From the repository root, run:

```sh
npx tsx scripts/extract-player-forehand-frames.mts
```

The extractor reads the selected timestamps from `scripts/player-forehand-landmarks.json` and writes JPEGs into `frames/`. Each filename includes the player profile ID and source time.

## Run the comparison tool

Requires Node.js 20 or newer. From this directory:

```sh
cd research/forehand-retargeting/pose-debugger
npm ci
npm start
```

Open `http://127.0.0.1:8765/`. Choose a source video and timestamp, then a rendered h3d screenshot. The same model processes both inputs. The 2D score is a debugging aid and does not recover camera calibration, monocular depth, or racket orientation.

## Model provenance

The model is `Pose Landmarker Lite`, downloaded from Google's MediaPipe model hosting:

`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`

File size: 5,777,746 bytes. SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.

The model is stored only in this research folder and is not a production h3d asset.
