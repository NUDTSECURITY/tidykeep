// `tidykeep init`：把 payload/skills/ 下的全部 skill 铺到三家 Agent 都能发现的位置。
// 默认用户级（~），这样换项目不必重装；--project 用于随仓库分发给团队。
// skill 目录自动发现——新增 skill 只要放进 payload/skills/，不必改代码。
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile } from '../lib/fs-safe.mjs';
import { upsertBlockText } from '../lib/markers.mjs';
import { discoverSkills, parseFrontmatter, validateAll } from '../lib/skill-validate.mjs';
import {
  assertGitProjectRoot, assertNoProjectSymlinks, canonicalProjectRoot,
} from '../lib/project-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = join(HERE, '..', '..', 'payload');
export const SKILLS_SRC = join(PAYLOAD, 'skills');

export const MD_BEGIN = '<!-- tidykeep:begin -->';
export const MD_END = '<!-- tidykeep:end -->';
export const HASH_BEGIN = '# >>> tidykeep >>>';
export const HASH_END = '# <<< tidykeep <<<';

export const CLAUDE_POINTER = `# 项目规则入口(tidykeep)

本项目所有 Agent 规则统一维护于 AGENTS.md,请勿在本文件重复添加规则。以下导入其全文:

@AGENTS.md`;

export const GITIGNORE_BODY = '.tmp/';

/**
 * 用户级路由表。skill 的 description 是语义匹配，可能不命中；规则文件则是每次会话
 * 必然全量加载的，把路由写在这里才谈得上"自动调用"。保持短——它每次会话都占上下文。
 */
export const USER_ROUTER = `## Skill 自动路由

本机装有下列 skill。**遇到对应情形主动调用,不要等用户点名**:

| 遇到这种情形 | 调用 |
|---|---|
| 要为新功能或缺陷**写测试、改测试、补测试** | \`blind-test\`(先定契约与验收条款,再写实现) |
| 一段开发工作**告一段落、准备提交**,或用户说"就这样吧/搞定了" | \`tidykeep\`(核对文档漂移、清会话残留、同步 STATE.md) |
| 要判断**一个仓库或模块的整体质量**、盘技术债、大改前摸底 | \`rigor3\`(三维度 60 控制项打分与整改清单) |
| 从一个**模糊想法**做出系统、写 PRD、需求没想清楚 | \`sdlc\`(八阶段,问询式澄清需求) |

分工:知识层归 \`tidykeep\`,代码层归 \`rigor3\`,写测试归 \`blind-test\`,长流程归 \`sdlc\`。
未安装的 skill 忽略对应行即可。`;

/**
 * 用户级规则文件位置。只写官方核实过的两处：
 * Claude Code 读 ~/.claude/CLAUDE.md；Codex 全局读 ~/.codex/AGENTS.override.md，
 * 不存在时才读 ~/.codex/AGENTS.md（override 存在时写 AGENTS.md 会被无声忽略）。
 * Kimi 的用户级指令路径尚未现场核实，故不写——见 STATE.md 待办。
 */
export function userRuleFiles(home) {
  const codexOverride = join(home, '.codex', 'AGENTS.override.md');
  return [
    '.claude/CLAUDE.md',
    existsSync(codexOverride) ? '.codex/AGENTS.override.md' : '.codex/AGENTS.md',
  ];
}

/**
 * 三家 Agent 的 skill 发现目录。用户级与项目级同名，只是根不同——
 * Codex 只扫 .agents/skills，Claude 读 .claude/skills，Kimi 两处都读。
 */
export const SKILL_ROOTS = ['.claude/skills', '.agents/skills'];

