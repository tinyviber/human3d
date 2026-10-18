# 正手击球 · 研究 — WP-C 验收账本

`forehand-study.request.json` 里嵌的 WorkshopDoc 是一段 2.0 s、5 键的网球
正手（准备 → 引拍 → 触球 → 随挥 → 恢复）。它不是手写出来的 fixture：
全部编辑都经 Workshop 页面的真实 UI 写路径完成——`npm run dev`（Vite
:5173，`workshop.html`）+ Playwright（系统 Chrome，`QA_BROWSER_CHANNEL=chrome`）
驱动 `scripts/forehand-study/drive.mjs` 回放 `ops.json` 配方。文档由
`__WS__.getDoc()` 读出后经 `normalizeDoc` 归一化封装进请求信封。

**没有向文档里注入任何姿态/烘焙帧数据。** 除读路径与播放控制
（`page.evaluate` 读出的 `getDoc()`/`setPlaying`/`solveCurrent`/camera
读数）外，没有任何引擎方法直调——全部写入都走真实 UI 事件。

## 键位与时间

| 键 | 时刻 | 相位 | 约束 |
|---|---|---|---|
| k-ready 准备 | 0 s | 准备/半预转 | plantL+R·grip |
| k-back 引拍 | 0.78 s | 引拍（髋−36°·转体−22°） | plantL+R·grip |
| k-contact 触球 | 1.15 s | 触球（唯一 contact） | plantL+R·grip·**contact** |
| k-follow 随挥 | 1.52 s | 随挥穿越 | plantL+R·grip |
| k-recover 恢复 | 1.95 s | 回收 | plantL+R·grip |

`duration 2.0`、`handFrames L/R 均为 pelvis`、`inbetweens true`、`loop false`。

## 每键编辑方式（全部真实 UI 写路径）

| 内容 | UI 路径 |
|---|---|
| 重命名 / 时长 | `名称` / `时长` 文本字段（时长字段触发 retimeKeys） |
| 每键时刻 | `时间 s` 字段 |
| root/yaw/lean/chest/side | 「躯干与骨盆」面板 range slider（`input` 事件） |
| 双手目标点 | 画布「编辑手柄」真实 pointer 拖拽（正面视图拖 x,y → 侧面视图拖 z,y；R 手两轮收敛到 <1 mm） |
| 右手腕姿态 | 「右手腕姿态」delta slider：屈/伸、尺桡偏、旋前（超出 ±60°/±90° 量程时面板重挂载续调） |
| 支撑/握拍/触球约束 | 沿用种子的 `plantL·plantR·grip` 全开；contact 仅触球键（种子自带，未增删） |

逐键手腕 delta 回放序列（按 ops.json 记录，分解自目标手朝向，残差 <0.7°）：
准备 flex+26 dev+20 twist+19 flex+4 dev+1；引拍 flex−60 dev+59 twist+60
flex−11 dev+1 twist+1；触球 twist−46 dev+30 flex+24 twist−8 dev+3；
随挥 flex+60 flex+36 dev−14 twist−13 flex+2；恢复 flex+48 twist+30 dev−3 flex+2。

## 设计 → 实测迭代（共 ~35 轮探针迭代）

离线 `probeDocument`（`packages/motion-core/src/quality-probe.ts`，与 vitest/CLI 同源）
先扫 ~30 个姿态/时序候选确定形态，再把胜出版本回放进 UI（`ops.json`），
最终指标即上方 UI 文档的实测值。

关键拐点：
- 1.8 s 版本踢点过多 → 2.0 s 上限（accel ∝ 1/dt²）。
- 引拍段收小、挥拍段做均匀速 → contact 键中心差切线抬高。
- 手腕 delta 本身是 tip 速度杠杆：按「clamp=0 前提下最大化 contact 点
  速度」贪心重调，contact tip 2.06 → 3.79 m/s。

## 最终探针指标（共享探针 CLI，240fps / 60fps）

