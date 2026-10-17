# AGENTS

## 调查与经验记录

- **PR #1 完整调查记录**：[`docs/investigate.md`](docs/investigate.md) —— Motion protocol v1 + 工作台的四轮 review 历程、每个问题的提案、被否方案的证据、最终确认的实现与测试。
- **跨任务通用规则**：[`docs/learning.md`](docs/learning.md) —— 从上述历程沉淀的十条工程规则（轨迹形态断言、哈希绑定真实数据、转换事件语义、真实路径测试、UI 可写性、显示/编辑分离、死数据提示、边界等式契约、契约兑现、真实交互 E2E）。

在修改运动服务、工作台、姿态包相关代码前，请先读这两份文件：investigate.md 解释了现有语义为什么长这样，learning.md 解释了哪些错误模式已被 review 抓过。

## 项目验证命令

- `npx tsc -b` — 类型检查（CI 门禁）
- `npm test` — vitest（70 项，CI 门禁）
- `npm run build` — 生产构建（CI 门禁）
- `npm run qa` — 浏览器 E2E（需先 `npm run dev`；无本地 Playwright 浏览器时用 `QA_BROWSER_CHANNEL=chrome npm run qa` 走系统 Chrome；未进 CI）
- `npm run protocol:example` — 重生成 `spec/examples/idle.pose.json`
- `npm run service` — 本地 Motion Protocol v1 服务（127.0.0.1:8788）

## 关键语义速记

- 支撑脚是**接触区间**：`plant=true` run 首帧的存储脚位定义接触点，后续锁定帧的存储脚位被忽略。
- 离地帧（`plant=false` 紧跟支撑）时刻脚仍在接触点，其存储脚位是**后续区间的摆动中点**；贴地存储 = 有意拖步。
- 姿态包 `timestamps.at(-1) === duration` 恒成立；包 `id` 是制品身份（请求指纹 + 定义 + rig + solver 哈希），`provenance.requestFingerprint` 是请求身份。
