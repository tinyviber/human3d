# Forehand Semantics Metrics (17 Players)

Generated: 2026-10-22T07:57:37.502Z (box).

## Acceptance Summary (three categories, separate denominators)

Each category passes only on the checks it actually runs.
1. **Solver Validity** (motion level, 17 presets): **17/17** pass the definite checks: elbow clamp, wrist-cone clamp, definite arm–torso crossing, shoulder direction, wrist residual ≤ 1 mm, ankle ≤ 20.05°, served 40/60 Hz root acceleration ≤ 36 m/s² and slip ≤ 9 mm.
   - **Not a clean pass:** 104 of 407 sampled frames are indeterminate (mixed shoulder/axilla skin meets the torso; 3–12 per motion). The checker does not classify them, so this table makes no zero-contact claim for those frames.
   - **Open risk, not a pass:** at the 240 Hz engineering probe, which the service never serves, 10/17 presets exceed 36 m/s² (max 53.3). Passing at 40/60 Hz does not establish smooth motion.
2. **Rig Target Tracking Error** (cell level, 34 cells): **26/34** pass. Solved rig vs the generator's own targets: this checks that the solver tracks what the generator asked for, not video truth.
3. **Video Reconstruction Error** (3D only, 34 cells): **10/34** pass. Depth ≤ 2 cm and knee ≤ 10° against the 3D depth study (MediaPipe worldLandmarks).
   - 2D keyframe quantities (stance ratio, off-elbow angle, arm direction) are **not gated**. The video is an uncalibrated, mixed-camera compilation, so 2D values cannot be compared with 3D rig angles. They are shown as diagnostics; 31/34 cells exceed the old 2D thresholds.
   - The earlier basis, which included 2D criteria, gave 2/34 (5.9%). It mixed coordinate spaces and is withdrawn.

NaN in solved kinematics: 0/34 cells.

### Engineering floors that shape the numbers
1. **MIN_TAKEBACK_CM=8 floor**: Video MediaPipe for shallow-crouch players (e.g. Federer 5.1 cm, Cilic 4.8 cm, Tiafoe 6.1 cm) measured shallow crouching. The generator floors takeback depth to 8 cm for an athletic squat, so depth and knee diverge from raw video by design.
2. **Heel-lift floor, 18°**: the contact heel pitch is max(semantic estimate, 18°). Every preset is bound by the floor (semantic estimates 6.6–8.4° where measured, 12° where not), so the heel lift is an engineering compensation, not a video measurement.
3. **Off-arm clearance cap**: the off-arm reach is capped at 0.97 and directed outward to avoid chest penetration.

---

## 1. Category 1: Solver Validity (motion level)

Source: `scripts/measure-player-forehands.mts 16 --json` (production replay: `frameAt` → `solveEffectiveFrame` → `PoseValidityChecker` on the skinned mesh; 16 uniform samples plus every key), and `evidence/forehand-presets.json` (served 40/60 Hz verdicts, 240-sample peak ankle). Indeterminate samples are shown, not counted as pass.

