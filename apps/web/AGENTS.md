# AGENTS — @human3d/web

浏览器端：实验室（`src/lab/`）、统一播放源（`src/playback/`）、动作工作台（`src/workshop/`）与两个入口页。

## 边界（自动强制）

- 可 import `@human3d/motion-core`；生产代码**不得** import `@human3d/server`（测试可用其 devDependency）。
- Vite `publicDir`/`outDir` 指向仓库根 `public/`/`dist/`；相对路径不得越出本包。

## 定向测试

- `npm test -- apps/web/src/workshop/workshop.test.ts`（或 `mirror.test.ts`）、`apps/web/src/playback/motion-source.test.ts`
- 真实交互验收：`npm run qa`（需 dev server；`QA_BROWSER_CHANNEL=chrome` 走系统 Chrome；未进 CI）

## 检索指针

- 工作台不变量（真实写路径、显示/编辑分离、撤销/隔离）：[`docs/domain/workshop.md`](../../docs/domain/workshop.md)
- 姿态包导入/信封派生：[`docs/domain/pose-package.md`](../../docs/domain/pose-package.md)
- 功能与验收：[`docs/WORKSHOP.md`](../../docs/WORKSHOP.md)、[`docs/QA.md`](../../docs/QA.md)
