// tidykeep runtime 台账与暂存区策略(vendored;由 `npx tidykeep init` 刷新,请勿手改)。
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { relAllowed, scratchName, toPosix } from './paths.mjs';

// 仅排除由安装器生成、只指向 AGENTS.md 的薄指针；AGENTS.md 本身是受管规则文档。
const POINTER_FILES = new Set(['CLAUDE.md', 'GEMINI.md', 'KIMI.md']);

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
    return parseGitStatusOutput(out.stdout ?? '');
  } catch {
    return null;
  }
}

/** 解析 porcelain v1 -z；rename/copy 可能出现在 index(X)或 worktree(Y)列。 */
export function parseGitStatusOutput(output) {
  const fields = String(output).split('\0');
  const entries = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.length < 4) continue;
    const code = f.slice(0, 2);
    const firstPath = f.slice(3);
    if (code.includes('R') || code.includes('C')) {
      const secondPath = fields[++i] ?? '';
      // porcelain -z 的路径顺序为目标路径、源路径。rename 同时表示旧路径删除；
      // copy 保留源路径，只需为新路径建/更新 section。
      entries.push([code, firstPath]);
      if (code.includes('R') && secondPath) entries.push(['D ', secondPath]);
    } else {
      entries.push([code, firstPath]);
    }
  }
  return entries;
}

function entryPath(code, rawPath) {
  let path = String(rawPath ?? '');
  if (path.includes(' -> ')) path = path.split(' -> ').at(-1);
  path = toPosix(path.replace(/^"|"$/g, ''));
  return { code: String(code ?? ''), path };
}

function isDeletedCode(code) {
  return code.includes('D');
}

function changeAction(code) {
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  if (code.includes('C')) return 'copied';
  if (code.includes('A') || code.includes('?')) return 'added';
  return 'modified';
}

function pathIsManaged(path, cfg) {
  if (!path || path === 'LEDGER.md') return false;
  // WATCH_FILES 是用户显式声明的精确路径，优先于 generated-prefix 与薄指针默认排除。
  const watchedPaths = new Set((cfg.WATCH_FILES ?? []).map(toPosix));
  if (watchedPaths.has(path)) return true;
  const base = path.split('/').pop();
  if (POINTER_FILES.has(path) || ignorePrefixes(cfg).some((prefix) => path.startsWith(prefix))) return false;
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  const watchedExts = new Set([...(cfg.CODE_EXTS ?? []), ...(cfg.DOC_EXTS ?? [])].map((value) => String(value).toLowerCase()));
  return watchedExts.has(ext);
}

/** 从 porcelain entries 提取逐文件受管变化，供 Stop 与 git hook 共用。 */
export function managedPathChanges(entries, cfg) {
  const changes = [];
  const seen = new Set();
  for (const entry of entries ?? []) {
    if (!Array.isArray(entry)) continue;
    const { code, path } = entryPath(entry[0], entry[1]);
    if (!pathIsManaged(path, cfg) || seen.has(path)) continue;
    seen.add(path);
    changes.push({ path, deleted: isDeletedCode(code) });
  }
  return changes;
}

/**
 * 给 Stop hook 的语义交接提供有界事实。这里只描述 Git 变化，不推断文档、设计或文件是否应删除；
 * 这些结论必须由 Agent 载入 tidykeep skill 后结合代码语义作出。
 */
export function semanticReviewFacts(entries, cfg, limit = 12) {
  const watchedPaths = new Set((cfg.WATCH_FILES ?? []).map(toPosix));
  const codeExts = new Set((cfg.CODE_EXTS ?? []).map((value) => String(value).toLowerCase()));
  const docExts = new Set((cfg.DOC_EXTS ?? []).map((value) => String(value).toLowerCase()));
  const all = [];
  const seen = new Set();

  for (const entry of entries ?? []) {
    if (!Array.isArray(entry)) continue;
    const { code, path } = entryPath(entry[0], entry[1]);
    if (!pathIsManaged(path, cfg) || seen.has(path)) continue;
    seen.add(path);
    const base = path.split('/').pop() ?? '';
    const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
    // pathIsManaged 已证明非 WATCH 路径的扩展名属于 code/doc 集合。
    const kind = watchedPaths.has(path) ? 'watched' : docExts.has(ext) ? 'doc' : 'code';
    all.push({ path, action: changeAction(code), kind });
  }

  const count = (field, value) => all.filter((item) => item[field] === value).length;
  const shown = all.slice(0, Math.max(0, limit));
  return {
    total: all.length,
    changes: shown,
    omitted: Math.max(0, all.length - shown.length),
    counts: {
      deleted: count('action', 'deleted'),
      renamed: count('action', 'renamed'),
      code: count('kind', 'code'),
      doc: count('kind', 'doc'),
      watched: count('kind', 'watched'),
    },
    stateChanged: all.some((item) => item.path === 'STATE.md'),
  };
}

