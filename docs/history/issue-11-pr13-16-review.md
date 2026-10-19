# Issue #11 · PR #13–#16 外部审查记录

> 归档于合并时。审查对象为 issue #11 四条实施 PR（#13 文档知识库 / #14 P2 审计 / #15 CI 与隔离 / #16 affected-checks 选择器）。审查标准即 issue #11 自定义的目标循环：优先发现影响正确性、隔离性、验证可靠性与合并安全的缺陷，不挑风格。

## 跨 PR 集成发现（最先确认）

- **#16 实际建立在 #15 之上，但 base 是 `main`**：#15 head `dd3afb6`、#16 head `8a2b316`，GitHub comparison 确认 #16 恰领先 #15 一个提交且无分叉。#16 显示的 ~4900 行 diff 含 #15 基础设施。
- **处置**：#16 base 改到 `issue-11/a1-ci-isolation`，只评审选择器自身差异；#15 合并后再改回 `main`。

## 各 PR 判定

| PR | 交付 | Verdict | 要点 |
|---|---|---|---|
| #13 文档知识库 | AGENTS 分层、domain、ADR、docs:check | **PROCEED** | 无阻断；与 #15 有集成点（见下） |
| #14 P2 审计 | `docs/issue-11d-audit.md` 只读调查 | **PROCEED** | 审计 ≠ P2 实施；后续按 issue 性能目标重排优先级 |
| #15 CI 与隔离 | Draft/Ready CI、worktree/端口/QA 隔离 | **REWORK** | QA 可能复用其他 worktree 的服务进程；workspace link 校验不严格 |
| #16 affected checks | 选择器、依赖扫描、验证回执 | **REWORK** | docs-only 触发六项全量；快照采集次数过多；与 test-matrix 风险矩阵不统一 |

## #15 必修项

- **QA 静默复用外部服务**（`scripts/browser-qa.mjs` ~73–94）：先打 `/v1/capabilities`，通了就直接用——另一 worktree 占 8788 时 QA 会"成功"但打的是别人的代码。改法：默认独占（端口被占即失败）；允许外部服务须显式 opt-in 且验证服务身份。
- **workspace link 校验不严**（`scripts/lib/worktree-check.mjs` `validateWorkspaceLinks()`）：只查链接目标在 worktree 内，没查指向正确包目录（`@human3d/motion-core → apps/web` 也能过）。改法：逐包核对解析路径与 manifest 包名，加"指向本 worktree 内错误目录"负向测试。
- **验收缺口（非代码 bug）**：`ci-lifecycle.md` 自述 Draft→Ready 事件未真实复演、branch protection 未验证——issue 该部分验收保持"待完成"如实记录；"QA 输出原子发布"与实际仍用 `writeFileSync` 的调用方口径需对齐（修正宣称或补原子写）。

## #16 必修项

- **docs-only → 六项全量**：`scripts/lib/affected-checks.mjs:226-283` 把 `\.mdx?$` 映射到 `fullFallback`（fast/spec/vitest/build/dynamics-validate/dynamics-test），且 `tests/affected-checks.test.ts` 将其断言为预期——测试钉死了 bug。违背 WP-1A「无关文档变更不会执行全量编译」。改法：新增 `docs` 检查分类，接 #13 的 `npm run docs:check`；混改时取并集；同步更新正/负向测试。
- **快照开销**：`check-affected.mjs` 每快照边界两次采集、`trackedContentDigest()` 全量哈希；plan-only ≥4 次全量采集，全六项可达 18 次。改法：先实测三场景（纯文档/单 TS 文件/core solver）端到端耗时、选择器自身与检查耗时分列；plan-only 不做接近全仓扫描的采集，完整证明留给执行阶段。
- **风险矩阵不统一**：#13 `test-matrix.md` 定 `docs/** → docs:check`，#16 六项无此检查且另起分类规则。改法：单一权威映射源，测试保证文档与选择结果一致。
- **复杂度预算**：#16 已约 2000 行检查执行与状态证明系统；review 建议把「选择器耗时占反馈循环比例」列入硬验收，不再扩大防御性逻辑。

## #13 集成注意（合并时执行）

- #15 重写 test.yml——最终合并结果中 `full` job **必须保留 `docs:check`**，否则本 PR 门禁在集成时丢失。
- #15 新增 `docs/engineering/review-protocol.md`，与本 PR 的 `review-gates.md`/`task-protocol.md` 内容域重叠——合并后统一入口与权威关系（维护建议，非阻断）。

## CI 核验（各 PR head 当时）

| PR | 结论 | 说明 |
|---|---|---|
| #13 | Success | docs:check 所在 workflow 成功 |
| #14 | Success | — |
| #15 | Success | fast/full/dynamics/required 全成功 |
| #16 | Success | 同上 |

外部审查的说明：CI 绿只证当前配置可运行，不证负向场景被覆盖——#16 的文档全量回退恰被其测试断言为预期行为。

## 处置记录

- #13/#14：本记录归档后合并。
- #15：Rework 修复两项 P1（QA 服务独占/link 校验）后重推；Draft/Ready 事件矩阵与原子写口径如实记录。
- #16：base 切到 #15 分支 → 修 docs-only 回退 + 快照开销 + 矩阵统一 → 复审差异。
- 最终：两个独立 worktree 真实联调（一改代码跑服务、一跑 QA）证明无误连/无污染，再核 head SHA 的 required CI。
