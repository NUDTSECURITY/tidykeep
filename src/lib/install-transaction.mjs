import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile, sha256 } from './fs-safe.mjs';
import {
  fileHash, getFileRecord, isManagedAssetPath, loadManifest, managedAssetPaths, saveManifest,
} from './manifest.mjs';
import { assertNoProjectSymlinks, validateProjectRelativePath } from './project-paths.mjs';

export const INSTALL_TRANSACTION_REL = '.tidykeep/.install-transaction';
const JOURNAL_REL = `${INSTALL_TRANSACTION_REL}/journal.json`;
const STAGE_REL = `${INSTALL_TRANSACTION_REL}/stage`;
const HASH_RE = /^[a-f0-9]{64}$/;
const VALID_AGENTS = new Set(['claude', 'codex', 'kimi']);
const JOURNAL_KEYS = new Set(['version', 'entries', 'records', 'metadata']);
const ENTRY_KEYS = new Set([
  'rel', 'operation', 'beforeExists', 'beforeHash', 'afterHash', 'mode', 'managed',
]);
const RECORD_UPDATE_KEYS = new Set(['rel', 'record']);
const METADATA_KEYS = new Set(['toolVersion', 'runtimeVersion', 'agents']);
const RECORD_KEYS = new Set(['ownership', 'hash', 'kind', 'managed']);
const WRITE_PATHS = new Set([
  '.tidykeep/config.jsonc', '.tidykeep/allowlist',
  'AGENTS.md', 'CLAUDE.md', '.gitignore', '.gitattributes', 'STATE.md', 'LEDGER.md',
  '.claude/settings.json', '.codex/hooks.json',
]);
const DELETE_PATHS = new Set([
  '.tidykeep/config',
  '.tidykeep/hooks/guard_stale_names.py', '.tidykeep/hooks/stop_sync_check.py',
]);

function exactKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key));
}

function allowedEntryPath(rel, operation) {
  if (isManagedAssetPath(rel)) return true;
  return operation === 'write' ? WRITE_PATHS.has(rel) : DELETE_PATHS.has(rel);
}

function allowedStageAncestor(rel) {
  const prefix = rel ? `${rel}/` : '';
  return [...WRITE_PATHS, ...managedAssetPaths()].some((path) => path.startsWith(prefix));
}

function validateRecord(record, rel) {
  if (record === null) return null;
  if (!exactKeys(record, RECORD_KEYS)
      || !['created', 'modified'].includes(record.ownership)
      || typeof record.hash !== 'string' || !HASH_RE.test(record.hash)
      || typeof record.kind !== 'string' || !record.kind
      || typeof record.managed !== 'boolean') {
    throw new Error(`安装事务中的 manifest 记录非法:${rel}`);
  }
  if (!record.managed || record.kind !== 'managed' || !isManagedAssetPath(rel)) {
    throw new Error(`安装事务只允许记录精确机器资产:${rel}`);
  }
  return { ...record };
}

