# 动作工作台（Motion Workshop）

状态：已实现最小可用版（`workshop.html`），轨迹优先，不依赖 MuJoCo 动力学。

## 为什么先做轨迹而不是肌肉

查看器接入 MyoSim/MuJoCo 的正向链路是「肌肉激活 → 关节力矩 → 物理积分 → 动作」。但动画素材与运动分析真正需要的是**动作轨迹**：先有目标姿态再倒推肌肉收缩，会立刻撞上逆动力学、肌肉冗余控制（数百条肌肉 ↔ 几十个自由度）和运动规划三个难题，仅靠手工关键帧无法唯一确定驱动方式。

MyoSuite 官方文档本身就把运动回放（joint-angle trajectory replay）、逆运动学、逆动力学、正向模拟分成不同操作——载入关节角轨迹回放不要求从肌肉激活开始。

因此工作台把管线重排为：

| 阶段 | 方法 | 需要动力学 |
|---|---|---|
| 手动调整关键姿态 | 任务空间拖动 + 解析 IK | 否 |
| 生成连续动作 | Hermite 补间 + 约束保持 | 否 |
| 更自然的动作 | 参考视频对照（后续：WHAM/Motion Prior） | 否 / 可选 |
| 物理合理性 | 关节限位、支撑脚锁定、重心投影检查 | 运动学近似即可 |
| 真正肌肉控制 | MuscleMimic / 物理模仿学习 | 是 —— 后续阶段，不重造 |

MuscleMimic（amathislab/musclemimic）已提供全身肌肉驱动模仿学习实现与预训练检查点；当轨迹确认后再把「哪些肌肉实现了这个运动」交给它，而不是手工推激励。

## 交互模型

**1. 拖动末端而不是逐关节旋转。** 手腕、脚踝、骨盆、拍头都是可拖动手柄，命中后由定长双骨 IK（`solveTwoBone`）解算整条链；肘/膝极点手柄调弯曲平面朝向。拖动写进当前或自动新建的关键帧（auto-key）。

**2. 关键帧携带约束而不只是姿态。** 每个关键帧记录：

- `plantL / plantR`：支撑脚锁定。连续的 `plant=true` 关键帧构成一个**接触区间**：整个区间内脚保持在区间起始帧的接触位置（后续锁定帧存储的脚位被忽略——接触是约束不是姿态采样）。移动支撑脚必须先经过一个 `plant=false` 关键帧（离地），再声明新的 `plant=true`（重新接触）。离地帧时刻脚仍位于上一接触点（保证连续），但**离地帧存储的脚位不会被忽略——它作为摆动路径点**：脚从接触点由静止出发，在区间中点经过该存储姿态，再以静止到达落地帧接触点。想做出真正抬脚就把离地帧的脚拖到空中；存储脚位贴地则产生有意的拖步/滑步。切换处 Hermite 切线为零，位置与速度都连续，不会瞬间跳变。
- `grip`：握拍约束（侧别由文档级 `gripSide` 决定）→ `applyGrip` 包裹该侧指节、球拍挂载到该侧手腕。
- `contact`：触球/接触事件 → 拍头在该帧的世界位置显示为黄色标记，直接拖动标记即调整该帧手部目标让拍头到达该点（写入握拍侧的手部目标）。

约束属于关键帧并随 JSON 导出——生成器由此知道动作的**目的**（支撑、接触时刻），不只是身体形状。

**3. 参考视频并排。** 本地视频载入（不上传），帧步进、「对齐」把视频时间轴对齐到动作时间轴、可同步播放；每个关键帧可记录其对应的视频时间，形成视频关键帧清单。WHAM 类单目 3D 重建是后续接入点（遮挡、深度歧义需人工修正），当前以人工对照关键帧为主。

