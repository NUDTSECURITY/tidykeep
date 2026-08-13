// tidykeep runtime 配置解析与安全归一(vendored;由 `npx tidykeep init` 刷新,请勿手改)。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toPosix } from './paths.mjs';

export const DEFAULT_CONFIG = {
  // 文件命名守卫(拦截 _v2/_old/copy/副本 等历史副本命名)
  GUARD: true,
  // 台账同步强制等级:block(阻止收工/提交)/ warn(仅提醒)/ off
  ENFORCE_LEDGER: 'block',
  // 视为"需同步台账"的扩展名
  CODE_EXTS: ['py', 'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs', 'go', 'rs', 'java', 'rb', 'php', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'scala', 'sql', 'sh', 'bash', 'zsh', 'vue', 'svelte', 'ipynb'],
  DOC_EXTS: ['md', 'rst', 'txt', 'adoc', 'json', 'jsonc', 'yml', 'yaml', 'toml', 'xml', 'properties', 'gradle', 'lock'],
  // 无扩展名或扩展名不在上表、但仍需逐文件同步台账的项目根精确路径
  WATCH_FILES: ['package.json', '.gitignore', '.gitattributes', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Makefile', 'Dockerfile'],
  // 历史副本命名模式(JS RegExp,i 标志)
  STALE_RE: '([_. -](v[0-9]+|old|new|final|finalfinal|backup|bak|copy[0-9]*|dup|tmp|temp|deprecated|legacy|orig)[_. -]*|\\([0-9]+\\)|副本|旧版|备份)\\.[A-Za-z0-9]+$',
  // 项目内草稿区目录名(已 gitignore;一次性/验证脚本专用)
  SCRATCH_DIR: '.tmp',
  // 禁止在系统临时目录(/tmp、~/tmp、%TEMP% 等)落盘
  FORBID_SYSTEM_TMP: true,
  // 收尾时检查草稿区残留
  CHECK_TMP_LEFTOVER: true,
  // commit 信息最小长度(按字符,中英同权)
  MIN_SUBJECT: 10,
  MIN_BODY: 20,
  // 收尾提交提醒:off(默认)/remind；旧 auto 配置兼容归一为 remind。
  AUTO_COMMIT: 'off',
};

// ---------- JSONC ----------

function stripCommentsAndTrailingCommas(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[++i] ?? ''; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; i--; continue; }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      if (i >= text.length) throw new SyntaxError('未闭合 JSONC 块注释');
      i++;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  if (inString) throw new SyntaxError('未闭合 JSON 字符串');
  return out;
}

export function parseJsonc(text) {
  // 第二遍用于清掉“逗号 + 注释 + 闭括号”在首遍去注释后形成的尾逗号。
  return JSON.parse(stripCommentsAndTrailingCommas(stripCommentsAndTrailingCommas(text)));
}

// ---------- 配置 ----------

const LEGACY_BOOL_KEYS = new Set(['GUARD', 'FORBID_SYSTEM_TMP', 'CHECK_TMP_LEFTOVER']);
const LEGACY_NUM_KEYS = new Set(['MIN_SUBJECT', 'MIN_BODY']);
const LEGACY_LIST_KEYS = new Set(['CODE_EXTS', 'DOC_EXTS', 'WATCH_FILES']);

export function parseLegacyConfig(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key0 = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && val[0] === val.at(-1) && (val[0] === '"' || val[0] === "'")) val = val.slice(1, -1);
    const key = key0 === 'STALE_ERE' ? 'STALE_RE' : key0;
    if (LEGACY_BOOL_KEYS.has(key)) out[key] = val.toLowerCase() !== 'off';
    else if (LEGACY_NUM_KEYS.has(key)) out[key] = Number(val);
    else if (LEGACY_LIST_KEYS.has(key)) out[key] = val.split(/\s+/).filter(Boolean);
    else out[key] = val;
  }
  return out;
}

const BOOLEAN_CONFIG_KEYS = ['GUARD', 'FORBID_SYSTEM_TMP', 'CHECK_TMP_LEFTOVER'];
const ENUM_CONFIG_KEYS = {
  ENFORCE_LEDGER: new Set(['block', 'warn', 'off']),
  AUTO_COMMIT: new Set(['off', 'remind', 'auto']), // auto 是旧值，validateConfig 映射为 remind
};

function cloneDefaults() {
  return Object.fromEntries(Object.entries(DEFAULT_CONFIG).map(([key, value]) => [
    key, Array.isArray(value) ? [...value] : value,
  ]));
}

function safeRelativePath(value, { directory = false } = {}) {
  if (typeof value !== 'string' || value.includes('\0')) return null;
  let path = toPosix(value.trim());
  while (path.startsWith('./')) path = path.slice(2);
  path = path.replace(/\/+$/, '');
  if (!path || path === '.' || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) return null;
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  if (directory && new Set(['.git', '.tidykeep', '.claude', '.codex', '.agents', '.kimi-code']).has(parts[0])) return null;
  return path;
}