function validateJournal(raw) {
  if (!exactKeys(raw, JOURNAL_KEYS) || raw.version !== 1) {
    throw new Error('安装事务 journal 格式或版本非法');
  }
  if (!Array.isArray(raw.entries) || !Array.isArray(raw.records)
      || !raw.metadata || typeof raw.metadata !== 'object' || Array.isArray(raw.metadata)) {
    throw new Error('安装事务 journal 缺少 entries/records/metadata');
  }
  const seenEntries = new Set();
  const entries = raw.entries.map((entry) => {
    if (!exactKeys(entry, ENTRY_KEYS)) throw new Error('安装事务条目含未知字段');
    const rel = validateProjectRelativePath(entry?.rel, '安装事务路径');
    if (seenEntries.has(rel)) throw new Error(`安装事务含重复路径:${rel}`);
    seenEntries.add(rel);
    if (!['write', 'delete'].includes(entry.operation)
        || typeof entry.beforeExists !== 'boolean'
        || (entry.beforeExists ? !HASH_RE.test(entry.beforeHash ?? '') : entry.beforeHash !== null)
        || (entry.operation === 'write' ? !HASH_RE.test(entry.afterHash ?? '') : entry.afterHash !== null)
        || (entry.operation === 'write' && (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o7777))
        || (entry.operation === 'delete' && entry.mode !== null)
        || typeof entry.managed !== 'boolean') {
      throw new Error(`安装事务条目非法:${rel}`);
    }
    if (!allowedEntryPath(rel, entry.operation)
        || entry.managed !== isManagedAssetPath(rel)) {
      throw new Error(`安装事务无权改写项目路径:${rel}`);
    }
    return { ...entry, rel };
  });
  const seenRecords = new Set();
  const records = raw.records.map((update) => {
    if (!exactKeys(update, RECORD_UPDATE_KEYS)) throw new Error('安装事务 manifest 更新含未知字段');
    const rel = validateProjectRelativePath(update?.rel, '安装事务 manifest 路径');
    if (seenRecords.has(rel)) throw new Error(`安装事务含重复 manifest 记录:${rel}`);
    seenRecords.add(rel);
    if (!isManagedAssetPath(rel)) {
      throw new Error(`安装事务无权更新 manifest 路径:${rel}`);
    }
    return { rel, record: validateRecord(update.record, rel) };
  });
  const entriesByRel = new Map(entries.map((entry) => [entry.rel, entry]));
  for (const { rel, record } of records) {
    const entry = entriesByRel.get(rel);
    if (!entry || (record === null ? entry.operation !== 'delete'
      : entry.operation !== 'write' || record.hash !== entry.afterHash)) {
      throw new Error(`安装事务 manifest 更新未与文件操作精确绑定:${rel}`);
    }
  }
  const metadata = raw.metadata;
  if (!exactKeys(metadata, METADATA_KEYS)
      || typeof metadata.toolVersion !== 'string' || typeof metadata.runtimeVersion !== 'string'
      || !Array.isArray(metadata.agents) || metadata.agents.some((agent) => !VALID_AGENTS.has(agent))) {
    throw new Error('安装事务 metadata 非法');
  }
  return {
    version: 1,
    entries,
    records,
    metadata: {
      toolVersion: metadata.toolVersion,
      runtimeVersion: metadata.runtimeVersion,
      agents: ['claude', 'codex', 'kimi'].filter((agent) => metadata.agents.includes(agent)),
    },
  };
}

function currentHash(path) {
  if (!existsSync(path)) return { exists: false, hash: null };
  return { exists: true, hash: fileHash(path) };
}

function matchesBefore(current, entry) {
  return current.exists === entry.beforeExists
    && (!current.exists || current.hash === entry.beforeHash);
}

function stagePath(target, rel) {
  return join(target, STAGE_REL, rel);
}

function loadJournal(target) {
  const path = join(target, JOURNAL_REL);
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`安装事务 journal 无法解析:${error?.message ?? error}`); }
  return validateJournal(raw);
}

function cleanUncommittedStaging(target) {
  const txn = join(target, INSTALL_TRANSACTION_REL);
  const top = readdirSync(txn);
  if (top.some((name) => name !== 'stage')) {
    throw new Error(`未提交安装 staging 含未知内容:${top.filter((name) => name !== 'stage').join(',')}`);
  }
  const stageRoot = join(target, STAGE_REL);
  if (!existsSync(stageRoot)) { rmdirSync(txn); return; }
  if (!lstatSync(stageRoot).isDirectory()) throw new Error('未提交安装 staging 不是普通目录');
  const files = [];
  const dirs = [];
  const walk = (dir, rel) => {
    dirs.push(dir);
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`未提交安装 staging 含符号链接:${childRel}`);
      if (stat.isDirectory()) {
        if (!allowedStageAncestor(childRel)) throw new Error(`未提交安装 staging 含未知目录:${childRel}`);
        walk(path, childRel);
      } else if (stat.isFile()) {
        if (!allowedEntryPath(childRel, 'write')) throw new Error(`未提交安装 staging 含未知文件:${childRel}`);
        files.push(path);
      } else throw new Error(`未提交安装 staging 含特殊文件:${childRel}`);
    }
  };
  walk(stageRoot, '');
  for (const path of files) unlinkSync(path);
  for (const path of dirs.reverse()) rmdirSync(path);
  rmdirSync(txn);
}

function inspectCommittedTransaction(target, journal) {
  const txn = join(target, INSTALL_TRANSACTION_REL);
  const top = readdirSync(txn);
  if (top.length !== 2 || !top.includes('stage') || !top.includes('journal.json')) {
    throw new Error(`已提交安装事务含未知内容:${top.filter((name) => !['stage', 'journal.json'].includes(name)).join(',') || '布局不完整'}`);
  }
  const journalPath = join(target, JOURNAL_REL);
  const stageRoot = join(target, STAGE_REL);
  if (!lstatSync(journalPath).isFile()) throw new Error('安装事务 journal 不是普通文件');
  if (!lstatSync(stageRoot).isDirectory()) throw new Error('安装事务 stage 不是普通目录');

  const expected = new Set(
    journal.entries.filter((entry) => entry.operation === 'write').map((entry) => entry.rel),
  );
  const files = [];
  const dirs = [];
  const walk = (dir, rel) => {
    dirs.push(dir);
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`安装事务 stage 含符号链接:${childRel}`);
      if (stat.isDirectory()) {
        if (![...expected].some((item) => item.startsWith(`${childRel}/`))) {
          throw new Error(`安装事务 stage 含未知目录:${childRel}`);
        }
        walk(path, childRel);
      } else if (stat.isFile()) {
        if (!expected.delete(childRel)) throw new Error(`安装事务 stage 含未知文件:${childRel}`);
        files.push(path);
      } else throw new Error(`安装事务 stage 含特殊文件:${childRel}`);
    }
  };
  walk(stageRoot, '');
  if (expected.size > 0) throw new Error(`安装事务 stage 缺少文件:${[...expected].join(',')}`);
  return { files, dirs, journalPath, txn };
}

