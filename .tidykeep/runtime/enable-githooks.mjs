#!/usr/bin/env node
// 启用 tidykeep git hooks(团队成员克隆仓库后执行一次;离线可用,不依赖 npm)。
// core.hooksPath 是本地 git 配置,不随仓库同步,因此每人一次。
import { chmodSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false });

function stripShellComment(line) {
  let quote = '';
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function activeShellLines(text) {
  const out = [];
  const falseStack = [];
  let terminated = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const code = stripShellComment(raw).trim();
    if (!code) continue;
    if (/^fi(?:\s*;)?$/.test(code)) { falseStack.pop(); continue; }
    if (/^if\b/.test(code)) {
      const dead = /^if\s+(?:false|!\s*true)\s*;?\s*then(?:\s|$)/.test(code)
        || /^if\s+\[\s*(?:1\s+-eq\s+0|0\s+-ne\s+0)\s*\]\s*;?\s*then(?:\s|$)/.test(code)
        || falseStack.includes(true);
      falseStack.push(dead);
      if (!dead) out.push(code);
      if (/\bfi\s*;?$/.test(code)) falseStack.pop();
      continue;
    }
    if (terminated || falseStack.includes(true)) continue;
    if (/^exit(?:\s+[^;&|]+)?\s*;?$/.test(code)) { terminated = true; continue; }
    out.push(code);
  }
  return out;
}

// 与 CLI 的严格判定保持同一接受面：只承认显式 exec，或 sh 调用后 `|| exit $?`。
function externalHookChained(text, name) {
  const reference = `.tidykeep/githooks/${name}`;
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dqPrefix = `(?:(?:\\$\\([^\"]+\\)|\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?|/)[^\"]*)?`;
  const sqPrefix = `(?:(?:\\$\\([^']+\\)|\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?|/)[^']*)?`;
  const target = `(?:"${dqPrefix}${escaped}"|'${sqPrefix}${escaped}'|[^\\s;&|]*${escaped})`;
  const shell = `(?:(?:/usr/bin/env\\s+)?(?:/bin/)?(?:sh|bash)\\s+)`;
  const args = `(?:\\s+[^;&|]+)?`;
  const exec = new RegExp(`^exec\\s+(?:${shell})?${target}${args}\\s*;?$`);
  const checked = new RegExp(`^${shell}${target}${args}\\s*\\|\\|\\s*exit\\s+\\$\\?\\s*;?$`);
  return activeShellLines(text).some((code) => {
    return code.includes(reference) && (exec.test(code) || checked.test(code));
  });
}

function externalHooksReady(value) {
  const base = value.startsWith('~/')
    ? join(process.env.HOME ?? '', value.slice(2))
    : (isAbsolute(value) ? value : resolve(root, value));
  return ['pre-commit', 'commit-msg'].every((name) => {
    try { return externalHookChained(readFileSync(join(base, name), 'utf8'), name); }
    catch { return false; }
  });
}

const topResult = git('rev-parse', '--show-toplevel');
if (topResult.status !== 0) {
  const detail = (topResult.stderr ?? topResult.error?.message ?? '').trim();
  if (!topResult.error && /not a git repository/i.test(detail)) {
    console.log('[tidykeep] 非 git 仓库,跳过 git hooks(建议 git init 后重跑)');
    process.exit(0);
  }
  console.error(`[tidykeep] 无法确认 Git 仓库根目录,未作改动: ${detail || `git exit ${topResult.status}`}`);
  process.exit(1);
}
let gitRoot;
try { gitRoot = realpathSync(topResult.stdout.trim()); }
catch (error) {
  console.error(`[tidykeep] 无法确认 Git 仓库根目录,未作改动: ${error?.message ?? error}`);
  process.exit(1);
}
const sameRoot = process.platform === 'win32'
  ? gitRoot.toLowerCase() === root.toLowerCase()
  : gitRoot === root;
if (!sameRoot) {
  console.error(`[tidykeep] 拒绝启用:vendored runtime 位于 Git 仓库子目录 ${root};仓库根为 ${gitRoot}`);
  process.exit(1);
}