export function listSkillFiles(skillDir) {
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

/** 解析 --skills 选择，undefined 表示全部。返回 [{name, dir}]。 */
export function selectSkills(wanted) {
  const all = discoverSkills(SKILLS_SRC);
  if (!wanted?.length) return all;
  const byName = new Map(all.map((s) => [s.name, s]));
  const missing = wanted.filter((n) => !byName.has(n));
  if (missing.length) {
    throw new Error(`未知 skill: ${missing.join(', ')};可用: ${all.map((s) => s.name).join(', ')}`);
  }
  return wanted.map((n) => byName.get(n));
}

/** 计划要写的文件。protocol=true 时附带 tidykeep 协议文件（仅项目级有意义）。 */
export function planInstall(skills, { protocol, root, scope }) {
  const writes = [];
  for (const { name, dir } of skills) {
    for (const file of listSkillFiles(dir)) {
      const data = readFileSync(join(dir, file));
      for (const skillRoot of SKILL_ROOTS) {
        writes.push({ rel: `${skillRoot}/${name}/${file}`, data, kind: 'skill' });
      }
    }
  }

  if (scope === 'user') {
    // 路由表写进用户级规则文件——否则装了 skill 也只能靠语义匹配碰运气。
    for (const rel of userRuleFiles(root)) {
      writes.push({
        rel,
        block: { begin: MD_BEGIN, end: MD_END, body: USER_ROUTER },
        kind: 'block',
      });
    }
    return writes;
  }

  if (!protocol) return writes;

  writes.push({
    rel: 'AGENTS.md',
    block: { begin: MD_BEGIN, end: MD_END, body: readFileSync(join(PAYLOAD, 'rules.md'), 'utf8') },
    kind: 'block',
  });
  writes.push({
    rel: 'CLAUDE.md',
    block: { begin: MD_BEGIN, end: MD_END, body: CLAUDE_POINTER },
    kind: 'block',
  });
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

/** 把逐文件清单压成摘要：skill 按目录聚合，其余逐条列出。 */
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

/** 解析安装作用域。默认用户级——个人库的意义就是换项目不必重装。 */
export function resolveScope({ project }) {
  if (project === undefined) return { root: homedir(), scope: 'user', protocol: false };
  const root = canonicalProjectRoot(project || '.');
  assertGitProjectRoot(root, 'init');
  return { root, scope: 'project', protocol: true };
}

export function init(opts = {}) {
  let scope;
  let skills;
  try {
    scope = resolveScope(opts);
    skills = selectSkills(opts.skills);
  } catch (error) {
    console.error(`[tidykeep] ${error.message}`);
    return 1;
  }

  // 格式错误的 skill 会被 Agent 静默忽略，所以安装前 fail-closed。
  const problems = validateAll(skills);
  if (problems.length) {
    console.error('[tidykeep] skill 格式校验未通过,拒绝安装:');
    for (const p of problems) console.error(`  ✗ ${p}`);
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

  const resolved = [];
  for (const item of plan) {
    const abs = join(scope.root, item.rel);
    if (item.kind === 'create-if-missing') {
      if (existsSync(abs)) continue;
      resolved.push({ rel: item.rel, abs, data: item.data, note: '新建', kind: item.kind });
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
      resolved.push({
        rel: item.rel, abs, data: Buffer.from(result.text),
        note: result.existedBlock ? '更新块' : '注入块', kind: item.kind,
      });
      continue;
    }
    const before = existsSync(abs) ? readFileSync(abs) : null;
    if (before && before.equals(item.data)) continue;
    resolved.push({ rel: item.rel, abs, data: item.data, note: before ? '刷新' : '新建', kind: 'skill' });
  }

  const where = scope.scope === 'user' ? `用户级 ${scope.root}` : `项目 ${scope.root}`;
  if (opts.dryRun) {
    console.log(`[tidykeep] dry-run:${where}`);
    if (!resolved.length) console.log('  (无变化,已是最新)');
    for (const line of summarize(resolved)) console.log(`  ${line}`);
    return 0;
  }

  for (const w of resolved) {
    mkdirSync(dirname(w.abs), { recursive: true });
    atomicWriteFile(w.abs, w.data, { mode: 0o644 });
  }

  console.log(`[tidykeep] 已安装 ${skills.length} 个 skill → ${where}`);
  if (resolved.length) for (const line of summarize(resolved)) console.log(`  ${line}`);
  else console.log('  (无变化,已是最新)');
  if (scope.scope === 'user') {
    console.log('  这些 skill 现在对所有项目生效。新开会话后 Agent 才会重新扫描。');
  }
  return 0;
}

/** `tidykeep list`：列出库里有哪些 skill 及其一句话用途（取 description 的第一句）。 */
export function list() {
  const skills = discoverSkills(SKILLS_SRC);
  console.log(`[tidykeep] 库中有 ${skills.length} 个 skill:\n`);
  for (const { name, dir } of skills) {
    const fm = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
    const summary = (fm?.description ?? '').split(/[。.:：]/)[0].trim();
    console.log(`  ${name.padEnd(12)}  ${summary}`);
  }
  console.log('\n  装全部: tidykeep init        只装一个: tidykeep init --skills <name>');
  return 0;
}

/** `tidykeep doctor`：只校验库自身格式，不写任何文件。 */
export function doctor() {
  const skills = discoverSkills(SKILLS_SRC);
  const problems = validateAll(skills);
  if (problems.length) {
    console.error(`[tidykeep] ${skills.length} 个 skill,发现 ${problems.length} 个格式问题:`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    return 1;
  }
  console.log(`[tidykeep] ${skills.length} 个 skill 格式校验全部通过 ✓`);
  for (const { name } of skills) console.log(`  ✓ ${name}`);
  return 0;
}
