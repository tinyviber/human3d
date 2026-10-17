# forehand-study 工具链（WP-C）

制作与校准 `spec/examples/forehand-study.request.json` 的迭代工具集，验收账本见 `spec/examples/forehand-study.md`。保留作复现与后续校准用途；非日常命令，不进 CI。

- `drive.mjs` — 工作台真实 UI 写路径回放器：`node scripts/forehand-study/drive.mjs ops.json <out.doc.json>`（需 dev server :5173，默认系统 Chrome，`QA_BROWSER_CHANNEL` 可覆盖）。所有文档改动走面板滑块/字段 input 事件与画布真实指针拖拽，不注入姿态数据。
- `ops.json` — 上述回放配方（重命名/时长/逐键时刻/躯干滑块/双手拖点/手腕 delta 序列）。
- `probe.mts` — 探针：`npx tsx scripts/forehand-study/probe.mts <doc|request.json> [fps] [--record <tag>]`，`--record` 追加到 `evidence/forehand-study/rounds.jsonl`。
- `grid.mts` / `retune.mts` — 离线候选扫描（键时刻/姿态通道变体排名）与逐键手腕 delta 贪心重调；仅预览，定稿仍回 UI 制作。
- `inspect.mts` / `kickmap.mts` / `tiptrace.mts` — 逐键诊断（前臂方向/手系/腕弯曲需求/拍头位置）、kick 分布图、tip 轨迹追踪。
- `delta-decomp.mts` — 把手系旋转种子→终态分解成 UI 手腕滑块的 flex/dev/twist delta 序列。
- `finalize.mts` / `pkgcheck.mts` — 读实时 UI 文档经 `normalizeDoc` 封装请求并验证契约/`handleRequest`；包级 `validatePosePackage` 复核。

中间稿与逐轮指标在 `evidence/forehand-study/`（`doc-*.json`、`rounds.jsonl`）。
