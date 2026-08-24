// skill 资产格式校验。约束来自 Agent Skills 规范:name 必须等于目录名、
// description ≤ 1024 字符、SKILL.md 建议 < 500 行、references 按需加载。
// 装错格式的 skill 会被 Agent 静默忽略——没有报错,只是不生效,所以安装前必须挡住。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESCRIPTION_MAX = 1024;
const SKILL_MD_MAX_LINES = 500;
const SKILL_MD_MAX_BYTES = 24_000;

export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  const body = match[1];
  const name = body.match(/^name:[ \t]*(.+)$/m)?.[1]?.trim();
  // 先取同行的值再判断，不要用负向先行断言——`description: >-` 会让 [ \t]* 回溯到
  // 零宽，断言随之通过，结果把折叠标记 ">-" 当成描述正文。
  const inline = body.match(/^description:[ \t]*(.*)$/m)?.[1]?.trim();
  let description;
  if (inline && !/^[>|][-+]?[0-9]*$/.test(inline)) {
    description = inline;
  } else {
    const folded = body.match(/^description:[ \t]*[>|][-+]?[0-9]*[ \t]*\r?\n((?:[ \t]+.*\r?\n?)+)/m);
    if (folded) {
      description = folded[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ');
    }
  }
  return { name, description };
}

/** 返回问题字符串数组;空数组表示通过。 */
export function validateSkill(name, dir) {
  const problems = [];
  const skillMd = join(dir, 'SKILL.md');

  let text;
  try { text = readFileSync(skillMd, 'utf8'); }
  catch { return [`${name}: 缺少 SKILL.md`]; }

  const fm = parseFrontmatter(text);
  if (!fm) return [`${name}: SKILL.md 缺少 YAML frontmatter`];

  if (fm.name !== name) problems.push(`${name}: frontmatter 的 name 是 ${JSON.stringify(fm.name)},必须等于目录名`);
  else if (!NAME_RE.test(name)) problems.push(`${name}: 目录名不符合规范(只允许小写字母数字与单连字符)`);
  if (name.length > 64) problems.push(`${name}: name 超过 64 字符`);

  if (!fm.description) problems.push(`${name}: description 缺失或无法解析`);
  else if (fm.description.length > DESCRIPTION_MAX) {
    problems.push(`${name}: description ${fm.description.length} 字符,超过 ${DESCRIPTION_MAX}`);
  }

  const lines = text.split(/\r?\n/).length;
  const bytes = Buffer.byteLength(text);
  if (lines > SKILL_MD_MAX_LINES) problems.push(`${name}: SKILL.md ${lines} 行,超过 ${SKILL_MD_MAX_LINES},请下沉到 references/`);
  if (bytes > SKILL_MD_MAX_BYTES) problems.push(`${name}: SKILL.md ${bytes} 字节,超过 ${SKILL_MD_MAX_BYTES},请下沉到 references/`);

  // 相对链接必须可达,否则 Agent 按需加载时会拿到空手。
  const targets = new Set([...text.matchAll(/\]\((?!https?:)([^)#\s]+)\)/g)].map((m) => m[1]));
  for (const target of targets) {
    try { statSync(join(dir, target)); }
    catch { problems.push(`${name}: SKILL.md 引用了不存在的 ${target}`); }
  }

  // references/ 里的孤儿文件永远不会被读到,是纯粹的体积。
  let refs = [];
  try { refs = readdirSync(join(dir, 'references')); } catch { /* 没有 references 是合法的 */ }
  for (const ref of refs) {
    if (!text.includes(`references/${ref}`)) problems.push(`${name}: references/${ref} 未被 SKILL.md 引用`);
  }

  return problems;
}

/** 扫描 skills 根目录,返回 [{ name, dir }],按名字排序。 */
export function discoverSkills(skillsRoot) {
  let entries;
  try { entries = readdirSync(skillsRoot); }
  catch { throw new Error(`skill 目录不可读:${skillsRoot}`); }
  return entries
    .filter((n) => !n.startsWith('.') && statSync(join(skillsRoot, n)).isDirectory())
    .sort()
    .map((name) => ({ name, dir: join(skillsRoot, name) }));
}

export function validateAll(skills) {
  return skills.flatMap(({ name, dir }) => validateSkill(name, dir));
}
