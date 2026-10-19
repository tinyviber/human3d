# ADR-0005：按依赖方向拆 npm workspaces 三包

状态：已实施（PR #9）。完整设计记录（结构、七条迁移裁决、验证证据、phase 2/3）见 [../ARCHITECTURE.md](../ARCHITECTURE.md)——本文只记裁决要点，不重复全档。

## 决定

- `packages/motion-core`（纯域，无 DOM/node）/ `apps/web`（场景与 DOM）/ `apps/server`（传输与 node 设施），依赖方向单向 web/server → motion-core。
- 归置原则：有非 Web 消费者的代码进 core（`validate`/`package-export`/`glb-export`/`quality-probe`/`random-document`）；`motion-source.ts` 拆成 core 的 `package-inspect` 与 web 的播放源。
- 边界由 `tests/architecture.test.ts`（TypeScript AST 解析）自动强制，不靠文档自觉。

## 被否备选（ARCHITECTURE.md「迁移裁决」有完整理由）

1. 按现有目录名（`server / workshop / ui`）拆包——边界仍然错；
2. 拆 4–5 个包含独立 `@human3d/protocol`——只增加需同步维护的构建配置；
3. 立即引入 Project References——`composite` 强制 declaration，改动 `tsc -b` 门禁语义；
4. `assets/motions/` 移进包——Python 工具链与契约测试共用该路径，属已知边界泄漏，不阻塞；
5. lab 与 workshop 拆成两个 Web 应用——两者共享 Rig、渲染与回放，同站两入口。

## 维护规则

新增模块先问「谁在用」；跨包只走包名导入；core 新代码不得引入 `node:`/DOM/three 之外的重依赖；求解语义变化同步 `SERVICE_VERSION`。
