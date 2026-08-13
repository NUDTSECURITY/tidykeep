// 安装清单 v3：只持久化确定性的 managed 机器资产及其 SHA-256。marker、settings、
// 配置、知识文件与备份可能含用户/本机字节，不写入随仓库流转的清单；其卸载依靠
// 精确结构或 payload 模板证明。v1 文本/v2 JSON 只为保守迁移而兼容读取。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile, hashFile as hashFileValue } from './fs-safe.mjs';
import { validateProjectRelativePath } from './project-paths.mjs';

const fileMap = () => Object.create(null);
const VALID_AGENTS = new Set(['claude', 'codex', 'kimi']);
const AGENT_ORDER = ['claude', 'codex', 'kimi'];
const TOP_LEVEL_KEYS = new Set([
  'manifestVersion', 'toolVersion', 'runtimeVersion', 'agents', 'files',
]);
// 早期 v3 曾把本机时间、Git 接线与 Kimi 用户目录状态写进随仓库流转的清单。
// 读取与再次保存时接受但立即丢弃，避免升级被旧字段卡住；其余未知字段仍拒绝。
const DEPRECATED_TOP_LEVEL_KEYS = new Set(['installedAt', 'hookspath', 'kimi', 'uninstallProblems']);
const FILE_RECORD_KEYS = new Set(['ownership', 'hash', 'kind', 'managed']);
const VALID_KINDS = new Set(['managed', 'marker', 'settings', 'config', 'generated', 'legacy']);
// manifest 会随仓库流转，不能让一个被篡改的 managed:true 为任意项目文件
// 授予删除权限。删掉旧机器文件时须把其路径留在此历史白名单。
const MANAGED_ASSET_PATHS = new Set([
  ...[
    'core.mjs', 'config.mjs', 'paths.mjs', 'write-policy.mjs', 'ledger.mjs',
    'git-policy.mjs', 'messages.mjs', 'hook.mjs', 'githook.mjs',
    'enable-githooks.mjs', 'kimi-shim.mjs',
  ].map((name) => `.tidykeep/runtime/${name}`),
  '.tidykeep/githooks/pre-commit',
  '.tidykeep/githooks/commit-msg',
  '.tidykeep/docs/workflows.md',
  '.claude/skills/tidykeep/SKILL.md',
  '.agents/skills/tidykeep/SKILL.md',
]);

export function isManagedAssetPath(rel) {
  return MANAGED_ASSET_PATHS.has(rel);
}

export function managedAssetPaths() {
  return [...MANAGED_ASSET_PATHS];
}

const skeleton = () => ({
  manifestVersion: 3,
  toolVersion: '',
  runtimeVersion: '',
  agents: [],
  files: fileMap(),
});

function hidden(m, key, value) {
  Object.defineProperty(m, key, { value, writable: true, enumerable: false, configurable: true });
  return m;
}

function normalizeRecord(value, { legacy = true, rel = null } = {}) {
  if (value === 'created' || value === 'modified') {
    if (!legacy) return null;
    return { ownership: value, hash: null, kind: 'legacy', managed: false };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return null;
  if (!legacy && Object.keys(value).some((key) => !FILE_RECORD_KEYS.has(key))) return null;
  const ownership = value.ownership ?? (legacy ? value.state : undefined);
  if (ownership !== 'created' && ownership !== 'modified') return null;
  if ('hash' in value && value.hash !== null
      && (typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.hash))) return null;
  if ('kind' in value && (typeof value.kind !== 'string' || !value.kind)) return null;
  if ('managed' in value && typeof value.managed !== 'boolean') return null;
  const record = {
    ownership,
    hash: typeof value.hash === 'string' ? value.hash.toLowerCase() : null,
    kind: typeof value.kind === 'string' && value.kind ? value.kind : 'legacy',
    managed: value.managed === true,
  };
  if (!legacy) {
    if (!VALID_KINDS.has(record.kind)) return null;
    if (record.managed !== (record.kind === 'managed')) return null;
    if (record.managed && (!record.hash || !MANAGED_ASSET_PATHS.has(rel))) return null;
  }
  return record;
}

