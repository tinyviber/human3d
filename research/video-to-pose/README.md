# 视频 → 姿态观测基准（S2）

这是 S2 的第一版研究基准。它用同一批真实正手视频，比较 MediaPipe 与 RTMPose 的 2D 观测在稳定性、两者一致性和失败帧上的表现。它是研究工具，不属于 H3D 运行时：`apps/` 与 `packages/motion-core` 不引用本目录。它只产出观测与诊断指标，不证明精度（没有真值）。结论与局限见 [REPORT.md](REPORT.md)。

## 输入

| 片段 | 源文件（main 上 `research/forehand-retargeting/videos/`） | 裁剪 | 帧数 / fps / 分辨率 |
|---|---|---|---|
| federer-127-136s | 费德勒正手.mp4 | 127 s 起至素材末尾（135.49 s） | 254 / 30 / 640×360 |
| djokovic-0-8s | 德约正手.mp4 | 0–8 s | 240 / 30 / 1280×720 |
| zverev-131-141s | 多人正手.mp4 | 131–141 s（多人合辑中的 Zverev 段，人工选定） | 250 / 25 / 640×360 |
| tennis-gvhmr（参考） | GVHMR 官方示例 tennis.mp4，只存本地 | 整段 | 312 / 29.83 / 812×720 |

- 三个裁剪段由 `cut_segments.sh` 生成（ffmpeg 重新编码、去掉音频），段文件放在仓库外（`/data/video-pose-inputs/segments/`），不入库。源视频已在 main 上，本分支不再复制。
- `多人正手.mp4` 是多人合辑，机位混合且未标定。main 上 `docs/reports/forehand-video-retargeting.md` 已记录：未标定的 2D 关键点不能直接映射到 rig 目标。
- tennis-gvhmr 只作参考，不是 H3D 素材。GVHMR 授权仅限教育、研究与非营利用途，视频不入库。

## 运行

```bash
python3 -m venv /data/venvs/pose-bench            # 建议放在仓库外
/data/venvs/pose-bench/bin/pip install -r research/video-to-pose/requirements.txt
bash research/video-to-pose/cut_segments.sh       # 需要 ffmpeg，段文件输出到 /data/video-pose-inputs/segments/
export PY=/data/venvs/pose-bench/bin/python
for n in federer-127-136s djokovic-0-8s zverev-131-141s; do
  bash research/video-to-pose/run_benchmark.sh /data/video-pose-inputs/segments/$n.mp4 $n research/video-to-pose/out
done
bash research/video-to-pose/run_benchmark.sh /data/video-pose-inputs/gvhmr-tennis.mp4 tennis-gvhmr research/video-to-pose/out   # 参考视频需先下载到仓库外
$PY research/video-to-pose/summarize.py research/video-to-pose/out/metrics > research/video-to-pose/out/summary-tables.md
$PY research/video-to-pose/write_manifest.py research/video-to-pose/out
$PY research/video-to-pose/overlay.py <视频> research/video-to-pose/out/obs/mediapipe-<名字>.json \
  research/video-to-pose/out/obs/rtmpose-<名字>.json <输出目录> --frames 36,75
```

`overlay.py` 先画 RTMPose（青色），再画 MediaPipe（品红），避免 MediaPipe 被遮住。

系统依赖（MediaPipe 原生库需要 OpenGL/EGL，Amazon Linux 2023；本次安装的包）：`sudo dnf install mesa-libGL mesa-libEGL mesa-libGLES mesa-libgbm libxkbcommon`。

模型：
- MediaPipe Pose Landmarker **Full**，路径 `~/.cache/human3d-pose/pose_landmarker_full.task`；本地缺失时 `extract_mediapipe.py` 从 `MODEL_URL` 下载。下载地址与哈希见 `out/manifest.json`。
- RTMPose：rtmlib `BodyWithFeet(mode="balanced")`，即 YOLOX-m 检测加 RTMPose-m（Halpe-26），ONNX 缓存在 `~/.cache/rtmlib/hub/checkpoints/`。

## 输出格式：`human3d.video-pose-observation.v1`