function cleanCommittedTransaction(target, journal) {
  const { files, dirs, journalPath, txn } = inspectCommittedTransaction(target, journal);
  for (const path of files) unlinkSync(path);
  for (const path of dirs.reverse()) rmdirSync(path);
  unlinkSync(journalPath);
  rmdirSync(txn);
}

export function hasInstallTransaction(target) {
  return existsSync(join(target, INSTALL_TRANSACTION_REL));
}

/** stage 全部写完后才落 journal；同一次 init 只接受目标处于 before/after 两态。 */
export function prepareInstallTransaction(target, plan) {
  const txn = join(target, INSTALL_TRANSACTION_REL);
  if (existsSync(txn)) throw new Error('已有中断安装事务，必须先清理并按现场重规划');
  // planning 读取与 staging 之间可能有并发用户编辑。所有快照必须在创建事务目录
  // 前一次性核对，任何一项漂移都保持零 staging、零目标写入。
  for (const item of plan.entries) {
    if (!Object.hasOwn(item, 'before') || (item.before !== null && !Buffer.isBuffer(item.before))) {
      throw new Error(`安装事务规划缺少 before 快照:${item.rel}`);
    }
    const current = currentHash(join(target, item.rel));
    const expectedExists = item.before !== null;
    const expectedHash = expectedExists ? sha256(item.before) : null;
    if (current.exists !== expectedExists || (current.exists && current.hash !== expectedHash)) {
      throw new Error(`安装事务开始前文件已变化:${item.rel}；未写入任何目标`);
    }
  }
  mkdirSync(join(target, STAGE_REL), { recursive: true });
  try {
    const seen = new Set();
    const entries = [];
    for (const item of plan.entries) {
      const rel = validateProjectRelativePath(item.rel, '安装事务路径');
      if (seen.has(rel)) throw new Error(`安装事务规划含重复路径:${rel}`);
      seen.add(rel);
      const before = item.before === null
        ? { exists: false, hash: null }
        : { exists: true, hash: sha256(item.before) };
      if (item.operation === 'delete') {
        entries.push({
          rel, operation: 'delete', beforeExists: before.exists, beforeHash: before.hash,
          afterHash: null, mode: null, managed: item.managed === true,
        });
        continue;
      }
      if (item.operation !== 'write') throw new Error(`安装事务操作非法:${rel}`);
      const data = Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data);
      const mode = item.mode ?? 0o644;
      atomicWriteFile(stagePath(target, rel), data, { mode });
      entries.push({
        rel, operation: 'write', beforeExists: before.exists, beforeHash: before.hash,
        afterHash: sha256(data), mode, managed: item.managed === true,
      });
    }
    const journal = validateJournal({
      version: 1,
      entries,
      records: plan.records,
      metadata: plan.metadata,
    });
    // 防止 stage 中内容在 journal 落盘前已损坏。
    for (const entry of journal.entries) {
      if (entry.operation === 'write' && fileHash(stagePath(target, entry.rel)) !== entry.afterHash) {
        throw new Error(`安装事务 staging 校验失败:${entry.rel}`);
      }
    }
    atomicWriteFile(join(target, JOURNAL_REL), JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
    return journal;
  } catch (error) {
    try { cleanUncommittedStaging(target); }
    catch (cleanupError) {
      throw new Error(`${error?.message ?? error}; 且 staging 无法安全清理:${cleanupError?.message ?? cleanupError}`);
    }
    throw error;
  }
}

