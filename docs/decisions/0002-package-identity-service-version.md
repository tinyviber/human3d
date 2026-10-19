# ADR-0002：制品身份 = 内容哈希组合；请求身份与制品身份分离

状态：已确认（PR #1 提案 No.3 之一，后续 WP-C/WP-D 沿用同一规则）。证据见 [../history/investigate.md](../history/investigate.md)。

## 决定

- 姿态包 `id` 是**制品身份**：hash(requestFingerprint + definitionHash + rig manifest hash + solver 名/版本)。同一请求换 rig 或换求解器后必须得到不同 id。
- `provenance.requestFingerprint` 是**请求身份**，与制品身份分离；bundled 文档的请求指纹不含内置文档内容（`normalizedRequest` 传 `undefined`），artifact id 随定义哈希变化才是正确语义。
- `definitionSHA256` 哈希**展开后的真实定义**（`keyframedDefinition()` 导出 `base` 展开后的控制帧），不是手工维护的 `{id, revision}` 版本号。
- **求解运动语义变化必须无条件 bump `SERVICE_VERSION`**（`protocol.ts` 的规则）：WP-C 切线限界 `0.1.0→0.2.0`、SO(3) 三次 `0.2.0→0.3.0`、gripSide 镜像求解 `0.3.0→0.4.0` 均照此执行——其中 gripSide 是事后补升，说明漏升会发生，审查时要主动核对该项。
- 哈希绑定的是**数据内容**：测试写「改 X → hash 变」，不写「hash 存在」；导出内部数据注意深拷贝，浅拷贝会让调用方污染模块状态（learning [2]）。

## 被否方案

- 只哈希请求体标识 `motionId`：换 rig/求解器后同请求同 id、结果不同，缓存混淆（PR #1 P1-3 原缺陷）。
- 只哈希 `{keyframed: actionId, revision}`：改关键帧不改 hash，可复现性声明是假的（PR #1 P1-2 原缺陷）。
- golden 哈希化压缩：见 [0007-golden-plaintext.md](0007-golden-plaintext.md)。