| 指标 | 240fps | 60fps | 预算 | 状态 |
|---|---|---|---|---|
| 腕 bend max | 48.2° | 48.2° | ≤59.8° | ✅ 余量 ~12° |
| wristClamp.clamped | 0/481 | 0/121 | =0 | ✅ |
| arm_R 残差 | 0.00 mm | 0.00 mm | <3 mm | ✅ |
| leg 残差 | 0.00 mm | 0.00 mm | <3 mm | ✅ |
| reachMax | 94.3% | 94.3% | <100% | ✅ |
| 支撑脚滑移 | 0.00 mm | 0.00 mm | =0 | ✅ |
| foot-depth | ~0 m | ~0 m | =0 | ✅ |
| 鞋底穿透 | 0.00 mm | 0.00 mm | =0 | ✅ |
| 踝背屈 L/R | 19.6°/20.0° | 同左 | ≤20° | ✅（R 贴限，pelvis 修正顶在限上） |
| tip vmax | 8.94 m/s @0.983 s | 8.91 @0.983 | 接触键附近明显峰 | ✅ |
| **contact 键 tip 速度** | **3.79 m/s** | **4.04 m/s** | 尽量 >3 | ✅（idle ~1 m/s 为反例） |
| tip kick（dv>0.1/帧） | **136** | 117 | =0 目标 | ⚠️ 残余，如实记录 |
| wrist kick | 7 | 39 | 低 | ⚠️ 60fps 下逐帧 Δv 天然更大 |
| root maxA | 12.6 m/s² | 2.4 | <40 | ✅ |
| wrist_R 角速度峰值 | 11.1 rad/s | 同 | <40 | ✅ |
| wrist atKey step 中位 | 0.06° | 0.68° | 无键处折角 | ✅ |
| 动力链（相对峰值时刻） | 骨盆 .971→躯干 .971→上臂 .875→前臂 1.212→手 .988 | 同序 | 近端先 | ⚠️ 手部峰值夹在前臂之前 |

## 验收边界（声明范围）

本 fixture 只证明**几何/平滑/接触约束达标**（IK 残差、关节限位、支撑滑移、
鞋底穿透、腕锥截幅为零这一类），**不证明符合真实网球正手运动学**。已知
残余如实记录在下节；其中两项的硬门口径写死如下，防止被误读为"已达标"：

- 拍头速度峰领先触球 0.17 s（0.983 vs 1.15 s）——测试只钉 `|Δt|≤0.25 s`
  容差，不宣称峰必须落在触球时刻；
- 近端→远端动力链时序**未完全验证**——硬门只钉「骨盆峰、躯干峰不晚于
  前臂峰（+0.05 s 容差）」，手部峰（.988 s）夹在前臂（1.212 s）之前
  是已记录的反例，不在门内。

## 残余偏差（如实记录，未达标项）

1. **tip kicks 136 @240fps**：9 m/s 级挥拍鞭打的物理代价（阈值对应
   24 m/s²/帧；鞭打段 accelTop ~80 m/s²）。探针与注释里写明这是残余而非
   已达标；quality.test.ts 用 ×1.25 上限 170 做回归门。
2. **tip 峰值在触球前 0.17 s**（0.983 vs 1.15 s）：真实正手的拍头速度
   也在触球瞬间前后到峰；接触键时刻速度 3.79 m/s 仍 >3。测试门
   |Δt|≤0.25 s（见上节口径）。
3. **动力链顺序**：近端（骨盆/躯干 .971 s）先于前臂（1.212 s）成立，
   但手部峰值（.988 s）夹在前臂之前——非完全 proximal→distal。测试门
   仅约束骨盆/躯干 ≤ 前臂 +0.05 s（见上节口径）。
4. **R 踝背屈顶在 20° 限**：pelvis 后移修正生效、未超限（saturated 0 帧）。

## 验证命令输出

- `apps/server/src/contract.test.ts` 的 forehand-study 用例（CI 门禁）：
  `contract.request → true`、`handleRequest → 200`（定稿包 81 帧 @40fps · 13 项质量检查
  全 OK · 8 事件含 1.15 s contact）、`validatePosePackage → []`（0 错误）。
- `npx vitest run packages/motion-core/src/quality.test.ts apps/server/src/contract.test.ts`
  → 22 项全过（含本 fixture 的 5 项新断言）。
- 全量 `npm run spec:check`、`npx tsc -b`、`npm test` 见提交信息/CI。

UI 会话零 pageerror/console error；`getDoc()` 与 localStorage 持久化副本
逐字节一致（drive.mjs 收尾断言）。
