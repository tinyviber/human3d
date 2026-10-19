# 任务协议：切片、task brief 与 owner lane

本文是**约定规范**：流程以纯 Markdown 约定直接成立，不依赖某一家 CLI 的私有行为。`.agents/skills/` 下的 `task-slice`/`fast-review`/`final-review`/`handoff` skill 属 **规划/待实现（PR-11A）**——在落地前，本文档即规范本体。

## 任务切片

- 较大的 issue/PR 切成有完整输入输出、独立 owner、独立验收、明确依赖的任务包；默认改动限制在单个包/模块，越界必须记入 ledger 并回到接口协调。
- 同一个热文件（`document.ts` / `rig.ts` / `WorkshopApp.tsx` 等）同一时刻只有一个协调的 owner lane；多任务都要改公共接口时，先做契约 PR 或明确 stacked PR 顺序。
- 跨包接口变更先冻结契约、安排集成 owner，再并行实现。
- 优先在现有包内拆模块交付，不新增 npm 包/submodule（issue #11「不做」）。

## Task brief 模板

每个任务包开工前写 brief（可放任务私有空间或 PR 描述）：

```text
- task_id：                  唯一标识（如 PR-11C）
- goal：                     一句话目标
- base SHA：                 实现基线（审查与验证都锚定它）
- worktree / branch：        隔离位置（见 worktree-policy.md）
- 权威来源：                  issue/spec/文档指针
- 允许修改范围（owner lane）：路径白名单
- 输入契约：                  依赖的接口/不变量
- 输出契约：                  交付物形态
- 禁止变更：                  不得触碰的行为/文件/协议项
- 验收样例：                  可复演的判定标准
- 所需的局部测试：            实现期必须跑的最小集合
- 需要由集成层完成的测试：    本地不跑但必须有人跑的项目
- 依赖与风险：                前置任务、热文件冲突、偏差记录
- 超范围处理：                发现 brief 外问题时的处置（记 ledger / 另立任务）
```

## 运行 ledger

- 任务进度、失败方案、修复轮数、验证回执、最后 head SHA 记在**任务私有空间**（worktree 内未跟踪文件或 harness 会话记录），不写回全局调查文档。
- 任务收尾只把长期有用的裁决提炼到 [../decisions/](../decisions/) 或 [../learning.md](../learning.md)；逐轮过程不进默认必读面。
- [../history/](../history/) 是冻结存档，不再追加。

## 验证回执（规划/待实现，PR-11B）

`check:affected` 的 machine-readable receipt（base/head SHA、工作树 clean/dirty、选中/跳过及理由、命令/结果/耗时、未执行风险）落地前，回执由 task brief + PR 描述中的「已执行 / 未执行验证」清单手工承担——格式见 [review-gates.md](review-gates.md)「最终交付报告」。
