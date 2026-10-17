# 新增肌肉驱动动作：参数模板

本工作流面向已经有模型的动作：沿用现有 MyoSim 降阶骨架、支撑约束、右臂目标和肌肉控制器时，只需复制 / 修改 JSON，模型目录会自动将它显示为一个动作。无需为每个动作添加 TypeScript 注册分支。

## 创建与运行

先安装一次项目固定的仿真依赖：

```sh
python3 -m venv .venv-dynamics
source .venv-dynamics/bin/activate
pip install -r scripts/requirements-dynamics.txt
```

创建动作文件：

```sh
npm run dynamics:new -- --id medicine-ball-push --title "药球推送"
```

编辑 `assets/actions/medicine-ball-push.json` 中的 `display`、`reference.keyframes` 和来源说明。每个关键帧给出秒数、阶段名、骨盆偏航、需要控制的标量关节角（度），以及 MyoSim 骨盆相对坐标系中的右肘 / 右腕位置（米，源模型 Z 向上）。角度 / 位置是任务目标，不是会被直接播放的最终姿态。使用真实数据时填好原始动作文件、区间、出处和许可；如果姿态是工程估计，将来源明确标为 `engineering-approximation`。

验证、进行两组肌肉正向积分并导出浏览器记录：

```sh
npm run dynamics:validate
npm run dynamics:build -- medicine-ball-push
npm run dynamics:test -- medicine-ball-push
npm run build
npm run dev
```

Vite 在构建时从 `assets/actions/*.json` 自动生成动作库。新的数据文件提供名称、说明、目标阶段、是否单次播放、物体负载文字和肌力对照参数；动作面板、阶段标记、播放时间轴和力学面板随之出现。动作记录、源模型路径、运行版本和审核指标存放在 `assets/dynamics/` 与 `public/dynamics/`。只编辑关键帧和 metadata 不需要更改 `motions.ts`、`App.tsx` 或 `engine.ts`。

项目中的可复制例子是 `assets/actions/baseball-throw.json` 与 `assets/actions/punch.json`；字段解释和来源见 [DYNAMICS.md](DYNAMICS.md)。JSON Schema 在 `assets/actions/action.schema.json`。

## 当前模板能表达什么

- 降阶骨架有 `nq=52`、`nv=50`：44 个活动关节自由度和 6 个浮动根速度自由度。两侧肩 / 肘、躯干、双侧髋膝踝，以及右腕、前臂、拇指和四指可动；双足用固定支撑夹具。
- 任务姿态可以通过骨盆偏航、任意活动标量关节目标，以及右肘 / 右腕任务点来表达。肩肘 IK 保持固定骨长，并在生成目标时检查胸廓间隙与可达性。
- 采样速率、模拟步长、控制频率和肌力容量扰动。投掷与直拳都不自动创建手持物体。
- 动作阶段、标题、观察重点、运动参考、工程近似和许可证来源。

关键帧之间采用非均匀三次 Hermite 轨迹，并由有界肌肉招募器跟踪；它不会让每个关节各自按正弦函数摆动。`dynamics:build` 的 IK 目标误差、间隙、积分控制误差和两个容量案例会先留在运行记录里，出现关节越限、支撑漂移或过大目标误差时应继续调整参数，不要直接发布截图。

## 无法只靠参数新增的结构

当前模板仍固定双足，限制肩胛和腰椎细分；左臂的肩与肘可动，但左腕 / 手指没有独立肌肉控制。增加滑步或换步、脚底接触切换、独立左臂任务、球体释放与飞行、多物体碰撞、新骨骼 / 执行器或不同种类 IK 目标，需要修改模型和 / 或求解器代码，再重新验证。固定足的原地投掷不能只靠 JSON 变成完整棒球投球模拟。

新动作如果超过可达范围、可用肌力或模型接触设置，参数模板不会自动使它变成可信的人体动作。它会给出仿真审计错误或较大跟踪残差；应缩小任务、调整可支持的模型结构，或换用适合该动作的实测运动数据。所有结果仍需浏览器视觉 review。
