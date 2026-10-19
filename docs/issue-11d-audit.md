# Issue #11 PR-11D 只读审计记录 — P2 包内模块化候选 D1–D5

- **审计基线**：`16502fa`（main，PR #12 已合并 issue #10）· 分支 `audit/issue-11d` · 只读审计，不实现
- **标签说明**：issue #11 原文没有逐字标出 "D1–D5"。其「P2 — 在 #10 热文件稳定后再做的包内模块化」节恰好含 5 个 checklist 项，且「建议 PR 划分」第 4 条把 PR-11D 定义为这些 P2 项。本文按出现顺序把 5 项记作 **D1–D5（推断映射，非原文标签）**：D1 = Document 拆分；D2 = Core 导出/纯度；D3 = 重复常量/管线；D4 = Web god files / QA；D5 = Typecheck/fixtures。
- **全局变化**：调查的「#10 并行开发、热文件冻结」前置条件已解除——#10 经 PR #12 合入（`ddeee42`/`cc6433d`/`6496f1b`/`b91ac00`/`ff43212`），其产出 `packages/motion-core/src/generate.ts`（815 行）成为新的 core 热文件，并且新增 `apps/web/src/workshop/generate.worker.ts` + `generation-protocol.ts`。凡涉及 document.ts / solver.ts / 出口面的重构仍需与 #10 后续 lane 协调，但不再被「#10 进行中」阻断。
- **实测口径**：行数用 `wc -l`；bundle 数据为本 worktree `npm ci && npm run build`（vite 7.3.7，tsc -b 含在内）产出的 `dist/assets/*` 实测；信封字节数用 `JSON.stringify(JSON.parse(...)).length` 求 8 个信封的 minified 下界。

---

## D1 — Document 拆分

**issue 主张**：`document.ts` 调查时约 850 行，混 types/schema、flatten/unflatten、contact plan/采样/compile、edit/retime、mirror、seeds；建议拆 `document/{types,schema,sampler,compile,edit,mirror,seeds}`，保持公共导出。

**当前证据**：`packages/motion-core/src/document.ts` 现 **846 行**，仍是单文件，七类职责全部在场：

| 职责 | 行区间 | 主要符号 |
|---|---|---|
| 类型/接口 | 12–66 | `V3` `HandTarget` `FootTarget` `PoseParams` `KeyConstraints` `WorkshopKey` `HandFrame` `WorkshopDoc` `DocLike` `SupportWeights` `EffectiveFrame` |
| flatten/unflatten | 85–118 | `flattenPose` `unflattenPose` `canonicalizeHands` `clonePose` |
| 通道表/接触计划/四元数工具 | 123–195 | `ANGLE_CHANNELS` `LOCK_SIDE` `unwrapAngle` `quatLn/quatExp` `contactPlan` |
| 模型构建+插值 | 196–434 | `buildModel` `supportWeight` `governingIndex` `interpolate` |
| 采样 API | 435–468 | `samplePose` `constraintsAt` `frameAt` `frameFromModel` |
| 编译缓存 | 469–528 | `freezeDeep` `CompiledMotion` `compileMotion` `frameAtCompiled` `sampleMotion` |
| 键编辑 | 530–577 | `sortedKeys` `isReleaseKey` `contactStartKey` `keyAt` `insertKey` `nearestKey` `ensureKey` |
| 序列化/schema 校验/归一化 | 578–725 | `serializeDoc` `validateDocShape` `loopBlockers` `normalizeDoc` `parseDoc` |
| 镜像 | 726–764 | `mirrorDoc` |
| 重定时 | 765–792 | `retimeKeys` `setKeyTime` |
| 种子文档 | 793–846 | `SeedControls` `readySeed/standSeed` `controlsToPoseParams` `defaultDocument` `blankDocument` `newDocId` |

被依赖面很广：core 内 `types.ts`、`protocol.ts`、`pose-package.ts`、`package-export.ts`、`quality-probe.ts`、`generate.ts`、`solver.ts`、`random-document.ts`、`motion-file.ts` 及 7 个 core 测试文件均 import './document'；web 侧 `WorkshopApp.tsx:7` 从 barrel 一次引入 14 个 document 符号。任何拆分必须维持 barrel 导出不变。