每个方法一份 JSON，位于 `out/obs/`（被 `.gitignore` 排除，可重新生成）。
- `source`：文件名、sha256、大小、宽、高、fps、帧数、时长。
- `method`：名称、版本、`running_mode`、`person_selection`、`min_confidence`。
- `frames[]`：`detected`；`image` 为像素坐标 `[x, y, score]`（MediaPipe 33 点，RTMPose Halpe-26 点）。MediaPipe 另有 `world`（米，原点在髋中心，不是全局坐标）。

## 指标（compare.py）

按全段（all）和三等分窗口（w1/w2/w3）计算。长度单位统一为躯干尺度：每帧取肩中点到髋中点的距离（两方法各算一次后取平均），全段取中位数。

| 指标 | 定义 |
|---|---|
| detect_rate | 有人体检测的帧占比 |
| limb_ok_rate | 12 个肢体关节（肩到踝）全部达到阈值（MediaPipe 0.5，RTMPose 0.3）的帧占比 |
| outside_frame_rate | 有检测的帧中，任一肢体关节落在画面外的占比（忽略置信度；x<0 或 x≥W，y<0 或 y≥H 计为画外） |
| outside_frame_per_joint | 每个肢体关节落在画面外的占比（同上定义） |
| jitter_torso | 相邻三帧的二阶差分范数除以躯干尺度，给出 median 与 p95 |
| agreement_torso | 两方法所有共享关节的图像距离除以躯干尺度，给出 median、p90 与超过 0.10 的占比 |
| hip_centre_path / net | 髋中心图像位置的逐帧位移之和 / 净位移（不做相机补偿），单位躯干尺度 |
| bone_cv_world_mediapipe | MediaPipe world 坐标中左上臂、左前臂、左大腿、左小腿、左侧躯干五段的段长变异系数，取中位数 |
| heel_contact | 脚跟位于最低脚跟点上方 3% 画幅高度内即视为接触（代理指标，不是真值） |
| failure_frames | 无检测、肢体低于阈值、两方法偏差超过 0.25 躯干长度的帧区间（帧号从 0 起） |
| per_joint | 每个肢体关节：MediaPipe 可见度低于 0.5 的占比与中位数、RTMPose 分数低于 0.3 的占比、两方法偏差的 median 与 p90 |

## 局限（必读）

1. **没有真值**：指标衡量两种方法之间的一致性和稳定性，不是精度。不能据此写“误差 X cm”。
2. **单目、未标定**：没有相机内外参。图像尺度只能用躯干尺度归一化。MediaPipe 世界坐标没有全局根运动。
3. **两方法不对称**：MediaPipe 用 VIDEO 模式（带时序跟踪），RTMPose 逐帧独立推理。因此时序稳定性的比较有混杂。
4. **模型不同**：这里用 MediaPipe Full。main 上 `research/forehand-retargeting/pose-debugger/` 用的是 Lite，两者结果不能直接互比。
5. **人物选择**：MediaPipe 设 `num_poses=1`；RTMPose 选关键点框最大的检测。多人合辑段必须目检 overlay。
6. **阈值敏感**：`limb_ok_rate` 与 `failure_frames` 随阈值变化，报告中应同时看 `per_joint` 的原始分布。
7. **髋部定义**：两方法对髋关节的定义不同，存在系统性的垂直偏移（见 REPORT）。它不能直接当作误差。

## 许可

- rtmlib、MMPose（RTMPose 代码）、YOLOX、MediaPipe：代码为 Apache-2.0（已从上游 LICENSE 核实）。**模型权重的许可和训练数据条款未逐一核实。**
- onnxruntime：MIT。
- GVHMR：LICENSE 授权仅限教育、研究与非营利用途；基于它的修改须开源且禁止商用。本目录不含 GVHMR 代码或权重。
- 视频素材是第三方体育视频。本分支不新增视频，裁剪段只留在仓库外。

## 移交与未完成

- **GVHMR**：需要 GPU（本机没有）和 SMPL/SMPL-X 模型（需用户在官方站点注册下载，不能代为获取）。跑通后要写适配器，把输出转成同一 schema。本次未运行。
- **Pose2Sim / OpenCap**：需要至少 2 台同步、已标定的相机（OpenCap 为多部 iPhone）。本次没有这类素材，需用户拍摄。
- **H3D 重定向（阶段 3）**：未开始。按 review，等 UI 稳定后再做。
