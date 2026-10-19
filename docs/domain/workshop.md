# 领域不变量：工作台 UI 与持久化

改 `apps/web/src/workshop/`、播放源或工作台 E2E 前必读本文。功能全景见 [../WORKSHOP.md](../WORKSHOP.md)，验收记录见 [../QA.md](../QA.md)。

## 真实写路径

- 算法支持的每个能力都必须存在真实 UI 写入路径（learning [5]）：参数能进文档、有控件、禁用态合理。QA 验收用真实指针/输入事件（`scripts/forehand-study/drive.mjs`、`browser-qa.mjs`），不直调引擎写方法（读路径/播放控制除外）。
- 测试复现「出问题的具体交互路径」（learning [10]）：修交互 bug 要配一条走真实事件的断言，旁路改数据不算覆盖。

## 显示与编辑分离

- 渲染位置 ≠ 编辑目标时必须拆两个控件：摆动区间内脚柄 `passive`（显示真实位置、拾取穿透），青色 `swing` 手柄绑离地帧存储目标、跟手（learning [6]）。手柄必须跟手是所见即所得底线。
- 死数据写入口就近提示（learning [7]）：末尾离地帧无后续区间、存储高度不会被采样——UI 给出显式提示且不显路径点手柄。

## 撤销与文档生命周期

- 撤销合并窗口的键是「同一文档、同一事务」（`RecordGate`）：跨文档/撤销后必录新快照；增量控件把文档纪元编进 key 随撤销重置（learning [13]）。
- **跨文档恢复只做选择切换**：快照是指针，undo/redo 恢复目标 id ≠ 当前 id 时只 `selectDoc`，绝不向异 id 文档写内容；同 id 恢复才覆写自身历史。新文档（如镜像产物）的书预存源快照 → 一步选回。
- 删文档连同其撤销书（`onRemoved` 钩子）；恢复目标不在库中走 hint，不静默吞步。

## 持久化与隔离

- `MotionLibrary`：JSON 损坏或 `schemaVersion` 未知时整体进隔离区、跳过自动保存、原文不覆盖（learning [14]）；隔离导出对字符串原文原样导出。
- 生成预览（`generationPreview`）是易失覆盖，不落 localStorage、不进库字节；取消清空候选恢复源，保留才复制为新文档。

## 渲染导出

- `captureStill`/`captureSheet`：固定 640×720 / 固定相机预设出图，编辑器叠加物默认不入图；`CaptureMutex` 入口互斥，拼图全程持有 `captureDepth`，全部 tile 对同一文档冻结副本求解。
