# !!!INVESTIGATE!!!

> 调查对象：PR #1「Motion protocol v1 服务 + 工作台评审修复」（分支 `feat/motion-protocol-v1`）与 PR #3「issue #2 评审路线图实现」（分支 `fix/issue-2-review-roadmap`）。
> PR #1 历程：`7e653c4`（被评审）→ `4b053bf` → `c850ece` → `327c86c` → `0edc53a`，共四轮 review、四轮修复，已于 `27d8aaf` 合并入 main。
> PR #3 历程：`e26c4fe`（被评审）→ `3a01861` → 两轮 review、两轮修复，squash 合并。

# PROBLEM DESCRIPTION

首轮 review（基于 `7e653c4`，Request changes）：Motion Protocol v1 方向正确——拖动结束持久化、严格 JSON 校验、关键帧等比例重定时、手部四元数 SLERP、服务与浏览器 UI 分离、CI 齐备。但有四个 P1 阻断合并：

1. **支撑脚在 `plant=true → false` 边界位置瞬移**：接触区间重写只解决了连续支撑区间内的跳变，离地帧时刻脚从接触点 A 直接跳到存储目标 B。
2. **`definitionSHA256` 不含真实动作定义**：只哈希 `{keyframed: actionId, revision}`，`src/core/authoring.ts` 的 `seq` 关键帧改了 hash 不变，破坏可复现性。
3. **`motionId` 不能标识求解结果**：仅由请求体决定——换 Rig / 改求解器后同一请求同一 ID、不同轨迹，缓存会混淆资产。
4. **`support-start` 不是真正的支撑开始事件**：每个 `plant=true` 关键帧都发一次，持续支撑产生重复事件。

附带 P2：`outputs`/`sample` 形状错误会抛成 HTTP 500；幂等缓存无 TTL/容量上限；声明支持 `Content-Encoding: gzip` 但 `serve.ts` 不解压；手掌 SLERP 相邻区间角速度不连续；tip 轨迹跨非握拍段错误连线；`browser-qa.mjs` 刷新后只查动作名不查数值。

约束：不扩范围（不做 GLB/VRMA、MCP、真实动力学求解），保持现有架构。

# UPDATES

## UPDATE — 第二轮 review（基于 `4b053bf`，仍 Request changes）

首轮大部分修复被核实认可，但新发现两个 P1：

- **末帧丢失**：`count=Math.round(duration*fps)+1` 且 `t=min(duration,i/fps)`，`forehand`（5.2s）在合法 `fps=1` 下时间轴为 `0..5`，丢失 5.2s 终点，`timestamps.at(-1) !== duration`。
- **摆动滑地**：离地帧继承接触点只解决了瞬移；「0s 支撑 A / 1s 离地 / 2s 落地 C」三键场景中两端速度为零且无高度信息，路径沿地面 smoothstep 滑动。既有测试只断言离开 A、速度非零，未断言离地高度。

附带 P2：`keyframedDefinition()` 浅拷贝泄露模块内部数组引用；`browser-qa.mjs` 刷新后仍只读 localStorage，未查内存文档与骨骼；HTTP 冒烟用自建简化 server，未走真实 `serve.ts` 的 gzip 路径。幂等缓存总字节预算可后置。

## UPDATE — 第三轮 review（基于 `c850ece`，仍建议修改）

时间轴与摆动插值算法通过。新发现 P1——**工作台无法实际制作抬脚**：

- `engine.ts` 拖脚时强制锁定水平面且保留原 y；`WorkshopApp.tsx` 脚部面板只有朝向、无高度控件。
- 结果：插值器能吃 `foot.target.y`，但用户没有任何入口写入它——离地摆动仍是贴地滑行。
- P2：`serve.ts` 返回 413 后未销毁 gunzip 流（仍在解压消耗 CPU）；浏览器 E2E 未进 CI（可后置）。

## UPDATE — 第四轮 review（基于 `327c86c`，仍 Request changes，范围收窄到工作台交互）

抬脚编辑入口通过。新发现 P1——**离地关键帧的脚柄无正确反馈**：

- 离地帧时刻脚骨骼在接触点 A，可编辑的存储目标是路径点 B，但脚柄绑在骨骼 A 上——拖动写 B，手柄不跟手（鼠标在动、手柄不动）。
- 末尾离地帧（无后续区间）的存储高度是死数据，无任何提示。
- P2：新增 E2E 只测了滑块、没测真实 3D 拖动路径点。

# TEST [CONFIRMED]

**单元 / 服务测试（vitest，CI 门禁，70 项全过）**：

- `workshop.test.ts`（29）：接触区间保持、离地/落地边界位置与速度连续（有限差分断言）、摆动区间中点真实到达抬升高度、释放区间端点切线与通用 Hermite 规则一致（C¹）。
- `service.test.ts`（21）：非法 `outputs`/`sample`/`rig`/`parameters` 输入返回 400；`artifactId` 随 solver/rig/定义任一变化而改变、同请求稳定；支撑事件转换语义；末时间戳 `=== duration`（`forehand@fps=1`、非整数 fps、短时长回归）；`keyframedDefinition` 返回值不可变；**真实 `serve.ts` 子进程**：gzip 200 / 非法 gzip 400 / 解压超 1MiB 413。
- `kinematics.test.ts`（20）：骨骼长度与旋转数值保持。

**浏览器 E2E（`QA_BROWSER_CHANNEL=chrome npm run qa`，本地门禁，未入 CI）**：13 项检查全过、`errors: []` / `warnings: []`，关键项：

- `workshopDragPersist`：拖动 → localStorage → 刷新后内存文档 `handR.target` 数值相等且求解腕部骨骼位置一致。
- `workshopFootHeight`：UI 取消支撑勾选 → 高度滑块写 0.35m（真实 input 事件）→ 摆动区间中点 `foot_L` 骨骼 y>0.15。
- `workshopWaypointDrag`：摆动区间内脚柄 `passive`、路径点手柄可见；真实 `mouse.down/move/up` 拖路径点 → 存储 `footL.target.y` 上升、手柄世界位置等于存储目标、求解骨骼同步升高。

**构建**：`npx tsc -b` + `vite build` 通过；`spec/examples/idle.pose.json` 由 `npm run protocol:example` 重生成且内容不变。

成功标准：以上全部断言成立，四轮 review 中每个被指出的问题均有对应回归测试。

# PROPOSALS

- No.1 离地帧继承接触点 + 边界零切线 [DENIED]
- No.2 摆动路径点插值：离地帧存储目标作区间中点 [CONFIRMED]
- No.3 协议层修复包：身份拆分 / 真实定义哈希 / 转换事件 / 校验 / 幂等上限 / gzip / 精确末帧 [CONFIRMED]
- No.4 抬脚编辑入口：离地脚三维拖动 + 高度滑块 [CONFIRMED]
- No.5 路径点手柄分离：passive 脚柄 + swing 手柄 + 末尾离地提示 [CONFIRMED]

## No.1 离地帧继承接触点 + 边界零切线

### CODE CHANGE

`samplePose` 在 Hermite 之前把脚部目标通道重写为有效值：连续支撑区间恒为 run 首接触点；`plant=true → false` 的离地帧继承上一接触点；落地帧存储目标即新接触点。对静止关键帧（锁定帧 + 切换边界）强制零切线。随 `4b053bf` 提交。

### DENIED

第二轮 review 判定：它确实消除了位置/速度瞬移，但在「支撑 A → 离地 → 落地 C」三键场景里，有效序列是 A（地）→ A（地）→ C（地），Hermite 两端零切线只能给出贴地 smoothstep——**脚从未离开地面**。离地帧的存储脚位被完全忽略，用户授权的高度信息丢失。结论：连续性修复正确但不充分，「脚在水平移动」不能认定为「脚已离地」。

## No.2 摆动路径点插值

### CODE CHANGE

释放帧（`plant=false` 且前帧 `plant=true`）的存储目标不再丢弃，而是作为其**后**区间的摆动中点 waypoint：路径 contact → 区间中点经过存储姿态 → 下一有效目标，两段 Hermite；端点切线沿用与通用插值相同的 rest/CR 规则，离地帧后接摆动帧时保持 C¹（修正过中间版本硬编码零切线导致的跳变）。schema/文档明确：存储贴地 = 有意拖步，不是抬脚。随 `c850ece` 提交。

### CONFIRMED

`workshop.test.ts` 三键用例（A 支撑 / B 离地抬升 / C 落地）断言区间中点到达 B 的抬升高度且边界速度连续；第三轮 review 明确「支撑脚插值算法已达到本轮要求」。

## No.3 协议层修复包

### CODE CHANGE

- `keyframedDefinition()` 导出展开 `base` 后的真实控制帧（第二轮改为深拷贝），`definitionSHA256` 哈希 `{revision, duration, phases, definition}`。
- 包 `id` = hash(requestFingerprint + definitionHash + rig manifest hash + solver 名/版本)；`provenance.requestFingerprint` 记录请求指纹——请求身份与制品身份分离。
- `support-start` 仅在 `false → true`（含起始即支撑）发出，新增 `support-end`；事件对即接触区间。
- 请求形状错误一律 400；幂等缓存 256 键 + 900s TTL；`serve.ts` 流式 gunzip，大小上限按解压后计（防 gzip bomb），非法 gzip 400、超限 413 并 `stream.destroy()` 终止解压。
- `capture()` 用显式时间戳数组，非整数 `duration*fps` 追加精确终点；独立校验器要求 `timestamps.at(-1) === duration`。

### CONFIRMED

分布在 `4b053bf` / `c850ece` 两提交。每轮 review 逐项核实认可（定义哈希改关键帧必变、artifact 身份随 solver/rig/定义变化、事件转换语义、真实 `serve.ts` 子进程 gzip 三态、末帧回归）。CI 全绿。

## No.4 抬脚编辑入口

### CODE CHANGE

`engine.ts`：脚柄按选中关键帧的支撑约束分流——`plant=true` 维持地面水平面拖动（接触点语义）；`plant=false` 改相机朝向平面三维拖动并写入 `y`（夹到地面以上）。`WorkshopApp.tsx`：脚部面板新增左/右脚「抬升高度」滑块（0–0.8m，支撑态禁用）。随 `327c86c` 提交。

### CONFIRMED

QA `workshopFootHeight`：真实 UI 取消支撑 → 滑块 input 事件写 0.35m → 摆动中点 `foot_L` 骨骼离地 >0.15。第四轮 review 核实「提供了可以修改脚部高度的编辑入口」，但暴露了 No.5 的手柄反馈问题。