**结论**：**成立**。行数（846 ≈ 850）与职责混合度与调查一致，#10 合并未缩小该文件。

**风险与前置条件**：单文件被 ~10 个 core 模块 + web + server 直接/间接消费，拆分是纯内部搬迁，但若移动类型定义的文件归属会改变 `import type` 来源路径——必须全部经 barrel 出口兜住。`normalizeDoc`/`parseDoc` 决定请求指纹的规范形态（`protocol.ts:38-46`），搬迁不得触碰规范化输出字节。`mirrorDoc` 有 mirror∘mirror 逐字节相等契约（AGENTS.md 语义速记）。`contactPlan`/`interpolate` 属求解语义，行为变化即要求 `SERVICE_VERSION` 升版（`protocol.ts:10-20`），纯搬迁则不需要。

**建议授权实现范围**：仅在 `packages/motion-core/src/document/` 目录内做文件搬迁+re-export（`document.ts` 退化为薄 barrel 或经 `index.ts` 改指目录入口），不改任何导出符号名与语义。**行为保持门禁**：`serializeDoc`/`parseDoc`/`normalizeDoc` 输出字节不变；`mirrorDoc∘mirrorDoc` 字节相等；`compileMotion`/`frameAtCompiled` 采样结果逐帧一致（`compiled.test.ts`、`solver-baseline.test.ts`）；`SERVICE_VERSION` 不升版。

**未满足验收项**：未拆。无阻塞；#10 冻结已解除。

---

## D2 — Core 导出/纯度

**issue 主张**：`racket.ts` 的 Three.js 可视网格、`types.ts` 的 `ViewId`/`DebugOptions`、`quality-probe`/`random-document` 开发工具与主入口混杂；8 个动作信封约 255 KB 进入不必要 web chunk；sideEffects 标记为前提。

**当前证据**：

- `racket.ts`（136 行）仍含可视网格构建：`createRacket()`（racket.ts:7-24）使用 `Mesh`/`MeshStandardMaterial`/`CylinderGeometry`/`TorusGeometry`/`TubeGeometry`/`LineSegments` 等渲染材质，与纯数学 `gripFrame`/`mountRacket`/`applyGrip`/`blendGrip`（31–136）同文件。core 边界测试只禁 DOM/node 导入、允许 three（`architecture.test.ts:72`），所以这不违规，但可视网格确实是渲染关注点混入"数学库"层。
- `types.ts:6` `ViewId`、`types.ts:20` `DebugOptions` 的全部消费方都在 `apps/web`（`lab/engine.ts:15,37`、`lab/App.tsx:8,43-45`、`lab/dynamics.ts:3,141`、`workshop/engine.ts:6,61,107,467`、`WorkshopApp.tsx:19,93`）——core 内部无任何运行时消费。
- `index.ts:34-36` 把 `quality-probe`/`generate`/`random-document` 混入主 barrel。注意 tier 已分化：`generate.ts` 是 #10 产品功能（workshop worker 用），`quality-probe`/`random-document` 仍是脚本/测试工具（`scripts/measure-quality-probe.mts`、`random-document-stats.mts`、vitest）。tree-shaking 现状：探针特征串（`jerkInt`/`tipDevMm`/`forehand-detuned`/`probeDocument`）在页面共享 chunk `style-CVwCqN5s.js` 中命中 0 次——它们当前不掉进页面 chunk，混出问题是 API 面而非字节。
- 信封实测：8 个动作信封（idle/walk/reach/squat/ready/forehand/baseball-throw/punch，`motion-files.ts:2-9` 静态 import + 顶层 `normalizeMotionFile` 副作用，`motion-files.ts:15-17`）minified JSON 合计 **254,597 B ≈ 255 KB**（raw 577,133 B），与调查的"约 255 KB"几乎一致。它们进入共享 chunk `dist/assets/style-CVwCqN5s.js`（601,242 B，约占 42%），该 chunk 被 `index.html` **和** `workshop.html` 同时 `modulepreload`——工作台页不需要信封（只有 lab 经 `MOTIONS`/`MOTION_FILES` 引用：`lab/engine.ts:5-6`、`lab/App.tsx:6`），却照样下载这 ~255 KB。同一批信封还重复打进 `generate.worker-Q-KixVcm.js`（560,023 B）。
- `sideEffects`：三个包 `package.json` 均无 `sideEffects` 字段，前提仍未做。

