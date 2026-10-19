# ADR-0006：presentation 走 `action.parameters` 开放通道；GLB 是派生品

状态：已确认（WP-B 决策裁决）。证据见 [../history/investigate.md](../history/investigate.md)「WP-B · 决策裁决」。

## 决定

- `presentation`（`documentName`/`prop`/`loop`/`gripSide` 等显示 hint）走包内 `action.parameters` 开放对象，不进 v2 schema 顶层；`parameters` 本来就是 per-action 开放通道且**不入制品哈希**。
- 信封（`assets/motions/*.json`）是 bundled 包的**权威显示元数据**：`posePackageSpec` 按 `action.id` 命中注册表即取信封字段，包内伪造的 `parameters.presentation` 不能覆盖信封；只有 adhoc 包（`workshop-doc`）才读 `parameters.presentation`。
- `phases` 永远来自包内事件（`phase` 优先，无则 `keyframe`），按交付数据派生，不按 action.id 声称的内容派生。
- v2 包不携带逐帧握拍量 → 道具按包级 hint 常量显示（`wantsProp` 上限），这是诚实上限不是缺陷。
- GLB 不承载身份契约、不作为服务端 `outputs.format`：`animations[0].name` 与文件名借用 artifact id 只为对应关系，非内容寻址声明。

## 被否方案

- **为显示 hint 升 `schemaVersion=3` 顶层化**：会强制所有消费者重校验，只为一个显示 hint 不值。v3 若引入逐帧握拍量等真实通道时再顶层化，届时 hint 语义由数据字段取代。

## 关联

浏览器导入侧的 rig/definition 信任核验（`rigMatches`/信封 `trust` 闭包）见 [../domain/pose-package.md](../domain/pose-package.md)。
