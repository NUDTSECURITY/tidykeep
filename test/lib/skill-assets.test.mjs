// skill 资产格式校验:纯 skill 形态下唯一还能机械证明的东西,替代原 doctor 的角色。
// 约束来自 Agent Skills 规范与 Codex 项目指令预算(见 STATE.md D-023)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKILLS_DIR = join(ROOT, 'payload', 'skills');

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESCRIPTION_MAX = 1024;      // 规范硬上限
const SKILL_MD_MAX_LINES = 500;    // 规范建议
const SKILL_MD_MAX_BYTES = 24_000; // ≈6000 tokens,留出余量的自设护栏
const RULES_MAX_BYTES = 32 * 1024; // Codex project_doc_max_bytes 默认值

function skillNames() {
  return readdirSync(SKILLS_DIR).filter((n) => statSync(join(SKILLS_DIR, n)).isDirectory()).sort();
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, 'SKILL.md 必须以 YAML frontmatter 开头');
  const body = match[1];
  const name = body.match(/^name:[ \t]*(.+)$/m)?.[1]?.trim();
  // description 支持单行与 >- / > 折叠块两种写法
  let description = body.match(/^description:[ \t]*(?!>|\|)(.+)$/m)?.[1]?.trim();
  if (description === undefined) {
    const folded = body.match(/^description:[ \t]*[>|]-?[ \t]*\r?\n((?:[ \t]+.*\r?\n?)+)/m);
    assert.ok(folded, 'description 缺失或格式无法解析');
    description = folded[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ');
  }
  return { name, description };
}

test('每个 skill 都有可解析的 frontmatter,且 name 等于目录名', () => {
  const names = skillNames();
  assert.ok(names.length >= 2, `期望至少两个 skill,实际:${names.join(', ')}`);
  for (const dir of names) {
    const { name } = parseFrontmatter(readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8'));
    assert.equal(name, dir, `${dir}/SKILL.md 的 name 必须等于目录名`);
    assert.match(name, NAME_RE, `${dir} 的 name 不符合规范命名规则`);
    assert.ok(name.length <= 64, `${dir} 的 name 超过 64 字符`);
  }
});

test('description 非空且在规范上限内', () => {
  for (const dir of skillNames()) {
    const { description } = parseFrontmatter(readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8'));
    assert.ok(description && description.length > 0, `${dir} 的 description 为空`);
    assert.ok(
      description.length <= DESCRIPTION_MAX,
      `${dir} 的 description 为 ${description.length} 字符,超过 ${DESCRIPTION_MAX}`,
    );
  }
});

test('SKILL.md 体量在预算内(超了应下沉到 references/)', () => {
  for (const dir of skillNames()) {
    const path = join(SKILLS_DIR, dir, 'SKILL.md');
    const text = readFileSync(path, 'utf8');
    const lines = text.split(/\r?\n/).length;
    const bytes = Buffer.byteLength(text);
    assert.ok(lines <= SKILL_MD_MAX_LINES, `${dir}/SKILL.md ${lines} 行,超过 ${SKILL_MD_MAX_LINES}`);
    assert.ok(bytes <= SKILL_MD_MAX_BYTES, `${dir}/SKILL.md ${bytes} 字节,超过 ${SKILL_MD_MAX_BYTES}`);
  }
});

test('SKILL.md 里的相对链接全部可达', () => {
  for (const dir of skillNames()) {
    const skillRoot = join(SKILLS_DIR, dir);
    const text = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
    const targets = new Set(
      [...text.matchAll(/\]\((?!https?:)([^)#\s]+)\)/g)].map((m) => m[1]),
    );
    assert.ok(targets.size > 0, `${dir}/SKILL.md 没有任何相对引用,检查是否漏写 references`);
    for (const target of targets) {
      assert.doesNotThrow(
        () => statSync(join(skillRoot, target)),
        `${dir}/SKILL.md 引用了不存在的 ${target}`,
      );
    }
  }
});

test('references/ 下没有从 SKILL.md 完全无法抵达的孤儿文件', () => {
  for (const dir of skillNames()) {
    const skillRoot = join(SKILLS_DIR, dir);
    const text = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
    let refs;
    try { refs = readdirSync(join(skillRoot, 'references')); } catch { continue; }
    for (const ref of refs) {
      assert.ok(text.includes(`references/${ref}`), `${dir}/references/${ref} 未被 SKILL.md 引用`);
    }
  }
});

test('rules.md 在 Codex 32 KiB 项目指令预算内', () => {
  const bytes = Buffer.byteLength(readFileSync(join(ROOT, 'payload', 'rules.md')));
  assert.ok(bytes <= RULES_MAX_BYTES, `rules.md ${bytes} 字节,超过 ${RULES_MAX_BYTES}`);
});
