# 肌肉表面分区数据

当前分区由真实的 Z-Anatomy 解剖网格投影生成，原先的 15 对手绘肌群轮廓已退役。应用继续使用 MakeHuman 连续蒙皮，运动求解、骨架和 UV 均不改变。

## 来源与选择

| 候选 | 依据 | 裁决 |
|---|---|---|
| [BodyParts3D 官方 4.0](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html) | 有官方 FMA 分类与原始 OBJ；[官方许可](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html)已更新为 CC BY 4.0。核查官方名称表后缺少腹直肌、咬肌及多种表情肌。 | 用于核对来源，不作为本次唯一几何源。 |
| [BodyParts3D 4.3 GitHub 下载工具](https://github.com/olivercase/body_parts_3d_api) | FMA/组件对应可追溯，但模型的版本、聚合关系与分部分类需要额外核对。 | 未复制其代码或模型。 |
| [Z-Anatomy 原始项目](https://github.com/Z-Anatomy/Models-of-human-anatomy) | 在 BodyParts3D 基础上补充了面部与腹部等结构，有独立命名的肌肉、肌头及分部。 | 采用。 |
| 健身 SVG/第三方查看器分类 | 多为少量肌群或启发式分类；核对中发现一个 BodyParts3D 查看器把胫骨前肌、腓骨肌等误归骨骼。 | 不作为解剖分类真源。 |

离线几何采用[固定转换提交](https://github.com/SeemaBansal1/3d-human-body-anatomy/tree/28912432581accd7a1c62129d55f0e9758221d48)导出的 `muscles.glb`、`skeleton.glb`、`skin.glb`，仅取原始 `zname`、`zgroup` 及几何。没有复制该查看器的描述、AI 文本、应用代码或器官层。导出过程在其 `pipeline/export_layers.py` 中可核对：世界变换烘焙、减面、Draco 压缩，保留命名。原始结构归属、文件 SHA256、固定下载地址及本地几何校验值见 [z-anatomy/source.json](z-anatomy/source.json)。

## 构建与范围

- `z-anatomy/geometry.npz` 保留 1003 个源结构的顶点、三角面与结构索引；476 个原“肌肉层”组件中的 14 个肌腱/腱膜等结构作为非肌肉遮挡物，462 个肌肉组件全部进入清单。
- `scripts/lib/anatomy_atlas.py` 依据原始名称合并同一侧同一肌肉的头/分部，保留各源对象身份；中文显示名在 [muscle-names.json](muscle-names.json)，未翻译项显示原始英文。
- 为协调两个人体的姿态与比例，使用骨端和皮肤截面地标建立薄板样条对应，再在源皮肤及肌肉/骨/肌腱表面查询。分界来自网格，不再绘制额外的肌肉轮廓。
- 腹斜肌的源对象含覆盖腹直肌的腱膜延伸：以实际腹直肌三角面的正面投影揭开这部分覆盖。表面显示资格另由 [surface-policy.json](surface-policy.json) 审计：明确排除眼外肌、舌/咽/喉、椎前颈肌及指定深层结构，逐项记录原因及参考。排除的网格继续作为中性遮挡物，源身份保留，表面面积为零；不会移走遮挡物再把更深肌肉露出来。
- 这是跨模型的近似表面对应，不是对 MakeHuman 人体的解剖标定。这是保守的浅表肌腹展示策略，并非完整射线可见性或逐层解剖系统；部分深层伸肌的远端可露出。排除或未映射结构保留零面积记录，不强行扩张到皮肤。`public/models/anatomy-regions.json` 记录表面覆盖、每块区域面积、源对象及对应误差；不宣称覆盖每一条人体肌肉。
- ID 遮罩使用 R/G 两通道保存 16 位身份，B 保存边缘覆盖，支持超过 255 个条目。CPU 拾取与 GPU 使用同一编码。

构建环境：`python3 -m pip install -r scripts/requirements-anatomy.txt`。普通离线重建：`python3 scripts/build-anatomy-surface.py`；`--check` 重新计算并校验结果。来源几何不进入网页下载，只发布生成的遮罩与清单。

重新导入：按 `source.json.files` 的固定 URL 下载为 `z-muscles.glb`、`z-skeleton.glb`、`z-skin.glb`，执行 `python3 scripts/import-z-anatomy.py --source-dir <下载目录>`。使用仓库已有的 Three.js Draco 解码器，无需 Blender；导入器拒绝与固定文件哈希不符的输入。

## 许可与修改

Z-Anatomy — Gauthier Kervyn；原始 BodyParts3D © The Database Center for Life Science。数据及派生肌肉遮罩/清单遵循 **CC BY-SA 4.0**，见 [原许可与署名](z-anatomy/UPSTREAM-LICENSE.txt)。应用代码原有 MIT 许可保持独立。

修改包括：使用固定导出版本的减面网格，离线解码/打包，非肌肉遮挡分类，肌头/分部合并，中文名，跨模型表面对应及 UV 遮罩烘焙。没有使用 Z-Anatomy 中另有非商业条款的内耳或肾脏模型。
