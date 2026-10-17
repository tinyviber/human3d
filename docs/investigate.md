# !!!INVESTIGATE!!!

> 调查对象：PR #1「Motion protocol v1 服务 + 工作台评审修复」（分支 `feat/motion-protocol-v1`）。
> 历程：`7e653c4`（被评审）→ `4b053bf` → `c850ece` → `327c86c` → `0edc53a`，共四轮 review、四轮修复。
> PR #1 已于 `27d8aaf` 合并入 main。

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
