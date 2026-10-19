# ADR-0009：知识库布局——历史冻结、单源 AGENTS、死链不许静默豁免

状态：已确认（PR-11C / issue #11 WP-1C）。

## 决定

- `docs/investigate.md` 冻结移入 [../history/investigate.md](../history/investigate.md)：完整逐轮 review 调查史保留可查，但不再是默认必读；新调查记录进任务私有空间，收尾只提炼 ADR/Learning。
- 根 `AGENTS.md` 是规范的唯一来源：硬规则、模块地图、任务/审查/验证入口；领域不变量在 [../domain/](../domain/)，流程约定在 [../engineering/](../engineering/)，按任务检索走 [../README.md](../README.md)。
- 相对链接用 `scripts/check-docs-links.mjs`（`npm run docs:check`，CI check job 已挂）做存在性检查。

## 被否 / 不做的方案

- **不创建 `CLAUDE.md` / `.claude/` / `.cursor/`**：issue 原文只把 `CLAUDE.md` 列为「必要时 `@AGENTS.md`」的可选项；多 harness 的 AGENTS 加载行为不同，复制第二套规范只会漂移。若某 harness 需要，由它自己做 `@AGENTS.md` 转发文件，仓库不维护副本。
- **不 vendor 未核实素材**修死链：`assets/source/MAKEHUMAN-LICENSE.md` 引用的 `LICENSE.CODE.md`/`LICENSE.ASSETS.md` 与 `assets/source/dynamics/*-MODEL.md` 引用的三张 `docs/images/*.png` 均为上游文件，来源/许可未核实、上游路径亦不可推定——保留链接并以带理由的 allowlist 豁免（见 `check-docs-links.mjs` 头部注释），不静默豁免、不推定 URL 改写。这是**被阻塞的验收项**：解除阻塞 = 核实上游来源后 vendor 素材或改写链接。
- **不把逐轮 review 转抄成默认必读**：history 保留全档，decisions/ 只提炼「决定 + 被否方案 + 依据指针」。

## 预留口径

- PR-11B 若落地 `check:affected`，`docs/**` 变更应映射为 `docs:check` 这一轻量检查（见 [../engineering/test-matrix.md](../engineering/test-matrix.md)）。
