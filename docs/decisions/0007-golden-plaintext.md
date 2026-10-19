# ADR-0007：golden 文件保留原始轨迹，不哈希化压缩

状态：已确认（外部 review 第二轮的文档裁决）。证据见 [../history/investigate.md](../history/investigate.md)「外部 review 第二轮」。

## 决定

`spec/examples/idle.pose.json`（约 665KB）与 `spec/solver-baseline/*.golden.json` 这类原始轨迹 golden **保持明文**，不压缩成哈希。

## 被否方案

- **哈希化压缩 golden**：哈希只能回答「变没变」，回答不了「哪里变了」。WP-C 正是靠逐位 diff 证伪了「轨迹逐位不变」的提交声明，并给出逐骨 × 逐帧的偏差位置表——漂移可定位的价值高于体积成本。

## 退路

若将来体积过大，可另加一份采样点摘要文件做速查，但 oracle 本体保持原始轨迹不缩水。

## 关联

- `spec/solver-baseline/` 的语义是**求解器变更探测器**（重捕获容差 1e-3°/1e-3mm，只盖平台浮点抖动），不是迁移等价断言——语义的转变记录见 history WP-C。