**结论**：**成立**（数值几乎不变；偏差=探针类代码已被 tree-shake 挡在页面 chunk 外，信封字节与"不必要 chunk"判断完全复现；generate.ts 现为产品功能，不算"开发工具"）。

**风险与前置条件**：`ViewId`/`DebugOptions` 下移是类型级变更（runtime 无感），但属公共 API 面收缩——所有消费方已列全，改动面可控。`racket.ts` 拆分须保留 `mountRacket` 的镜像挂载语义（racket.ts:48-64 注释解释为什么不能从左 grip frame 重算）。信封拆 chunk 的手段（subpath `/catalog` 或动态 import）会改变 `MOTION_FILES` 的同步可得性——lab `specOf`/`engine` 多处同步读表，改异步即行为变更。标记 `sideEffects:false` 前需验证 `motion-files.ts` 顶层 normalize、`document.ts` 顶层 `LOCK_SIDE`/`freezeDeep` 等模块级副作用不依赖加载顺序。

**建议授权实现范围**：分两个独立小 PR——(a) `ViewId`/`DebugOptions` 迁 web + `racket.ts` 可视/数学分离（公共导出可经 barrel 保持不变或显式宣布 breaking）；(b) 信封出主 chunk（`/catalog` subpath 或 vite manualChunks），以真实 bundle 对比验收。**门禁**：两入口页可用、lab 动作列表 8 项（`browser-qa.mjs:14` 断言 `.motion-row` count=8）、`spec:check` golden 不变、服务端目录 `actionCatalog()` 输出不变。

**未满足验收项**：未做；`sideEffects:false` 仍是无验证前提。

---

## D3 — 重复常量/管线

**issue 主张**：球拍 tip 局部坐标常量 9 处重复；web `package-export.ts` 与 server `service.ts` 重复打包/校验；`mot_`+16 hex 规则、FPS 限值；digest 依赖注入。

**当前证据**：

- **tip 常量**：`new Vector3(0,.61,0)` 现 **10 处/7 文件**（调查时 9 处，#10 新增 `generate.ts:544`）：非测试 8 处 = `solver.ts:226`、`quality-probe.ts:261`、`generate.ts:544`、`workshop/engine.ts:293,354,381,395`、`lab/engine.ts:301`；测试 2 处 = `grip-side.test.ts:174`、`mirror.test.ts:233`（另有 `document.ts:420` 注释提"0.61 m racket lever"）。`.61` 与 `createRacket` 的几何常量 `.445+.166`（racket.ts:16,20-21）之间没有具名常量关联——改拍头几何不会同步 tip 采样点，是真实漂移风险。
- **打包/校验重复**：web 侧文件已迁入 core——`packages/motion-core/src/package-export.ts`（103 行，`buildPosePackageLocal`）。重复对 = `buildPosePackageLocal`（fps 门 76-77 → `parseDoc` 79-80 → caps 85-88 → meta+solve 89-98 → `validatePosePackage` 99-102）镜像 `service.ts` `solveMotion`（契约层 136-139 → parseDoc 162-164 → caps 167-168 → meta+solve 191-197 → schema+语义校验 202-207）。这是**有意保留的 twin**（package-export.ts:9-21,62-84 注释明示"mirrors solveMotion step for step"、死代码守卫为可读性保留），且由 `apps/server/src/package-export.test.ts` 的 peer-parity 逐字节钉死。
- **`mot_`+16 hex**：写了 3 遍——`protocol.ts:61-62`（共享 `artifactId` 同步 digest 助手已存在）、`package-export.ts:91`（async 内联）、`service.ts:86-87`（自有 wrapper，未复用 protocol.artifactId）。
- **FPS 限值分散**：schema `motion-request.schema.json:75` max 60、`pose-package.schema.json:142` max 240；代码 `package-export.ts:52` {1,60}、`service.ts:18` {maxFps:60,defaultFps:40}、`validate.ts:148` ≤240、`package-inspect.ts:47,58` ≤240、`generate.ts:284` 1..240、UI `WorkshopApp.tsx:545` clamp 1..60。
- **digest DI**：已实现——`Digest`/`subtleDigest`/`PackageEnv.digest`（package-export.ts:24-42），服务端 `sha256`（rig-manifest.ts，node:crypto），并有 `subtleDigest`↔`node:crypto` 字节对等测试（package-export.test.ts:45-46）。

