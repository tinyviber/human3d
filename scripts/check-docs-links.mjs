#!/usr/bin/env node
/*
 * Markdown 相对链接检查器（零依赖，Node 标准库）。
 *
 * 覆盖范围：git 跟踪的全部 *.md（另含未被 ignore 的未跟踪 *.md，
 * 使本地提交前即可检查新文档）中的行内链接/图片目标 `](...)`。
 * 对相对链接做文件/目录存在性检查；外部 URL（scheme:...）、纯 # 锚点跳过。
 * 代码围栏（``` / ~~~）与行内 `code` 段内的 `](...)` 不计入。
 *
 * 豁免原则：不允许静默豁免。ALLOWLIST 每一条必须写明理由；当链接被修复或
 * 源文件中的该链接消失时，对应豁免条目会成为「过期豁免」并使检查失败——
 * 防止 allowlist 漂移成无声的白名单。
 *
 * 出口码：0 = 无死链（或全部 allowlisted）；1 = 有未豁免死链或过期豁免。
 *
 * 已知盲区（当前仓库无对应写法，暂未覆盖）：reference-style 链接
 * `[t][r]` / `[r]: url`；目标含未编码空格的 `](a b.md)` 不匹配即静默跳过；
 * 4 空格缩进代码块不排除。仓库出现这些写法时需补强本检查器。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * 已知无法修复的死链（任务规则禁止 vendor 未核实来源/许可的素材，
 * 上游仓库内路径亦未核实，故不推定 URL）。解除方式只能是上游核实后
 * vendor 素材或改写链接——在此之前保持豁免并携带理由。
 * 阻塞说明同步记录在 docs/decisions/0009-knowledge-layout.md。
 */
const ALLOWLIST = [
  {
    file: 'assets/source/MAKEHUMAN-LICENSE.md',
    target: 'LICENSE.CODE.md',
    reason:
      '上游 MakeHuman 许可声明引用的同目录文件，未 vendor；上游路径未核实，不推定改写',
  },
  {
    file: 'assets/source/MAKEHUMAN-LICENSE.md',
    target: 'LICENSE.ASSETS.md',
    reason:
      '上游 MakeHuman 许可声明引用的同目录文件，未 vendor；上游路径未核实，不推定改写',
  },
  {
    file: 'assets/source/dynamics/ARM-MODEL.md',
    target: '../../../docs/images/DELT1_DELT1_l_shoulder_elv_r.png',
    reason:
      '上游 MyoSim 模型文档配图（肌肉左右对称关系图），未 vendor；来源与许可未核实',
  },
  {
    file: 'assets/source/dynamics/LEG-MODEL.md',
    target: '../../../docs/images/glmax1_r_glmax1_l_hip_flexion_r.png',
    reason:
      '上游 MyoSim 模型文档配图（glmax1 左右髋屈曲关系图），未 vendor；来源与许可未核实',
  },
  {
    file: 'assets/source/dynamics/TORSO-MODEL.md',
    target: '../../../docs/images/IL_L1_r_IL_L1_l_flex_extension.png',
    reason:
      '上游 MyoSim 模型文档配图（IL_L1 左右屈伸关系图），未 vendor；来源与许可未核实',
  },
];

const allowlist = new Map(ALLOWLIST.map((e) => [`${e.file} -> ${e.target}`, e]));
const allowlistUsed = new Set();

const files = [
  ...new Set(
    execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '--', '*.md'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean),
  ),
];

// 行内链接与图片目标：](target)、](<target>)、](target "title")
const LINK_RE = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+["'][^"']*["']\s*)?\)/g;
const FENCE_RE = /^\s*(```+|~~~+)/;
const INLINE_CODE_RE = /`[^`]*`/g;

const dead = [];
let linkCount = 0;

for (const file of files) {
  const abs = path.join(ROOT, file);
  const text = readFileSync(abs, 'utf8');
  const dir = path.dirname(abs);
  let inFence = false;
  text.split('\n').forEach((line, i) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const stripped = line.replace(INLINE_CODE_RE, '');
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(stripped))) {
      const raw = (m[1] ?? m[2] ?? '').trim();
      if (!raw || raw.startsWith('#')) continue;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) continue; // http(s):, mailto: 等外部协议
      linkCount++;
      const target = raw.split('#')[0].split('?')[0];
      if (!target) continue; // 纯锚点
      let decoded = target;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        /* 保留原文 */
      }
      const resolved = path.resolve(dir, decoded);
      if (existsSync(resolved)) continue;
      const key = `${file} -> ${raw}`;
      const entry = allowlist.get(key);
      if (entry) {
        allowlistUsed.add(key);
        dead.push({ file, line: i + 1, target: raw, exempt: true, reason: entry.reason });
      } else {
        dead.push({ file, line: i + 1, target: raw, exempt: false });
      }
    }
  });
}

const stale = [...allowlist.keys()].filter((k) => !allowlistUsed.has(k));

for (const d of dead) {
  const tag = d.exempt ? 'ALLOWLISTED' : 'DEAD';
  console.log(`[${tag}] ${d.file}:${d.line} -> ${d.target}${d.exempt ? `\n    理由：${d.reason}` : ''}`);
}
for (const key of stale) {
  console.log(`[STALE-ALLOWLIST] ${key}\n    链接已不存在或已可解析，请移除该豁免条目。`);
}

const unexempted = dead.filter((d) => !d.exempt).length;
console.log(
  `\n检查 ${files.length} 个 Markdown 文件、${linkCount} 条相对链接：` +
    `${unexempted} 条死链，${dead.length - unexempted} 条豁免，${stale.length} 条过期豁免。`,
);
process.exit(unexempted === 0 && stale.length === 0 ? 0 : 1);