**4. 洋葱皮对照。** 「显示」卡片开启后，编辑视图叠加相邻姿态的幽灵骨架线框（`LineSegments`，非克隆 SkinnedMesh）：`keys` 模式取播放头前后各 N 个真实关键帧时刻（`sortedKeys` 括号定位，压在播放头下的键不幽灵化——那是正在编辑的实姿态），`step` 模式取 `t±k·Δt` 随播放头每帧跟随。每个幽灵时刻走与轨迹采样相同的 `frameAt + solveEffectiveFrame` 真实求解路径再逐骨记录世界位置。前帧冷色、后帧暖色、按距离衰减透明度，`depthTest:false`、renderOrder 8（低于手柄的 20）、不进拾取集合。每向最多 3 层——120 键文档不会被全键幽灵化；重算挂在 `docDirty`/`rebuildAux` 节奏上，幽灵时刻签名不变则跳过重解算，拖动中冻结。开关与参数是会话态，不写入动作库。

## 数据与求解

- `src/workshop/document.ts`：`WorkshopDoc` = 关键帧数组 + 时长 + 补间开关。姿态是任务空间参数（根骨偏移/朝向、脊柱前倾/转体/侧弯、四肢末端目标 + 极点 + 手部 forward/normal 框架、脚部 yaw/pitch）。`samplePose` 按数据性质分别插值：位置量做非均匀 Hermite（Catmull-Rom 中心差分切线，每个内部键限界 `|m| ≤ 2×相邻较小割线幅值`（`TANGENT_SECANT_CAP`）——抑制稀疏键的样条过冲/鞭打，端点与锁定通道仍取零切线，保持 C¹）；yaw/foot yaw/pitch 等角度先沿关键帧链做 ±360° 展开再走最短路径；手部 forward/normal 契约上必须是正交归一框架（seed/parse/库存恢复时规范化），按 corrected-slerp 形式的 SO(3) 三次曲线插值（逐位过键、键时刻角速度 C¹，切线与 `tan()` 同一构造与同限界）保证中间帧始终构成有效方向；支撑脚按上一条接触区间规则保持。
- `src/workshop/solver.ts`：采样帧的唯一求解入口是 `solveEffectiveFrame`（支撑权重淡入淡出、握拍渐变、抬肩辅助随帧传入，不再单独推导），落到 `solvePose` 把参数写到骨架（复用 `rig.limb`/`rig.hand`/`applyGrip`，含支撑脚背屈超限时的骨盆后移二分修正）。`analyzePose` 输出运动学合理性：膝/肘/肩限位、支撑脚残差、分段质量近似质心在支撑多边形（锁定脚脚印凸包）内的投影。
- `src/workshop/engine.ts`：Three.js 场景、手柄拾取与拖拽平面、轨迹线（拍头/手腕）、触球标记、质心投影与地面支撑多边形。
- `src/workshop/WorkshopApp.tsx`：文档/视频/约束/检查面板 + 关键帧时间轴。
- `mirrorDoc`（`document.ts`）整档镜像：以 x=0 平面（该骨架左=+X、右=−X）把同一动作换边——右手正手变左手正手。逐键约定：`root.x`、骨盆 `yaw`、`chest`/`side`（YXZ 中的 Y/Z 分量）与脚 `yaw` 取反，`lean`、脚 `pitch` 保持；`handL⇄handR`、`footL⇄footR` 对调且 target/pole/forward/normal 全部 x→−x（正交框架逐位保持）；`plantL⇄plantR` 对调使接触区间挪到另一侧脚（接触点、离地帧摆动中点经同一存储重写随动镜像）；`handFrames` 随手换侧（惯用的双手 pelvis 配置下等价于不变）；`gripSide` R↔L 翻转（镜像回右手时写回规范缺省形态）；`clavicleLift`、`loop`、`duration`、`inbetweens`、键时间/标签/`videoTime` 原样保留；`id`/`name`/`english` 追加可回切的镜像标记（`.mirrored` / ` · 镜像` / ` · MIRRORED`）——再镜像一次逐字节回到原文档。文档卡「镜像动作」按钮把镜像文档作为**新动作**入库并选中（原文档保留），且在新文档的撤销书上预存源文档快照：一步撤销即回到镜像前的文档（选择跟随恢复的 id；重做对称地回到镜像文档）。`mirror.test.ts` 在真实 `frameAt → solveEffectiveFrame` 路径上逐骨断言世界位置/朝向互为 x 镜像（实测位置残差 ≤2.8e-15 m、朝向 ≤6e-8 rad），随机文档与 shipped 资产同口径覆盖。