**结论**：**部分成立**。常量与限值重复完全成立（tip 10 处）；打包重复成立但属有意 twin 且有对等门禁；digest DI 一项调查后已落地，此子项过期。

**风险与前置条件**：抽公共常量（如 `RACKET_TIP_LOCAL`）落点只能是 core（web 两处 import 它），纯改名不改值无风险但需全量替换 10 处包括测试。统一 fps 限值必须区分两个域：请求契约 ≤60（schema+service+UI 三面绑定）与包/探针 ≤240（validate/inspect/generate），合并常量时不能把一个限值误套到另一个域——`generate.ts:284` 的 240 上限与请求侧 60 不是同一语义。折叠 twin 的最大风险是门禁顺序与错误体措辞：service 先契约后 parse、local 先 fps 后 parse，parity 测试只保证**给定输入**字节相等，不保证所有错误路径措辞一致（package-export.ts:16-20 自述"phrases rejections in its own words"）。

**建议授权实现范围**：(a) `racket.ts` 导出 `RACKET_TIP_LOCAL` 常量并替换 10 处引用（含测试）；(b) `service.ts` 改调 `protocol.artifactId` 消掉第三处 `mot_` 写法；(c) fps 域常量归并到 `limits.ts`（保持两域分开命名）。**不建议**在本主题内合并 twin 管线——parity 门禁允许存在双实现。**门禁**：peer-parity 测试（`package-export.test.ts`）、`spec:check`、artifact id 不变（`mot_` 规则字节不动）。

**未满足验收项**：tip 常量仍散；`mot_` 规则三处；fps 限值未收敛（但语义分散属事实而非缺陷，需谨慎合并）。

---

## D4 — Web god files / QA

**issue 主张**：拆 `WorkshopApp.tsx`、`workshop/engine.ts`、`browser-qa.mjs` 职责；收敛场景初始化重复；保留拖动、撤销、刷新持久化、导出与回放的真实验收。

**当前证据**：

- `apps/web/src/workshop/WorkshopApp.tsx` **678 行**：内嵌子组件 `Row`/`Slider`/`WristPanel`/`Timeline`（40-82）+ 主组件 ≥15 组 `useState`（88-234）混有：键编辑面板、时间线拖动、库管理（`MotionLibrary`）、撤销/重做（`HistoryBook`）、视频同步（116）、姿态包导出（360 `buildPosePackageLocal`）、GLB 导出、#10 新增的候选生成 UI（`CandidateSession`/`GenerationProgress`/`metricLabels` 28-38 + worker 协议）。
- `apps/web/src/workshop/engine.ts` **657 行**：onion 幽灵帧工具（14-54）、固定机位渲染导出契约（55-100）、姿态编辑器场景类（102-657：renderer/相机/灯光 164-179、拖动 handle、`solveCurrent` 335、轨迹 paths、resize 475、dispose 644）。
- `scripts/browser-qa.mjs` **607 行**单脚本：lab 段（14-61：8 动作、视角、debug 开关、播放/速度/seek/orbit/资料对话框/采样/移动端截图/MediaRecorder 录制）→ 服务拉起+姿态包 E2E（62-100）→ 工作台拖拽持久化（104-137）→ 双端导出对等（138-206）→ GLB 导出（213-232）→ foot height/waypoint/onion/渲染导出段（至 ~607）。硬编码 `127.0.0.1:5173`/`:8788`，证据写 `evidence/`——与 issue 其它 WP 的端口/证据隔离要求也相互牵连。
- **场景初始化重复**：`lab/engine.ts:58-70` 与 `workshop/engine.ts:165-179` 近乎逐行相同（`WebGLRenderer{antialias,preserveDrawingBuffer}`、同色温 Hemisphere+Ambient、`DirectionalLight` key 0xfff6ec/4.2 + shadow 2048 同参数、fill 0xc3d9ff/2、`OrbitControls` damping .08 + 极角限制、`ResizeObserver`→`resize`），两处 `resize()`（lab:314 / workshop:475）与 dispose 遍历释放几何体（lab:332）也同构。

