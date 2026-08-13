// Git hooks 接线的只读判定。这里只承认会执行 tidykeep hook 且把失败向 Git
// 传播的保守 shell 形式，避免把注释、echo 示例或明显不可达分支误判为接线。
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const GIT_HOOK_NAMES = ['pre-commit', 'commit-msg'];

export function resolveHooksPath(target, value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return isAbsolute(value) ? value : resolve(target, value);
}

function stripShellComment(line) {
  let quote = '';
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function isObviousFalseCondition(code) {
  return /^if\s+(?:false|!\s*true)\s*;?\s*then(?:\s|$)/.test(code)
    || /^if\s+\[\s*(?:1\s+-eq\s+0|0\s+-ne\s+0)\s*\]\s*;?\s*then(?:\s|$)/.test(code);
}

function activeShellLines(text) {
  const lines = [];
  const falseStack = [];
  let terminated = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const code = stripShellComment(raw).trim();
    if (!code) continue;
    if (/^fi(?:\s*;)?$/.test(code)) { falseStack.pop(); continue; }
    if (/^if\b/.test(code)) {
      const dead = isObviousFalseCondition(code) || falseStack.includes(true);
      falseStack.push(dead);
      if (!dead) lines.push(code);
      if (/\bfi\s*;?$/.test(code)) falseStack.pop();
      continue;
    }
    if (terminated || falseStack.includes(true)) continue;
    if (/^exit(?:\s+[^;&|]+)?\s*;?$/.test(code)) { terminated = true; continue; }
    lines.push(code);
  }
  return lines;
}

/**
 * 接受两类显式故障传播形式：
 *   exec [sh] <tidykeep-hook> ...
 *   sh <tidykeep-hook> ... || exit $?
 */
export function hasExecutableTidykeepChain(text, hookName) {
  const reference = `.tidykeep/githooks/${hookName}`;
  for (const code of activeShellLines(text)) {
    if (!code.includes(reference)) continue;

    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dqPrefix = `(?:(?:\\$\\([^\"]+\\)|\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?|/)[^\"]*)?`;
    const sqPrefix = `(?:(?:\\$\\([^']+\\)|\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?|/)[^']*)?`;
    const target = `(?:"${dqPrefix}${escaped}"|'${sqPrefix}${escaped}'|[^\\s;&|]*${escaped})`;
    const shell = `(?:(?:/usr/bin/env\\s+)?(?:/bin/)?(?:sh|bash)\\s+)`;
    const args = `(?:\\s+[^;&|]+)?`;
    const exec = new RegExp(`^exec\\s+(?:${shell})?${target}${args}\\s*;?$`);
    const checked = new RegExp(`^${shell}${target}${args}\\s*\\|\\|\\s*exit\\s+\\$\\?\\s*;?$`);
    if (exec.test(code) || checked.test(code)) return true;
  }
  return false;
}

/** 卸载用的保守判定：不要求已证明故障传播，但排除注释、输出示例、赋值和死分支。 */
export function hasExecutableTidykeepReference(text, hookName) {
  const reference = `.tidykeep/githooks/${hookName}`;
  return activeShellLines(text).some((code) => {
    if (!code.includes(reference)) return false;
    if (/^(?:echo|printf|true|false|:)\b/.test(code)) return false;
    if (/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=/.test(code)) return false;
    return true;
  });
}

export function inspectExternalHooks(target, hooksPath) {
  if (!hooksPath) {
    return {
      ok: false, anyChained: false, anyReferenced: false,
      base: null, hooks: [], note: 'core.hooksPath 未设置',
    };
  }
  const base = resolveHooksPath(target, hooksPath);
  const hooks = GIT_HOOK_NAMES.map((name) => {
    const path = join(base, name);
    try {
      const text = readFileSync(path, 'utf8');
      const chained = hasExecutableTidykeepChain(text, name);
      const referenced = hasExecutableTidykeepReference(text, name);
      return { name, path, chained, referenced, readable: true };
    } catch (error) {
      return {
        name, path, chained: false, referenced: false, readable: false,
        errorCode: error?.code ?? null, error: error?.message ?? String(error),
      };
    }
  });
  const missing = hooks.filter(({ chained }) => !chained).map(({ name }) => name);
  return {
    ok: missing.length === 0,
    anyChained: hooks.some(({ chained }) => chained),
    anyReferenced: hooks.some(({ referenced }) => referenced),
    base,
    hooks,
    note: missing.length ? `未确认安全链入:${missing.join('、')}` : '',
  };
}