| Player | Samples | Elbow max (°) | Elbow clamp | Wrist-cone clamp | Arm–torso crossing (definite) | Indeterminate | Shoulder dir | Wrist residual (mm) | Ankle peak (°) | Root acc 40 / 60 Hz (m/s²) | Slip 40 Hz (mm) | 240 Hz probe (m/s², open) | Status (definite checks) | Gaps |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---|
| novak-djokovic | 24 | 92.6 | 0 | 0 | 0 | 4 | 0 | 0.00 | 20 | 4.882 / 8.274 | 0.213 | 29.289 | PASS | ok |
| roger-federer | 24 | 87.2 | 0 | 0 | 0 | 8 | 0 | 0.00 | 20 | 8.957 / 10.449 | 0 | 36.988 (>36) | PASS | ok |
| carlos-alcaraz | 23 | 122.7 | 0 | 0 | 0 | 3 | 0 | 0.00 | 20 | 11.426 / 15.852 | 0 | 48.23 (>36) | PASS | ok |
| alexander-zverev | 24 | 81.8 | 0 | 0 | 0 | 4 | 0 | 0.00 | 20 | 7.968 / 14.115 | 0 | 40.603 (>36) | PASS | ok |
| daniil-medvedev | 24 | 94.8 | 0 | 0 | 0 | 11 | 0 | 0.00 | 19.99 | 13.467 / 16.76 | 0 | 41.98 (>36) | PASS | ok |
| ben-shelton | 24 | 81.8 | 0 | 0 | 0 | 5 | 0 | 0.00 | 20 | 7.695 / 13.013 | 0 | 43.752 (>36) | PASS | ok |
| alexander-bublik | 24 | 81.8 | 0 | 0 | 0 | 5 | 0 | 0.00 | 20 | 8.081 / 9.156 | 0 | 21.124 | PASS | ok |
| frances-tiafoe | 24 | 84.3 | 0 | 0 | 0 | 9 | 0 | 0.00 | 20 | 6.46 / 9.219 | 0.396 | 33.377 | PASS | ok |
| holger-rune | 24 | 86.5 | 0 | 0 | 0 | 5 | 0 | 0.00 | 19.916 | 13.595 / 15.428 | 0 | 41.842 (>36) | PASS | ok |
| alex-de-minaur | 24 | 95.9 | 0 | 0 | 0 | 7 | 0 | 0.00 | 20 | 9.251 / 10.329 | 0 | 31.189 | PASS | ok |
| alejandro-davidovich-fokina | 24 | 86.7 | 0 | 0 | 0 | 12 | 0 | 0.00 | 19.988 | 7.41 / 11.181 | 0 | 43.708 (>36) | PASS | ok |
| flavio-cobolli | 24 | 86.0 | 0 | 0 | 0 | 6 | 0 | 0.00 | 20 | 15.176 / 16.252 | 0 | 31.609 | PASS | ok |
| marin-cilic | 24 | 81.8 | 0 | 0 | 0 | 3 | 0 | 0.00 | 20 | 7.826 / 16.917 | 0 | 49.759 (>36) | PASS | ok |
| karen-khachanov | 24 | 81.8 | 0 | 0 | 0 | 6 | 0 | 0.00 | 20 | 9.115 / 13.473 | 0 | 53.296 (>36) | PASS | ok |
| jakub-mensik | 24 | 81.8 | 0 | 0 | 0 | 3 | 0 | 0.00 | 19.997 | 14.402 / 19.061 | 0 | 33.134 | PASS | ok |
| ignacio-buse | 24 | 91.4 | 0 | 0 | 0 | 8 | 0 | 0.00 | 19.992 | 20.833 / 23.186 | 0.461 | 39.192 (>36) | PASS | ok |
| felix-auger-aliassime | 24 | 83.6 | 0 | 0 | 0 | 5 | 0 | 0.00 | 20 | 13.895 / 14.321 | 0 | 33.177 | PASS | ok |

**Solver Validity (definite checks): 17/17 (100.0%)**

Built-in motions in the same scan (not presets; not changed by this work): ready: 0 wrist-cone clamp, 0 definite crossings, 0 indeterminate; forehand: 10 wrist-cone clamp, 0 definite crossings, 11 indeterminate.

---

## 2. Category 2: Rig Target Tracking Error

Acceptance tolerances:
- Pelvis depth: |Δ| ≤ 2.0 cm vs floored/capped target
- Knee flexion: |Δ| ≤ 10.0° vs target (45° band for floored squat)
- Off-arm elbow: |Δ| ≤ 15.0° vs mapping target
- Off-arm direction: ∠ ≤ 20.0° vs outward mapping vector

**Rig Target Tracking Pass Rate: 26/34 (76.5%)**