**结论**：**成立**（文件均未拆分且 workshop 侧因 #10 生成 UI 继续膨胀）。

**风险与前置条件**：`WorkshopApp` 拆组件须保 `data-testid`/ARIA 标签（`browser-qa.mjs` 用中文 aria name 定位开关/按钮，如 `'骨骼与关节'`、`'球拍运动轨迹'`），文案改动即断 QA。engine 抽场景初始化公共件会同时动两个入口页，须保两页视觉基线（evidence 截图 review 流程）。`browser-qa.mjs` 分段重构不能破坏其顺序依赖（服务在 workshop 段仍在跑，mjs:102 注释明示）。

**建议授权实现范围**：按文件各自一个 PR——(a) `WorkshopApp.tsx` 抽出 Timeline/生成面板/导出块为子组件文件；(b) `workshop/engine.ts` 抽 capture-export 与 onion 为模块；(c) lab/workshop 公共场景初始化提取；(d) `browser-qa.mjs` 分段为可独立运行的 section 模块。**门禁**：`npm run qa` 全绿（真实拖拽/撤销/持久化/导出对等/回放逐项保留）、两入口页 aria/testid 不变、evidence 截图语义不漂移。

**未满足验收项**：未拆；QA 端口仍硬编码（与 #11 WP-0C 端口隔离项重叠，实施时需协调归属）。

---

## D5 — Typecheck / fixtures

**issue 主张**：每包独立 TS 配置（core `lib:["ES2022"]` 防 DOM 泄漏）；共享 rig fixture 避免重复 GLB 读取；build/project references 先证收益再加。

**当前证据**：

- 全仓仅 `tsconfig.json` 单根配置，`lib:["ES2022","DOM","DOM.Iterable"]`、`include: apps/*/src + packages/*/src + tests`——core 源码与 web 同一 DOM 环境下 typecheck，DOM 泄漏只能靠 `tests/architecture.test.ts` 的 AST 扫描在**测试期**拦截（`collectDomUses`/`core-dom` 规则），`npx tsc -b` 本身不会拒绝 core 里的 `window`。无 per-package tsconfig、无 project references（`tsc -b` 作用于单个非 composite 配置）。
- **fixture 重复**：**15 个测试文件**各自 `fs.readFileSync('public/models/human.glb')` + `new GLTFLoader().parseAsync(...)` 内联加载：core 7（compiled/generate/grip-side/kinematics/quality/regressions/solver-baseline/solver-hints——实际 8 个）、web 3（motion-source/mirror/workshop）、server 3（glb-export/package-export/property）、tests/bench.test.ts；无共享 fixture 助手（`tests/` 仅 architecture-boundaries + bench；`scripts/lib/` 只有 filereader-shim 环境 shim）。
- project references 收益：本次审计未做 profile——**无法证实**，维持 issue 的"先证收益"门槛。

**结论**：**成立**（结构事实）；project references 收益**无法证实**（未测量，按 issue 要求本就不应先行实施）。