function applyJournal(target, journal) {
  const pathChecks = [INSTALL_TRANSACTION_REL, JOURNAL_REL];
  for (const entry of journal.entries) {
    pathChecks.push(entry.rel);
    if (entry.operation === 'write') pathChecks.push(`${STAGE_REL}/${entry.rel}`);
  }
  assertNoProjectSymlinks(target, pathChecks);
  inspectCommittedTransaction(target, journal);

  // 先完整校验所有 stage 与所有目标状态，再触碰第一个目标。否则后面的 stage
  // 损坏会在前面已写入后才暴露，制造本可避免的部分写入。
  for (const entry of journal.entries) {
    const current = currentHash(join(target, entry.rel));
    if (entry.operation === 'write') {
      const staged = stagePath(target, entry.rel);
      if (!existsSync(staged) || fileHash(staged) !== entry.afterHash) {
        throw new Error(`安装事务 staging 缺失或损坏:${entry.rel}`);
      }
      if (!(current.exists && current.hash === entry.afterHash) && !matchesBefore(current, entry)) {
        throw new Error(`安装事务目标冲突:${entry.rel} 既非写入前内容也非工具 staging 内容`);
      }
    } else if (current.exists && !matchesBefore(current, entry)) {
      throw new Error(`安装事务目标冲突:${entry.rel} 删除前内容已变化`);
    }
  }

  const failAfter = Number.parseInt(process.env.TIDYKEEP_TEST_FAIL_AFTER_MANAGED_WRITES ?? '', 10);
  let managedWrites = 0;
  for (const entry of journal.entries) {
    const path = join(target, entry.rel);
    const current = currentHash(path);
    if (entry.operation === 'write') {
      const staged = stagePath(target, entry.rel);
      if (!existsSync(staged) || fileHash(staged) !== entry.afterHash) throw new Error(`安装事务 staging 损坏:${entry.rel}`);
      if (current.exists && current.hash === entry.afterHash) continue;
      if (!matchesBefore(current, entry)) {
        throw new Error(`安装事务目标冲突:${entry.rel} 既非写入前内容也非工具 staging 内容`);
      }
      atomicWriteFile(path, readFileSync(staged), { mode: entry.mode });
      if (fileHash(path) !== entry.afterHash) throw new Error(`安装事务写后校验失败:${entry.rel}`);
      if (entry.managed && Number.isInteger(failAfter) && failAfter > 0 && ++managedWrites === failAfter) {
        throw new Error(`测试注入:第 ${managedWrites} 个 managed 文件写入后中断`);
      }
    } else {
      if (!current.exists) continue;
      if (!matchesBefore(current, entry)) {
        throw new Error(`安装事务目标冲突:${entry.rel} 删除前内容已变化`);
      }
      unlinkSync(path);
    }
  }

  const manifest = loadManifest(target);
  if (manifest.loadError) throw new Error(`manifest.json 损坏:${manifest.loadError.message}`);
  // 项目内 marker/settings/config/知识/备份均可能包含用户或本机字节，不能把其
  // 内容 hash 持久化进会随仓库流转的 manifest。旧 v3 记录在升级时一次性收敛。
  for (const [rel] of Object.entries(manifest.files ?? {})) {
    if (!getFileRecord(manifest, rel)?.managed) delete manifest.files[rel];
  }
  for (const { rel, record } of journal.records) {
    if (record === null) delete manifest.files[rel];
    else manifest.files[rel] = { ...record };
  }
  manifest.manifestVersion = 3;
  manifest.toolVersion = journal.metadata.toolVersion;
  manifest.runtimeVersion = journal.metadata.runtimeVersion;
  manifest.agents = [...journal.metadata.agents];
  saveManifest(target, manifest);
  cleanCommittedTransaction(target, journal);
  return manifest;
}

export function applyInstallTransaction(target, journal) {
  return applyJournal(target, validateJournal(journal));
}

export function recoverInstallTransaction(target, log = () => {}) {
  const txn = join(target, INSTALL_TRANSACTION_REL);
  if (!existsSync(txn)) return false;
  assertNoProjectSymlinks(target, [INSTALL_TRANSACTION_REL, JOURNAL_REL, STAGE_REL]);
  const journalPath = join(target, JOURNAL_REL);
  if (!existsSync(journalPath)) {
    // journal 是 commit point；缺少它说明只在 staging 阶段中断，尚未触碰目标文件。
    cleanUncommittedStaging(target);
    log('已清理未进入提交阶段的安装 staging');
    return false;
  }
  const journal = loadJournal(target);
  inspectCommittedTransaction(target, journal);
  // journal/stage 都属于项目内不可信输入，绝不回放其中字节。上次已落目标的前缀
  // 由 init 重新读取并生成全新计划；这里只按已验证布局精确清理事务证据。
  cleanCommittedTransaction(target, journal);
  log('已丢弃上次中断事务的 staging，将按当前项目内容重新规划安装');
  return false;
}