## No.5 路径点手柄分离

### CODE CHANGE

摆动区间内脚骨骼手柄标记 `passive`（渲染但拾取穿透——它显示脚在路径上的真实位置，不再是可编辑控制）；新增青色 `swing` 手柄直接绑定离地帧存储的 `foot.target`，相机平面拖动跟手、≥0 夹取；点击路径点 seek 并选中对应离地帧（与触球标记同约定）。末尾离地帧（无后续区间 → 存储高度死数据）在约束面板给出明确提示，且不显示路径点手柄。随 `0edc53a` 提交。

### CONFIRMED

QA `workshopWaypointDrag`：摆动区间内断言脚柄 `passive===true` 且路径点手柄可见 → 真实鼠标拖动 → 存储 `target.y` 上升、手柄世界位置与存储目标一致（<1e-3）、求解后 `foot_L` 中点骨骼同步升高。修复了「写成功但无视觉反馈」的所见即所得缺口。

## 遗留事项（review 明确允许后置，未纳入本次提案）

- 幂等缓存总字节预算（性能优化）。
- Playwright 纳入 GitHub Actions 独立 job（质量门禁）。
- 手掌方向更高阶平滑插值（角速度连续）。
- tip 轨迹跨非握拍段连线处理。

---

# PR #3 — issue #2 评审路线图实现

> 分支 `fix/issue-2-review-roadmap`，覆盖阶段 1 全部与阶段 2 大部；阶段 3（GLB 导出）与阶段 4 多数项目未做，issue #2 保持开放。
> 历程：`e26c4fe`（两轮提交打包，被评审）→ `3a01861` → `0564842`，两轮 review、两轮修复。

## PR #3 · 第一轮 review（基于 `e26c4fe`，Request changes）

工作台保存无效文档的两处 P1 与三处 P2：

- **P1 `ensureKey()` 不查 `maxKeys`**：创建第 121 帧成功保存，刷新后 `validateDocShape` 拒绝 → 文档被隔离、从可编辑列表消失。
- **P1 循环 `retimeKeys()` 破坏顺序**：先按比例缩放再单独夹末帧到 `duration−loopGap`；0/.98/.99@1.0s 缩到 0.2s 得 0/.196/.190，不再严格递增 → 同样落隔离区。
- **P2 接触脚滑块死写**：yaw/pitch 滑块写选中帧；选中帧非支撑开始帧时写入被 contactPlan 覆盖的存储值，画面不动。
- **P2 撤销不一致**：600ms 合并计时器跨文档共享——切文档后的第一步编辑无快照；`WristPanel` 增量角度只随关键帧重置，撤销后继续按旧累计值算 delta。
- **P2 库文件覆盖路径**：LibraryFile 整体不可解析或 `schemaVersion` 未知时，`load()` 重建默认库并 `save()`，原始字节被覆盖。

### 修复（`3a01861`）

- `ensureKey` 达 `maxKeys` 返回 `undefined`；「添加关键帧」与拖动手柄自动建帧两处入口拒绝并在页脚提示。
- `retimeKeys` 改为在合法区间 `[0, span]` 内等比缩放（loop 时 span=`duration−loopGap`），末帧不再单独夹取。
- 脚部俯仰/朝向滑块显示并写入 owner 键（支撑区间键 → `contactStartKey`；释放帧 → 前一支撑区间开始帧），并附锁定提示。
- 合并窗口提取为 `RecordGate`：仅同文档 600ms 内合并，跨文档/撤销后必录；`wristEpoch` 使 `WristPanel` 随撤销重建。
- 不可读库文件原文整体进隔离区、跳过自动保存，字符串原文导出。
- 回归 +6：上限拒绝、loop 双向 retime、满帧/loop 文档「编辑→保存→重载」、`RecordGate` 语义、损坏/未知版本文件保留。

## PR #3 · 第二轮 review（基于 `3a01861`，Request changes，仅剩局部问题）

- **P2-1 owner 搜索越过释放帧**：向前找"最近支撑帧"没有停在释放边界——连续摆动帧（K2/K3）的存储 yaw/pitch 本是活数据（采样器只对 locked-run 与 release 做 override），却被错写回支撑帧。
- **P2-2 `ensureKey` 采样原点不一致**：`ensureKey` 用默认 `origin=(0,0,0)`，工作台 `frameAtTime` 用 `restRoot`——`handFrames='pelvis'` 且骨盆转体时，插入帧的手部世界坐标出现偏移（t=.35 处实测 ~4mm，转体越大越明显）。

### 修复（`0564842`）

- owner 规则精确匹配采样器 override 条件：`plant=true` → `contactStartKey`；`isReleaseKey` → 前一支撑区间的开始帧；其余（自由摆动帧）→ `sel` 自身。
- `ensureKey(doc,time,origin)` 显式接收 rest root；`WorkshopEngine.restRoot()` 公开，两处调用（按钮、拖动自动建帧）与工作台同一原点。
- 回归 +2：「支撑 → 离地 → 连续摆动 → 落地」断言释放帧朝向死写、摆动帧存储值仍被采样（活数据）；自动建帧用真实 restRoot，插入前后 `frameAt(doc,t,restRoot)` 逐通道一致（非默认原点自洽比较）。

## PR #3 · 合并状态

- `tsc -b` / `vitest run`（115 项）/ `vite build` 通过；浏览器 E2E 见 QA 记录。
- squash 合并 `main`，远程分支 `fix/issue-2-review-roadmap` 删除。
- issue #2 阶段 3/4 未做，保持开放不关闭。

---

# PR #4 — WP-A 架构收敛：motion-file 信封 + MotionSource 统一播放

> 分支 `feat/arch-convergence`，覆盖 issue #2 阶段 2 余项（评审建议的 PR #4）；阶段 3（GLB/工作台导出）与阶段 4 未做，issue 保持开放。
> 历程：`a3e7fa4`（迁移+clavicleLift）→ `74ee39f`（服务统一）→ `b470bc5`（MotionSource）→ `68b9ebe`（属性测试）→ `b6ecf38`（release 尾段修复）→ `954eefc`（review 修复轮）。drones 流程：发现（brainstorm+design）→ 两轮 eval 门 → 三实施 + 一测试 → 两轮 review 门。

## 设计裁决（eval 门）

- **迁移等价性**：`authoring.ts` 的 `world()` 在骨盆背屈修正后求值，手目标含 `−pelvisShift`；`solvePose` 不修正手目标。裁决采纳**转换时逐键烘焙**（迁移器先跑旧 `poseAt` 再解算手目标写进键值），否决 solver 修改义方案——后者会打破「支撑脚存什么解什么」的所见即所得回归（workshop.test.ts:175）与 learning [6]/[16]。
- **clavicleLift**：reach 的抬肩是数据驱动 hint（`clavicleLift?: boolean`，仅 reach 置 true），solver 在腿部 IK 后、手臂 IK 前施加 `−8°·lift/−5°·lift`，`lift=max(0,(target.y−root.y−1.1)/.62)`；工作台面板有复选框写路径（learning [5] UI 可写性）。
- **指纹语义**：`normalizedRequest` 对 bundled 文档参数传 `undefined`——请求指纹不含内置文档内容（与 main 逐位一致），artifact `id`/`revision` 随定义哈希变化是正确语义。
- **MotionSource**：clip/document/dynamics/pose-package 四实现共享单一 playhead；`PoseFade` 仅 skin→skin（动力学保持硬切）；异步竞态三层守卫（motionId 守卫 + loadRevision + `_source!==source`）。

## 验证结果

- 迁移残差（旧 `poseAt` 黄金 fixture 对照）：idle 0.000°/0.00mm、reach 0.711°/0.50mm、squat 0.405°/1.80mm、ready 0.001°/0.00mm、forehand 4.028°/2.44mm（孤立腕部峰，均 <5° 容差）。
- `tsc -b` / `vitest run`（138 项）/ `spec:check`（12）/ `build` / `QA_BROWSER_CHANNEL=chrome npm run qa` 全绿；`dynamics-browser-qa.mjs` 29/29。
- 属性扫描（3 seeds × 48 文档，真实 `solveWorkshop` 路径）：有限值/单位四元数/段长刚性/帧间位移界/接触保持/脚尖离地/支撑权重/确定性/循环缝/阶梯模式；随机文档 POST 真实服务区分 200 与语义 422。

## 过程中抓到并修复的缺陷

- **`blendGrip(0)` 拇指残留**（`racket.ts`）：amount=0 时拇指未归位，`identity()` 即 rest。
- **release 尾段三次外推**（`document.ts` `interpolate()`）：非 loop 文档最后区间 release 分支用未钳制的 `time` 求值，`t=1.8` 处脚目标发散到 `y=−0.82m`、脚尖 −9cm 入地。修复为 `tc=clamp(time,t0,t0+dt)`，尾段钳到下一键存储值。回归断言尾帧逐通道等于存储值。
- **`browser-qa.mjs` reload 竞态**（main 既有）：自动播放导致腕位断言读的是插值态；断言前 `setPlaying(false);seek(0)`。
- **姿态包同 action.id 顶替**：`openPosePackage` 键改为 `pkg:${p.id}`（artifact id 去重），无 id 包 `unkeyed-N` 兜底。
- **信封 kind 互斥**：TS 校验器 + Ajv schema 双层强制 `document xor clip`（Ajv `strictRequired` 禁 `not`，用 `then.properties.clip:false` 实现）。
- **键时间浮点尾数**：迁移器 `Math.round(t*1e6)/1e6` 归一化（键时间会进 `definitionSHA256`），`squat.json` 末键 5.599999997764826 → 5.6。

## review 门结论

- 正确性视角：PASS（迁移/golden/指纹/MotionSource 竞态/持久化逐项核对，仅 main 既有竞态与 nit）。
- 测试/契约/文档视角：REWORK → PASS（文档同步欠债一批 + 属性测试位移界补出处注释 + 编号统一）。

---

# WP-B — 姿态包闭环：浏览器导出 + GLB + 实验室回放

> 分支 `feat/pose-pipeline`。历程：`6de7f1e`（共享抽离地基：solver 与 protocol 原语抬入 `src/core`，浏览器侧复用的前提）→ `7b9fcfa`（浏览器侧构建器）→ `2297f6a`（工作台导出 + QA 对等）→ `a477244`（GLB 导出）→ 本工单（实验室回放补齐 + 文档收尾）。

