# 领域不变量：姿态包与 Motion Protocol v1

改 `protocol.ts`、`pose-package.ts`、`package-export.ts`、`package-inspect.ts`、`validate.ts`、`apps/server` 或 `spec/` 前必读本文。协议方案见 [../ANIMATION-PROTOCOL-PLAN.md](../ANIMATION-PROTOCOL-PLAN.md)，校验阈值见 [../validation.md](../validation.md)，契约在 `spec/`。

## 身份与时间轴

- 包 `id` = hash(请求指纹 + 定义 + rig manifest + solver 名/版本)；`provenance.requestFingerprint` 是请求身份。两者分离，不要合并（[../decisions/0002-package-identity-service-version.md](../decisions/0002-package-identity-service-version.md)）。
- `timestamps.at(-1) === duration` 恒成立；非整数 `duration*fps` 追加精确终点；密度上限 `⌈duration·fps−1e-6⌉+1` 按包声明 fps 计（[../decisions/0003-timestamps-endpoint-contract.md](../decisions/0003-timestamps-endpoint-contract.md)）。
- 求解语义变化必须 bump `SERVICE_VERSION`；规范形态的请求（`normalizeDoc` 折叠后）决定指纹，同义写法共享制品 id。

## Web/Server 字节对等

- 工作台「导出姿态包」≡ 同文档 `POST /v1/motions` 响应：共享 `buildPosePackageLocal`/`solveWorkshop`/`validatePosePackage` 路径；对等测试逐字节钉死（含 422 details 逐字、超限 400、双错输入次序）。**双端打包逻辑不得各自漂一份**——`subtleDigest`（WebCrypto）↔ `sha256`（node:crypto）经 `Digest` 注入共用 `core/protocol.ts` 规范原语。
- GLB 是派生品：不承载身份契约，动画名/文件名借用制品 id 仅为对应关系（[../decisions/0006-presentation-channel-glb-derivative.md](../decisions/0006-presentation-channel-glb-derivative.md)）。

## 信封与 spec 派生

- `posePackageSpec`：bundled 包按 `action.id` 取注册表信封（capabilities/name/phases/method/focus，`oneShot=!document.loop`）；adhoc 包（`workshop-doc`）读 `action.parameters.presentation`。信封对 bundled 包是权威，伪造 parameters 不越信封权。
- `phases` 只按包内事件派生（`phase` 优先、`keyframe` 兜底）；`wantsProp` 常量显示是 v2 无逐帧握拍量的诚实上限。
- 导入信任门：`rigMatches(p, manifestHash)` 不符拒收（哈希不可知时降级骨骼名检查并注明「rig 未验证」）；信封 `trust` 闭包核对包内 `definitionSHA256` 与本地预算哈希，不符走 ad-hoc 通道并在 description 注明。

## 两道校验门

- 浏览器导入 `checkPosePackageShape` 与服务端契约 `validatePosePackage` 是不同信任边界，**不合并**（[../decisions/0008-two-validation-gates.md](../decisions/0008-two-validation-gates.md)）。新增包字段/资源上限时两边都要过一遍 checklist。
- 资源上限要同时切断内存路径和 CPU 路径（413 拒绝 + `stream.destroy()`，learning [9]）；写入入口先拒绝，隔离只是兜底（learning [11]）。
- 服务目录只列可服务动作：`/v1/actions` 过滤 `kind==='workshop-motion'`；dynamics-motion 进动作库但不进服务目录（「不预告不可服务动作」断言钉死）。