export function ledgerSyncCheck(entries, cfg) {
  const changes = managedPathChanges(entries, cfg);
  const workChanged = changes.length > 0;
  let ledgerChanged = false;
  for (const entry of entries ?? []) {
    if (!Array.isArray(entry)) continue;
    const { code, path } = entryPath(entry[0], entry[1]);
    // 只认项目根 LEDGER。首次安装时 LEDGER 与源码可能同时未跟踪；是否真的
    // 逐文件写全由 ledgerCoverageCheck 继续证明，因此未跟踪台账也可作为候选。
    if (path === 'LEDGER.md' && !isDeletedCode(code)) ledgerChanged = true;
  }
  return { workChanged, ledgerChanged, needSync: workChanged && !ledgerChanged, changes };
}

function ledgerSections(text) {
  const source = String(text ?? '').replaceAll('\r\n', '\n');
  const starts = [...source.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)];
  const sections = new Map();
  for (let i = 0; i < starts.length; i++) {
    const path = toPosix(starts[i][1].trim().replace(/^`|`$/g, ''));
    const start = starts[i].index;
    const end = starts[i + 1]?.index ?? source.length;
    sections.set(path, source.slice(start, end).trimEnd());
  }
  return sections;
}

function checkedToday(section, today) {
  if (!section || !today) return false;
  return new RegExp(`^- 最后核对:\\s*${String(today).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(section);
}

/**
 * 证明每个受管变化均在 LEDGER 中逐文件收尾：
 * - 新增/修改：当前 section 存在、相对 HEAD 有变化、最后核对为 today；
 * - 删除：当前 section 已移除（HEAD 是否曾有 section 不作要求，兼容补清历史缺口）。
 */
export function ledgerCoverageCheck(changes, headLedger, currentLedger, today) {
  const before = ledgerSections(headLedger);
  const after = ledgerSections(currentLedger);
  const covered = [];
  const missing = [];
  for (const change of changes ?? []) {
    const path = toPosix(change?.path ?? '');
    if (!path) continue;
    const oldSection = before.get(path);
    const newSection = after.get(path);
    if (change.deleted) {
      if (newSection === undefined) covered.push(path);
      else missing.push({ path, reason: 'deleted-section-present' });
      continue;
    }
    if (newSection === undefined) missing.push({ path, reason: 'section-missing' });
    else if (!checkedToday(newSection, today)) missing.push({ path, reason: 'last-checked-not-today' });
    else if (oldSection === newSection) missing.push({ path, reason: 'section-unchanged' });
    else covered.push(path);
  }
  return { ok: missing.length === 0, covered, missing };
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
      if (found.length >= Math.max(0, limit)) return;
      const full = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      let st;
      try { st = lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink()) found.push(`${scratch}/${r}`);
      else if (st.isDirectory()) walk(full, r);
      else if (rel || !SCRATCH_SENTINELS.has(name)) found.push(`${scratch}/${r}`);
    }
  };
  walk(base, '');
  return found;
}

// ---------- git 兜底层 ----------

export function checkStagedNames(paths, cfg, allow = new Set(), opts = {}) {
  const scratch = scratchName(cfg);
  const platform = opts.platform ?? process.platform;
  const bad = [];
  for (const raw of paths ?? []) {
    if (!raw) continue;
    const f = toPosix(raw);
    if (relAllowed(f, scratch, allow, platform)) continue;
    const base = f.split('/').pop();
    if (cfg.staleRe.test(base)) bad.push(f);
  }
  return bad;
}
