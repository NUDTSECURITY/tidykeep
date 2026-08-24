// `tidykeep init`：把两个 skill 铺到三家 Agent 都能发现的目录，并向 AGENTS.md /
// CLAUDE.md / .gitignore upsert 标记块。没有 hooks、没有 manifest、没有事务——
// 受管资产就是我们自己发布的文件，重跑即覆盖；用户文件只通过严格配对的标记块触碰。
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile } from '../lib/fs-safe.mjs';
import { upsertBlockText } from '../lib/markers.mjs';
import {
  assertGitProjectRoot, assertNoProjectSymlinks, canonicalProjectRoot,
} from '../lib/project-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = join(HERE, '..', '..', 'payload');

export const MD_BEGIN = '<!-- tidykeep:begin -->';
export const MD_END = '<!-- tidykeep:end -->';
export const HASH_BEGIN = '# >>> tidykeep >>>';
export const HASH_END = '# <<< tidykeep <<<';

export const CLAUDE_POINTER = `# 项目规则入口(tidykeep)

本项目所有 Agent 规则统一维护于 AGENTS.md,请勿在本文件重复添加规则。以下导入其全文:

@AGENTS.md`;

export const GITIGNORE_BODY = '.tmp/';

/** 三家 Agent 的项目级 skill 发现目录（官方口径见 STATE.md D-023）。 */
export const SKILL_ROOTS = ['.claude/skills', '.agents/skills'];
export const SKILL_NAMES = ['tidykeep', 'sdlc', 'blind-test'];

/** 递归列出 payload 里一个 skill 的全部文件，返回相对该 skill 目录的路径。 */
function listSkillFiles(skillDir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs).sort()) {
      const childAbs = join(abs, entry);
      const childRel = rel ? `${rel}/${entry}` : entry;
      if (statSync(childAbs).isDirectory()) walk(childAbs, childRel);
      else out.push(childRel);
    }
  };
  walk(skillDir, '');
  return out;
}

/** 计划出本次要写的全部文件：[{ rel, data }]。纯函数，便于 --dry-run 与测试。 */
export function planInstall(root) {
  const writes = [];

  for (const name of SKILL_NAMES) {
    const src = join(PAYLOAD, 'skills', name);
    for (const file of listSkillFiles(src)) {
      const data = readFileSync(join(src, file));
      for (const skillRoot of SKILL_ROOTS) {
        writes.push({ rel: `${skillRoot}/${name}/${file}`, data, kind: 'skill' });
      }
    }
  }

  const rules = readFileSync(join(PAYLOAD, 'rules.md'), 'utf8');
  writes.push({ rel: 'AGENTS.md', block: { begin: MD_BEGIN, end: MD_END, body: rules }, kind: 'block' });
  writes.push({ rel: 'CLAUDE.md', block: { begin: MD_BEGIN, end: MD_END, body: CLAUDE_POINTER }, kind: 'block' });
  writes.push({
    rel: '.gitignore',
    block: { begin: HASH_BEGIN, end: HASH_END, body: GITIGNORE_BODY },
    kind: 'block',
  });

  writes.push({
    rel: 'STATE.md',
    data: readFileSync(join(PAYLOAD, 'STATE.md')),
    kind: 'create-if-missing',
  });

  return writes;
}

/** 把逐文件清单压成人能读的摘要：skill 按目录聚合计数，其余逐条列出。 */
export function summarize(items) {
  const groups = new Map();
  const lines = [];
  for (const item of items) {
    if (item.kind === 'skill') {
      const dir = item.rel.split('/').slice(0, 3).join('/');
      const g = groups.get(dir) ?? { note: item.note, count: 0 };
      g.count += 1;
      if (g.note !== item.note) g.note = '更新';
      groups.set(dir, g);
    } else {
      lines.push(`${item.note}  ${item.rel}`);
    }
  }
  return [
    ...[...groups].map(([dir, g]) => `${g.note}  ${dir}/  (${g.count} 个文件)`),
    ...lines,
  ];
}

export function init(dir, opts = {}) {
  let root;
  try {
    root = canonicalProjectRoot(dir ?? '.');
    // 非 Git 目录可安装；属于 Git 时必须是主 worktree 根（D-021）。
    assertGitProjectRoot(root, 'init');
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

  // Preflight：标记块必须严格配对，否则整体拒绝，绝不吞用户内容。
  const resolved = [];
  for (const item of plan) {
    const abs = join(root, item.rel);
    if (item.kind === 'create-if-missing') {
      if (existsSync(abs)) continue;
      resolved.push({ rel: item.rel, abs, data: item.data, note: '新建' });
      continue;
    }
    if (item.kind === 'block') {
      const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
      const result = upsertBlockText(before, item.block.begin, item.block.end, item.block.body);
      if (result.status === 'unpaired') {
        console.error(`[tidykeep] ${item.rel} 的 tidykeep 标记不成对(孤立或逆序)。`);
        console.error('           请先手工修复标记后重跑;工具拒绝在此情况下改写,以免吞掉你的内容。');
        return 1;
      }
      if (result.text === before) continue;
      resolved.push({ rel: item.rel, abs, data: Buffer.from(result.text), note: result.existedBlock ? '更新块' : '注入块' });
      continue;
    }
    const before = existsSync(abs) ? readFileSync(abs) : null;
    if (before && before.equals(item.data)) continue;
    resolved.push({ rel: item.rel, abs, data: item.data, note: before ? '刷新' : '新建', kind: 'skill' });
  }

  if (opts.dryRun) {
    console.log(`[tidykeep] dry-run:${root}`);
    if (!resolved.length) console.log('  (无变化,已是最新)');
    for (const line of summarize(resolved)) console.log(`  ${line}`);
    return 0;
  }

  for (const w of resolved) {
    mkdirSync(dirname(w.abs), { recursive: true });
    atomicWriteFile(w.abs, w.data, { mode: 0o644 });
  }

  console.log(`[tidykeep] 已安装:${root}`);
  if (resolved.length) {
    for (const line of summarize(resolved)) console.log(`  ${line}`);
  } else {
    console.log('  (无变化,已是最新)');
  }
  console.log('  规则入口 AGENTS.md,设计真相 STATE.md。本协议靠约定执行,没有自动拦截。');
  return 0;
}