/**
 * 把不可信 JSONC/旧配置收敛为完整且安全的运行时配置。
 * 非法值逐键回退默认值；errors 可供 doctor/CLI 向用户解释，而 hook 仍可安全运行。
 */
export function validateConfig(input) {
  const config = cloneDefaults();
  const errors = [];
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (raw !== input) errors.push({ key: '<root>', reason: '配置根必须是对象' });

  const expected = new Set(Object.keys(DEFAULT_CONFIG));
  for (const key of Object.keys(raw)) {
    if (!expected.has(key)) errors.push({ key, reason: '未知键' });
  }

  for (const key of BOOLEAN_CONFIG_KEYS) {
    if (!(key in raw)) continue;
    if (typeof raw[key] === 'boolean') config[key] = raw[key];
    else errors.push({ key, reason: '必须是 boolean' });
  }

  for (const [key, allowed] of Object.entries(ENUM_CONFIG_KEYS)) {
    if (!(key in raw)) continue;
    const value = typeof raw[key] === 'string' ? raw[key].toLowerCase() : '';
    if (allowed.has(value)) config[key] = key === 'AUTO_COMMIT' && value === 'auto' ? 'remind' : value;
    else errors.push({ key, reason: `必须是 ${[...allowed].join('|')}` });
  }

  for (const key of ['MIN_SUBJECT', 'MIN_BODY']) {
    if (!(key in raw)) continue;
    if (Number.isInteger(raw[key]) && raw[key] >= 0 && raw[key] <= 10000) config[key] = raw[key];
    else errors.push({ key, reason: '必须是 0..10000 的整数' });
  }

  for (const key of ['CODE_EXTS', 'DOC_EXTS']) {
    if (!(key in raw)) continue;
    if (!Array.isArray(raw[key])) {
      errors.push({ key, reason: '必须是扩展名数组' });
      continue;
    }
    const normalized = [];
    for (const item of raw[key]) {
      const ext = typeof item === 'string' ? item.trim().replace(/^\.+/, '').toLowerCase() : '';
      if (/^[a-z0-9]+$/.test(ext)) {
        if (!normalized.includes(ext)) normalized.push(ext);
      } else {
        errors.push({ key, reason: `忽略非法扩展名:${String(item)}` });
      }
    }
    config[key] = normalized;
  }

  if ('WATCH_FILES' in raw) {
    if (!Array.isArray(raw.WATCH_FILES)) {
      errors.push({ key: 'WATCH_FILES', reason: '必须是项目根相对文件路径数组' });
    } else {
      const normalized = [];
      for (const item of raw.WATCH_FILES) {
        const path = safeRelativePath(item);
        if (path) {
          if (!normalized.includes(path)) normalized.push(path);
        } else {
          errors.push({ key: 'WATCH_FILES', reason: `忽略危险路径:${String(item)}` });
        }
      }
      config.WATCH_FILES = normalized;
    }
  }

  if ('SCRATCH_DIR' in raw) {
    const scratch = safeRelativePath(raw.SCRATCH_DIR, { directory: true });
    if (scratch) config.SCRATCH_DIR = scratch;
    else errors.push({ key: 'SCRATCH_DIR', reason: '必须是项目内安全相对目录' });
  }

  if ('STALE_RE' in raw) {
    if (typeof raw.STALE_RE === 'string') {
      try {
        // 先编译再接纳，防止无效表达式进入运行时。
        new RegExp(raw.STALE_RE, 'i');
        config.STALE_RE = raw.STALE_RE;
      } catch {
        errors.push({ key: 'STALE_RE', reason: '不是有效的 JS RegExp' });
      }
    } else {
      errors.push({ key: 'STALE_RE', reason: '必须是字符串' });
    }
  }

  config.staleRe = new RegExp(config.STALE_RE, 'i');
  return { config, errors };
}

export function loadConfig(root) {
  let user = {};
  try {
    const jsoncPath = join(root, '.tidykeep', 'config.jsonc');
    const legacyPath = join(root, '.tidykeep', 'config');
    if (existsSync(jsoncPath)) user = parseJsonc(readFileSync(jsoncPath, 'utf8'));
    else if (existsSync(legacyPath)) user = parseLegacyConfig(readFileSync(legacyPath, 'utf8'));
  } catch { /* 配置损坏时按默认值运行,守卫不因此瘫痪 */ }
  const { config, errors } = validateConfig(user);
  Object.defineProperty(config, 'configErrors', { value: errors, enumerable: false });
  return config;
}

export function loadAllowlist(root) {
  const allow = new Set();
  try {
    for (const raw of readFileSync(join(root, '.tidykeep', 'allowlist'), 'utf8').split('\n')) {
      const line = raw.trim();
      if (line && !line.startsWith('#')) allow.add(line);
    }
  } catch { /* 无 allowlist 即空集 */ }
  return allow;
}