## 决策裁决

- **构建器放 motion-core（`@human3d/motion-core`）而非 server**：浏览器无 `node:crypto`——`Digest` 注入（WebCrypto ↔ node:crypto），`canonical`/指纹/manifest/artifact id 全部走 `core/protocol.ts` 共享原语；对等测试证明两侧逐字节一致，而不是约定一致。
- **`presentation` 走 `action.parameters` 开放通道，不进 v2 schema 顶层**：`parameters` 在包里本来就是 per-action 开放对象且不入制品哈希；为它升 `schemaVersion=3` 会强制所有消费者重校验，只为一个显示 hint 不值。v3 若引入逐帧握拍量等真实通道时再顶层化——届时 hint 语义由数据字段取代。
- **GLB 是派生品，不作为服务端 `outputs.format`**：GLB 不承载身份契约——`animations[0].name`（`posePackageToClip` 默认 `name=pkg.id`，刻意自描述）与文件名都借用 artifact id 便于对应，非内容寻址声明；服务端 format 有意推迟（渲染分层属后置阶段，plan 文档状态表已改注）。
- **信封是 bundled 包的权威显示元数据**：`posePackageSpec` 按 `action.id` 命中 `motionFileById` 即整体取信封字段（capabilities/name/english/method/focus/oneShot=`!document.loop`），伪造的 `parameters.presentation` 不能给 bundled id 叠加 prop。adhoc 包（`workshop-doc`）才读 `parameters.presentation`（`prop:'racket'`→球拍能力常量、`loop`→`oneShot=!loop`）与 `documentName`→`name`。
- **phases 永远来自包内事件**：`phase` 事件优先，无则 `keyframe` 事件做时间轴标记——按交付数据派生，不按 action.id 声称的内容派生。
- **`wantsProp` 常量上限是诚实的**：v2 包不携带逐帧握拍量，`PosePackageSource` 接受包级 prop hint 常量返回；spec.description 明示「v2 姿态包不携带逐帧握拍量，道具按包级 hint 全程常量显示」。同理 `spec.description` 拼接 `provenance.solver`/`quality.warnings`（计数+前 3 条原文）——warnings 此前在实验室完全不可见。

## 三件套 + 回放

1. `packages/motion-core/src/package-export.ts`：`buildPosePackageLocal`（快照 → `parseDoc` → 上限 → 指纹/id → `solveWorkshop` → `validatePosePackage`），`workshopMeta` 在 `core/protocol.ts` 把 `documentName`/`presentation` 写进 ad-hoc `action.parameters`，服务端 ad-hoc 分支同一工厂。
2. 工作台导出：「导出姿态包」`<docId>.<artifactId>.pose.json`；「导出 GLB」`<docId>.<artifactId>.glb`（干净重解析模型 + `posePackageToClip`，422 不下载且问题留卡）；`scripts/package-to-glb.mts` CLI 同转换器。
3. 实验室回放：`openPosePackage` → `posePackageSpec` 派生 + `PosePackageSource` prop hint；`checkPosePackageShape` 继续前置拒绝。

## 对等测试与回归

- `package-export.test.ts`：`buildPosePackageLocal` vs `handleRequest` 同进程全 body `toEqual`（文档形态/fps 网格/422 details 逐字/超限 400/双错输入次序），`subtleDigest` 对 `sha256` 逐字节；随机文档两 seed 共 16 篇**全量**跑对等（status+body，422 另显式钉 `error.details` 逐字；实测 15×422+1×200，再补 200 锚定文档保证成功侧必有覆盖）。
- `glb-export.test.ts`：golden 包 → GLB → GLTFLoader 读回，mixer 采样对独立 FK ~5e-8m。
- `motion-source.test.ts` 新增 6 项：服务真 `handleRequest` 产 forehand 包 → 信封恢复（capabilities/name/phases/oneShot/description 含 solver+warnings+常量道具注记）；伪造 `parameters` 不越信封权；未知 id 兜底；`buildPosePackageLocal` adhoc 包 → presentation 推导 + keyframe 回退 + loop/oneShot；prop hint 驱动 `wantsProp` 与 grip 读数。
- `browser-qa.mjs`：`posePackage`（idle 包）、新增 `posePackageForehand`（球拍重挂载、手部特写/轨迹控件、oneShot 禁循环）、`workshopPackageExport`（下载 vs 服务逐字段对等 + 回环解码 + `documentName` 进标题）、`workshopGlbExport`。

## 遗留

- v3 `presentation` 顶层字段（逐帧握拍量/真逐键事件类型）推迟：见上裁决——通道在 `parameters` 里够用，schema 升级成本高于收益。
- `wantsProp` 常量上限：v2 无逐帧 grip，道具全程常量显示已属诚实上限；逐帧化随 v3 一并考虑。
- 422 拒绝不产文件是既定语义（制品不存在）；GLB 文件名借用 artifact id 仅为对应关系，不做内容寻址声明。

---

# WP-C — Catmull-Rom 切线限界：稀疏键鞭打过冲修复

> 分支 `feat/pose-pipeline`，前置 `5cc74e8`（质量探针模块——本次校准与回归的度量基础）。落点：`packages/motion-core/src/document.ts` `tan()` + `TANGENT_SECANT_CAP`。

## 缺陷与定界

- 文档插值对内部键用非均匀 Catmull-Rom 中心差分 `m=(v_{j+1}−v_{j−1})/(t_{j+1}−t_{j−1})`，切线幅值无约束：稀疏键的非对称邻域把"快侧割线"的速度带进"慢侧区间"（|m·Δt|≫|Δv|），曲线越过键值外插。`defaultDocument`（5 键 0.8s）探针 wrist_R 峰值 22.07 rad/s @240fps，密集烘焙的 bundled forehand（49 键 5.2s）只有 5.4——稀疏文档的鞭打属离群。
- 但要分清两层读数：**通道层位移过冲**（样条曲线越过键值包络）与**求解骨角速度**（IK 对目标序列的解算输出）。本修复界住前者；后者峰值由求解器主导，能量迁移而非消失（见探针对照）。回归断言锚在通道层。

## 实现与对评审原案的偏离

- 每内部键切线限界 `|m| ≤ κ·min(|s左|,|s右|)`，κ=`TANGENT_SECANT_CAP=2`，方向对称、保号；端点切线仍为 0；rest/锁定通道的零切线约定不破；每键单一切线值 → C¹ 保持。
- **偏离：原案写 `max` 相邻割线幅值，实现用 `min`。** 中心差分是两割线的 Δt 加权均值，幅值必落在两割线张成的区间内——`max` 帽数学上永不触发（实测全零）。真正致病的是切线被快邻域放大后施加在慢区间里，故界读较小割线；这是唯一"同时限制向两侧区间外插且每键单值"的取法。
- loop 幽灵链与主链同走 `tan()`：wrap 键的钳位值在接缝两侧一致，接缝 C¹（有专测）。
- release-swing 两段式（interpolate 的 release 分支）有自己的 chord/end 切线逻辑，不经 `tan()`——不二次钳制。

## κ 校准（240fps 探针 + 通道级过冲直接度量）

逐通道"采样值越过键值包络"的过冲（全区间求和 / 单区间最差）与对密集文档的扰动（同文档钳制前后曲线差）：

| κ | default 过冲和 mm | default 最差 mm | forehand 过冲和 mm | forehand 最差 mm | forehand 扰动 mm / ° |
|---|---|---|---|---|---|
| ∞（修前） | 12620 | 97.7 | 1909 | 3.5 | — |
| 1.2 | 7205 | 68.8 | 958 | 3.0 | 1.91 / 0.137 |
| 1.5 | 7865 | 72.3 | 1131 | 3.1 | 1.27 / 0.128 |
| **2** | **8527** | **76.8** | **1261** | **3.2** | **1.12 / 0.112** |
| 3 | 9814 | 86.2 | 1470 | 3.4 | 1.04 / 0.081 |

**κ=2**：稀疏文档砍掉 ~⅓ 过冲、最差通道 −21%；密集文档扰动 ≤1.12mm/0.112°，在既有迁移预算内。κ≥3 对缺陷交付不足；κ≤1.5 把快区间前的真实加速也抹平（过冲和反而更小但扰动密集文档更大——κ 越小界越紧，对 dense 曲线是纯损失）。

## 身份与 golden 语义

- 求解运动语义变化 → `SERVICE_VERSION` `0.1.0`→`0.2.0`（`artifactIdPayload` 的 `solver.revision`、`provenance.solverRevision`、capabilities 同步变化）。`spec/examples/idle.pose.json` 重生成：artifact id `mot_6db10f3c7966b541`→`mot_85e6387dda9682db`——身份 bump 正确，但本提交当初声称的「轨迹逐位不变（各键邻域对称，钳制不触发）」经复核证伪，如实更正：钳制在 idle 上**实际触发 22 处（键×通道）**，全部位于 pelvis 系手部目标通道（flatten 通道 7–9/19–21；迁移细分键 6-7、19-20、34-35 的邻域非对称，被钳切线幅值 ≤7.7e-4 m/s）。功能影响可忽略：40fps 包网格（193 采样点）实测解算后仅 upperarm01/lowerarm01/lowerarm02/wrist 双侧 8 条旋转轨出现共 880 个四元数分量差、最大聚合角差 ~0.005°（0.0045°），平移轨逐位相同；下表 idle 行全零是因为 42 个 golden 采样点落在受扰区间内的时刻恰好全是键时刻（Hermite 过键逐位），受扰区间内部无采样。b450e79 提交说明里的 "the clamp never triggers there" 同步证伪，以此处实测为准。
- `spec/solver-baseline/*.golden.json` 语义改写：**迁移等价断言 → 变更探测器基线**。原 golden 是 frozen authoring 管线（迁移脚本内快照 `poseAt`）的捕获；本提交起由 `scripts/recapture-solver-baseline.mts` 走生产回放路径（frameAt→solveEffectiveFrame）重捕获，`solver-baseline.test.ts` 容差收紧到 1e-3°/1e-3mm——回放确定性（property.test 钉死逐位重解）意味着该余量只盖平台浮点抖动，任何未来求解语义漂移即红。钳制效应读数（squat max 0.405→1.012°）见下节；authoring 迁移脚本及其参照捕获/残差报告已在消融批次退役（生成器不存在后是死数据）。

## 旧↔新迁移 delta（golden 网格，求解骨局部四元数角差，度）

