# forehand-study 制作链（WP-C）

`spec/examples/forehand-study.request.json` 的**重制入口**：验收账本见 `spec/examples/forehand-study.md`。非日常命令，不进 CI。

- `drive.mjs` — 工作台真实 UI 写路径回放器：`node scripts/forehand-study/drive.mjs ops.json <out.doc.json>`（需 dev server :5173，默认系统 Chrome，`QA_BROWSER_CHANNEL` 可覆盖）。所有文档改动走面板滑块/字段 input 事件与画布真实指针拖拽，不注入姿态数据。
- `ops.json` — 上述回放配方（重命名/时长/逐键时刻/躯干滑块/双手拖点/手腕 delta 序列）。

逐轮指标快照在 `evidence/forehand-study/rounds.jsonl`（`final-240`/`final-60` 为定稿读数），中间稿为 `evidence/forehand-study/doc-*.json`。重新测量任意文档走共享探针 CLI：`npx tsx scripts/measure-quality-probe.mts [fps] [motion|all]`（与 `src/workshop/quality.test.ts` 同源实现）。
