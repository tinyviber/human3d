# Worktree 隔离与资源约定

**约定规范**：自动化校验已由 `npm run worktree:check -- --source-root <源 checkout> [--worktree-root <worktree>]` 提供（PR-11A 已落地）：worktree 路径边界、workspace link 解析到本 worktree 声明的包目录、端口独占检查。以下条款由任务流程与该脚本共同执行。

## 隔离规则

- 一任务一 worktree、一分支；优先仓库外 worktree。若用仓库内目录（如 `.claude/worktrees/`），必须 gitignore 且明确排除出测试发现范围。
- 任何 checkout 不得共用可写 build/QA 产物：`dist/`、`evidence/`、QA 截图录屏都是 per-worktree 状态。
- worktree 建立后在**自身根目录** `npm ci`，并校验 `node_modules/@human3d/*` 解析到本 checkout 的 workspace——不要默认同名包解析正确（曾发生 in-repo worktree 把 `@human3d/*` 解析到主 checkout 的串线）。
- Vitest 发现范围必须排除其他 worktree、`dist/` 与临时产物；`npm test -- <path>` 定向时显式给本 worktree 内路径。
- Vite dev（默认 5173）与 motion 服务（8788）端口不静默复用别的 Agent 进程：端口被占要明确失败而不是悄悄换端口（约定用 vite `strictPort` 之类显式锁端口；当前 `vite.config.ts` 尚未设置，属待落地项）；并行任务用环境变量分开端口。
- QA 输出写任务私有的未跟踪路径；只有显式动作（如 `--update-evidence` 口径）才把结果写回入库基线 `evidence/`。
- 不 push 远端、不动分支保护、不动其他分支，除非 brief 明确授权。

## 资源受限机器

- 支持定向单 worker：`npm test -- <file> --maxWorkers=1 --no-file-parallelism`。
- 不要求每个 worktree 都在本机并行跑全部 build/QA/dynamics；重型验证可按 [review-gates.md](review-gates.md) 移交 CI/其他机器，但必须记录为「未执行」。

## 已知串线事故（历史记录，防复发）

- in-repo worktree 曾把 `node_modules/@human3d/*` 解析到主 checkout、Vitest 扫进别的 worktree 的测试、QA 硬编码 5173/8788、证据直接写 `evidence/`——启动新 worktree 后先核对这四点再开工。
