# ADR-0008：浏览器导入校验与服务端契约校验是两道独立的门

状态：已确认（PR #8 消融「被否的候选」复核维持）。证据见 [../history/investigate.md](../history/investigate.md)「PR #8」。

## 决定

- `checkPosePackageShape`（浏览器侧，`package-inspect.ts`）与 `validatePosePackage`（服务端契约门，`validate.ts`）**不合并**：两者保护不同信任边界（不可信文件导入 vs 服务端交付契约）、可用上下文不同（bone set vs 完整 manifest）、文案语言不同（中文用户面 vs 英文 API）。
- 两侧各自吃增长：导入侧有结构/rig/事件/轨道重复/逐样本四元数单位性/密度上限等门；服务端有语义校验与阈值（见 [../validation.md](../validation.md)）。共享的数值约定（如四元数 1e-3 容差、fps≤240）靠注释互指，不抽公共实现把导入闸耦合到服务契约上。

## 被否方案（PR #8 消融批次复核，避免重开）

- **合并两道校验**：需要参数化 + 文案层，属复杂度搬家，并把导入闸耦合到服务契约。
- **Ajv 进浏览器**替代手写结构校验：新增依赖 + 首包体积，净义务增加。
- **`buildModel` 加缓存**提升性能：增加缓存状态与失效义务，且无性能问题证据。
- （同批保留项：`quality-probe`/`random-document` 是质量门与属性测试的共享实现；golden 明文见 [0007](0007-golden-plaintext.md)。）
