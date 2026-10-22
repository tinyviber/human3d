# Forehand Semantics Metrics (17 Players)

Generated: 2026-10-22T03:35:52.916Z (box).

## Acceptance Summary (Three Categories Separated)

In accordance with verification honesty requirements, metrics are strictly separated into three categories:
1. **Solver Validity**: **34/34** pass (100.0%)
   - Kinematic convergence, joint clamp avoidance, zero torso-arm intersections, safety gates (dorsi≤20°, ankle_max≤20.05°, accel≤40 m/s², slip≤10 mm).
2. **Rig Target Tracking Error**: **26/34** pass (76.5%)
   - Solved rig poses vs engineered rig targets (including `MIN_TAKEBACK_CM=8` floor, ~45° squat band, 0.97 off-arm reach cap).
3. **Video Reconstruction Error**: **2/34** pass (5.9%)
   - Solved rig poses directly vs raw un-floored, un-capped MediaPipe video observations.

### Why Categories 2 and 3 Diverge (Structural Engineering Constraints)
1. **MIN_TAKEBACK_CM=8 Floor**: Video MediaPipe for shallow-crouch players (e.g. Federer 5.1 cm, Cilic 4.8 cm, Tiafoe 6.1 cm) measured shallow crouching. The rig generator floors load depth to 8 cm to maintain an athletic tennis squat. This creates intentional discrepancies with raw video knee/depth.
2. **2D Stance Camera Foreshortening**: Ankle-to-ankle distance in 2D video is compressed by foreshortening relative to 3D chain length. The rig uses calibrated stances with knee-flex boost.
3. **Off-Arm Clearance Capping**: The off-arm reach is capped at 0.97 and directed outward to eliminate chest penetrations.

---

## 1. Category 1: Solver Validity

| Metric | Requirement | Status |
|---|---|---|
| Elbow Flexion Clamp | Inner elbow ∈ [35°, 175°] (flexion ≤ 145°) | Passed (0 clamp violations) |
| Wrist Cone Clamp | Restrained within anatomical cone | Passed (0 clamp violations) |
| Arm-Torso Penetration | Zero volume crossing | Passed (0 crossings) |
| Ankle Dorsiflexion | ≤ 20.0° | Passed (DORSI_LIMIT=20 respected) |
| Ankle Max Guard | ≤ 20.05° | Passed (ANKLE_MAX=20.05 respected) |
| Root Acceleration | ≤ 40 m/s² | Passed (worst ~23.5 m/s²) |
| Support Foot Slip | ≤ 10 mm | Passed (worst ≤ 0.7 mm) |

**Solver Validity Pass Rate: 34/34 (100%)**

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

## 3. Category 3: Raw Video Reconstruction Error

Direct comparison against raw unfloored/uncapped MediaPipe video observations:
- Raw Pelvis depth: |Δ| ≤ 2.0 cm vs raw video
- Raw Knee flexion: |Δ| ≤ 10.0° vs raw video
- 2D Stance ratio: |Δ%| ≤ 10.0% vs raw 2D landmark ratio (subject to 2D foreshortening)
- Raw Off-elbow: |Δ| ≤ 15.0° vs raw video 2D angle
- Raw Off-direction: ∠ ≤ 20.0° vs raw video direction

**Video Reconstruction Pass Rate: 2/34 (5.9%)**

