# 领域不变量：求解器（FK/IK）与质量门

改 `solver.ts`、`kinematics.ts`、`rig.ts`、`racket.ts`、`generate.ts` 或质量阈值前必读本文。历史证据见 [../history/investigate.md](../history/investigate.md)。

## 求解路径

- `frameAt → solveEffectiveFrame` 是唯一的真实求解路径：测试、质量探针（`quality-probe.ts`）、优化器（`generate.ts` 经 `probeFrames → analyzeProbeFrames → evalDetail`）、工作台渲染共用同一路径——测试/度量不得另写一套求解（learning [4]）。
- IK 为双骨解析解（肩–肘–腕、髋–膝–踝定长链），含弯曲提示方向；不是迭代 CCD。
- 求解是确定性的：同一文档 + 同一 rig 逐位重解（`property.test.ts`/`solver-baseline.test.ts` 钉死）。

## 限位与合理性

- 腕锥限位 `WRIST_BEND_LIMIT_DEG` = 59.8°：种子文档超限是文档自身需求，不是放宽限幅的理由（WP-C 裁决）。
- 求解器合理性检查与服务端语义校验（422 `motion_rejected`）的阈值与校准流程见 [../validation.md](../validation.md)；阈值用 `scripts/measure-motions.mts` / `measure-quality-probe.mts` 实测校准，不凭感觉调。

## gripSide 与镜像求解

- `EffectiveFrame.gripSide` 由 `frameAt` 从文档拍平；`solveEffectiveFrame`/`solvePose` 按侧路由 `blendGrip`/手指/腕锥/锁骨/球拍挂载；非握拍手保持松弛。
- 左挂载 = 右挂载的精确 x 镜像（M·q·M，x 反射）；`grip-side.test.ts` 在真实求解路径上逐骨断言（163 骨位置 + 世界朝向）。这是**求解语义**变化——任何改变求解输出的改动都必须 bump `SERVICE_VERSION`（[../decisions/0002-package-identity-service-version.md](../decisions/0002-package-identity-service-version.md)）。

## 变更探测与性能口径

- `spec/solver-baseline/*.golden.json` 是求解器变更探测器（重捕获容差 1e-3°/1e-3mm，只盖平台浮点抖动）；golden 明文不哈希化（[../decisions/0007-golden-plaintext.md](../decisions/0007-golden-plaintext.md)）。
- `evidence/quality-probe-*.json` 是当前求解器的 240fps 探针基线；语义变更后全量重跑并如实记录 delta。
- 优化器（`generate.ts`）：搜索只有「合法区间重排非锁定键时间」与「有界相位偏移重采样」两类操作；候选必须硬约束门禁通过且报告代价严格下降才产出；不产候选 ≠ 失败，门禁拒绝是正常结果。评价口径：数值代理改善 ≠ 动作自然。
- 性能测试先分离算法成本、并行竞争与测试预算，再收紧单测工作量（learning [17]）；生产默认预算由确定性 CLI evidence 覆盖，测试里降预算的结果不能当生产性能证明。
