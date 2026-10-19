# 任务协议：切片、task brief 与 owner lane

本文是**约定规范**：流程以纯 Markdown 约定直接成立，不依赖某一家 CLI 的私有行为。`.agents/skills/` 下的 `task-slice`/`fast-review`/`final-review`/`handoff` skill 属 **规划/待实现（PR-11A 遗留）**——在落地前，本文档即规范本体。**权威分工**：brief 字段级模板与 verdict/record 契约在 [review-protocol.md](review-protocol.md) 与 [task-brief-template.md](task-brief-template.md)；本文拥有任务切片、owner lane 与运行 ledger 规则。

## 任务切片

- 较大的 issue/PR 切成有完整输入输出、独立 owner、独立验收、明确依赖的任务包；默认改动限制在单个包/模块，越界必须记入 ledger 并回到接口协调。
- 同一个热文件（`document.ts` / `rig.ts` / `WorkshopApp.tsx` 等）同一时刻只有一个协调的 owner lane；多任务都要改公共接口时，先做契约 PR 或明确 stacked PR 顺序。
- 跨包接口变更先冻结契约、安排集成 owner，再并行实现。
- 优先在现有包内拆模块交付，不新增 npm 包/submodule（issue #11「不做」）。

## Task brief

每个任务包开工前按 [task-brief-template.md](task-brief-template.md) 填 brief（可放任务私有空间或 PR 描述）；字段契约与示例见 [review-protocol.md](review-protocol.md) 及 [examples/task-slices.md](examples/task-slices.md)。

## 运行 ledger

- 任务进度、失败方案、修复轮数、验证回执、最后 head SHA 记在**任务私有空间**（worktree 内未跟踪文件或 harness 会话记录），不写回全局调查文档。
- 任务收尾只把长期有用的裁决提炼到 [../decisions/](../decisions/) 或 [../learning.md](../learning.md)；逐轮过程不进默认必读面。
- [../history/](../history/) 是冻结存档，不再追加。

## 验证回执（已实现，PR-11B）

`npm run check:affected -- --base <sha>` 输出 machine-readable receipt（`.out/check-affected/<run>/receipt.json`）：base/head SHA、工作树 clean/dirty、选中/跳过检查及 fallback 理由、命令/结果/耗时、快照一致性模型。plan-only 用每边界单次轻量捕获（`snapshotConsistency: single-collected-boundary-git-visible`，不做全仓内容 digest）；`--run` 为正式验证证据保留双采完整捕获（`double-collected-git-visible`）。Receipt schemaVersion=2；`check:full` 统一封装仍是待实现项，在此之前交付报告照旧列「已执行 / 未执行验证」清单（格式见 [review-gates.md](review-gates.md)「最终交付报告」）。
