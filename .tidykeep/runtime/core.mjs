// tidykeep runtime core — 唯一逻辑真源(vendored;由 `npx tidykeep init` 刷新,请勿手改)
// 行为基准:与 bash/python 初稿逐条对齐(见仓库 git 历史中的 payload/hooks/*.py)。
// 零依赖,仅用 node 内置模块;所有路径在内部一律 POSIX 斜杠。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir as osHomedir, tmpdir as osTmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const DEFAULT_CONFIG = {
  // 文件命名守卫(拦截 _v2/_old/copy/副本 等历史副本命名)
  GUARD: true,
  // 台账同步强制等级:block(阻止收工/提交)/ warn(仅提醒)/ off
  ENFORCE_LEDGER: 'block',
  // 视为"需同步台账"的扩展名
  CODE_EXTS: ['py', 'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs', 'go', 'rs', 'java', 'rb', 'php', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'scala', 'sql', 'sh', 'bash', 'zsh', 'vue', 'svelte', 'ipynb'],
  DOC_EXTS: ['md', 'rst', 'txt', 'adoc'],
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
  // 收尾自动提交:off(默认)/ remind(收尾完成未提交时打回一次,让 agent 自己写
  // 详细提交)/ auto(hook 直接提交,信息取自 LEDGER 本次新增的 DONE 条目)。
  // 触发条件是"工作区有改动且台账已同步"——即按协议完成了一段功能的收尾;
  // 纯对话回合没有改动,不会产生提交。
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
  return out;
}

export function parseJsonc(text) {
  return JSON.parse(stripCommentsAndTrailingCommas(stripCommentsAndTrailingCommas(text)));
}

// ---------- 配置 ----------

const LEGACY_BOOL_KEYS = new Set(['GUARD', 'FORBID_SYSTEM_TMP', 'CHECK_TMP_LEFTOVER']);
const LEGACY_NUM_KEYS = new Set(['MIN_SUBJECT', 'MIN_BODY']);
const LEGACY_LIST_KEYS = new Set(['CODE_EXTS', 'DOC_EXTS']);

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