per-motion 汇总（163 骨 × 41–57 时刻；root 行为根骨平移差 mm）：

| motion | max | p95 | mean | root max | bones touched(>0.0005°) |
|---|---|---|---|---|---|
| idle | 0.000 | 0.000 | 0.000 | 0.00 | 0 |
| reach | 0.274 | 0.000 | 0.000 | 0.00 | 22 |
| squat | 0.607 | 0.000 | 0.001 | 0.79 | 22 |
| ready | 0.005 | 0.000 | 0.000 | 0.01 | 6 |
| forehand | 0.272 | 0.000 | 0.001 | 0.25 | 21 |

全部 p95=0.000°：钳制在密集烘焙文档上极少触发，绝大多数采样逐位相同。per-bone 表（任一 motion >0.001° 的骨）：

| bone | idle | reach | squat | ready | forehand |
|---|---|---|---|---|---|
| root | 0.000 | 0.007 | 0.000 | 0.000 | 0.076 |
| spine05–spine01 | 0.000 | 0.001 | 0.005 | 0.000 | 0.012 |
| upperarm01_L | 0.000 | 0.011 | 0.294 | 0.000 | 0.203 |
| lowerarm01_L | 0.000 | 0.017 | 0.607 | 0.000 | 0.214 |
| lowerarm02_L | 0.000 | 0.003 | 0.019 | 0.000 | 0.024 |
| wrist_L | 0.000 | 0.011 | 0.318 | 0.000 | 0.272 |
| clavicle_R | 0.000 | 0.015 | 0.000 | 0.000 | 0.000 |
| shoulder01_R | 0.000 | 0.009 | 0.000 | 0.000 | 0.000 |
| upperarm01_R | 0.000 | 0.191 | 0.294 | 0.000 | 0.218 |
| lowerarm01_R | 0.000 | 0.274 | 0.607 | 0.000 | 0.258 |
| lowerarm02_R | 0.000 | 0.003 | 0.022 | 0.000 | 0.054 |
| wrist_R | 0.000 | 0.121 | 0.317 | 0.000 | 0.167 |
| neck01 | 0.000 | 0.001 | 0.005 | 0.000 | 0.009 |
| neck02 | 0.000 | 0.000 | 0.005 | 0.000 | 0.000 |
| head | 0.000 | 0.000 | 0.003 | 0.000 | 0.000 |
| upperleg01_L | 0.000 | 0.008 | 0.299 | 0.002 | 0.082 |
| lowerleg01_L | 0.000 | 0.001 | 0.588 | 0.005 | 0.076 |
| foot_L | 0.000 | 0.001 | 0.289 | 0.003 | 0.036 |
| upperleg01_R | 0.000 | 0.008 | 0.299 | 0.002 | 0.081 |
| lowerleg01_R | 0.000 | 0.000 | 0.588 | 0.004 | 0.075 |
| foot_R | 0.000 | 0.001 | 0.289 | 0.003 | 0.035 |

## 回归

- `workshop.test.ts` 新增 `Catmull-Rom tangent clamp` 三项：①过冲界用例（稀疏三键文档：峰值位移过冲 0.0079m ≤ κ·min割线·Δt·max h10 解析界，且 < 同键未钳制参照曲线的 0.6×；三键时刻采样逐位等于存储值）②C¹：被钳键两侧单侧差分收敛同一速度（ε=1e-4 处 |Δ|≈4e-4 m/s）③loop 接缝：wrap 键被钳时接缝两侧速度连续、接缝值逐位相等。
- `property.test.ts` ×4 松弛注释改注（钳制后内部切线 ≤2×较小割线，slack 变双倍余量）；`quality.test.ts` 基线块刷新为修后数值。
- `measure-quality-probe.mts` 的 `all` 列表与单选支持 `default`（defaultDocument 即稀疏键最坏样本）。

## 探针前后对照（240fps，`evidence/quality-probe-{default,forehand}.json`）

| 指标 | default 修前 → 修后 | forehand 修前 → 修后 |
|---|---|---|
| wrist_R 骨峰 rad/s | 22.07 @0.600 → 22.60 @0.600 | 5.4 @3.004 → 5.8 @2.163 |
| 最差骨峰 rad/s | 24.50 lowerarm02_R → 25.51 | 10.5 lowerarm01_R @2.421 → 11.4 upperarm01_R @2.163 |
| wrist vmax m/s | 5.90 @0.733 → 6.02 @0.579 | 1.60 → 1.60 |
| tip vmax m/s | 18.60 @0.596 → 18.96 @0.596 | 4.23 @3.004 → 4.23 @3.004 |
| tip 速度 kick>0.1m/s | 191 → 191 | 62 → 62 |
| tip 折返>25° | 2 → 1 | 1 → 2 |

**诚实结论**：钳制界住的是样条通道过冲（过冲和 12620→8527mm −32%，最差通道 97.7→76.8mm −21%；探针报告的求解骨峰值不降、个别微升）。若 WP-C 的验收口径是"求解侧 wrist_R 峰值降到密集文档量级"，本实现不满足——钉住的语义是评审原案的切线限界本身，通道层过冲才是它的直接对象。

# WP-C(续)— 手部朝向 slerp→SO(3) 三次插值:键时刻角速度 C⁰ 跳变修复

## 缺陷与定界

- 原实现:`interpolate()` 对 `hand.forward`/`hand.normal` 逐段 `Quaternion.slerp`。段内角速度恒定、键时刻方向阶跃——角速度是 C⁰ 的;0.61m 球拍杆臂把每个键的 ω 跳变放大成拍头速度 kick(修前实测:defaultDocument tip kick>0.1m/s 共 191 帧、forehand 62 帧,且集中贴键:forehand 键时刻 ±20ms 内占 44 帧)。
- 实测:defaultDocument handR 键时刻有限差分 |ωL−ωR| 最差 10.29 rad/s(ε=1e-3);ε 缩小不收敛——真 C⁰ 跳变不随 dt 缩放(对照:探针同口径 240fps 7.45° vs 60fps 27.35° 单帧转角)。

## 实现:corrected-slerp 形式的 SO(3) 三次曲线(squad 族)

`interpolate()` 段内姿态:

```
q(u) = slerp(q_i, q_{i+1}, u) · exp( u(1−u)·(d0 + u·d1) )
d0 = T_i·Δt − b          (把左端导数从割线修正到 T_i)
d1 = 2b − (T_i + T_{i+1})·Δt   (同时满足右端导数 T_{i+1})
b  = ln(q_i⁻¹q_{i+1})  —— 段割线对数(体坐标)
```

右乘修正项在两端消失 → **过每个键帧逐位精确**(实测键时刻 f/n 误差 ≤7.3e-16);对任意 T_j 恒有 q⁻¹q'(0)/Δt=T_i、q⁻¹q'(1)/Δt=T_{i+1} → **角速度 C¹**(对截幅/端点取值同样成立)。

**与字面 Shoemake 双 slerp squad 的偏离(诚实记录)**:评审原案允许"正确实现 squad 或用近似实现"。字面形式 `slerp(slerpAB(u), slerpCD(u), 2u(1−u))` 在本仓库文档族上实测崩溃:defaultDocument 稀疏大旋转键(≥90°/0.15s)下,内控制链 s_i→s_{i+1} 与弦几乎反向(dot 最深 −0.925),外层 slerp 的逐对半球选择中途切换 → 输出旋转真实跳变,采样 ω 峰 ~6275 rad/s、服务语义门拒件(wrist_R 101.7 rad/s)——比被修的缺陷更糟的 C⁰。修正式不可能反极:修正是有界相对旋转增量(defaultDocument 实测最大偏离弦 0.11rad)。语义等价:squad 要求的"过键、C¹、SO(3) 三次"三条契约全部由测试钉死。

**切线构造(非均匀键距处理)**:T_j = (b−a)/(t_{j+1}−t_{j−1}),a/b 为相邻割线对数——与标量通道 `tan()` 的中心差分同一构造,按**时间**而非 u 参数匹配 → 非均匀键下仍 C¹(标准 s_i 公式只匹配 per-u 导数,均匀键距才等价)。|T| 截幅 κ·min(|a|/dt_L,|b|/dt_R),κ=TANGENT_SECANT_CAP=2,同 tan() 契约——相邻同姿键割线为 0 → T=0,静止区间天然静止,无特判(测试断言逐位不动)。

**端点约定**:T=0(与 tan() 链端 rest 切线一致;文档起止静止)。

**半球链**:log/割线计算前对**整条链**(含 loop 幻影拷贝)做 dot<0 符号连续——同 `unwrapAngle` 之于 `ANGLE_CHANNELS` 的契约,而非旧代码逐段修端点符号。

**loop**:幻影链每侧两个周期拷贝(尾二、末键 −D 在前;首、次键 +D 在后),与 tan() 完全同构;夹住接缝的内侧幻影(末键 −D、首键 +D)是链内节点,内部切线分支按周期性直接算出其源键的 T——无需回拷(最初实现按单层幻影的心智模型回拷 `sq[0]←sq[len−2]`/`sq[len−1]←sq[1]`,在两层链上是 ghost←ghost 误植且条目从不被 [0,D] 采样消费,已移除;400 篇随机 loop 文档 ×204 采样点逐位复算零差异)。实测接缝值差 0、ω 差 0.001(ε=1e-4,quatLn 半角率口径)。

**pelvis 系**:四元数链建在 `interp` 数组上——即已经骨盆旋转后的坐标,world/pelvis 两手同一套代码,转换时点不变(Rt(out yaw) 左乘,learning[16])。

## 键时刻角速度连续(有限差分,quatLn 半角率口径——数值为 |ω|/2,物理 rad/s 需 ×2;修前修后同口径,比较有效)

| 文档 | 指标 | 修前(slerp) | 修后(cubic) |
|---|---|---|---|
| defaultDocument | worst |ωL−ωR| @ε=1e-3 | handR 10.2939 | handL 0.0387 · handR 0.1692 |
| defaultDocument | worst |ωL−ωR| @ε=1e-4 | ~10(不收敛) | 0.01698 |
| forehand | worst |ωL−ωR| @ε=1e-3 | handR 0.9459 | handL 0.0024 · handR 0.0140 |
| forehand | worst |ωL−ωR| @ε=1e-4 | ~0.95(不收敛) | 0.00141 |

ε 缩小残差 ~线性收敛 → 有限差分截断,不是跳变;旧 slerp 残差不随 ε 缩小——跳变本体。