| Player | Phase | hDepth | vDepthRaw | ΔDepthRaw | hKnee | vKneeRaw | ΔKneeRaw | hStance | vStanceRaw | ΔStance% | hElbow | vElbowRaw | ΔElbowRaw | Status | Discrepancies |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---|
| carlos-alcaraz | 引拍 | 8 | 7.3 | +0.7 | 41.1 | 58 | -16.9 | 0.714 | 0.298 | +139.8% | 150 | 73 | +77 | GAP | knee|Δ|=16.9>10° vs raw video (58°); stance|Δ|=139.8% vs 2D stance; elbow|Δ|=77.0>15° vs raw video (73°); dir∠=35.4>20° vs raw video dir |
| carlos-alcaraz | 击球 | 12 | 14.6 | -2.6 | 64.4 | 79 | -14.6 | 0.733 | 0.382 | +91.9% | 57.3 | 55 | +2.3 | GAP | depth|Δ|=2.6>2cm vs raw video (14.6cm); knee|Δ|=14.6>10° vs raw video (79°); stance|Δ|=91.9% vs 2D stance |
| alexander-zverev | 引拍 | 8 | 4.1 | +3.9 | 44.1 | 42 | +2.1 | 0.722 | 0.208 | +246.5% | 125 | 125 | 0 | GAP | depth|Δ|=3.9>2cm vs raw video (4.1cm); stance|Δ|=246.5% vs 2D stance |
| alexander-zverev | 击球 | 8.2 | 8.2 | 0 | 54.4 | 31 | +23.4 | 0.747 | 0.598 | +25% | 106 | 106 | 0 | GAP | knee|Δ|=23.4>10° vs raw video (31°); stance|Δ|=25.0% vs 2D stance |
| daniil-medvedev | 引拍 | 8 | 4.7 | +3.3 | 44.4 | 43 | +1.4 | 0.711 | 0.192 | +270.3% | 151.9 | — | — | GAP | depth|Δ|=3.3>2cm vs raw video (4.7cm); stance|Δ|=270.3% vs 2D stance |
| daniil-medvedev | 击球 | 8 | 8 | 0 | 54 | 34 | +20 | 0.726 | 0.714 | +1.7% | 89 | 89 | 0 | GAP | knee|Δ|=20.0>10° vs raw video (34°) |
| ben-shelton | 引拍 | 8 | 2.6 | +5.4 | 44.5 | 48 | -3.5 | 0.713 | 0.361 | +97.4% | 151.9 | — | — | GAP | depth|Δ|=5.4>2cm vs raw video (2.6cm); stance|Δ|=97.4% vs 2D stance |
| ben-shelton | 击球 | 6.1 | 6.1 | 0 | 45.4 | 46 | -0.6 | 0.74 | 0.361 | +104.7% | 110 | — | — | GAP | stance|Δ|=104.7% vs 2D stance |
| alexander-bublik | 引拍 | 8 | 1.8 | +6.2 | 47.7 | 24 | +23.7 | 0.556 | 0.233 | +138.4% | 151.9 | — | — | GAP | depth|Δ|=6.2>2cm vs raw video (1.8cm); knee|Δ|=23.7>10° vs raw video (24°); stance|Δ|=138.4% vs 2D stance |
| alexander-bublik | 击球 | 1.9 | 1.9 | 0 | 38.5 | 35 | +3.5 | 0.592 | 0.641 | -7.7% | 110 | — | — | PASS | ok |
| frances-tiafoe | 引拍 | 8 | 1.3 | +6.7 | 49.2 | 24 | +25.2 | 0.548 | 0.318 | +72.6% | 150 | 95 | +55 | GAP | depth|Δ|=6.7>2cm vs raw video (1.3cm); knee|Δ|=25.2>10° vs raw video (24°); stance|Δ|=72.6% vs 2D stance; elbow|Δ|=55.0>15° vs raw video (95°); dir∠=61.9>20° vs raw video dir |
| frances-tiafoe | 击球 | 1.3 | 0.6 | +0.7 | 32 | 23 | +9 | 0.591 | 0.143 | +313.9% | 110 | 179 | -69 | GAP | stance|Δ|=313.9% vs 2D stance; elbow|Δ|=69.0>15° vs raw video (179°); dir∠=53.9>20° vs raw video dir |
| holger-rune | 引拍 | 8 | 4.3 | +3.7 | 43.8 | 40 | +3.8 | 0.692 | 0.37 | +87.2% | 136 | 136 | 0 | GAP | depth|Δ|=3.7>2cm vs raw video (4.3cm); stance|Δ|=87.2% vs 2D stance |
| holger-rune | 击球 | 8.7 | 8.7 | 0 | 56.6 | 62 | -5.4 | 0.718 | 0.162 | +343.5% | 123 | 123 | 0 | GAP | stance|Δ|=343.5% vs 2D stance |
| alex-de-minaur | 引拍 | 8 | 2.4 | +5.6 | 46.2 | 43 | +3.2 | 0.654 | 0.263 | +148.2% | 137 | 137 | 0 | GAP | depth|Δ|=5.6>2cm vs raw video (2.4cm); stance|Δ|=148.2% vs 2D stance; dir∠=31.5>20° vs raw video dir |
| alex-de-minaur | 击球 | 5.3 | 5.3 | 0 | 46.7 | 62 | -15.3 | 0.68 | 0.263 | +158% | 97 | 134 | -37 | GAP | knee|Δ|=15.3>10° vs raw video (62°); stance|Δ|=158.0% vs 2D stance; elbow|Δ|=37.0>15° vs raw video (134°); dir∠=47.6>20° vs raw video dir |
| alejandro-davidovich-fokina | 引拍 | 8 | 2.8 | +5.2 | 44.4 | 41 | +3.4 | 0.688 | 0.442 | +55.7% | 151.9 | — | — | GAP | depth|Δ|=5.2>2cm vs raw video (2.8cm); stance|Δ|=55.7% vs 2D stance |
| alejandro-davidovich-fokina | 击球 | 3.1 | 3.1 | 0 | 35.1 | 17 | +18.1 | 0.704 | 0.219 | +221.9% | 116 | 116 | 0 | GAP | knee|Δ|=18.1>10° vs raw video (17°); stance|Δ|=221.9% vs 2D stance |
| flavio-cobolli | 引拍 | 8 | 4.2 | +3.8 | 47.4 | 36 | +11.4 | 0.583 | 0.533 | +9.3% | 150 | 94 | +56 | GAP | depth|Δ|=3.8>2cm vs raw video (4.2cm); knee|Δ|=11.4>10° vs raw video (36°); elbow|Δ|=56.0>15° vs raw video (94°); dir∠=30.0>20° vs raw video dir |
| flavio-cobolli | 击球 | 2 | 2 | 0 | 35.1 | 31 | +4.1 | 0.617 | 0.533 | +15.6% | 110 | — | — | GAP | stance|Δ|=15.6% vs 2D stance |
| marin-cilic | 引拍 | 8 | 1.2 | +6.8 | 49.7 | 25 | +24.7 | 0.522 | 0.146 | +257.5% | 151.9 | — | — | GAP | depth|Δ|=6.8>2cm vs raw video (1.2cm); knee|Δ|=24.7>10° vs raw video (25°); stance|Δ|=257.5% vs 2D stance |
| marin-cilic | 击球 | 1.5 | 0.3 | +1.2 | 37.2 | 18 | +19.2 | 0.568 | 0.146 | +288.9% | 112 | 112 | 0 | GAP | knee|Δ|=19.2>10° vs raw video (18°); stance|Δ|=288.9% vs 2D stance |
| karen-khachanov | 引拍 | 8 | -1.1 | +9.1 | 46 | 19 | +27 | 0.677 | 0.148 | +358% | 151.9 | — | — | GAP | depth|Δ|=9.1>2cm vs raw video (-1.1cm); knee|Δ|=27.0>10° vs raw video (19°); stance|Δ|=358.0% vs 2D stance |
| karen-khachanov | 击球 | 4.2 | 4.2 | 0 | 38.9 | 40 | -1.1 | 0.706 | 0.168 | +320.6% | 110 | 165 | -55 | GAP | stance|Δ|=320.6% vs 2D stance; elbow|Δ|=55.0>15° vs raw video (165°); dir∠=26.7>20° vs raw video dir |
| jakub-mensik | 引拍 | 8 | 1.3 | +6.7 | 45.9 | 26 | +19.9 | 0.694 | 0.286 | +142.1% | 151.9 | — | — | GAP | depth|Δ|=6.7>2cm vs raw video (1.3cm); knee|Δ|=19.9>10° vs raw video (26°); stance|Δ|=142.1% vs 2D stance |
| jakub-mensik | 击球 | 4.5 | 4.5 | 0 | 43 | 43 | 0 | 0.716 | 0.149 | +379.1% | 131 | 131 | 0 | GAP | stance|Δ|=379.1% vs 2D stance |
| ignacio-buse | 引拍 | 8 | 5 | +3 | 43.7 | 44 | -0.3 | 0.718 | 0.132 | +443.4% | 151.9 | — | — | GAP | depth|Δ|=3.0>2cm vs raw video (5cm); stance|Δ|=443.4% vs 2D stance |
| ignacio-buse | 击球 | 8.5 | 8.5 | 0 | 55 | 31 | +24 | 0.74 | 0.694 | +6.5% | 110 | 174 | -64 | GAP | knee|Δ|=24.0>10° vs raw video (31°); elbow|Δ|=64.0>15° vs raw video (174°); dir∠=37.3>20° vs raw video dir |
| felix-auger-aliassime | 引拍 | 13.3 | 13.3 | 0 | 56.3 | 51 | +5.3 | 0.726 | 0.802 | -9.5% | 151.9 | — | — | PASS | ok |
| felix-auger-aliassime | 击球 | 7.7 | 7.7 | 0 | 53 | 63 | -10 | 0.752 | 0.802 | -6.3% | 110 | 159 | -49 | GAP | elbow|Δ|=49.0>15° vs raw video (159°); dir∠=47.3>20° vs raw video dir |
| novak-djokovic | 引拍 | 8 | 1.7 | +6.3 | 47.9 | 36 | +11.9 | 0.639 | 0.221 | +188.6% | 151.9 | — | — | GAP | depth|Δ|=6.3>2cm vs raw video (1.7cm); knee|Δ|=11.9>10° vs raw video (36°); stance|Δ|=188.6% vs 2D stance |
| novak-djokovic | 击球 | 1.9 | 1.8 | +0.1 | 30.8 | 21 | +9.8 | 0.68 | 0.436 | +56.1% | 105 | 105 | 0 | GAP | stance|Δ|=56.1% vs 2D stance |
| roger-federer | 引拍 | 8 | 0 | +8 | 48 | 16 | +32 | 0.496 | 0.406 | +22.3% | 151.9 | — | — | GAP | depth|Δ|=8.0>2cm vs raw video (0cm); knee|Δ|=32.0>10° vs raw video (16°); stance|Δ|=22.3% vs 2D stance |
| roger-federer | 击球 | 1.5 | 0.6 | +0.9 | 36.3 | 12 | +24.3 | 0.555 | 0.414 | +34.1% | 107 | 107 | 0 | GAP | knee|Δ|=24.3>10° vs raw video (12°); stance|Δ|=34.1% vs 2D stance |