| Player | Phase | hDepth | tgtDepth | ΔDepth | hKnee | tgtKnee | ΔKnee | hElbow | mapElbow | ΔElbow | dir∠ | Status | Gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---|
| carlos-alcaraz | 引拍 | 8 | 8* | 0 | 41.1 | 45 | -3.9 | 150 | 150 | 0 | 0 | PASS | ok |
| carlos-alcaraz | 击球 | 12 | 12† | 0 | 64.4 | 79 | -14.6 | 57.3 | 57 | +0.3 | 0 | FAIL | knee|Δ|=14.6>10° vs target (79°) |
| alexander-zverev | 引拍 | 8 | 8* | 0 | 44.1 | 45 | -0.9 | 125 | 125 | 0 | 0 | PASS | ok |
| alexander-zverev | 击球 | 8.2 | 8.2 | 0 | 54.4 | 31 | +23.4 | 106 | 106 | 0 | 0 | FAIL | knee|Δ|=23.4>10° vs target (31°) |
| daniil-medvedev | 引拍 | 8 | 8* | 0 | 44.4 | 45 | -0.6 | 151.9 | 155 | -3.1 | 0 | PASS | ok |
| daniil-medvedev | 击球 | 8 | 8 | 0 | 54 | 34 | +20 | 89 | 89 | 0 | 0 | FAIL | knee|Δ|=20.0>10° vs target (34°) |
| ben-shelton | 引拍 | 8 | 8* | 0 | 44.5 | 45 | -0.5 | 151.9 | 155 | -3.1 | 0 | PASS | ok |
| ben-shelton | 击球 | 6.1 | 6.1 | 0 | 45.4 | 46 | -0.6 | 110 | 110 | 0 | 0 | PASS | ok |
| alexander-bublik | 引拍 | 8 | 8* | 0 | 47.7 | 45 | +2.7 | 151.9 | 155 | -3.1 | 0 | PASS | ok |
| alexander-bublik | 击球 | 1.9 | 1.9 | 0 | 38.5 | 35 | +3.5 | 110 | 110 | 0 | 0 | PASS | ok |
| frances-tiafoe | 引拍 | 8 | 8* | 0 | 49.2 | 45 | +4.2 | 150 | 150 | 0 | 0 | PASS | ok |
| frances-tiafoe | 击球 | 1.3 | 0.6 | +0.7 | 32 | 23 | +9 | 110 | 110 | 0 | 0 | PASS | ok |
| holger-rune | 引拍 | 8 | 8* | 0 | 43.8 | 45 | -1.2 | 136 | 136 | 0 | 0 | PASS | ok |
| holger-rune | 击球 | 8.7 | 8.7 | 0 | 56.6 | 62 | -5.4 | 123 | 123 | 0 | 0 | PASS | ok |
| alex-de-minaur | 引拍 | 8 | 8* | 0 | 46.2 | 45 | +1.2 | 137 | 137 | 0 | 0 | PASS | ok |
| alex-de-minaur | 击球 | 5.3 | 5.3 | 0 | 46.7 | 62 | -15.3 | 97 | 97 | 0 | 0 | FAIL | knee|Δ|=15.3>10° vs target (62°) |
| alejandro-davidovich-fokina | 引拍 | 8 | 8* | 0 | 44.4 | 45 | -0.6 | 151.9 | 155 | -3.1 | 0 | PASS | ok |
| alejandro-davidovich-fokina | 击球 | 3.1 | 3.1 | 0 | 35.1 | 17 | +18.1 | 116 | 116 | 0 | 0 | FAIL | knee|Δ|=18.1>10° vs target (17°) |
| flavio-cobolli | 引拍 | 8 | 8* | 0 | 47.4 | 45 | +2.4 | 150 | 150 | 0 | 0 | PASS | ok |
| flavio-cobolli | 击球 | 2 | 2 | 0 | 35.1 | 31 | +4.1 | 110 | 110 | 0 | 0 | PASS | ok |
| marin-cilic | 引拍 | 8 | 8* | 0 | 49.7 | 45 | +4.7 | 151.9 | 155 | -3.1 | 0 | PASS | ok |
| marin-cilic | 击球 | 1.5 | 0.3 | +1.2 | 37.2 | 18 | +19.2 | 112 | 112 | 0 | 0 | FAIL | knee|Δ|=19.2>10° vs target (18°) |
| karen-khachanov | 引拍 | 8 | 8* | 0 | 46 | 45 | +1 | 151.9 | 155 | -3.1 | 0 | PASS | ok |
| karen-khachanov | 击球 | 4.2 | 4.2 | 0 | 38.9 | 40 | -1.1 | 110 | 110 | 0 | 0 | PASS | ok |
| jakub-mensik | 引拍 | 8 | 8* | 0 | 45.9 | 45 | +0.9 | 151.9 | 155 | -3.1 | 0 | PASS | ok |
| jakub-mensik | 击球 | 4.5 | 4.5 | 0 | 43 | 43 | 0 | 131 | 131 | 0 | 0 | PASS | ok |
| ignacio-buse | 引拍 | 8 | 8* | 0 | 43.7 | 45 | -1.3 | 151.9 | 155 | -3.1 | 0 | PASS | ok |
| ignacio-buse | 击球 | 8.5 | 8.5 | 0 | 55 | 31 | +24 | 110 | 110 | 0 | 0 | FAIL | knee|Δ|=24.0>10° vs target (31°) |
| felix-auger-aliassime | 引拍 | 13.3 | 13.3 | 0 | 56.3 | 51 | +5.3 | 151.9 | 155 | -3.1 | 0 | PASS | ok |
| felix-auger-aliassime | 击球 | 7.7 | 7.7 | 0 | 53 | 63 | -10 | 110 | 110 | 0 | 0 | PASS | ok |
| novak-djokovic | 引拍 | 8 | 8* | 0 | 47.9 | 45 | +2.9 | 151.9 | 155 | -3.1 | 0 | PASS | ok |
| novak-djokovic | 击球 | 1.9 | 1.8 | +0.1 | 30.8 | 21 | +9.8 | 105 | 105 | 0 | 0 | PASS | ok |
| roger-federer | 引拍 | 8 | 8* | 0 | 48 | 45 | +3 | 151.9 | 155 | -3.1 | 0 | PASS | ok |
| roger-federer | 击球 | 1.5 | 0.6 | +0.9 | 36.3 | 12 | +24.3 | 107 | 107 | 0 | 0 | FAIL | knee|Δ|=24.3>10° vs target (12°) |

