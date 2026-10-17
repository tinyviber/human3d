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

- **构建器放 `src/core` 而非 server**：浏览器无 `node:crypto`——`Digest` 注入（WebCrypto ↔ node:crypto），`canonical`/指纹/manifest/artifact id 全部走 `core/protocol.ts` 共享原语；对等测试证明两侧逐字节一致，而不是约定一致。
- **`presentation` 走 `action.parameters` 开放通道，不进 v2 schema 顶层**：`parameters` 在包里本来就是 per-action 开放对象且不入制品哈希；为它升 `schemaVersion=3` 会强制所有消费者重校验，只为一个显示 hint 不值。v3 若引入逐帧握拍量等真实通道时再顶层化——届时 hint 语义由数据字段取代。
- **GLB 是派生品，不作为服务端 `outputs.format`**：GLB 不承载身份契约——`animations[0].name`（`posePackageToClip` 默认 `name=pkg.id`，刻意自描述）与文件名都借用 artifact id 便于对应，非内容寻址声明；服务端 format 有意推迟（渲染分层属后置阶段，plan 文档状态表已改注）。
- **信封是 bundled 包的权威显示元数据**：`posePackageSpec` 按 `action.id` 命中 `motionFileById` 即整体取信封字段（capabilities/name/english/method/focus/oneShot=`!document.loop`），伪造的 `parameters.presentation` 不能给 bundled id 叠加 prop。adhoc 包（`workshop-doc`）才读 `parameters.presentation`（`prop:'racket'`→球拍能力常量、`loop`→`oneShot=!loop`）与 `documentName`→`name`。
- **phases 永远来自包内事件**：`phase` 事件优先，无则 `keyframe` 事件做时间轴标记——按交付数据派生，不按 action.id 声称的内容派生。
- **`wantsProp` 常量上限是诚实的**：v2 包不携带逐帧握拍量，`PosePackageSource` 接受包级 prop hint 常量返回；spec.description 明示「v2 姿态包不携带逐帧握拍量，道具按包级 hint 全程常量显示」。同理 `spec.description` 拼接 `provenance.solver`/`quality.warnings`（计数+前 3 条原文）——warnings 此前在实验室完全不可见。

## 三件套 + 回放

1. `src/core/package-export.ts`：`buildPosePackageLocal`（快照 → `parseDoc` → 上限 → 指纹/id → `solveWorkshop` → `validatePosePackage`），`workshopMeta` 在 `core/protocol.ts` 把 `documentName`/`presentation` 写进 ad-hoc `action.parameters`，服务端 ad-hoc 分支同一工厂。
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

> 分支 `feat/pose-pipeline`，前置 `5cc74e8`（质量探针模块——本次校准与回归的度量基础）。落点：`src/workshop/document.ts` `tan()` + `TANGENT_SECANT_CAP`。

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

- 求解运动语义变化 → `SERVICE_VERSION` `0.1.0`→`0.2.0`（`artifactIdPayload` 的 `solver.revision`、`provenance.solverRevision`、capabilities 同步变化）。`spec/examples/idle.pose.json` 重生成：artifact id `mot_6db10f3c7966b541`→`mot_85e6387dda9682db`，轨迹逐位不变——idle 各键邻域对称，钳制不触发（见下表全零行）。
- `spec/migration/*.golden.json` 语义改写：**迁移等价断言 → 变更探测器基线**。原 golden 是 frozen authoring 管线（`migrate-authored-motions.mts` 内快照 `poseAt`）的捕获；本提交起由 `scripts/recapture-migration-goldens.mts` 走生产回放路径（frameAt→solveEffectiveFrame）重捕获，`migration.test.ts` 容差收紧到 1e-3°/1e-3mm——回放确定性（property.test 钉死逐位重解）意味着该余量只盖平台浮点抖动，任何未来求解语义漂移即红。authoring 参照捕获改落 `evidence/migration-authored/`（gitignored，可复现）；residual 报告仍由 migrate 脚本产出到 `evidence/migration-report.txt`，现含钳制效应（squat max 0.405→1.012°）。

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