### Notable Raw Video Divergences
- **carlos-alcaraz-forehand (引拍)**: knee|Δ|=16.9>10° vs raw video (58°); stance|Δ|=139.8% vs 2D stance; elbow|Δ|=77.0>15° vs raw video (73°); dir∠=35.4>20° vs raw video dir
- **carlos-alcaraz-forehand (击球)**: depth|Δ|=2.6>2cm vs raw video (14.6cm); knee|Δ|=14.6>10° vs raw video (79°); stance|Δ|=91.9% vs 2D stance
- **alexander-zverev-forehand (引拍)**: depth|Δ|=3.9>2cm vs raw video (4.1cm); stance|Δ|=246.5% vs 2D stance
- **alexander-zverev-forehand (击球)**: knee|Δ|=23.4>10° vs raw video (31°); stance|Δ|=25.0% vs 2D stance
- **daniil-medvedev-forehand (引拍)**: depth|Δ|=3.3>2cm vs raw video (4.7cm); stance|Δ|=270.3% vs 2D stance
- **daniil-medvedev-forehand (击球)**: knee|Δ|=20.0>10° vs raw video (34°)
- **ben-shelton-forehand (引拍)**: depth|Δ|=5.4>2cm vs raw video (2.6cm); stance|Δ|=97.4% vs 2D stance
- **ben-shelton-forehand (击球)**: stance|Δ|=104.7% vs 2D stance
- **alexander-bublik-forehand (引拍)**: depth|Δ|=6.2>2cm vs raw video (1.8cm); knee|Δ|=23.7>10° vs raw video (24°); stance|Δ|=138.4% vs 2D stance
- **frances-tiafoe-forehand (引拍)**: depth|Δ|=6.7>2cm vs raw video (1.3cm); knee|Δ|=25.2>10° vs raw video (24°); stance|Δ|=72.6% vs 2D stance; elbow|Δ|=55.0>15° vs raw video (95°); dir∠=61.9>20° vs raw video dir
- **frances-tiafoe-forehand (击球)**: stance|Δ|=313.9% vs 2D stance; elbow|Δ|=69.0>15° vs raw video (179°); dir∠=53.9>20° vs raw video dir
- **holger-rune-forehand (引拍)**: depth|Δ|=3.7>2cm vs raw video (4.3cm); stance|Δ|=87.2% vs 2D stance
- **holger-rune-forehand (击球)**: stance|Δ|=343.5% vs 2D stance
- **alex-de-minaur-forehand (引拍)**: depth|Δ|=5.6>2cm vs raw video (2.4cm); stance|Δ|=148.2% vs 2D stance; dir∠=31.5>20° vs raw video dir
- **alex-de-minaur-forehand (击球)**: knee|Δ|=15.3>10° vs raw video (62°); stance|Δ|=158.0% vs 2D stance; elbow|Δ|=37.0>15° vs raw video (134°); dir∠=47.6>20° vs raw video dir
- **alejandro-davidovich-fokina-forehand (引拍)**: depth|Δ|=5.2>2cm vs raw video (2.8cm); stance|Δ|=55.7% vs 2D stance
- **alejandro-davidovich-fokina-forehand (击球)**: knee|Δ|=18.1>10° vs raw video (17°); stance|Δ|=221.9% vs 2D stance
- **flavio-cobolli-forehand (引拍)**: depth|Δ|=3.8>2cm vs raw video (4.2cm); knee|Δ|=11.4>10° vs raw video (36°); elbow|Δ|=56.0>15° vs raw video (94°); dir∠=30.0>20° vs raw video dir
- **flavio-cobolli-forehand (击球)**: stance|Δ|=15.6% vs 2D stance
- **marin-cilic-forehand (引拍)**: depth|Δ|=6.8>2cm vs raw video (1.2cm); knee|Δ|=24.7>10° vs raw video (25°); stance|Δ|=257.5% vs 2D stance
- **marin-cilic-forehand (击球)**: knee|Δ|=19.2>10° vs raw video (18°); stance|Δ|=288.9% vs 2D stance
- **karen-khachanov-forehand (引拍)**: depth|Δ|=9.1>2cm vs raw video (-1.1cm); knee|Δ|=27.0>10° vs raw video (19°); stance|Δ|=358.0% vs 2D stance
- **karen-khachanov-forehand (击球)**: stance|Δ|=320.6% vs 2D stance; elbow|Δ|=55.0>15° vs raw video (165°); dir∠=26.7>20° vs raw video dir
- **jakub-mensik-forehand (引拍)**: depth|Δ|=6.7>2cm vs raw video (1.3cm); knee|Δ|=19.9>10° vs raw video (26°); stance|Δ|=142.1% vs 2D stance
- **jakub-mensik-forehand (击球)**: stance|Δ|=379.1% vs 2D stance
- **ignacio-buse-forehand (引拍)**: depth|Δ|=3.0>2cm vs raw video (5cm); stance|Δ|=443.4% vs 2D stance
- **ignacio-buse-forehand (击球)**: knee|Δ|=24.0>10° vs raw video (31°); elbow|Δ|=64.0>15° vs raw video (174°); dir∠=37.3>20° vs raw video dir
- **felix-auger-aliassime-forehand (击球)**: elbow|Δ|=49.0>15° vs raw video (159°); dir∠=47.3>20° vs raw video dir
- **novak-djokovic-forehand (引拍)**: depth|Δ|=6.3>2cm vs raw video (1.7cm); knee|Δ|=11.9>10° vs raw video (36°); stance|Δ|=188.6% vs 2D stance
- **novak-djokovic-forehand (击球)**: stance|Δ|=56.1% vs 2D stance
- **roger-federer-forehand (引拍)**: depth|Δ|=8.0>2cm vs raw video (0cm); knee|Δ|=32.0>10° vs raw video (16°); stance|Δ|=22.3% vs 2D stance
- **roger-federer-forehand (击球)**: knee|Δ|=24.3>10° vs raw video (12°); stance|Δ|=34.1% vs 2D stance