\* floored depth target (MIN_TAKEBACK_CM=8). † soft-capped contact depth.

### Rig Target Discrepancies
- **carlos-alcaraz-forehand (击球)**: knee|Δ|=14.6>10° vs target (79°)
- **alexander-zverev-forehand (击球)**: knee|Δ|=23.4>10° vs target (31°)
- **daniil-medvedev-forehand (击球)**: knee|Δ|=20.0>10° vs target (34°)
- **alex-de-minaur-forehand (击球)**: knee|Δ|=15.3>10° vs target (62°)
- **alejandro-davidovich-fokina-forehand (击球)**: knee|Δ|=18.1>10° vs target (17°)
- **marin-cilic-forehand (击球)**: knee|Δ|=19.2>10° vs target (18°)
- **ignacio-buse-forehand (击球)**: knee|Δ|=24.0>10° vs target (31°)
- **roger-federer-forehand (击球)**: knee|Δ|=24.3>10° vs target (12°)

---

## 3. Category 3: Video Reconstruction (3D only)

Gated (3D vs 3D): pelvis depth |Δ| ≤ 2.0 cm and knee flexion |Δ| ≤ 10.0° against the 3D depth study (`evidence/forehand-depth.json`, MediaPipe worldLandmarks, pelvis-relative, 10 Hz).
Diagnostics only (not gated): 2D keyframe stance ratio, off-elbow angle and arm direction (`evidence/forehand-semantics.json`). The video is an uncalibrated mixed-camera compilation, so these cannot be compared with 3D rig angles.

**Video Reconstruction Pass Rate (3D): 10/34 (29.4%)**

