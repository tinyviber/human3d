# ADR-0001：支撑脚接触区间 + 离地帧存储目标作摆动中点

状态：已确认（PR #1，第二轮 review 后定型）。原始证据与逐轮过程见 [../history/investigate.md](../history/investigate.md)「PROPOSALS No.1 / No.2」。

## 决定

- 支撑脚是**接触区间**而不是逐帧状态：`plant=true` 连续 run 首帧的存储脚位定义接触点，run 内后续锁定帧的存储脚位被采样器忽略。
- 离地帧（`plant=false` 且前帧支撑）时刻脚仍在接触点；它的存储脚位不是被丢弃的，而是作为其**后**区间的摆动中点 waypoint：路径 = 接触点 → 区间中点经过存储姿态 → 下一有效目标，两段 Hermite。
- 贴地存储 = 有意拖步，不是抬脚。
- 语义事件按状态转换发射：`support-start`/`support-end` 只在 `false→true` / `true→false` 边发出，持续支撑不重复发事件（learning [3]）。

## 被否方案

- **离地帧继承接触点 + 边界零切线（PR #1 提案 No.1，DENIED）**：它消除了位置/速度瞬移，但「支撑 A → 离地 → 落地 C」场景里有效序列是 A→A→C，Hermite 两端零切线只能给出贴地 smoothstep——脚从未离开地面，离地帧存储的高度信息被完全忽略。教训：连续性断言通过 ≠ 轨迹正确；断言要落在需求语义（离地 = 高度 > 0）而不是代理指标（速度 ≠ 0、不瞬移）上（learning [1]）。

## 影响面

- 采样器（`document.ts`）按上述 override 规则判定「此帧存储是否生效」；判定边界必须精确匹配 locked-run 与 release 两类 override 条件，近似的归属规则会把可写参数错绑到别的帧（learning [15]）。
- UI 拖动语义与死数据提示见 [../domain/workshop.md](../domain/workshop.md)；采样/编辑细节见 [../domain/motion-model.md](../domain/motion-model.md)。
