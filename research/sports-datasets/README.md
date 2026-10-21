# 运动数据集可行性审计

这是一次独立调研，用来判断五个公开运动数据集能不能帮 human3d 处理现在的正手下蹲、脚接触和视频姿态问题。生产求解器、Motion Protocol 和界面都没有改。

报告：[REPORT.md](REPORT.md)

离线脚本：[audit_pose.py](audit_pose.py)。`python3 audit_pose.py selftest` 不需要数据。真实样本的统计和棍图在 [evidence/](evidence/)。下载的数据集文件被 [.gitignore](.gitignore) 排除，不进仓库。