| Player | Phase | hDepth | vDepth (3D) | ΔDepth | hKnee | vKnee (3D) | ΔKnee | Status | Gaps (3D) | 2D diagnostics (not gated) |
|---|---|---:|---:|---:|---:|---:|---:|:---:|---|---|
| carlos-alcaraz | 引拍 | 8 | 7.3 | +0.7 | 41.1 | 58 | -16.9 | GAP | knee|Δ|=16.9>10° vs 3D depth study (58°) | stance|Δ|=139.8% vs 2D stance; elbow|Δ|=77.0>15° vs 2D keyframe (73°); dir∠=35.4>20° vs 2D keyframe dir |
| carlos-alcaraz | 击球 | 12 | 14.6 | -2.6 | 64.4 | 79 | -14.6 | GAP | depth|Δ|=2.6>2cm vs 3D depth study (14.6cm); knee|Δ|=14.6>10° vs 3D depth study (79°) | stance|Δ|=91.9% vs 2D stance |
| alexander-zverev | 引拍 | 8 | 4.1 | +3.9 | 44.1 | 42 | +2.1 | GAP | depth|Δ|=3.9>2cm vs 3D depth study (4.1cm) | stance|Δ|=246.5% vs 2D stance |
| alexander-zverev | 击球 | 8.2 | 8.2 | 0 | 54.4 | 31 | +23.4 | GAP | knee|Δ|=23.4>10° vs 3D depth study (31°) | stance|Δ|=25.0% vs 2D stance |
| daniil-medvedev | 引拍 | 8 | 4.7 | +3.3 | 44.4 | 43 | +1.4 | GAP | depth|Δ|=3.3>2cm vs 3D depth study (4.7cm) | stance|Δ|=270.3% vs 2D stance |
| daniil-medvedev | 击球 | 8 | 8 | 0 | 54 | 34 | +20 | GAP | knee|Δ|=20.0>10° vs 3D depth study (34°) | — |
| ben-shelton | 引拍 | 8 | 2.6 | +5.4 | 44.5 | 48 | -3.5 | GAP | depth|Δ|=5.4>2cm vs 3D depth study (2.6cm) | stance|Δ|=97.4% vs 2D stance |
| ben-shelton | 击球 | 6.1 | 6.1 | 0 | 45.4 | 46 | -0.6 | PASS | ok | stance|Δ|=104.7% vs 2D stance |
| alexander-bublik | 引拍 | 8 | 1.8 | +6.2 | 47.7 | 24 | +23.7 | GAP | depth|Δ|=6.2>2cm vs 3D depth study (1.8cm); knee|Δ|=23.7>10° vs 3D depth study (24°) | stance|Δ|=138.4% vs 2D stance |
| alexander-bublik | 击球 | 1.9 | 1.9 | 0 | 38.5 | 35 | +3.5 | PASS | ok | — |
| frances-tiafoe | 引拍 | 8 | 1.3 | +6.7 | 49.2 | 24 | +25.2 | GAP | depth|Δ|=6.7>2cm vs 3D depth study (1.3cm); knee|Δ|=25.2>10° vs 3D depth study (24°) | stance|Δ|=72.6% vs 2D stance; elbow|Δ|=55.0>15° vs 2D keyframe (95°); dir∠=61.9>20° vs 2D keyframe dir |
| frances-tiafoe | 击球 | 1.3 | 0.6 | +0.7 | 32 | 23 | +9 | PASS | ok | stance|Δ|=313.9% vs 2D stance; elbow|Δ|=69.0>15° vs 2D keyframe (179°); dir∠=53.9>20° vs 2D keyframe dir |
| holger-rune | 引拍 | 8 | 4.3 | +3.7 | 43.8 | 40 | +3.8 | GAP | depth|Δ|=3.7>2cm vs 3D depth study (4.3cm) | stance|Δ|=87.2% vs 2D stance |
| holger-rune | 击球 | 8.7 | 8.7 | 0 | 56.6 | 62 | -5.4 | PASS | ok | stance|Δ|=343.5% vs 2D stance |
| alex-de-minaur | 引拍 | 8 | 2.4 | +5.6 | 46.2 | 43 | +3.2 | GAP | depth|Δ|=5.6>2cm vs 3D depth study (2.4cm) | stance|Δ|=148.2% vs 2D stance; dir∠=31.5>20° vs 2D keyframe dir |
| alex-de-minaur | 击球 | 5.3 | 5.3 | 0 | 46.7 | 62 | -15.3 | GAP | knee|Δ|=15.3>10° vs 3D depth study (62°) | stance|Δ|=158.0% vs 2D stance; elbow|Δ|=37.0>15° vs 2D keyframe (134°); dir∠=47.6>20° vs 2D keyframe dir |
| alejandro-davidovich-fokina | 引拍 | 8 | 2.8 | +5.2 | 44.4 | 41 | +3.4 | GAP | depth|Δ|=5.2>2cm vs 3D depth study (2.8cm) | stance|Δ|=55.7% vs 2D stance |
| alejandro-davidovich-fokina | 击球 | 3.1 | 3.1 | 0 | 35.1 | 17 | +18.1 | GAP | knee|Δ|=18.1>10° vs 3D depth study (17°) | stance|Δ|=221.9% vs 2D stance |
| flavio-cobolli | 引拍 | 8 | 4.2 | +3.8 | 47.4 | 36 | +11.4 | GAP | depth|Δ|=3.8>2cm vs 3D depth study (4.2cm); knee|Δ|=11.4>10° vs 3D depth study (36°) | elbow|Δ|=56.0>15° vs 2D keyframe (94°); dir∠=30.0>20° vs 2D keyframe dir |
| flavio-cobolli | 击球 | 2 | 2 | 0 | 35.1 | 31 | +4.1 | PASS | ok | stance|Δ|=15.6% vs 2D stance |
| marin-cilic | 引拍 | 8 | 1.2 | +6.8 | 49.7 | 25 | +24.7 | GAP | depth|Δ|=6.8>2cm vs 3D depth study (1.2cm); knee|Δ|=24.7>10° vs 3D depth study (25°) | stance|Δ|=257.5% vs 2D stance |
| marin-cilic | 击球 | 1.5 | 0.3 | +1.2 | 37.2 | 18 | +19.2 | GAP | knee|Δ|=19.2>10° vs 3D depth study (18°) | stance|Δ|=288.9% vs 2D stance |
| karen-khachanov | 引拍 | 8 | -1.1 | +9.1 | 46 | 19 | +27 | GAP | depth|Δ|=9.1>2cm vs 3D depth study (-1.1cm); knee|Δ|=27.0>10° vs 3D depth study (19°) | stance|Δ|=358.0% vs 2D stance |
| karen-khachanov | 击球 | 4.2 | 4.2 | 0 | 38.9 | 40 | -1.1 | PASS | ok | stance|Δ|=320.6% vs 2D stance; elbow|Δ|=55.0>15° vs 2D keyframe (165°); dir∠=26.7>20° vs 2D keyframe dir |
| jakub-mensik | 引拍 | 8 | 1.3 | +6.7 | 45.9 | 26 | +19.9 | GAP | depth|Δ|=6.7>2cm vs 3D depth study (1.3cm); knee|Δ|=19.9>10° vs 3D depth study (26°) | stance|Δ|=142.1% vs 2D stance |
| jakub-mensik | 击球 | 4.5 | 4.5 | 0 | 43 | 43 | 0 | PASS | ok | stance|Δ|=379.1% vs 2D stance |
| ignacio-buse | 引拍 | 8 | 5 | +3 | 43.7 | 44 | -0.3 | GAP | depth|Δ|=3.0>2cm vs 3D depth study (5cm) | stance|Δ|=443.4% vs 2D stance |
| ignacio-buse | 击球 | 8.5 | 8.5 | 0 | 55 | 31 | +24 | GAP | knee|Δ|=24.0>10° vs 3D depth study (31°) | elbow|Δ|=64.0>15° vs 2D keyframe (174°); dir∠=37.3>20° vs 2D keyframe dir |
| felix-auger-aliassime | 引拍 | 13.3 | 13.3 | 0 | 56.3 | 51 | +5.3 | PASS | ok | — |
| felix-auger-aliassime | 击球 | 7.7 | 7.7 | 0 | 53 | 63 | -10 | PASS | ok | elbow|Δ|=49.0>15° vs 2D keyframe (159°); dir∠=47.3>20° vs 2D keyframe dir |
| novak-djokovic | 引拍 | 8 | 1.7 | +6.3 | 47.9 | 36 | +11.9 | GAP | depth|Δ|=6.3>2cm vs 3D depth study (1.7cm); knee|Δ|=11.9>10° vs 3D depth study (36°) | stance|Δ|=188.6% vs 2D stance |
| novak-djokovic | 击球 | 1.9 | 1.8 | +0.1 | 30.8 | 21 | +9.8 | PASS | ok | stance|Δ|=56.1% vs 2D stance |
| roger-federer | 引拍 | 8 | 0 | +8 | 48 | 16 | +32 | GAP | depth|Δ|=8.0>2cm vs 3D depth study (0cm); knee|Δ|=32.0>10° vs 3D depth study (16°) | stance|Δ|=22.3% vs 2D stance |
| roger-federer | 击球 | 1.5 | 0.6 | +0.9 | 36.3 | 12 | +24.3 | GAP | knee|Δ|=24.3>10° vs 3D depth study (12°) | stance|Δ|=34.1% vs 2D stance |

