# AGENTS — spec/

Motion Protocol v1 的发布契约面：JSON Schema、OpenAPI、golden 样例。仅在协议/规范任务需要时读本文件。

## 边界

- `*.schema.json` 与 `openapi.yaml` 是公开契约：改动即协议变更，必须过 `npm run spec:check` 并按协议规则升版（求解语义变化 bump `SERVICE_VERSION`，见 `packages/motion-core/src/protocol.ts`）。
- `examples/idle.pose.json` 等 golden **保持明文**，不哈希化（[`docs/decisions/0007-golden-plaintext.md`](../docs/decisions/0007-golden-plaintext.md)）；重生成走 `npm run protocol:example`，diff 要逐位审。
- `solver-baseline/*.golden.json` 是求解器变更探测器，由 `scripts/recapture-solver-baseline.mts` 重捕获。

## 定向测试

`npm run spec:check`（= `apps/server/src/contract.test.ts`：Ajv 严格编译、OpenAPI 与服务一致、golden）。

## 检索指针

- 协议语义与包不变量：[`docs/domain/pose-package.md`](../docs/domain/pose-package.md)、[`docs/validation.md`](../docs/validation.md)
- 方案与优先级：[`docs/ANIMATION-PROTOCOL-PLAN.md`](../docs/ANIMATION-PROTOCOL-PLAN.md)；夹具账本：`examples/forehand-study.md`