function requiredGitPath(flag, label) {
  const result = git('rev-parse', flag);
  const raw = (result.stdout ?? '').trim();
  if (result.error || result.status !== 0 || !raw) {
    const detail = (result.error?.message ?? (result.stderr ?? '').trim()) || `git exit ${result.status}`;
    console.error(`[tidykeep] 无法确认 ${label},未作改动: ${detail}`);
    process.exit(1);
  }
  try { return realpathSync(isAbsolute(raw) ? raw : resolve(root, raw)); }
  catch (error) {
    console.error(`[tidykeep] ${label}不可访问,未作改动: ${error?.message ?? error}`);
    process.exit(1);
  }
}

const gitDir = requiredGitPath('--git-dir', 'git dir');
const gitCommonDir = requiredGitPath('--git-common-dir', 'git common dir');
const sameGitDir = process.platform === 'win32'
  ? gitDir.toLowerCase() === gitCommonDir.toLowerCase()
  : gitDir === gitCommonDir;
if (!sameGitDir) {
  const mainRoot = basename(gitCommonDir) === '.git' ? dirname(gitCommonDir) : gitCommonDir;
  console.error(`[tidykeep] 拒绝启用: ${root} 是 linked worktree，core.hooksPath 与主仓库共享；请改在主仓库操作: ${mainRoot}`);
  process.exit(1);
}

const hooksDir = join(root, '.tidykeep', 'githooks');
try {
  for (const [path, type] of [
    [join(root, '.tidykeep'), 'directory'], [hooksDir, 'directory'],
    [join(hooksDir, 'pre-commit'), 'file'], [join(hooksDir, 'commit-msg'), 'file'],
  ]) {
    const stat = lstatSync(path);
    const valid = !stat.isSymbolicLink()
      && (type === 'directory' ? stat.isDirectory() : stat.isFile());
    if (!valid) throw new Error(`${path} 必须是项目内普通${type === 'directory' ? '目录' : '文件'}(禁止 symlink)`);
  }
  if (process.platform !== 'win32') {
    chmodSync(join(hooksDir, 'pre-commit'), 0o755);
    chmodSync(join(hooksDir, 'commit-msg'), 0o755);
  }
} catch (error) {
  console.error(`[tidykeep] git hooks 目录不安全或不完整,未作改动: ${error?.message ?? error}`);
  process.exit(1);
}

const curResult = git('config', 'core.hooksPath');
if (curResult.error || (curResult.status !== 0 && curResult.status !== 1)) {
  console.error(`[tidykeep] 读取 core.hooksPath 失败,未作改动: ${(curResult.stderr ?? curResult.error?.message ?? '').trim()}`);
  process.exit(1);
}
const cur = curResult.status === 0 ? curResult.stdout.trim() : '';
if (!cur) {
  const set = git('config', 'core.hooksPath', '.tidykeep/githooks');
  if (set.error || set.status !== 0) {
    console.error(`[tidykeep] 写入 core.hooksPath 失败,git hooks 未启用: ${(set.stderr ?? set.error?.message ?? '').trim()}`);
    process.exit(1);
  }
  const verify = git('config', 'core.hooksPath');
  if (verify.error || verify.status !== 0 || verify.stdout.trim() !== '.tidykeep/githooks') {
    console.error('[tidykeep] core.hooksPath 写入后校验失败,git hooks 未可靠启用');
    process.exit(1);
  }
  console.log('[tidykeep] git hooks 已启用(core.hooksPath -> .tidykeep/githooks;原 .git/hooks 同名 hook 会被链式执行)');
} else if (cur === '.tidykeep/githooks') {
  console.log('[tidykeep] git hooks 已是启用状态');
} else if (externalHooksReady(cur)) {
  console.log(`[tidykeep] 外部 core.hooksPath=${cur} 已完整链入 tidykeep`);
} else {
  console.log(`[tidykeep] 检测到已有 core.hooksPath=${cur}(如 husky),未覆盖。`);
  console.log(`  请在 ${cur}/pre-commit 与 ${cur}/commit-msg 中各加入一行:`);
  console.log('    sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/pre-commit" "$@" || exit $?');
  console.log('    sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/commit-msg" "$@" || exit $?');
  process.exit(1);
}