function migrate(raw, legacyVersion = null, { allowDeprecated = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) {
    throw new Error('manifest 根必须是对象');
  }
  if (legacyVersion === null) {
    const unknown = Object.keys(raw).filter((key) => !TOP_LEVEL_KEYS.has(key)
      && !(allowDeprecated && DEPRECATED_TOP_LEVEL_KEYS.has(key)));
    if (unknown.length) throw new Error(`manifest 含未知字段:${unknown.join(',')}`);
  }
  const m = skeleton();
  for (const key of ['toolVersion', 'runtimeVersion']) {
    if (key in raw) {
      if (typeof raw[key] !== 'string') throw new Error(`manifest.${key} 必须是字符串`);
      m[key] = raw[key];
    }
  }
  if ('agents' in raw) {
    if (!Array.isArray(raw.agents) || raw.agents.some((value) => !VALID_AGENTS.has(value))) {
      throw new Error('manifest.agents 仅支持 claude/codex/kimi');
    }
    const selected = new Set(raw.agents);
    m.agents = AGENT_ORDER.filter((agent) => selected.has(agent));
  }
  if (raw.files && typeof raw.files === 'object' && !Array.isArray(raw.files)
      && (Object.getPrototypeOf(raw.files) === Object.prototype || Object.getPrototypeOf(raw.files) === null)) {
    // 不能依赖运行机器的 ICU locale；manifest 需要在不同 OS/locale 下字节稳定。
    const entries = Object.entries(raw.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [rel, value] of entries) {
      validateProjectRelativePath(rel, 'manifest.files 路径');
      // v1/v2 只发布过 created/modified 字符串。旧 schema 中出现对象记录时，
      // 不能把其中自报的 managed/hash 当成升级或删除授权。
      if (legacyVersion !== null && value !== 'created' && value !== 'modified') {
        throw new Error(`manifest.files[${JSON.stringify(rel)}] 旧版记录必须是 created/modified`);
      }
      const record = normalizeRecord(value, { legacy: legacyVersion !== null, rel });
      if (!record) throw new Error(`manifest.files[${JSON.stringify(rel)}] 记录非法`);
      m.files[rel] = record;
    }
  } else if ('files' in raw && raw.files !== undefined) {
    throw new Error('manifest.files 必须是对象');
  }
  return hidden(m, 'legacyVersion', legacyVersion);
}

export function parseLegacyManifest(text) {
  const raw = { files: fileMap() };
  for (const lineText of text.split('\n')) {
    const line = lineText.trim();
    if (!line) continue;
    const [word, ...rest] = line.split(' ');
    const arg = rest.join(' ');
    if ((word === 'created' || word === 'modified') && arg && !Object.hasOwn(raw.files, arg)) raw.files[arg] = word;
    else if (word === 'hookspath' && arg) raw.hookspath = arg;
  }
  return migrate(raw, 1);
}

export function loadManifest(dir) {
  const jsonPath = join(dir, '.tidykeep', 'manifest.json');
  if (existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
      const version = raw?.manifestVersion ?? 1;
      if (!Number.isInteger(version) || version < 1 || version > 3) {
        throw new Error(`不支持 manifestVersion=${JSON.stringify(version)}(当前仅支持 1/2/3)`);
      }
      return migrate(raw, version < 3 ? version : null, { allowDeprecated: version === 3 });
    } catch (error) {
      return hidden(hidden(skeleton(), 'legacyVersion', null), 'loadError', error);
    }
  }
  const legacyPath = join(dir, '.tidykeep', 'manifest');
  if (existsSync(legacyPath)) {
    try { return parseLegacyManifest(readFileSync(legacyPath, 'utf8')); }
    catch (error) { return hidden(hidden(skeleton(), 'legacyVersion', null), 'loadError', error); }
  }
  return hidden(skeleton(), 'legacyVersion', null);
}

export function saveManifest(dir, manifest) {
  const clean = migrate(manifest, null, { allowDeprecated: true });
  const stable = skeleton();
  stable.toolVersion = clean.toolVersion;
  stable.runtimeVersion = clean.runtimeVersion;
  stable.agents = [...clean.agents];
  for (const [rel, raw] of Object.entries(clean.files)) {
    const record = normalizeRecord(raw, { legacy: false, rel });
    if (!record?.managed) continue;
    stable.files[rel] = {
      ownership: 'created', hash: record.hash, kind: 'managed', managed: true,
    };
  }
  atomicWriteFile(join(dir, '.tidykeep', 'manifest.json'), JSON.stringify(stable, null, 2) + '\n');
}

export function getFileRecord(manifest, rel) {
  validateProjectRelativePath(rel, 'manifest.files 路径');
  return normalizeRecord(manifest?.files?.[rel]);
}

export function fileHash(path) {
  return hashFileValue(path);
}

export function fileMatchesRecord(manifest, rel, path) {
  const record = getFileRecord(manifest, rel);
  if (!record?.hash || !existsSync(path)) return false;
  try { return hashFileValue(path) === record.hash; } catch { return false; }
}
