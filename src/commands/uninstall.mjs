// `tidykeep uninstall`：剥掉标记块、移除我们自己发布的 skill 文件，保留知识与用户内容。
// 所有权只由「内容精确等于当前 payload 发布内容」证明；被用户改过的文件一律保留并报告。
import { existsSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteFile } from '../lib/fs-safe.mjs';
import { stripBlockText } from '../lib/markers.mjs';
import { assertNoProjectSymlinks, canonicalProjectRoot } from '../lib/project-paths.mjs';
import {
  HASH_BEGIN, HASH_END, MD_BEGIN, MD_END, planInstall, SKILL_NAMES, SKILL_ROOTS, summarize,
} from './init.mjs';

/**
 * 后序递归删空目录：先清子目录，再判断自身。只能这样做——自顶向下会在遇到
 * 尚未清理的子目录时误判为「非空」而提前退出。返回自身是否已被删除。
 */
function pruneEmptyTree(abs) {
  let entries;
  try { entries = readdirSync(abs); } catch { return false; }
  for (const entry of entries) {
    const child = join(abs, entry);
    try { if (statSync(child).isDirectory()) pruneEmptyTree(child); } catch { /* 竞态忽略 */ }
  }
  try {
    if (readdirSync(abs).length) return false;
    rmdirSync(abs);
    return true;
  } catch { return false; }
}

/** 从 startAbs 起向上删空目录，止步于非空目录或项目根。 */
function pruneUpward(root, startAbs) {
  let current = startAbs;
  while (current !== root && current.startsWith(root)) {
    try {
      if (readdirSync(current).length) return;
      rmdirSync(current);
    } catch { return; }
    current = dirname(current);
  }
}

export function uninstall(dir, opts = {}) {
  let root;
  try {
    root = canonicalProjectRoot(dir ?? '.');
  } catch (error) {
    console.error(`[tidykeep] ${error.message}`);
    return 1;
  }

  let plan;
  try {
    plan = planInstall(root);
    assertNoProjectSymlinks(root, plan.map((w) => w.rel));
  } catch (error) {
    console.error(`[tidykeep] ${error.message}`);
    return 1;
  }

  const removed = [];
  const kept = [];
  let problems = 0;

  // 1. skill 文件：内容精确匹配才删。
  const shipped = new Map(
    plan.filter((w) => w.kind === 'skill').map((w) => [w.rel, w.data]),
  );
  for (const [rel, data] of shipped) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    if (!readFileSync(abs).equals(data)) {
      kept.push(`${rel}(内容与发布版本不一致,保留)`);
      problems += 1;
      continue;
    }
    unlinkSync(abs);
    removed.push({ rel, note: '移除', kind: 'skill' });
  }
  for (const skillRoot of SKILL_ROOTS) {
    for (const name of SKILL_NAMES) {
      const abs = join(root, skillRoot, name);
      if (existsSync(abs) && statSync(abs).isDirectory() && pruneEmptyTree(abs)) {
        // skill 目录已空并删除，继续向上清 .claude/skills、.claude 这类空壳。
        pruneUpward(root, join(root, skillRoot));
      }
    }
  }

  // 2. 标记块：严格配对才剥。
  for (const [rel, begin, end] of [
    ['AGENTS.md', MD_BEGIN, MD_END],
    ['CLAUDE.md', MD_BEGIN, MD_END],
    ['.gitignore', HASH_BEGIN, HASH_END],
  ]) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    const before = readFileSync(abs, 'utf8');
    const result = stripBlockText(before, begin, end);
    if (result.status === 'unpaired') {
      kept.push(`${rel}(标记不成对,拒绝改写)`);
      problems += 1;
      continue;
    }
    if (!result.stripped) continue;
    if (result.text.trim()) {
      atomicWriteFile(abs, Buffer.from(result.text), { mode: 0o644 });
      removed.push({ rel: `${rel} 的 tidykeep 块`, note: '剥离', kind: 'block' });
    } else {
      // 整个文件本来就只有我们注入的块 → 连文件一起删。
      unlinkSync(abs);
      removed.push({ rel, note: '移除', kind: 'block' });
    }
  }

  // 3. STATE.md：知识文件，永远保留。
  if (existsSync(join(root, 'STATE.md'))) kept.push('STATE.md(知识文件,始终保留)');

  console.log(`[tidykeep] 已卸载:${root}`);
  for (const line of summarize(removed)) console.log(`  ${line}`);
  for (const k of kept) console.log(`  保留  ${k}`);
  if (!removed.length && !kept.length) console.log('  (未发现 tidykeep 安装痕迹)');
  if (problems) {
    console.error(`[tidykeep] ${problems} 项无法证明所有权,已保守保留,请人工确认后删除。`);
    return 1;
  }
  return 0;
}