键时刻 f/n 逐位误差:default 5.09e-16 · forehand 7.31e-16。

## 身份与 golden 语义

- 求解运动语义变化 → `SERVICE_VERSION` `0.2.0`→`0.3.0`。`spec/examples/idle.pose.json` 重生成:artifact id `mot_85e6387dda9682db`→`mot_a9edd1d24e21d202`,轨迹逐位不变(idle 手帧各键不动,下表全零行)。
- `spec/solver-baseline/*.golden.json` 走既有 `recapture-solver-baseline.mts` 重捕获,容差 1e-3°/1e-3mm 不变。

## 旧↔新迁移 delta(本次 squad;golden 网格,求解骨局部四元数角差,度)

per-motion 汇总(163 骨 × 41–57 时刻):

| motion | max | p95 | mean | root max | bones touched(>0.0005°) |
|---|---|---|---|---|---|
| idle | 0.000 | 0.000 | 0.000 | 0.00 | 0 |
| reach | 0.614 | 0.000 | 0.001 | 0.00 | 73 |
| squat | 0.288 | 0.000 | 0.001 | 0.00 | 148 |
| ready | 0.000 | 0.000 | 0.000 | 0.00 | 0 |
| forehand | 1.443 | 0.000 | 0.002 | 0.00 | 75 |

p95=0.000°:改动只落在手帧驱动的骨上,绝大多数采样逐位相同。per-bone 表(任一 motion >0.0005° 的骨):

| bone | idle | reach | squat | ready | forehand |
|---|---|---|---|---|---|
| lowerarm02_L | 0.000 | 0.000 | 0.025 | 0.000 | 0.000 |
| lowerarm02_R | 0.000 | 0.049 | 0.027 | 0.000 | 0.438 |
| wrist_L | 0.000 | 0.000 | 0.288 | 0.000 | 0.000 |
| wrist_R | 0.000 | 0.614 | 0.287 | 0.000 | 1.443 |

差异全部集中在 wrist/lowerarm02——正是手帧朝向驱动的骨;躯干腿逐位不变。

## 回归

- `workshop.test.ts` 新增 `hand frame cubic (WP-C squad)` 七项:①键时刻逐位复现(<1e-9)②键时刻角速度左右有限差分连续(ε=1e-4,|ωL−ωR|<0.05,半角率口径;实测 0.017,旧 slerp 同口径 ~10)③稀疏世界系文档 C¹ ④相邻同姿键逐位静止+ω≈0(截幅自然结果,无特判)⑤loop 接缝值逐位相等+ω 连续 ⑥handFrames=pelvis 下立方在骨盆系运行(定姿相对骨盆→世界输出逐位跟随 yaw(t))⑦反极 quat 表示的键取短弧(max<3.1rad,不触 ~205° 长弧)。
- `quality.test.ts` 新增 kick 断言(共享 `probeDocument` 真实求解路径):forehand tip kicks<40(实测 26,修前 62);defaultDocument atKey 步长中位<interior×0.5(实测 0.17°/1.47°,修前 1.38°/1.50°)、tip accelTop<1500 m/s²(实测 1169,修前 2463@keyΔ0ms)。
- `solver-baseline.test.ts` 沿用重捕获机制;`evidence/quality-probe-*.json` 全部重生成。

## 探针前后对照(240fps,`evidence/quality-probe-{default,forehand}.json`)

| 指标 | default 修前 → 修后 | forehand 修前 → 修后 |
|---|---|---|
| tip 速度 kick>0.1m/s | 191 → 191(物理下限,见下) | 62 → **26**(其中键±20ms 44 → 9) |
| tip accelTop m/s² | 2463 @0.500 keyΔ0ms → 1169 @0.563 keyΔ63ms | 320 @2.163 → 326 @2.163 |
| tip vmax m/s | 18.96 → 24.19 | 4.23 → 4.25 |
| wristStep @key 中位 | 1.38° → 0.17°(interior 1.50°→1.47°) | 0.21° → 0.21°(interior 0.20°→0.21°) |
| hand 链峰 rad/s | 22.6 → 31.2 | 5.8 → 5.9 |
| tip 折返>25° | 1(130°@0.5) → 0 | 2 → 1(40°@2.163) |

**诚实结论**:① kick 阈值 0.1m/s 对 defaultDocument 已到下限——0.8s 挥拍 tip 合法速度 ~24m/s,|Δv|>0.1 几乎每帧成立,真正消失的是键邻域 C⁰ kick(最差单帧 Δv 10.26→4.87,且时间从 keyΔ0ms 挪到 keyΔ63ms)。② tip vmax 上升 28%:slerp 在键时刻的方向阶跃等效于每键一次刹车,平滑后能量不再被人为吃掉——这是物理上更诚实的轨迹,hand 链峰 31.2 rad/s 仍低于 40 rad/s 语义门。③ forehand 是 kick 指标真正能区分的文档:62→26,且残余集中在 keyΔ13ms 的接触区物理挥速,不是朝向插值缺陷。

# WP-C(收尾)— 验收夹具、硬质量门与裁决摘要

> 承接上两节(切线限界 `b450e79`、手部 SO(3) 三次 `5f3f2b9`)。收尾交付:`72f78e3`(UI 制作的 forehand-study 夹具 + 账本)+ `0b17c6d`(契约/质量硬门);本工单补全量浏览器复验与文档同步。

## 决策裁决摘要(评审选项,提案原文见 WP-C 工单)

- **B 进**:手部朝向逐段 slerp → SO(3) 三次插值(角速度 C¹)——已交付,见上节。
- **C 进**:经工作台真实 UI 写路径制作验收文档 + 探针硬质量门——已交付,见下。
- **D 推迟**:不在本 WP 交付,列入遗留待后续工单定夺。
- **E/F 出**:判出本 WP 范围,不做。
- **锥角不拓宽**:`WRIST_BEND_LIMIT_DEG` 维持 59.8° 不变。defaultDocument 的腕弯曲需求(240fps 实测 maxBend 92.03° @0.600s、46/193 帧=23.8% 超限、deficit 峰 32.23°、clamp 切换 @0.5625/0.7542s)是种子文档自身的真实超限,不是限幅过紧的证据;验收文档在现有锥内完成(maxBend 48.2°、0/481 帧截幅),不靠放宽限幅凑指标。

## study 夹具与账本位置

- 夹具:`spec/examples/forehand-study.request.json`(2.0s、5 键正手:准备→引拍→触球→随挥→恢复;`handFrames` 双手 pelvis;唯一 contact 键 @1.15s)。
- 账本:`spec/examples/forehand-study.md`——逐键 UI 编辑路径、~35 轮探针迭代拐点、240/60fps 最终指标表、残余偏差如实记录。全部编辑经真实 UI 写路径(`drive.mjs` 回放 `ops.json`:滑块/字段 input 事件 + 双视角画布指针拖拽),无姿态数据注入;引擎方法直调仅限读路径/播放控制(`getDoc`/`setPlaying`/`solveCurrent`/camera 读数)。
- 工具链:`scripts/forehand-study/`(drive/ops 配方,保留作夹具重制入口);研究期的 probe/grid/inspect/retune/kickmap/tiptrace/delta-decomp/finalize/pkgcheck 已随一次性校准退役,重测走共享探针 CLI(`measure-quality-probe.mts`)。
- 逐轮指标快照:`evidence/forehand-study/rounds.jsonl`(`final-240`/`final-60` 为定稿读数)+ `doc-*.json` 中间稿。

## 硬质量门校准值(quality.test.ts,实测 ×1.25 上限 / ÷1.25 下限)

@240fps:腕截幅 `clamped=0` 且 `maxBend<55°`(实测 48.2);IK arm/leg 残差 `<3mm`(实测 ~1e-16);`reachMax<1`(实测 94.3%);支撑脚滑移 `<1mm`(实测 ~4e-16);鞋底穿透 `<1e-6`;踝背屈 L/R `≤20.1°`(实测 19.6/20.0,R 贴限由 pelvis 修正顶住,`saturated=0`);`root.maxA<16`(实测 12.56)、`maxStep<1.6mm`(实测 1.27);contact 键 tip `>3.0`(实测 3.79)、tip vmax `>7.0`(实测 8.94 @0.983,峰领先触球 0.17s、门 |Δt|≤0.25s);tip kicks `≤170`(实测 136,回归门不宣称清零)、wrist kicks `≤9`(实测 7);动力链近端峰先于前臂 +0.05s 容差。60fps 复跑同门不变。`contract.test.ts` 钉:≤5 键、恰好一个 contact、逐键双足支撑、pelvis 手系、schema/服务 200 全通过。

## 求解语义两轮变更后的全量复验(本工单)

- `QA_BROWSER_CHANNEL=chrome npm run qa`:全部检查过(errors/warnings 空)——含 `posePackageForehand`(信封恢复/球拍重挂载/oneShot)、`workshopDragPersist`(拖动→刷新后内存文档与求解腕位一致)、`workshopWaypointDrag`(路径点真实拖动跟手)等既有断言在新求解语义下复验;证据文件随运行刷新。
- `QA_BROWSER_CHANNEL=chrome node scripts/dynamics-browser-qa.mjs`:29 项全过(投掷相位、直拳手部、录屏),动力学回放无回归。
- `npx tsc -b` / `npm test`(185)/ `npm run spec:check`(14)/ `npm run build` 全绿;`measure-motions.mts` 重测刷新 `docs/validation.md` 表(漂移均在余量内:内置峰 forehand 6.95 rad/s,工坊默认文档 29.22→32.98 rad/s——共享键切线带真实角速度过键,仍低于 40 门)。

## 遗留(如实记录,未达标或待后续)

- **tip kicks 136 @240fps(study 文档)**:物理残余而非插值缺陷——0.1m/s/帧阈值 ≈ 24m/s² 等效加速度,而 8.9m/s 挥拍鞭打段 accelTop ~80m/s²,大部分 kick 帧是合法速度变化;已用 ≤170 回归门防恶化,不宣称达标。
- **动力链非完全 proximal→distal**:相对峰时刻上臂 .875s → 骨盆/躯干同帧 .971s → 手 .988s → 前臂 1.212s——近端次序在 240fps 帧粒度未拉开(骨盆/躯干同帧),手部峰夹在前臂之前;门只钉「近端先于前臂」,全序留待后续。
- **D/E 待办**:D 按裁决推迟、E 判出本 WP,若重启需新工单;选项原文见 WP-C 工单记录。
- **study 晋升 bundled**:夹具目前是 spec 示例 + 探针门,未进 `assets/motions/` 信封与主页动作库;晋升(文档→motion-file 信封、进内置动作)留后续 WP。

