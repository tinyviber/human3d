# AGENTS — @human3d/motion-core

纯运动域包：文档采样器、FK/IK 求解、姿态包协议/导出、质量度量、生成器。

## 边界（自动强制，`tests/architecture.test.ts`）

- 生产代码**不得** import `node:*`、不得使用 DOM 全局；three 只当数学库。
- 不得 import 两个 app；消费方一律 `from '@human3d/motion-core'`（或 `/glb` 子路径），不写深路径。
- 唯一例外：以相对路径读仓库根 `assets/motions/*.json` 信封注册表（已知泄漏，见 `docs/ARCHITECTURE.md`）。
- 求解语义变化必须 bump `SERVICE_VERSION`（`protocol.ts`）。

## 定向测试

`npm test -- packages/motion-core/src/<file>.test.ts`；求解/golden 回归：`solver-baseline.test.ts`、`quality.test.ts`。

## 检索指针

- 不变量：[`docs/domain/motion-model.md`](../../docs/domain/motion-model.md)、[`docs/domain/solver.md`](../../docs/domain/solver.md)、[`docs/domain/pose-package.md`](../../docs/domain/pose-package.md)
- 决策：[`docs/decisions/`](../../docs/decisions/)（ADR-0001~0008 大多是本包的语义裁决）
- 规则：[`docs/learning.md`](../../docs/learning.md)
