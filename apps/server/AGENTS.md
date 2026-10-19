# AGENTS — @human3d/server

loopback HTTP 服务（`serve.ts`）、编排与幂等（`service.ts`）、Ajv 契约（`contract.ts`）、rig manifest 哈希（`rig-manifest.ts`）。

## 边界（自动强制）

- 可 import `@human3d/motion-core`；**不得** import `@human3d/web`。
- `spec/` 由 `contract.ts` 以 `import.meta.url` 相对定位——移动 `spec/` 会破坏服务。

## 定向测试

- `npm test -- apps/server/src/service.test.ts`（或 `contract.test.ts` = `npm run spec:check`）
- 协议/包改动另跑：`package-export.test.ts`、`validate.test.ts`、`property.test.ts`

## 检索指针

- 协议与包不变量（字节对等、身份、两道校验门）：[`docs/domain/pose-package.md`](../../docs/domain/pose-package.md)
- 校验阈值：[`docs/validation.md`](../../docs/validation.md)；契约：`spec/openapi.yaml`、[`spec/AGENTS.md`](../../spec/AGENTS.md)