# WP-D — 动力学动作目录化(D2)

## 目标与裁定

- **范围**:把两条肌肉驱动动作(`baseball-throw`/`punch`)从 `motions.ts` 的 Vite-only `import.meta.glob` 注册迁入 `assets/motions/*.json` 信封注册表,与 authored/clip 动作共用同一条 `MOTION_FILES` 静态注册链路。
- **信封形态**:`kind:'dynamics-motion'`;`dynamics.action` 承载原 action JSON 全部字段(schemaVersion/title/model/simulation/controller/reference/display/notes),`dynamics.records` 按 case 给出 `{meta,data}` URL;原始信封不写任何显示字段(name/english/duration/description/method/focus/phases 及 oneShot/capabilities/notes/license),全部由 `normalizeMotionFile` 从 `dynamics.action` 用旧 `actionMotions` 同一套公式派生(duration 保留仿真网格取整、phases 默认取关键帧时刻并经 lead/scale 换算、clamp 到 duration)。
- **不引入 `dynamics.model`**:记录 meta 已携带 `modelMeta`/`modelXml` 与哈希,信封再加模型字段只会产生第二份可漂移的模型身份。
- **记录文件迁入 per-action 目录**:`public/dynamics/<id>/<case>.{json,bin}`;信封 `dynamics.records` URL 是运行期抓取契约,`DynamicsReplay.load` 优先用信封 URL,裸 `{kind:'dynamics'}` spec 回退同一 per-action `/dynamics/<id>/<case>` 约定(本轮 review 修复前曾写死旧扁平 `<id>-<case>` 路径——迁移后磁盘上根本不存在,是必 404 的死路径,已更正,见文末修复轮)。中间产物(原始逐帧 run JSON、激励 bin、参考 npz)同样按动作分目录到 `assets/dynamics/<id>/`——它们是 export 管线的输入而非 web 资产,不进 public/。
- **互斥与派生边界**(schema `allOf` + `validateMotionFileShape` 双轨):dynamics-motion 必须有 `dynamics`、不得有 `document`/`clip`、不得写显示字段;`unwrapMotionFile`/`motionDefinitionPayload` 对 dynamics-motion 显式抛错(不进姿态管线哈希)。
- **服务目录不变**:`service.ts` 仍按 `f.kind==='workshop-motion'` 过滤,dynamics-motion 进文件注册表/网页动作库但不进 `/v1/actions`;`service.test.ts` 的「不预告不可服务动作」断言原样覆盖 `punch`/`baseball-throw`。
- **类型解环**:`MuscleActionFile`/`DynamicsRecords` 抽到 `packages/motion-core/src/muscle-action.ts`,`dynamics.ts`/`motion-source.ts`/`motion-file.ts`/`types.ts` 都从这里取型,不再经 `motions.ts`。
- **副产物**:`assets/actions/` 目录整体删除;`assets/source/dynamics/full-activation-model.xml` 是早期实验中间产物,随本次迁移删除(完整模型快照仍由 `myofullbody-complete.xml` + `myofullbody-parameters.json` 承载)。

## WP-D(补)— 工作台洋葱皮:播放头相邻姿态幽灵叠加

eval 裁决语义:编辑视图叠加播放头前后姿态的幽灵骨架线框——审阅「这一帧从哪里来到哪里去」,不是全轨迹拖尾。

- **幽灵 = 逐骨世界位置的 `LineSegments`**(非克隆 SkinnedMesh):每方向×距离一个槽位(2×`ONION_MAX`=6),段表与实验室调试骨架共用 `rig.skeletonSegments`(从 `core/engine.ts` 抽出的同一份表,骨列表不会分叉)。每幽灵时刻走 `frameAt + solveEffectiveFrame` 真实求解路径——与 `rebuildAux` 60 次轨迹采样同路——逐骨记录世界位置后恢复播放头姿态。
- **时刻选择**:`onionTimes` 纯函数。`keys` 模式 `sortedKeys` 括号取播放头前后各 N 个真实键时刻(严格不等式——压在播放头下的键是正在编辑的实姿态,不幽灵化);`step` 模式 `t±k·Δt` 随播放头每帧跟随,越界时刻丢弃。`ONION_MAX=3` 每向上限,maxKeys 文档永不全键幽灵化。
- **重算节奏(签名缓存)**:`docDirty→rebuildAux` 置 `onionStale` 强制重解算;幽灵时刻签名(mode/count/step + 各时刻 dir/dist/time)不变则跳过——播放头在同两键间移动不触发重解;step 模式随 animate 每帧走同一签名门。拖动中 `!this.drag` 守卫冻结(与其他 aux 层同节奏)。
- **视觉**:前帧冷色 0x367cff / 后帧暖色 0xe2543a,opacity .40→.20 按距离衰减,`depthTest:false`、renderOrder 8(低于手柄 20),挂场景根不进拾取集。开关与参数(count/mode/step)会话态不持久化,「显示」卡片控件。
- **QA**:`workshopOnion`——幽灵池存在、keys/step 数量断言、真实拖动期间缓冲逐字节冻结、关闭全隐。

## WP-D(补)— 固定相机渲染导出:静帧 + 关键帧拼图

eval 裁决语义:**确定性出图参数的静帧导出 + 关键帧 contact-sheet 导出**(明确非相机跟随、非服务端 renders 端点)。

- **引擎入口**:`WorkshopEngine.captureStill(t,{view?,overlays?})` / `captureSheet(times?,opts)`,与 `setView`/`seek` 同层的公开方法。出图契约自描述:固定 `STILL_WIDTH×STILL_HEIGHT` = 640×720 PNG、pixelRatio 钉 1、固定相机预设(默认 `CAPTURE_VIEW='threeQuarter'`,`setView` 语义——相对该时刻骨盆根定位)。流程 = `setPlaying(false)` → 快照 time/playing/view/相机位姿/逐对象叠加物可见态(快照记录**暂停前**的 playing,恢复才有意义)→ `seek(t)`+`solveCurrent`+`renderer.render`+`canvas.toBlob`(同任务内快照,`preserveDrawingBuffer:true` 已开)→ `finally` 原样恢复(`setPixelRatio` 先于 `resize()` 回 host 尺寸)。
- **叠加物策略**:拼图/静帧用于姿态审阅,编辑器叠加物(手柄组/轨迹线/触球标记/洋葱皮/CoM 支撑)默认全部不入图——直切 `Object3D.visible`,不走 `setOptions`/`docDirty`(一次导出不应触发 rebuildAux 的文档级副作用);`opts.overlays:true` 保留入图。新增私有 `capturing` 标志:多格拼图的两个 await 之间 animate 循环照常跑,`rebuildAux`(轨迹线/触球标记)、`updateOnion`、`updateBalance` 都会按 options 重建可见性,标志位压住全部重显路径;同标志还挡住捕获中画布 pointerdown 起的 drag 与 pointermove 写入。
- **拼图**:`captureSheet` 默认取全部关键帧时刻(sortedKeys);>12 键经纯函数 `sheetTimes` 均匀抽样到 `SHEET_MAX_TILES`=12,首尾帧必保留(step>1 保证严格递增无重复格)。逐 tile 走 captureStill 真路径 → `createImageBitmap` 解码 → 离屏 2D 画布 `SHEET_COLS`=4 列网格,每格下方 `SHEET_LABEL_H`=28px `t=…s` 标注带 → 单张 PNG。
- **UI**:动作文档卡姿态包区旁新增「静帧渲染」子区——「渲染静帧」按 `e.time` 导 `<docId>.t<秒>.png`、「关键帧拼图」导 `<docId>.sheet.png`,复用既有 `download`/`safeName`;注释与 hint 写明固定相机预设+固定出图尺寸、不含编辑器手柄、播放/视角导出后恢复。
- **测试/QA**:`workshop.test.ts` 补 `sheetTimes` 纯函数断言(键数 ≤ 上限全保留、30 键均匀抽 12 且端点钉死+无重复、自定义上限与调用序保持);`browser-qa.mjs` 新增 `workshopStillExport`——真实点击 → `waitForEvent('download')` → PNG magic(\x89PNG)+ IHDR 钉 640×720 与文件名约定,拼图断言 3 格宽度(1920×748)与体积大于单帧,并分别验证暂停态导出后 time/playing 原样恢复、播放中导出后 playing 恢复为 true。
- **文档**:WORKSHOP.md 导出矩阵三行→五行(静帧/拼图归入「渲染品」,不携带 artifact 身份);QA.md 检查表补 `workshopStillExport` 行。

## WP-D(补)— 握拍侧参数化:gripSide 镜像求解与左手球拍装载

eval 裁决语义(方案A):`WorkshopDoc.gripSide?:'L'|'R'` 文档级字段选择握拍侧——整套握拍阶段(指节包裹、腕锥限位、抬肩辅助、球拍挂载)镜像到左手;侧别改变求解轨迹,所以它属于文档并进入请求指纹,不是展示元数据。

- **规范形态**:缺省 = 右手;`normalizeDoc` 把显式 `'R'` 折叠回缺省——同义写法共享指纹与制品 id(`normalizedRequest` 内嵌整个文档,'R' 拼写在哈希前就归一掉);显式 `'L'` 保留并改变制品 id。
- **镜像约定**:左挂载 = 右挂载的精确 x 镜像(M·q·M,x 反射 M——位置 x→−x、四元数 (x,−y,−z,w) 分量规则),`grip-side.test.ts` 在真实 `frameAt→solveEffectiveFrame` 路径上逐骨断言(163 骨位置 + 世界朝向,实测 ≤5e-16 m / ≤5e-8 rad)——含腕锥截幅、clavicle 辅助、指节缠绕各阶段,非对称输入全镜像后求解必须共轭到另一侧。
- **求解路由**:`EffectiveFrame.gripSide` 由 `frameAt` 从文档拍平(与 clavicleLift 同一交付模式,调用方签名不变),`solveEffectiveFrame`/`solvePose` 按侧路由 `blendGrip`/手指/腕锥/锁骨(镜像符号)/放松;非握拍手保持松弛。
- **球拍与 UI**:`gripFrame`/`applyGrip`/`blendGrip`/`attachRacket`/`mountRacket` 均收 `side` 参数(缺省 'R' 保持旧语义);工作台引擎在 `solveFrame` 一处统一检测挂载侧变化并重挂(文档编辑/切换触发,每帧至多一次);「握拍侧」下拉写文档(左握时约束行动态标「左手握拍」);实验室 `capabilities.prop.side`/`posePackageSpec` 的 `presentation.gripSide` hint 驱动 `propSide` 与手部相机;`analyzeProbeFrames` 仪表握拍臂而非右臂。
- **QA**:`workshopGripSide`——真实下拉选左手 → 文档字段+重标+球拍重挂 `wrist_L` → 真实拖拍头写 `handL.target`,`handR.target` 逐字节不变。