### Notable 3D divergences
- **carlos-alcaraz-forehand (引拍)**: knee|Δ|=16.9>10° vs 3D depth study (58°)
- **carlos-alcaraz-forehand (击球)**: depth|Δ|=2.6>2cm vs 3D depth study (14.6cm); knee|Δ|=14.6>10° vs 3D depth study (79°)
- **alexander-zverev-forehand (引拍)**: depth|Δ|=3.9>2cm vs 3D depth study (4.1cm)
- **alexander-zverev-forehand (击球)**: knee|Δ|=23.4>10° vs 3D depth study (31°)
- **daniil-medvedev-forehand (引拍)**: depth|Δ|=3.3>2cm vs 3D depth study (4.7cm)
- **daniil-medvedev-forehand (击球)**: knee|Δ|=20.0>10° vs 3D depth study (34°)
- **ben-shelton-forehand (引拍)**: depth|Δ|=5.4>2cm vs 3D depth study (2.6cm)
- **alexander-bublik-forehand (引拍)**: depth|Δ|=6.2>2cm vs 3D depth study (1.8cm); knee|Δ|=23.7>10° vs 3D depth study (24°)
- **frances-tiafoe-forehand (引拍)**: depth|Δ|=6.7>2cm vs 3D depth study (1.3cm); knee|Δ|=25.2>10° vs 3D depth study (24°)
- **holger-rune-forehand (引拍)**: depth|Δ|=3.7>2cm vs 3D depth study (4.3cm)
- **alex-de-minaur-forehand (引拍)**: depth|Δ|=5.6>2cm vs 3D depth study (2.4cm)
- **alex-de-minaur-forehand (击球)**: knee|Δ|=15.3>10° vs 3D depth study (62°)
- **alejandro-davidovich-fokina-forehand (引拍)**: depth|Δ|=5.2>2cm vs 3D depth study (2.8cm)
- **alejandro-davidovich-fokina-forehand (击球)**: knee|Δ|=18.1>10° vs 3D depth study (17°)
- **flavio-cobolli-forehand (引拍)**: depth|Δ|=3.8>2cm vs 3D depth study (4.2cm); knee|Δ|=11.4>10° vs 3D depth study (36°)
- **marin-cilic-forehand (引拍)**: depth|Δ|=6.8>2cm vs 3D depth study (1.2cm); knee|Δ|=24.7>10° vs 3D depth study (25°)
- **marin-cilic-forehand (击球)**: knee|Δ|=19.2>10° vs 3D depth study (18°)
- **karen-khachanov-forehand (引拍)**: depth|Δ|=9.1>2cm vs 3D depth study (-1.1cm); knee|Δ|=27.0>10° vs 3D depth study (19°)
- **jakub-mensik-forehand (引拍)**: depth|Δ|=6.7>2cm vs 3D depth study (1.3cm); knee|Δ|=19.9>10° vs 3D depth study (26°)
- **ignacio-buse-forehand (引拍)**: depth|Δ|=3.0>2cm vs 3D depth study (5cm)
- **ignacio-buse-forehand (击球)**: knee|Δ|=24.0>10° vs 3D depth study (31°)
- **novak-djokovic-forehand (引拍)**: depth|Δ|=6.3>2cm vs 3D depth study (1.7cm); knee|Δ|=11.9>10° vs 3D depth study (36°)
- **roger-federer-forehand (引拍)**: depth|Δ|=8.0>2cm vs 3D depth study (0cm); knee|Δ|=32.0>10° vs 3D depth study (16°)
- **roger-federer-forehand (击球)**: knee|Δ|=24.3>10° vs 3D depth study (12°)