## 动作库与存储

工作台按**动作库**组织（`src/workshop/library.ts` 的 `MotionLibrary`）：

- 每个动作是一份 `WorkshopDoc`（`schemaVersion:2`，v1 文档经 `upgradeDoc` 迁移）：`id`（按名称生成 slug + 随机后缀，冲突时重新生成）、`name`（自定义命名）、`english`、`duration`、`inbetweens`、`loop`（周期性接缝）、`handFrames`（手部目标按 world / pelvis 系插值）、可选 `clavicleLift`（抬肩辅助：握拍侧手部目标抬高时锁骨与肩带随动上抬，求解器逐帧推导幅度——内置 reach 动作使用，面板「抬肩辅助」开关）、可选 `gripSide`（握拍侧 `'R'|'L'`：缺省即右手且为规范形态——显式 `'R'` 在 `normalizeDoc` 归一化时折叠回缺省，因此同义写法共享指纹；`'L'` 把整套握拍阶段——`applyGrip` 指节包裹、腕弯曲限位、抬肩辅助、球拍挂载——镜像到左手，面板「握拍侧」下拉。侧别改变求解出的轨迹，所以它属于文档并进入请求指纹，不是展示元数据）、`keys[]`。
- 动作库整体存 `localStorage['kinesis-workshop-library']`：`{schemaVersion:2, activeId, docs[], quarantine[]}`（v1 库文件仍可读取并迁移），编辑即写回（拖动期间 500ms 节流 + 拖动结束强制保存）。读取时逐条经 `validateDocShape` 严格校验（有限数值、严格递增时间、布尔约束、非退化方向框架），损坏或非法条目移入 `quarantine` 保留原文（可导出修复后再导入），全空时用示例动作重新播种；隐私模式 / 超限写失败时 `library.lastError` 置位且界面明示「仅存于内存」。
- 新建动作用 `blankDocument` 模板：站立姿态、双足支撑锁定、起始/结束两个关键帧，时长 1s。
- `导出 JSON` 输出**当前动作单文件**（`*.workshop.json`）；`导入` 接受裸文档或 motion-file 信封——`kind:'workshop-motion'` 的 `document` 经 `unwrapMotionFile` 解包取出（`clip-motion` 没有内嵌轨迹，明确报错），解析后加入动作库并选中，id 冲突自动重生成。

## 文件格式与导出

工作台有五个导出入口：前三个是源数据/交付契约/派生品，后两个是姿态审阅用的固定相机渲染品：

| 按钮 | 文件名 | 内容 | 备注 |
|---|---|---|---|
| `导出 JSON` | `<docId>.workshop.json` | WorkshopDoc v2：米制世界坐标、角度为度、时间为秒；关键帧含 `pose` 全部任务空间字段、`constraints` 和可选 `videoTime` | `导入` 载入同类文件或 motion-file 信封 |
| `导出姿态包` | `<docId>.<artifactId>.pose.json` | 规范姿态包（`spec/pose-package.schema.json` v2）：`buildPosePackageLocal` 本地求解，与 `POST /v1/motions {workshop-doc}` 同一条 `parseDoc → solveWorkshop → validatePosePackage` 管线，产物与响应对等（对等测试逐字节钉死） | 语义校验 422 时**不下载**，问题明细留在卡片上；需 https/localhost（`crypto.subtle`）；采样率 fps 1–60 进入制品 id |
| `导出 GLB` | `<docId>.<artifactId>.glb` | 同一求解结果烘焙成 glTF 动画（逐骨四元数轨 + root 位移轨，时间轴原样含非整数末段） | **派生品**：不承载身份契约——`animations[0].name` 与文件名借用 artifact id 便于对应（非内容寻址声明）；导出用干净重解析的 `human.glb`（编辑器里的球拍/材质不会烘进去），共享 `src/core/glb-export.ts`，Node 侧 `npm run package-to-glb` 走同一转换器 |
| `渲染静帧` | `<docId>.t<秒>.png` | 当前时刻姿态的确定性渲染（`WorkshopEngine.captureStill`）：固定相机预设（默认 45°，相对该时刻骨盆根定位）+ 固定 640×720 PNG，pixelRatio 钉 1、不随视口/轨道漂移；内部 `暂停 → 快照 time/playing/相机/叠加物可见态 → seek+solve+render+toBlob（同任务内）→ 原样恢复`，`preserveDrawingBuffer` 保证读回 | 编辑器叠加物（手柄/轨迹线/触球标记/洋葱皮/重心支撑）**默认不入图**——直切 `Object3D.visible`，不走 options/docDirty（不触发 rebuildAux）；`opts.overlays:true` 可保留 |
| `关键帧拼图` | `<docId>.sheet.png` | 逐关键帧时刻一格静帧拼 contact sheet（`captureSheet`）：默认全部键时刻，>12 键 `sheetTimes` 均匀抽样 12 格且首尾帧必保留；4 列网格，每格下方 `t=…s` 标注带 | 每格与单张静帧共用同一 `captureStill` 管线（同相机预设、同尺寸、同叠加物策略）；多格渲染间的等待由 `capturing` 标志压住 animate 循环对叠加物可见性的重建 |