## WP-D(补)— 文档镜像(mirrorDoc):同一动作换边

eval 裁决语义:镜像平面 x=0(该 rig 左=+X、右=−X),`mirrorDoc(doc)` 产出新 WorkshopDoc——右手正手变成左手正手,文档级变换而非求解开关。

### 镜像约定表(与 grip-side.test.ts 的 M·q·M 实测约定对齐)

| 字段 | 变换 |
|---|---|
| `pose.root` | `x→−x`,y/z 保持 |
| `pose.yaw` / `chest` / `side` | 取反(YXZ 中的 Y/Z 分量;`rig.rotate` 与 `footRotation` 同为 YXZ Euler,M 共轭逐因子作用:Rx 保持、Ry/Rz 取反) |
| `pose.lean` / 脚 `pitch` | 保持(X 分量) |
| `handL⇄handR` | 对调;target/pole/forward/normal 全部 x→−x——Mf·Mn 逐位等于 f·n=0,正交框架契约 bit-for-bit 保持,`parseDoc`/`canonicalizeHands` 对镜像输出是恒等 |
| `footL⇄footR` | 对调;target/pole x→−x、yaw→−yaw、pitch 保持 |
| `constraints` | `plantL⇄plantR` 对调;`grip`/`contact` 为侧别无关布尔,保持 |
| 接触区间 | 不存独立数据——区间语义由 plant 旗标 + 区间首帧存储脚位定义,随上述字段自动镜像:接触点、离地帧摆动中点、落地帧同一套存储重写 |
| `handFrames` | `{L←R, R←L}` 随手换侧(插值坐标系跟随该手原样);对现有双手 pelvis 配置是恒等。骨盆系无需特判:rest root.x=0,M 与 buildModel 的 yaw 旋转换算可交换 |
| `gripSide` | 翻转:缺省/`'R'`→`'L'`;`'L'`→缺省(镜回右手时写回规范形态,显式 `'R'` 不落盘) |
| `clavicleLift`/`loop`/`duration`/`inbetweens`/键时间/标签/`videoTime` | 原样保留(标量与时间轴不变) |
| `id`/`name`/`english` | 可回切标记:`.mirrored` / ` · 镜像` / ` · MIRRORED`,已带标记则剥除 |

### 关键不变量与实测

- **对合性**:`mirror∘mirror` 对规范字段序文档逐字节相等(seeds、shipped 资产、parseDoc/mirrorDoc 输出全在此类);手写乱序字段的文档按值相等(输出恒为规范字段序)。
- **几何硬断言**(mirror.test.ts,真实 `frameAt→solveEffectiveFrame`,全部采样时刻 × inbetweens 双模式,163 骨位置+世界四元数):实测最大残差 位置 ≤2.8e-15 m、朝向 ≤5.96e-8 rad——与 grip-side 镜像断言同量级(其记录 ≤5e-16 m / ≤5e-8 rad)。
- **两侧等价**:非对称 handFrames({L:'world',R:'pelvis'})、左握文档、loop 随机文档(seed 11/222)同口径通过——handFrames 换侧是该断言成立的必要条件。
- **UI 事务**:「镜像动作」把镜像文档作为新库条目入库并选中(原文档保留);新文档的撤销书预存源文档快照——一步撤销回到源文档(undo/redo 在恢复 id ≠ 当前 id 时由 applyDoc + selectDoc 跟随,反向步经 `DocHistory.pushPast`/`pushFuture` 存到恢复文档的书上,双向对称)。
- **QA**:`workshopMirror`——真实点击 → 新文档、`gripSide` 翻转、t=.5 腕位左右互换(容差 1e-5)、球拍重挂 `wrist_R`、撤销一步回源文档。

## WP-D · 双审修复轮(review-D1 minors + review-D2 medium/lows)

- **SERVICE_VERSION `0.3.0`→`0.4.0`**:`gripSide` 进 `solvePose`(指节包裹/腕锥/锁骨辅助/球拍挂载整段按侧镜像)是求解语义变化,`protocol.ts` 明令无条件 bump——WP-D 落地时漏升,本轮补上。`spec/examples/idle.pose.json` 经 `npm run protocol:example` 重生成:artifact id `mot_a9edd1d24e21d202`→`mot_c67dda30d91962fd`,顶层仅 `id` 与 `provenance.solverRevision` 变化——轨迹逐位不变(gripSide 缺省='R',idle 文档无 'L',既有轨迹不受影响)。(同轮修复的迁移脚本内嵌 schema 漂移随该脚本在消融批次退役,不再是维护面。)
- **动力学 flat-fallback 死契约**:`DynamicsReplay.load` 裸 spec 回退路径 `/dynamics/<id>-<case>` 自迁移起即永 404,更正为真实布局 `/dynamics/<id>/<case>`(types.ts/motion-source.ts 注释同步);`load` 新增 `meta.id`/`meta.case` 与请求 id/profile 一致性校验,不匹配显式抛错——与 `scripts/test-dynamics-records.py` 同一闸门,信封 URL 指错动作的记录不再静默回放。
- **HistoryBook.drop 死代码 + 复活路径**:`MotionLibrary.remove` 新增 `onRemoved` 钩子,`WorkshopApp` 接 `books.drop(id)`——删文档连同其撤销书;否则同 id 文档再导入(导入只在冲突时重编 id)会继承已删文档的整栈快照,undo 把旧内容写回新文档(僵尸写)。`applyDoc` 返回成败,undo/redo 恢复目标 id 不在库中(镜像源文档被删)时给出 hint 而非静默吞步。回归:删源文档→同 id 再导入→`books.of(id).canUndo()===false`。
- **captureSheet 文档版本混排**:拼图逐 tile await(toBlob/createImageBitmap 让出事件循环)之间 `getDoc()` 每格重读活动文档,中途切文档/编辑会把两版文档拼进同一张图;入口即 `serializeDoc→parseDoc` 冻结副本并交换 getDoc,全部 tile 对同一文档版本求解。
- **nits**:onionTimes keys 模式 loop 缝 wrap(loop 文档播放头近 0 时「上一姿态」跨缝取尾键自身时刻,去重且播放头下键不幽灵化,workshop.test.ts 断言);mirrorDoc 函数体补全字段枚举注释(新字段必须在此显式裁决,防静默保留源值)。
- **文档同步**:WORKSHOP.md 三 kind 互斥补 dynamics-motion;README 工作台行补 grip-side/onion/静帧/镜像,「右手手指」改不假定侧别;AGENTS.md 测试计数按实测更新。

# 外部 review 修复(对 PR #4/#5 代码的六项处置)

外部 review 在 PR #4(动力学动作目录化)/#5(姿态包导入)上发现的问题;编号沿用工单。

- **P1-1 动力学异步加载竞态**(`apps/web/src/playback/motion-source.ts` `DynamicsSource`):`load()` 的两个 await 点之间引擎可切走 source,旧路径仅靠 `s.retired`(dispose 才置位)与 `this.motionId!==id` 挡应用——`deactivate()` 不留标记,旧加载完成后 `status='ready'`+`replay.root.visible=true` 会复活 replay 盖住新 source。修法:`private gen` 代际计数,`load` 入口 `++this.gen` 记 `g`,`deactivate()`/`dispose()` 均 bump;两处 await 应用点与 catch 统一判 `this.gen!==g||s.retired` → `'superseded'`(不动 replay 状态)。dispose 分叉保持原语义:仅 retired 会话丢弃未被收编的 replay——被取代的会话不能丢,共享 `s.promise` 的当前属主还会收养它。回归测试:motion-source.test.ts「DynamicsSource — load supersession」四个用例(注入 `session.promise` 的假 replay,走真 `load`/`deactivate`/`dispose` 路径)。
- **P1-2 events 元素结构校验**(`checkPosePackageShape`):`events` 存在时必须是数组,逐元素 isObj、`type` 限 spec 枚举五值(phase/keyframe/contact/support-start/support-end,与 schema 同步)、`time` 为 ≥0 有限数、`label` 字符串;support-start/end 另要 `side∈'L'|'R'`(与 validate.ts:169 同闸门)。顺带补上 spec 消费字段的最小形状:rig 块(`id===RIG_ID`、`manifestSHA256` 字符串、`bones` ≥1 整数)、action 对象 + `action.id` 字符串、quality 对象 + `warnings` 字符串数组、provenance 对象 + solver/solverRevision/source 字符串。`posePackageSpec` 的 events.filter 前加 isObj 守卫作纵深防御(单独调用不依赖前置 shape 检查)。
- **P1-3 rig/definition 身份核验**:`engine.load()` 把 rig.json 改为 text 取回再 `JSON.parse`,经 `canonical(rigManifestBody(info))` + WebCrypto sha256 算本地 `manifestHash`;同时预算 `envelopeDefHash`(workshop-motion 信封逐一 `sha256(canonical(motionDefinitionPayload(f)))`,与服务端 `actionDefinitionHash` 同式)。无 `crypto.subtle`(非 secure context)两者记 undefined/空并 warn。`openPosePackage`:`rigMatches(p,manifestHash)` 不符→onError 拒收(声明哈希前缀写入错误信息);哈希不可知降级为既有骨骼名检查,spec description 注明「rig 未验证」。`posePackageSpec(p,id,trust?,rigVerified=true)`:信封恢复前过 `trust(actionId)`——包内 `action.definitionSHA256` 与信封预算哈希一致才信任,缺失/不符走 ad-hoc parameters 通道并在 description 注明「definitionSHA256 不符」;不传 trust 保持旧行为(无可核对方的调用方)。纯函数面 `rigMatches`/`trust` 闭包在 vitest 层测(篡改 definitionSHA256→capabilities 退回、manifestSHA256→rigMatches=false)。
- **P2-4 多周期 wrap**(`engine.tick`):单 tick 跳过多个周期时长帧×高速时,`this.time%=duration` 只归位播放头而 `loopWrapAdvance` 只发一次——walk 步幅累积丢步。改为 `wraps=Math.floor(this.time/duration)` 取模后按 wraps 逐次发 `loopWrapAdvance`。
- **P2-5 信封跨字段一致性**(`validateMotionFileShape`):workshop-motion 且 `document.duration` 为有限数时要求 `document.duration===duration`(零容差——两数字同源于 JSON;normalizeDoc 不改写 duration,故在校验器内检查即等价于归一化后);非 dynamics 分支 `phases` 增 `0≤p.time≤f.duration`(clip-motion 同样适用)。JSON Schema 表达不了跨字段一致,runtime 校验独担;测试断言 schema 接受而 normalize 拒绝,证明是新覆盖。
- **P2-6 GLB 边界覆盖**(`glb-export.test.ts`):四个用例全走真链路 `solveWorkshop`(真 capture)→`posePackageToClip`→`exportGlb`→回导→独立 `fkWorldAt` 对比(worst<1e-3):a) fps=7、duration 0.8s 非整除网格,断言 `timestamps.at(-1)===duration` 精确、count=7(末尾补点存在)、clip.duration 贴合;b) forehand 信封文档 @30fps 大旋转;c) 根 x/z 位移+转身 60° 同帧变化,并断言根轨确实移动(roundtrip 非平凡);d) 0.4s 两键极短文档。测试内求解 rig 用独立 GLB 解析,不污染 bake() 的干净模型。

