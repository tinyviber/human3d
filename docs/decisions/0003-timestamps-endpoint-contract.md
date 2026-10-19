# ADR-0003：姿态包时间轴终点是等式契约，不是近似约定

状态：已确认（PR #1 提案 No.3 之一；密度上限 off-by-one 在复核轮修正）。证据见 [../history/investigate.md](../history/investigate.md) 第二轮 review 与「复核追加轮 2」。

## 决定

- `timestamps.at(-1) === duration` 恒成立，是独立校验器的硬检查，不是「约等于 duration」。
- 采样网格 = 均匀 `1/fps` 步进；非整数 `duration*fps` 时**追加精确终点**而不是截断——`round(duration*fps)+1` 假设整数网格，曾让 `forehand@fps=1` 丢 5.2s 终点（learning [8]）。
- 包密度上限按生产者真实网格写：`count ≤ ⌈duration·fps − 1e-6⌉ + 1`，`fps` 取包自己声明的 `timeline.fps`（须在 (0,240] 内，缺省回退 240 外沿）。曾写成 `duration×240+1` 会拒收 `duration=0.502s @240fps` 的合法包（网格顶到 0.5 再补 0.502 → count=122）——上限公式必须描述**真实采样网格**，不是看上去合理的近似。

## 推论

- 边界值协议一律用等式/显式契约表达（learning [8]）：采样网格的终点语义、密度上限、事件配对区间。
- 声明 fps 与网格密度必须一致：声明 60 却携带 240 密度的包是不一致数据，按上限拒收。