export function loadConfig(root) {
  let user = {};
  try {
    const jsoncPath = join(root, '.tidykeep', 'config.jsonc');
    const legacyPath = join(root, '.tidykeep', 'config');
    if (existsSync(jsoncPath)) user = parseJsonc(readFileSync(jsoncPath, 'utf8'));
    else if (existsSync(legacyPath)) user = parseLegacyConfig(readFileSync(legacyPath, 'utf8'));
  } catch { /* 配置损坏时按默认值运行,守卫不因此瘫痪 */ }
  const cfg = { ...DEFAULT_CONFIG, ...user };
  try {
    cfg.staleRe = new RegExp(cfg.STALE_RE, 'i');
  } catch {
    cfg.staleRe = new RegExp(DEFAULT_CONFIG.STALE_RE, 'i');
  }
  return cfg;
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

// ---------- 路径 ----------

export function toPosix(p) {
  return String(p).replaceAll('\\', '/');
}

function isAbs(p) {
  return p.startsWith('/') || /^[A-Za-z]:\//.test(p);
}

function squash(p) {
  const unc = p.startsWith('//') && !p.startsWith('///'); // UNC \\server\share
  const isDrive = /^[A-Za-z]:\//.test(p);
  const parts = p.split('/');
  const out = [];
  for (const seg of parts) {
    if (seg === '' && out.length) continue;
    if (seg === '.') continue;
    if (seg === '..') { if (out.length > 1 || (out.length === 1 && out[0] !== '' && !isDrive)) out.pop(); continue; }
    out.push(seg);
  }
  const s = out.join('/') || '/';
  return unc ? '/' + s : s;
}

export function normalizePath(p, root, opts = {}) {
  const home = toPosix(opts.homedir ?? osHomedir());
  let q = toPosix(p);
  if (q === '~') q = home;
  else if (q.startsWith('~/')) q = home + q.slice(1);
  else if (/^~[^/]+/.test(q)) {
    // ~otheruser/...:按"其他用户家目录"解析到当前家目录的父级(对齐 python
    // expanduser 的放行语义——项目外路径,不做项目内命名裁决)
    const parent = home.includes('/') ? home.slice(0, home.lastIndexOf('/')) : '/home';
    q = parent + '/' + q.slice(1);
  }
  if (!isAbs(q)) q = toPosix(root).replace(/\/+$/, '') + '/' + q;
  return squash(q);
}

function rootPrefix(root, opts = {}) {
  return normalizePath(toPosix(root), '/', opts).replace(/\/+$/, '') + '/';
}

export function inProject(abs, root, opts = {}) {
  const pref = rootPrefix(root, opts);
  if (process.platform === 'win32' || /^[A-Za-z]:\//.test(pref)) {
    return abs.toLowerCase().startsWith(pref.toLowerCase());
  }
  return abs.startsWith(pref);
}

export function relToRoot(abs, root, opts = {}) {
  return abs.slice(rootPrefix(root, opts).length);
}

export function systemTmpPrefixes(root, opts = {}) {
  const home = toPosix(opts.homedir ?? osHomedir()).replace(/\/+$/, '');
  const env = opts.env ?? process.env;
  const list = [
    '/tmp/', '/var/tmp/', '/private/tmp/', '/private/var/tmp/', '/dev/shm/',
    `${home}/tmp/`, `${home}/.tmp/`,
  ];
  for (const key of ['TMPDIR', 'TEMP', 'TMP']) {
    if (env[key]) list.push(normalizePath(env[key], '/', opts).replace(/\/+$/, '') + '/');
  }
  list.push(toPosix(opts.tmpdir ?? osTmpdir()).replace(/\/+$/, '') + '/');
  return [...new Set(list)];
}

function matchesTmpPrefix(abs, prefixes, platform = process.platform) {
  // 大小写折叠仅用于本身大小写不敏感的路径体系(win32 / 盘符路径),
  // POSIX 上 /TMP 与 /tmp 是不同目录,不得误判
  return prefixes.some((p) => {
    if (platform === 'win32' || /^[A-Za-z]:\//.test(p)) {
      return abs.toLowerCase().startsWith(p.toLowerCase());
    }
    return abs.startsWith(p);
  });
}

function scratchName(cfg) {
  return (cfg.SCRATCH_DIR ?? '.tmp').replace(/^\/+|\/+$/g, '') || '.tmp';
}

/** win32 下项目内相对路径比较不区分大小写 */
function foldCase(s, platform) {
  return platform === 'win32' ? s.toLowerCase() : s;
}

function relAllowed(rel, scratch, allow, platform) {
  const r = foldCase(rel, platform);
  if (r.startsWith(foldCase(scratch + '/', platform)) || r.startsWith(foldCase('.tidykeep/', platform))) return true;
  if (allow.has(rel)) return true;
  if (platform === 'win32') {
    for (const a of allow) if (a.toLowerCase() === r) return true;
  }
  return false;
}

// ---------- 单文件写入裁决(Write/Edit 新建/NotebookEdit/apply_patch Add|Move 共用) ----------

export function classifyWritePath(filePath, ctx) {
  const { root, cfg, allow = new Set(), opts = {} } = ctx;
  if (!filePath) return { decision: 'allow' };
  const platform = opts.platform ?? process.platform;
  const tmpOn = cfg.FORBID_SYSTEM_TMP !== false;
  const guardOn = cfg.GUARD !== false;
  if (!tmpOn && !guardOn) return { decision: 'allow' };
  const scratch = scratchName(cfg);
  // 尾随换行/回车是调用方笔误,python 的 $ 会在换行前命中,这里对齐(防绕过)
  const cleaned = String(filePath).replace(/[\r\n]+$/, '');
  const ap = normalizePath(cleaned, root, opts);
  const base = ap.split('/').pop();
  const inside = inProject(ap, root, opts);
  if (tmpOn && !inside && matchesTmpPrefix(ap, systemTmpPrefixes(root, opts), platform)) {
    return { decision: 'deny', kind: 'system-tmp', detail: { base, path: cleaned, scratch } };
  }
  if (!inside) return { decision: 'allow' }; // 项目外其他位置不在守卫职责内
  const rel = relToRoot(ap, root, opts);
  if (relAllowed(rel, scratch, allow, platform)) return { decision: 'allow' };
  if (guardOn && cfg.staleRe.test(base)) {
    return { decision: 'deny', kind: 'stale-name', detail: { base, rel, scratch } };
  }
  return { decision: 'allow' };
}

// ---------- Bash / PowerShell 命令扫描 ----------

const CREATE_VERB = /(^|[;&|(]\s*)(cp|mv|touch|tee|install|rsync|dd|truncate|new-item|out-file|set-content|add-content|copy-item|move-item)\b|>>?\s*\S|\bmktemp\b/i;

export function visibleShellLines(cmd, opts = {}) {
  const out = [];
  let term = null;      // heredoc 终止词
  let psQuote = null;   // PowerShell here-string 终止引号
  for (const line of cmd.split('\n')) {
    if (term !== null) {
      const t = line.trim();
      if (t === term || t === term + ';') term = null;
      continue;
    }
    if (psQuote !== null) {
      if (line.trimStart().startsWith(psQuote + '@')) psQuote = null;
      continue;
    }
    out.push(line);
    const m = line.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
    if (m) { term = m[1]; continue; }
    // here-string 是 PowerShell 独有语法;bash 命令里行尾的 @" 只是普通字符串
    // (如 email),误入会吞掉后续所有行、绕过整段扫描——因此按 shell 类型门控
    if (opts.powershell) {
      const ps = line.match(/@(['"])\s*$/);
      if (ps) psQuote = ps[1];
    }
  }
  return out.join('\n');
}

function cleanToken(raw) {
  return raw.replace(/^['"`]+|['"`]+$/g, '').replace(/[),;:]+$/, '');
}

const isPathish = (tok) => tok.includes('/') || tok.includes('\\') || tok.startsWith('~');

// 源/目标双操作数动词:读取源是合法方向,只有最后一个操作数(目标)算写入
const COPY_VERBS = new Set(['cp', 'mv', 'rsync', 'install', 'copy-item', 'move-item']);

/** 收集"疑似写入目标"的路径 token:copy 类动词只取末操作数,重定向目标恒计入 */
function writeTargetTokens(visible) {
  const targets = [];
  for (const line of visible.split('\n')) {
    for (const seg of line.split(/(?:\|\||&&|[;|&])+/)) {
      const segTrim = seg.trim();
      if (!segTrim) continue;
      const verb = (segTrim.split(/\s+/)[0] ?? '').toLowerCase();
      const pathToks = [];
      for (const raw of segTrim.split(/[\s;|&()<>]+/)) {
        const tok = cleanToken(raw);
        if (tok && isPathish(tok)) pathToks.push(tok);
      }
      if (COPY_VERBS.has(verb)) targets.push(...pathToks.slice(-1));
      else targets.push(...pathToks);
      for (const m of segTrim.matchAll(/>>?\s*([^\s;|&()<>]+)/g)) {
        const tok = cleanToken(m[1]);
        if (tok && isPathish(tok)) targets.push(tok);
      }
    }
  }
  return targets;
}

export function scanBashCommand(cmd, ctx, scanOpts = {}) {
  const { root, cfg, allow = new Set(), opts = {} } = ctx;
  if (!cmd) return { decision: 'allow' };
  const platform = opts.platform ?? process.platform;
  const tmpOn = cfg.FORBID_SYSTEM_TMP !== false;
  const guardOn = cfg.GUARD !== false;
  if (!tmpOn && !guardOn) return { decision: 'allow' };
  const scratch = scratchName(cfg);
  const visible = visibleShellLines(cmd, { powershell: scanOpts.powershell === true });
  if (!CREATE_VERB.test(visible)) return { decision: 'allow' };

  if (tmpOn && /\bmktemp\b/.test(visible)) {
    const pArgs = [...visible.matchAll(/-p[= ]\s*(\S+)/g)].map((m) => m[1]);
    const redirected = pArgs.some((a) => a.includes(scratch)) || visible.includes(scratch + '/');
    if (!redirected) return { decision: 'deny', kind: 'mktemp', hits: ['mktemp'], detail: { scratch } };
  }

  const prefixes = tmpOn ? systemTmpPrefixes(root, opts) : [];
  const tmpHits = [];
  const staleHits = [];
  for (const tok of writeTargetTokens(visible)) {
    const ap = normalizePath(tok, root, opts);
    const base = ap.split('/').pop();
    const inside = inProject(ap, root, opts);
    if (tmpOn && !inside && matchesTmpPrefix(ap, prefixes, platform) && base.includes('.')) {
      tmpHits.push(tok);
      continue;
    }
    if (guardOn && inside) {
      const rel = relToRoot(ap, root, opts);
      if (relAllowed(rel, scratch, allow, platform)) continue;
      if (base.includes('.') && cfg.staleRe.test(base)) staleHits.push(rel);
    }
  }
  if (tmpHits.length) {
    return { decision: 'deny', kind: 'system-tmp', hits: [...new Set(tmpHits)].sort(), detail: { scratch } };
  }
  if (staleHits.length) {
    return { decision: 'deny', kind: 'stale-name', hits: [...new Set(staleHits)].sort(), detail: { scratch } };
  }
  return { decision: 'allow' };
}

// ---------- Codex apply_patch(V4A envelope) ----------

export function parseApplyPatch(text) {
  const checkTargets = [];
  const updates = [];
  const deletes = [];
  if (typeof text === 'string') {
    for (const m of text.matchAll(/^\*{3} (Add File|Update File|Delete File|Move to): (.+)$/gm)) {
      const path = m[2].trim();
      if (m[1] === 'Add File' || m[1] === 'Move to') checkTargets.push(path);
      else if (m[1] === 'Update File') updates.push(path);
      else deletes.push(path);
    }
  }
  return { checkTargets, updates, deletes };
}

// ---------- 收尾检查 ----------

const LEDGER_FILES = new Set(['LEDGER.md', 'STATE.md']);
const POINTER_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'KIMI.md']);

function ignorePrefixes(cfg) {
  return [scratchName(cfg) + '/', '.tidykeep/', '.claude/', '.codex/', '.agents/', '.kimi-code/'];
}

export function gitStatusEntries(root) {
  try {
    // -z:NUL 分隔且不做 quotepath 转义(非 ASCII 文件名原样输出);
    // -uall:展开未跟踪目录内的具体文件(否则新目录只显示 "?? dir/" 而失明)
    const out = spawnSync('git', ['-C', root, 'status', '--porcelain', '-uall', '-z'], {
      encoding: 'utf8', timeout: 10000, shell: false,
    });
    if (out.status !== 0 || out.error) return null;
    const fields = (out.stdout ?? '').split('\0');
    const entries = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.length < 4) continue;
      const code = f.slice(0, 2);
      entries.push([code, f.slice(3)]);
      if (code[0] === 'R' || code[0] === 'C') i++; // -z 模式下一字段是 rename/copy 的旧路径
    }
    return entries;
  } catch {
    return null;
  }
}

export function ledgerSyncCheck(entries, cfg) {
  const watched = new Set([...(cfg.CODE_EXTS ?? []), ...(cfg.DOC_EXTS ?? [])].map((e) => e.toLowerCase()));
  const prefixes = ignorePrefixes(cfg);
  let workChanged = false;
  let ledgerChanged = false;
  for (const [code, rawPath] of entries ?? []) {
    let path = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath;
    path = path.replace(/^"|"$/g, '');
    const base = path.split('/').pop();
    if (LEDGER_FILES.has(base)) {
      if (code !== '??') ledgerChanged = true; // 未跟踪的台账=刚安装未初始化,不算已同步
      continue;
    }
    if (prefixes.some((p) => path.startsWith(p)) || POINTER_FILES.has(base)) continue;
    const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
    if (watched.has(ext)) workChanged = true;
  }
  return { workChanged, ledgerChanged, needSync: workChanged && !ledgerChanged };
}

const SCRATCH_SENTINELS = new Set(['.gitkeep', '.gitignore', 'README.md']);

export function scratchLeftovers(root, cfg, limit = 8) {
  const scratch = scratchName(cfg);
  const base = join(root, scratch);
  const found = [];
  const walk = (dir, rel) => {
    let names;
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (found.length > limit) return;
      const full = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, r);
      else if (!SCRATCH_SENTINELS.has(name)) found.push(`${scratch}/${r}`);
    }
  };
  walk(base, '');
  return found;
}

// ---------- git 兜底层 ----------

export function checkStagedNames(paths, cfg, allow = new Set()) {
  const scratch = scratchName(cfg);
  const bad = [];
  for (const f of paths ?? []) {
    if (!f) continue;
    if (f.startsWith(scratch + '/') || f.startsWith('.tidykeep/') || allow.has(f)) continue;
    const base = f.split('/').pop();
    if (cfg.staleRe.test(base)) bad.push(f);
  }
  return bad;
}

export function stagedLedgerSync(paths, cfg) {
  const watched = new Set([...(cfg.CODE_EXTS ?? []), ...(cfg.DOC_EXTS ?? [])].map((e) => e.toLowerCase()));
  const prefixes = ignorePrefixes(cfg);
  let workHit = false;
  let ledgerHit = false;
  for (const f of paths ?? []) {
    if (!f) continue;
    const base = f.split('/').pop();
    if (LEDGER_FILES.has(base)) { ledgerHit = true; continue; }
    if (POINTER_FILES.has(base) || prefixes.some((p) => f.startsWith(p))) continue;
    const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
    if (watched.has(ext)) workHit = true;
  }
  return { workHit, ledgerHit };
}

export function countChars(s) {
  return [...String(s).trim()].length;
}

export function checkCommitMsg(text, cfg) {
  // git commit -v 会在 scissors 线后附带整个 diff(git 提交时会截掉),
  // 必须先截断,否则 diff 行喂饱正文长度、检查被静默绕过
  const beforeScissors = String(text).split(/^[#;@!$%^&|:] -+ >8 -+/m)[0];
  const lines = beforeScissors.split('\n').filter((l) => !l.startsWith('#'));
  const subject = (lines[0] ?? '').trim();
  const body = lines.slice(1).filter((l) => l.trim() !== '').join('\n');
  if (/^(Merge |Revert |fixup!|squash!|amend!)/.test(subject)) {
    return { ok: true, exempt: true, subjectLen: countChars(subject), bodyLen: countChars(body) };
  }
  const subjectLen = countChars(subject);
  const bodyLen = countChars(body);
  return {
    ok: subjectLen >= (cfg.MIN_SUBJECT ?? 10) && bodyLen >= (cfg.MIN_BODY ?? 20),
    exempt: false,
    subjectLen,
    bodyLen,
  };
}

// ---------- AUTO_COMMIT ----------

/** 从 LEDGER.md 的 diff 中提取本次新增的 DONE 条目描述(自动提交信息的素材) */
export function newDoneItemsFromDiff(diffText) {
  const items = [];
  for (const line of String(diffText).split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const m = line.match(/^\+\s*-\s*\[x\]\s*\d{4}-\d{2}-\d{2}\s*(.+)$/);
    if (m) items.push(m[1].trim());
  }
  return items;
}

/** 生成满足自身 commit-msg 规范的自动提交信息 */
export function buildAutoCommitMessage(items, files) {
  const subject = items.length
    ? `chore: 收尾提交——${items[0]}`.slice(0, 72)
    : `chore: 收尾提交(${files.length} 个文件改动,台账已同步)`;
  const shown = files.slice(0, 8).join('、') + (files.length > 8 ? '…' : '');
  const lines = [
    subject,
    '',
    '为什么: tidykeep AUTO_COMMIT——LEDGER/STATE 已同步,本段功能按协议收尾完成',
    `影响: ${files.length} 个文件(${shown})`,
  ];
  if (items.length > 1) lines.push(`DONE: ${items.join(';')}`);
  return lines.join('\n');
}

// ---------- 会话标记(防 Stop 死循环;放项目内 .state/,不落系统 tmp) ----------

export function stopFlagPath(root, sessionId) {
  let id = sessionId
    ? String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')
    : new Date().toISOString().slice(0, 10) + '-nosession';
  if (id.length > 64) id = createHash('sha1').update(id).digest('hex'); // 超长 id 摘要,保证文件名可写
  return join(root, '.tidykeep', '.state', `stop-once-${id}`);
}
