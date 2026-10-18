# 架构：npm workspaces 三包

状态：已实施（PR #9）。迁移是**结构性、行为不变**的——插值、IK、姿态协议与制品身份一律未动；验证证据见文末。

## 为什么拆

拆包的理由不是运行性能，而是 human3d 已经出现模块职责混杂：

- `packages/motion-core/src/package-export.ts` 曾 import `../server/validate`——浏览器代码反向依赖 server 目录；
- `apps/server/src/service.ts` 曾 import `../workshop/document`、`../workshop/limits`——服务端依赖工作台目录；
- `server/validate.ts` 是客户端与服务端**共用**的交付包语义校验器，不属于服务端独有；
- 于是文件夹名称不再对应架构边界：Agent 难以限定负责范围，局部测试无法按边界组织，未来 C++/WASM 也没有可替换的数值核边界。

## 结构

依赖方向单向：**web / server → motion-core**。

```
apps/web  @human3d/web ─┐
                        ├─→ packages/motion-core  @human3d/motion-core
apps/server @human3d/server ─┘
```

| 包 | 拥有 | 边界规则 |
|---|---|---|
| `packages/motion-core` | `document.ts`（WorkshopDoc 采样器）、`solver.ts`（FK/IK 求解与合理性检查）、`kinematics/rig/hand-frame/racket`、`protocol/pose-package/package-inspect/package-const`、`motion-file(s)/motions/muscle-action/semantic-map`、`validate.ts`（交付包语义校验）、`quality-probe/random-document`、`package-export`、`glb-export`（子路径 `@human3d/motion-core/glb`） | **纯**：不得 import DOM / node 模块；three 只作数学库；跨包消费者一律从包名导入，不写深路径 |
| `apps/web` | `src/lab/`（实验室引擎 `engine.ts`、动力学回放 `dynamics.ts`、React 面板）、`src/playback/`（播放源 `motion-source.ts` + `PoseFade`）、`src/workshop/`（场景 `engine.ts`、`WorkshopApp.tsx`、`library.ts`、`history.ts`）、两个入口页与 `vite.config.ts` | 可 import motion-core；生产代码不得 import `@human3d/server`（仅测试用其 devDependency） |
| `apps/server` | `serve.ts`（loopback HTTP，`node:http`）、`service.ts`（目录 / 求解编排 / 幂等）、`contract.ts`（Ajv 严格编译 `spec/`）、`rig-manifest.ts`（node:crypto 身份哈希）、`errors.ts` | 可 import motion-core；不得 import web |

测试按"最高依赖"落位：core 6 / server 6 / web 3 个测试文件。core 的测试可读夹具（`node:fs`），生产代码不行。

路径不变的部分：`assets/motions/*.json` 仍是工具链与文档使用的注册表路径（motion-core 以相对路径静态导入）；`spec/` 由 `apps/server/src/contract.ts` 以 `import.meta.url` 相对定位；`public/` 与 `dist/` 仍在仓库根（Vite `publicDir`/`outDir` 指过去，`server.fs.allow` 覆盖仓库根以便 `/@fs/` 提供工作区源码）。

命令入口不变：`npm run dev|build|preview|test|spec:check|service|protocol:example|package-to-glb|qa` 都在仓库根执行，`dev|build|preview` 委派给 `@human3d/web`。

## 迁移裁决

- **不按 `server / workshop / ui` 三个目录拆**：那只是把现有目录名升格，边界仍然错。按**依赖方向**切：能被两个应用共用的纯域 → motion-core；场景与 DOM → web；传输与 node 设施 → server。
- **`validate.ts`、`package-export.ts`、`glb-export.ts`、`quality-probe.ts`、`random-document.ts` 进 core**：它们都有非 Web 消费者——`scripts/package-to-glb.mts`（Node）用形状校验与 GLB 导出，CLI 用质量探针，测试用随机文档生成器。这样 `core → server` 的反向依赖自然消失。
- **`motion-source.ts` 一分为二**：`checkPosePackageShape` / `posePackageSpec` / `rigMatches` 有 Node 消费者 → core 的 `package-inspect.ts`；`ClipSource/DocumentSource/DynamicsSource/PosePackageSource/PoseFade` 是 three 场景绑定的播放实现 → web。
- **`core/engine.ts`、`core/dynamics.ts` 归 web**：它们是实验室的 Three.js 场景与动力学回放渲染器，不是运动域。
- **`assets/motions/` 留在仓库根**：Python 工具链（`new-muscle-action.py` 等）、10 处文档与契约测试共用该路径；把它移进包会把"结构性迁移"变成跨工具链迁移。这是**已知边界泄漏**，见下。
- **phase 1 不引入 Project References**：`composite` 强制 declaration 产出，会改动 `tsc -b` 门禁语义；先用"一个根 tsconfig 覆盖所有包 + 包名导入边界"，风险最小。
- **不引入 pnpm / Turborepo / Changesets**：npm 原生 workspaces 已足够管理三个本地包。

