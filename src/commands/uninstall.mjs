// `tidykeep uninstall`：移除本库发布的 skill 与协议标记块，保留用户内容与知识文件。
// 所有权只由「内容精确等于当前库中内容」证明；被改过的文件一律保留并非零退出。
import { existsSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteFile } from '../lib/fs-safe.mjs';
import { stripBlockText } from '../lib/markers.mjs';
import { assertNoProjectSymlinks } from '../lib/project-paths.mjs';
import {
  HASH_BEGIN, HASH_END, MD_BEGIN, MD_END,
  planInstall, resolveScope, selectSkills, SKILL_ROOTS, summarize,
} from './init.mjs';

/** 后序递归删空目录：自顶向下会在遇到尚未清理的子目录时误判非空而提前退出。 */
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

export function uninstall(opts = {}) {
  let scope;
  let skills;
  try {
    scope = resolveScope(opts);
    skills = selectSkills(opts.skills);
  } catch (error) {
    console.error(`[tidykeep] ${error.message}`);
    return 1;
  }

  let plan;
  try {
    plan = planInstall(skills, scope);
    if (scope.scope === 'project') assertNoProjectSymlinks(scope.root, plan.map((w) => w.rel));
  } catch (error) {
    console.error(`[tidykeep] ${error.message}`);
    return 1;
  }

  const removed = [];
  const kept = [];
  let problems = 0;

  const shipped = new Map(plan.filter((w) => w.kind === 'skill').map((w) => [w.rel, w.data]));
  for (const [rel, data] of shipped) {
    const abs = join(scope.root, rel);
    if (!existsSync(abs)) continue;
    if (!readFileSync(abs).equals(data)) {
      kept.push(`${rel}(内容与库中版本不一致,保留)`);
      problems += 1;
      continue;
    }
    unlinkSync(abs);
    removed.push({ rel, note: '移除', kind: 'skill' });
  }
  for (const root of SKILL_ROOTS) {
    for (const { name } of skills) {
      const abs = join(scope.root, root, name);
      if (existsSync(abs) && statSync(abs).isDirectory() && pruneEmptyTree(abs)) {
        pruneUpward(scope.root, join(scope.root, root));
      }
    }
  }

  if (scope.protocol) {
    for (const [rel, begin, end] of [
      ['AGENTS.md', MD_BEGIN, MD_END],
      ['CLAUDE.md', MD_BEGIN, MD_END],
      ['.gitignore', HASH_BEGIN, HASH_END],
    ]) {
      const abs = join(scope.root, rel);
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
        unlinkSync(abs);
        removed.push({ rel, note: '移除', kind: 'block' });
      }
    }
    if (existsSync(join(scope.root, 'STATE.md'))) kept.push('STATE.md(知识文件,始终保留)');
  }

  const where = scope.scope === 'user' ? `用户级 ${scope.root}` : `项目 ${scope.root}`;
  console.log(`[tidykeep] 已卸载:${where}`);
  for (const line of summarize(removed)) console.log(`  ${line}`);
  for (const k of kept) console.log(`  保留  ${k}`);
  if (!removed.length && !kept.length) console.log('  (未发现本库的安装痕迹)');
  if (problems) {
    console.error(`[tidykeep] ${problems} 项无法证明所有权,已保守保留,请人工确认后删除。`);
    return 1;
  }
  return 0;
}
