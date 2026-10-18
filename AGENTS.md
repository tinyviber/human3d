# AGENTS

## 调查与经验记录

- **PR #1 完整调查记录**：[`docs/investigate.md`](docs/investigate.md) —— Motion protocol v1 + 工作台的四轮 review 历程、每个问题的提案、被否方案的证据、最终确认的实现与测试。
- **跨任务通用规则**：[`docs/learning.md`](docs/learning.md) —— 从上述历程沉淀的十条工程规则（轨迹形态断言、哈希绑定真实数据、转换事件语义、真实路径测试、UI 可写性、显示/编辑分离、死数据提示、边界等式契约、契约兑现、真实交互 E2E）。

在修改运动服务、工作台、姿态包相关代码前，请先读这两份文件：investigate.md 解释了现有语义为什么长这样，learning.md 解释了哪些错误模式已被 review 抓过。

## 项目验证命令

- `npx tsc -b` — 类型检查（CI 门禁）
- `npm test` — vitest（165 项，CI 门禁）
- `npm run spec:check` — 契约测试：Ajv 严格编译、OpenAPI 与服务一致、golden 样例（CI 门禁）
- `npm run build` — 生产构建（CI 门禁）
- `npm run qa` — 浏览器 E2E（需先 `npm run dev`；无本地 Playwright 浏览器时用 `QA_BROWSER_CHANNEL=chrome npm run qa` 走系统 Chrome；未进 CI）
- `npm run protocol:example` — 重生成 `spec/examples/idle.pose.json`
- `npm run package-to-glb -- <in.pose.json> [out.glb]` — 姿态包转二进制 glTF（与浏览器「导出 GLB」共用 `src/core/glb-export.ts`）
- `npm run service` — 本地 Motion Protocol v1 服务（127.0.0.1:8788）
- `npm run dynamics:validate`、`npm run dynamics:test` — 动力学资产与物理记录校验，需要 Python 3.13 与 `scripts/requirements-dynamics.txt`（CI 门禁）
- `npx tsx scripts/measure-motions.mts` — 测量内置动作的语义峰值，用于阈值校准（见 `docs/validation.md`）

## 关键语义速记

- 支撑脚是**接触区间**：`plant=true` run 首帧的存储脚位定义接触点，后续锁定帧的存储脚位被忽略。
- 离地帧（`plant=false` 紧跟支撑）时刻脚仍在接触点，其存储脚位是**后续区间的摆动中点**；贴地存储 = 有意拖步。
- 姿态包 `timestamps.at(-1) === duration` 恒成立；包 `id` 是制品身份（请求指纹 + 定义 + rig + solver 哈希），`provenance.requestFingerprint` 是请求身份。
- 工作台「导出姿态包」≡ 同文档 `POST /v1/motions` 响应：共享 `buildPosePackageLocal`/`solveWorkshop`/`validatePosePackage` 路径，对等测试逐字节钉死；GLB 为派生品不承载身份契约——`animations[0].name` 与文件名都借用制品 id 便于对应，非内容寻址声明。
- 实验室打开姿态包经 `posePackageSpec` 派生 spec：bundled 包按 `action.id` 取信封（capabilities/name/phases），adhoc 包读 `action.parameters.presentation`（`documentName`/`prop`/`loop`）；v2 包不携带逐帧握拍量，道具按包级 hint 常量显示（`wantsProp` 上限）。

## 测试与验证策略

### 基本原则

- 根据改动范围、失败风险和机器资源选择验证级别。
- 不要求每次修改后都运行全量测试、生产构建或浏览器 E2E。
- 优先运行能够直接验证本次改动的最小测试集合。
- 测试通过不等于整个项目通过，必须准确报告验证范围。
- 不允许以节省资源为理由忽略已发现的失败。

### 验证级别

**Level 0：文档或非执行性修改**

仅修改 Markdown、注释等不影响运行行为的内容时，检查 diff 即可，无需执行构建和测试。

**Level 1：局部实现**

修改独立函数、UI 局部逻辑、插值计算等模块时：

- 运行直接相关的 Vitest 测试。
- 行为发生变化时，新增或更新对应测试。
- 若涉及 TypeScript 类型或接口，执行 `npx tsc -b`。
- 默认不运行全量测试或浏览器 E2E。

**Level 2：跨模块或公共接口**

修改共享类型、状态流、数据格式或模块间契约时：

- 运行所有受影响模块的测试。
- 执行 TypeScript 类型检查。
- 涉及构建配置或打包行为时，执行 `npm run build`。
- 根据实际影响决定是否扩大测试范围。

**Level 3：高风险与端到端行为**

修改 Motion Protocol、骨骼运动语义、IK、动力学、持久化或关键交互路径时：

- 必须验证受影响的真实实现路径。
- 根据改动补充集成测试或端到端测试。
- 不能用 mock 测试代替真实协议或交互验证。
- 资源不足时，允许把重型验证交给 CI 或其他机器，但必须记录尚未完成的验证。
- 关键验证完成之前，不得宣称功能已完整验证。

### 执行规则

- 优先运行定向测试：`npm test -- <test-file>`
- 低资源环境中使用：`npm test -- <test-file> --maxWorkers=1 --no-file-parallelism`
- `npm run build` 已包含 `tsc -b`，通常不必重复执行。
- 不要反复执行未受新修改影响的完整测试集合。
- 一次测试失败后，先调查根因，再决定重试方式。
- 测试时间过长或资源不足时，不应无限重试。

### PR 与 CI

- 本地定向验证用于快速反馈，不替代合并前验证。
- 完整的类型检查、单元测试和构建应由 CI 负责。
- 浏览器 E2E 未被 CI 覆盖时，应单独记录验证状态。
- 如果 CI 无法提供所需验证，应交给具备相应环境的机器执行，并在合并前确认结果。

### 最终交付报告

每次任务完成时说明：

- 已执行的验证及结果。
- 未执行的验证及原因。
- 是否需要 CI 或其他机器继续验证。
- 哪些风险尚未排除。

不得将“未运行”描述为“测试通过”。