**验证**:`npx tsc -b` ✓、`npm test`(249 项,235+14 新增)✓、`npm run spec:check` ✓、`npm run build` ✓;`npm run qa:dynamics` 全绿(29 项 checks,动力学真实加载路径回归)、`npm run qa` 全绿(posePackage/posePackageForehand 走真实 served 包经文件输入导入——rigMatches 与 trust 闭包在浏览器真实路径上被验证)。

## 复核追加轮(必修 M1 + 顺手 nit)

- **M1 `DynamicsSource.load` 失败段拆分**(`apps/web/src/playback/motion-source.ts`):原 catch 无条件 `s.promise=undefined`,把 replay 创建段与记录段混为一谈——`replay.load` 失败(记录 404/身份不符)时 `s.replay` 已收编而 promise 被清,重试 `s.promise??=` 新建第二个 DynamicsReplay,`if(!s.replay)` 为假 → 孤儿 replay 不入 `s.parent` 却 `root.visible=true` 返回 'applied',`session.replay`/`physics`/`duration` 永指无记录的旧对象(播放卡死);陈旧 load 的 catch 在闸判之前清 promise 也毒化当前属主。修法:两段 try——`await s.promise`(创建段)失败且 `s.promise===p` 身份吻合才清(已拒的创建承诺是所有后续 load 的毒药,但不得清掉新属主已替换的 promise);`replay.load`(记录段)失败保留 promise 与 `s.replay`,重试在同一 replay 上重放记录段。`gen!==g||s.retired` 闸保持在 status/error/replay 应用点之前。回归:记录段抛错→重试 'applied' 且 `session.replay` 同对象、`parent.children===[root]`;悬停中的陈旧 load 记录段抛错→'superseded' 且 `session.promise` 不变(旧实现下该断言失败)。顺手清掉死字段 `private motionId`(gen 闸已取代 `motionId!==id`,全文件再无读取点)。
- **nits**:glb-export.test.ts 用例 a 补 `ts.at(-1)-ts.at(-2)≠1/fps` 显式钉死非均匀网格语义;`posePackageSpec` 把信封命中但未信任拆成两句——包带哈希且信封可核验(workshop-motion 且本地哈希可知)却说不过的→「definitionSHA256 与当前内置定义不符」,其余(包未带字段/非 workshop-motion 信封/本地哈希不可知即 envelopeDefHash 空)→「definitionSHA256 缺失/无法核验,按 ad-hoc 处理」;standalone spec 的 events filter 在 isObj 后追加 `typeof time==='number'`/`typeof label==='string'`,防 `{type:'phase'}` 半成品漏进 phases(新增回归断言)。

**验证**:`npx tsc -b` ✓、`npm test`(253 项,249+4 新增)✓、`npm run spec:check` ✓。未跑 `npm run build`/`qa`/`dynamics:*`——改动限于 motion-source 运行时分支与测试断言,浏览器 E2E 与构建由 CI 覆盖。

## 外部 review 第二轮(必修三项 + 文档裁决)

- **跨文档 undo 覆写源文档(数据丢失)**:`WorkshopApp.tsx` 原 `undo()`/`redo()` 对恢复出的 prev/next 无条件 `applyDoc`(`L.docs[i]=next`)。场景实证:A 镜像出 B(B 的书预存 A 快照)→ 回 A 改关键帧 → 选中 B 按 undo → B.undo 弹出旧 A 快照 → `applyDoc` 用旧快照覆写**当前库里的 A**,A 的后续修改被无提示抹掉(redo 对称:A 的书 future 里 B 快照覆写被改过的 B)。修法钉死语义:**跨文档快照是指针,恢复只做选择切换,绝不向异 id 文档写内容**——`prev/next.id!==cur.id` 分支改为:库里有该 id → `selectDoc(id)`(不写库)并把 cur 按既有对称逻辑存到目标书的对侧栈;库里没有 → 既有 hint 路径。同 id 路径保持 applyDoc 覆写(文档自己的历史恢复自身,语义正确)。回归:mirror.test.ts 用真实 `MotionLibrary`+`HistoryBook` 复演 app 调用序——A→mirror B→recordBefore+edit 改 A→选 B 模拟 undo→断言库里的 A 保留新编辑(serializeDoc 逐位对比)、选中落到 A;再改 B 使 future 快照变旧→redo→断言选中回 B、B 内容未被覆写;源文档被删走 hint 分支不崩溃、不复活。
- **姿态包导入校验补齐**(`checkPosePackageShape`,在既有结构/rig/事件三层之上):a) `tracks.rotations` 同 `bone` 重复轨道拒绝——解码是谁后写谁赢的静默歧义;`validBones` 传入时再断言轨数 ≤ 骨骼数。b) 逐轨逐样本四元数单位性 `|q|∈1±1e-3`(与 `server/validate.ts` 同容差),全零/NaN/非单位样本报骨骼+帧号;为此把旋转轨数组检查从 `isVec`(一否全否)拆成 `Array.isArray`+长度,让非有限分量落进逐样本分支。c) 资源上限:`count ≤ duration×240+1+1e-6`(密度上限对齐服务 fps≤240 语义)+ `count ≤ MAX_PACKAGE_SAMPLES=200_000` 绝对上限(≈13.9min@240fps,巨型 JSON 内存 DoS 闸)。
- **捕获互斥 + 拼图全程持有**(`workshop/engine.ts`):a) 新增 `CaptureMutex` 导出类——`captureStill`/`captureSheet` 入口重入直接 reject(`'已有导出任务进行中'`);UI 按钮本就禁用,此闸给程序化并发/批处理兜底,防止两段捕获交错互踩状态快照。b) `capturing` 由布尔改**深度计数**(`captureDepth`),`captureSheet` 外层一对 begin/end 把标志从入口持有到拼图 toBlob——逐 tile 的 `renderStill` 仍各做 begin/end 重快照该 tile 的相机/传输态(LIFO 恢复),但 tile 间隙 flag 不再回落,间隙中的 pointerdown/drag 与叠加物重显全部压住;`getDoc` 冻结副本同样贯穿整段。QA `workshopStillExport` 断言点语义随之改变并同步适配:逐 tile 恢复点现在读到会话内暂停态(快照在外层暂停之后取得),仅最后一次外层恢复把播放态交回 true。
- **文档裁决——golden 大体积是有意权衡**(回应"哈希化压缩 golden"的建议):`spec/examples/idle.pose.json`(~665KB)这类原始轨迹 golden 的价值在于**漂移可定位**——WP-C 正是靠逐位 diff 证伪了「轨迹逐位不变」的提交声明,并给出逐骨×逐帧的偏差位置表;压缩成哈希只能回答"变没变",回答不了"哪里变了"。**不接受哈希化压缩**;承认体积成本——若将来过大,可另加一份采样点摘要文件做速查,但 oracle 本体保持原始轨迹不缩水。
- **文档级**:forehand-study.md 新增「验收边界」节——本 fixture 只证几何/平滑/接触约束达标,不证明符合真实网球正手运动学;峰领先触球门 `|Δt|≤0.25 s` 与链式验证仅「骨盆/躯干不晚于前臂(+0.05 s)」的口径写死(quality.test.ts 同注)。

## 复核追加轮 2(密度上限 off-by-one + 顺手 nit)

第二轮修复的独立复核抓到一处必修:密度上限公式 `count > duration×240+1+1e-6` 与生产者的真实采样网格不符——`pose-package.ts` `capture()` 的网格是「均匀 1/fps 步进 + 追加精确末端点」,最大合法计数是 `⌈duration·fps⌉+1`。反例:`duration=0.502s @240fps` 产出 `count=122`(网格顶到 0.5,补 0.502),而旧门限 `121.48` 会拒收本服务同款产线的合法包。修法:上限改 `⌈duration·fps−1e-6⌉+1`,且 `fps` 取包自己声明的 `timeline.fps`(顺带新增校验:声明值须在 (0,240] 内,缺省回退 240 外沿与 validate.ts 同容差)——声明 fps=60 却携带 240 密度的包是不一致数据,收紧到声明网格正好拒掉。回归:motion-source.test.ts 新增两例——真实 `solveWorkshop(rig,doc,240)` 在 0.502s 上产出 count=122 的包必须零问题通过;声明 fps=60+duration=.5 的黄金包篡改体按密度上限拒收。顺手 nit:`CaptureMutex.run` 改 `Promise.resolve().then(fn)` 把同步抛纳入 finally 链(busy 不再被同步异常楔死);四元数逐样本检查从「先 hypot 再查」换成逐分量 `Number.isFinite`(非强转,挡 `"0.5"` 这类字符串分量);mirror.test.ts 的 app-复演注释显式标注与 WorkshopApp.tsx 同步。

**验证**:`npx tsc -b`(随 build)✓、`npm test`(259 项,257+2 新增)✓、`npm run spec:check`(19 项)✓、`npm run build` ✓。未跑浏览器 QA/dynamics:*——改动限导入校验门与互斥器同步路径,浏览器路径由前一轮 QA 覆盖,CI 全量兜底。