被否决的备选：① 按现有目录名拆包（边界错）；② 拆成 4–5 个包（含独立 `@human3d/protocol`——单独协议包只增加需要同步维护的构建配置）；③ 立即引入 Project References；④ 把 `assets/motions` 移进包；⑤ 把 lab 与 workshop 拆成两个 Web 应用（两者共享 Rig、渲染技术与姿态包回放，且仍是同一网站的两个入口；等 Workshop 变成独立桌面应用或 Lab 需要独立部署时再议）。

## 验证与证据

迁移提交（`refactor(workspaces)!`）逐项验证了四条既有约定，另加三层：

| 契约 | 证据 |
|---|---|
| 浏览器与服务端姿态包逐字节一致 | `npm run protocol:example` 重生成 `spec/examples/idle.pose.json` 无差异 |
| solver revision 与 artifact id 不变 | `SERVICE_VERSION 0.4.0`、`mot_c67dda30d91962fd` 不变；`npm run package-to-glb` 输出同一 id；`GET /v1/capabilities` 实测 |
| 两个 Vite 页面可用 | dev 与 preview 下 `/`、`/workshop.html` 均 200 |
| 原有 `npm run` 命令可用 | 逐条实测（见上"命令入口不变"） |
| 门禁 | `tsc -b` ✓ · `npm test` 260/260 ✓ · `spec:check` 19/19 ✓ · `build` ✓（JS 合计 723.85 kB vs 迁移前 723.76 kB，仅 chunk 归属变化） |
| 浏览器 E2E | `QA_BROWSER_CHANNEL=chrome npm run qa` 22 项 checks 全 true、errors/warnings 空 |
| 求解零漂移 | 240fps 质量探针全量重跑：6 个动作与提交基线逐值相同（仅补上报告早已存在但基线未重生成的 `armReachResidual.side` 字段） |
| 结构自检 | core 不 import apps ✓；core 生产代码无 `node:`/DOM ✓；web 生产代码不 import server ✓；server 不 import web ✓；无 `@human3d/*/src/` 深路径导入 ✓ |

## 自动化边界检查

`tests/architecture.test.ts` 把上表的边界变成可执行断言，随 `npm test`（与 CI）运行——文档与一次性扫描守不住多 Agent 并行编辑：

1. `packages/motion-core` 生产代码不得 import `node:`、不得使用 DOM 全局（`window`/`document`/`localStorage`/`navigator`/`createImageBitmap` 等）、不得 import 两个 app；包外相对路径仅允许 `assets/motions/*.json`；
2. `apps/web` 生产代码不得 import `@human3d/server`（测试可用，其 devDependency 已声明）；
3. `apps/server` 不得 import `@human3d/web`；
4. 任何文件不得使用 `@human3d/<pkg>/src/...` 深路径导入；
5. 每个 `@human3d/*` 导入都必须在导入方 `package.json` 的 dependencies/devDependencies 里声明。

检查器按注释/字符串剥离后再扫描 DOM 全局（避免注释里的 "window." 误报），并跳过对象/类型键位置（`{document: WorkshopDoc}` 是数据不是 DOM）。**负向对照已实测**：向 core 注入 `node:fs` 与 `window`、向 web 注入 `@human3d/server` 与深路径导入，四类违规全部被报出且带文件与说明；撤销后恢复全绿。

## 已知泄漏与后续阶段

- **边界泄漏**：motion-core 以相对路径读取仓库根 `assets/motions/*.json`。phase 2 可选：把信封数据移进包内，或让 Python 工具链写包内路径。
- **包内仍平铺**：只做包边界，未按 `document/ solver/ protocol/` 再分子目录——压低 diff 与风险。
- **phase 2 候选**：从 motion-core 拆出 `@human3d/protocol`（schema/类型/协议常量）；引入 Project References 做模块级增量类型检查；把 `package-inspect` 与播放源再细分；根入口之外提供少量子路径入口（`/solver`、`/protocol`、`/catalog`），避免只想取求解器的消费者连带求值动作目录（`motion-files.ts` 会静态导入并归一化全部内置信封）——**只在 profile 或具体消费者需要按需加载时再做**。
- **phase 3**：把 `document`/`solver`/`kinematics` 的数值核迁到 C++/WASM。现在它们已在一个无 DOM/node 的包里，替换实现时 web 与 server 都不用动——这也是把这项重构排在 WASM 之前的原因。

## 维护规则

- 新增模块先问"谁在用"：两个应用都用 → motion-core；只有 web → `apps/web`；只有服务端 → `apps/server`。
- 跨包只能 `from '@human3d/motion-core'`（或 `/glb` 子路径）；包内保持相对路径。
- core 的新代码不得引入 `node:`、DOM 或除 three 之外的重依赖。
- 改动求解语义必须同步 `SERVICE_VERSION`（见 `protocol.ts` 的说明）——与拆包无关的既有规则，此处重申。