五个导出共用同一份当前文档；姿态包与 GLB 由 `solvePackage()` 统一求解，fps 改动会得到不同 artifact id（不同文件名）；静帧与拼图不携带 artifact 身份，只是姿态审阅图。

内置动作不放在浏览器动作库里，而是按 motion-file 信封（`schemaVersion:1`）存于 `assets/motions/*.json`，由 `assets/motions/motion.schema.json` 与 `normalizeMotionFile` 双侧校验：三种 kind 的轨迹载体互斥——`kind:'workshop-motion'` 内嵌 `document`（与导出的 WorkshopDoc 同构），`kind:'clip-motion'` 指向外部动画片段（`clip.url`，如 walk），`kind:'dynamics-motion'` 携带 `dynamics.action` 肌肉动作参数与 `dynamics.records` 记录 URL（如 punch、baseball-throw）；dynamics-motion 还禁写 `document`/`clip` 与一切显示字段（name/duration/phases/capabilities 等由 `dynamics.action` 派生，`unwrapMotionFile` 与姿态包管线对它显式拒绝）。工作台与服务共用同一条 `normalizeMotionFile → frameAt → solveEffectiveFrame` 求解管线，因此内置动作的姿态与服务交付的姿态包同源。

## 边界

- 不做动力学：没有质量/惯性的真实积分、没有肌肉。合理性检查是运动学近似（de Leva 式分段质量分数）。
- 补间是限幅 Hermite（位置/角度通道）+ SO(3) 三次（手部朝向），未做时序优化/滤波；导出只含关键帧与约束，不含烘焙轨迹。质量度量走 `src/workshop/quality-probe.ts`（CLI：`npx tsx scripts/measure-quality-probe.mts`，校准基线在 `evidence/quality-probe-*.json`）。
- 手部 forward/normal 通过增量滑杆编辑；拖动平面默认面向相机。支撑脚锁定在地面高度拖动；离地脚可三维拖动（相机朝向平面）或在右侧面板用「抬升高度」滑块精确设置 `foot.target.y` —— 该高度即摆动路径点。离地帧时刻脚骨骼仍在上一个接触点，因此摆动区间内脚柄只作显示；青色「摆动路径点」手柄直接绑定离地帧存储的 `foot.target`，拖动它即编辑轨迹中点。末尾离地帧没有后续区间，面板会提示先添加落地帧。
- 与查看器共用 `rig/kinematics/racket` 模块；`gripFrame`/`mountRacket`/`applyGrip`/`blendGrip` 均接收 `side` 参数（缺省 `'R'` 保持旧语义），左挂载是右挂载的精确 x 镜像（手腕局部系在静止位形下与世界系同轴，位置 x 取反、四元数 y/z 取反）。工作台动作不进入主页动作库。
