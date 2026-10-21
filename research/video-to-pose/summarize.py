#!/usr/bin/env python3
"""Print the S2 summary tables (Markdown) from out/metrics/metrics-*.json for REPORT.md."""
import argparse
import glob
import json
import os


def f(v, nd=3):
    if v is None:
        return "–"
    return f"{v:.{nd}f}"


def pair(d, nd=3):
    return f"{f(d['mediapipe'], nd)} / {f(d['rtmpose'], nd)}"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("metrics_dir")
    args = ap.parse_args()
    files = sorted(glob.glob(os.path.join(args.metrics_dir, "metrics-*.json")))
    metrics = {os.path.basename(p)[len("metrics-"):-len(".json")]: json.load(open(p)) for p in files}

    print("| 片段 | 窗口 | 帧 | 检测率 MP / RT | limb_ok MP / RT | 画外率 MP / RT | 抖动中位 MP / RT | 一致性中位 / p90 / >0.10 |")
    print("|---|---|---:|---|---|---|---|---|")
    for name, m in metrics.items():
        for w in ["all", "w1", "w2", "w3"]:
            x = m["windows"][w]
            agree = x["agreement_torso"]
            print(f"| {name} | {w} | {x['frames']} | {pair(x['detect_rate'], 2)} | {pair(x['limb_ok_rate'], 3)} | "
                  f"{pair(x['outside_frame_rate'], 3)} | {f(x['jitter_torso']['mediapipe']['median'], 3)} / "
                  f"{f(x['jitter_torso']['rtmpose']['median'], 3)} | {f(agree['median'], 3)} / {f(agree['p90'], 3)} / "
                  f"{f(agree['frac_over_0_10'], 3)} |")

    print()
    print("| 片段 | 窗口 | 髋中心路径 MP / RT | 净位移 MP / RT | 脚接触占比 MP / RT | 接触一致 | MP 世界骨长 CV |")
    print("|---|---|---|---|---|---|---|")
    for name, m in metrics.items():
        for w in ["all", "w1", "w2", "w3"]:
            x = m["windows"][w]
            print(f"| {name} | {w} | {pair(x['hip_centre_path_torso'], 2)} | {pair(x['hip_centre_net_torso'], 3)} | "
                  f"{pair(x['heel_contact']['contact_frac'], 3)} | {f(x['heel_contact']['agreement'], 3)} | "
                  f"{f(x['bone_cv_world_mediapipe']['median'], 3)} |")

    print()
    print("| 片段 | 失败帧计数（MP 无检测 / MP 肢体低于阈值 / RT 无人 / RT 肢体低于阈值 / 偏差>0.25） | 失败区间（偏差>0.25，帧号从 0 起，最多列前 8 段） |")
    print("|---|---|---|")
    for name, m in metrics.items():
        c = m["failure_frames"]["counts"]
        spans = m["failure_frames"]["methods_disagree_over_0_25_torso"][:8]
        print(f"| {name} | {c['mediapipe_no_pose']} / {c['mediapipe_limb_below_threshold']} / {c['rtmpose_no_person']} / "
              f"{c['rtmpose_limb_below_threshold']} / {c['methods_disagree_over_0_25_torso']} | "
              + ", ".join(f"{a}–{b}" if a != b else f"{a}" for a, b in spans) + " |")

    print()
    print("| 片段 | 关节 | MP 可见度<0.5 占比 | MP 可见度中位 | RT 分数<0.3 占比 | 偏差中位 | 偏差 p90 |")
    print("|---|---|---:|---:|---:|---:|---:|")
    for name, m in metrics.items():
        for j, v in m["per_joint"].items():
            print(f"| {name} | {j} | {f(v['mediapipe_visibility_below_thr'])} | {f(v['mediapipe_visibility_median'], 2)} | "
                  f"{f(v['rtmpose_score_below_thr'])} | {f(v['disagreement_median_torso'], 3)} | {f(v['disagreement_p90_torso'], 3)} |")


if __name__ == "__main__":
    main()