**风险与前置条件**：给 core 独立 `lib:["ES2022"]` 配置会让现有 core 文件里的类型依赖显形（如 `crypto.subtle`、`TextEncoder`、`structuredClone` 等 DOM/共享环境 API 的类型来源），可能需要 `lib:["ES2022","WebWorker"]` 或局部 `/// <reference>`——属低风险但需逐一确认编译仍绿。共享 fixture 若缓存同一个 `HumanRig`/`Skeleton` 实例会引入测试间状态污染——必须每次返回新 rig 或明确只读契约（多测试依赖 `attachRacket`/姿态变更，`kinematics.test.ts`/`mirror.test.ts` 都 mutate）。vitest 并行语义下 fixture 模块的 `beforeAll` 作用域是每文件独立模块图，缓存收益有限——可用 `vitest --reporter` 计时或抽查 parseAsync 耗时先证收益。

**建议授权实现范围**：(a) `packages/motion-core/tsconfig.json` 独立 `lib` 收紧 + 根 `references` 仅在编译时间实测有收益时才加；(b) `tests/` 或 `scripts/lib` 新增 `loadRigFixture()` 助手，逐文件替换 15 处内联加载（保持每测新实例）。**门禁**：`npx tsc -b` 与 `npm test` 全绿；架构边界测试保留且先于/独立于 tsconfig 生效；不得为通过 DOM-free 编译而给 core 加 DOM 类型声明。

**未满足验收项**：per-package tsconfig、共享 fixture 均未做；references 收益未证。

---

## 汇总

| 项 | 结论 | 一句话 |
|---|---|---|
| D1 | 成立 | document.ts 846 行七类职责，拆分候选有效 |
| D2 | 成立 | 信封 ~255KB(254,597B) 进共享 chunk 被工作台页白下载；racket 可视网格/ViewId/DebugOptions/开发工具混入仍在 |
| D3 | 部分成立 | tip 常量现 10 处、twin 管线与 mot_×3、fps 散布仍在；digest DI 已落地（子项过期） |
| D4 | 成立 | 678/657/607 行 god files + 场景初始化逐行重复 |
| D5 | 成立（references 收益无法证实） | 单根 DOM lib tsconfig、15 处重复 GLB 读取 |

**需后续授权实现清单**（每项独立 PR，均满足行为保持门禁：SERVICE_VERSION/artifact id/golden/双端字节对等/命令与入口页不变）：

1. D1：`document/` 目录内搬迁+barrel 保持导出。
2. D2a：`ViewId`/`DebugOptions` 迁 web、`racket.ts` 可视/数学分离；D2b：信封出共享 chunk（subpath `/catalog` 或 manualChunks，以 bundle 对比验收）；`sideEffects:false` 标记前先验证。
3. D3a：`RACKET_TIP_LOCAL` 统一 10 处；D3b：`service.ts` 复用 `protocol.artifactId`；D3c：fps 两域常量归并 `limits.ts`（不合并语义）。
4. D4a–d：WorkshopApp 子组件化 / workshop engine 模块拆分 / 场景初始化公共件 / browser-qa 分段——各自独立 PR，保 aria/testid 与 QA 顺序依赖。
5. D5a：core 独立 tsconfig 收紧 lib；D5b：`loadRigFixture()` 共享助手（每测新实例）；references 先 profile。

**审计验证范围**：静态读码 + `wc -l`/grep 定位 + `npm ci && npm run build` 实测 dist 字节。未跑 `npm test`/`spec:check`/`qa`（只读审计无代码变更，build 已含 `tsc -b` 通过）。dist/ 与 node_modules/ 为 gitignored 产物，本审计唯一入库写入为本文件。

---

## 外部审查附记（issue #11 四 PR 联审，归档于合并时）

- **Verdict：PROCEED（可合并）**。审查确认本文件只做实施前调查：未提前拆 `document.ts`、未改 core exports、未搬 web 组件——边界合适。
- **不得视为 P2 实施完成**。本记录对应 issue #11「建议 PR 划分」第 4 条的前置审计；D1–D5 是否实施及顺序应结合 #11 的性能目标重新排序——`document.ts` 846 行本身不是性能问题，是否立即拆取决于它实际造成的 Agent 冲突、上下文消耗与返工量。
- 审查完整记录（含 #15/#16 返工项与集成注意）见 `docs/history/issue-11-pr13-16-review.md`（由 PR #13 引入）。
