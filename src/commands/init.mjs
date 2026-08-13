// `tidykeep init`：先完整 preflight，再把机器区放入项目内 staging，最后逐文件
// 原子替换。managed 文件以 manifest hash 证明未被用户修改后才允许升级。
import {
  existsSync, mkdirSync, readFileSync, readdirSync,
  rmdirSync, statSync, unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { upsertBlockText } from '../lib/markers.mjs';
import {
  getFileRecord, loadManifest,
} from '../lib/manifest.mjs';
import { mergeSettingsText } from '../lib/settings-json.mjs';
import {
  appendMissingJsoncValues, parseJsonc, replaceJsoncValue,
} from '../lib/jsonc.mjs';
import { sha256 } from '../lib/fs-safe.mjs';
import {
  isKnownLegacyV1PythonHookHash, isKnownLegacyV2AssetHash,
  isKnownPublishedManagedAssetHash,
} from '../lib/legacy-assets.mjs';
import {
  assertGitProjectRoot, assertNoProjectSymlinks, canonicalProjectRoot, validateProjectDirectoryName,
} from '../lib/project-paths.mjs';
import { acquireProjectLock, releaseProjectLock } from '../lib/project-lock.mjs';
import { inspectExternalHooks } from '../lib/git-hooks.mjs';
import {
  applyInstallTransaction, hasInstallTransaction, INSTALL_TRANSACTION_REL,
  prepareInstallTransaction, recoverInstallTransaction,
} from '../lib/install-transaction.mjs';
import {
  MD_BEGIN, MD_END, HASH_BEGIN, HASH_END,
  CLAUDE_POINTER, gitignoreBlock, GITATTRIBUTES_BLOCK,
  claudeHookGroups, codexHookGroups,
} from '../lib/blocks.mjs';
import { installKimiGlobal, preflightKimiGlobal } from '../lib/kimi.mjs';
import {
  parseLegacyConfig, DEFAULT_CONFIG, validateConfig as validateRuntimeConfig,
} from '../../payload/runtime/core.mjs';

const PAYLOAD = fileURLToPath(new URL('../../payload/', import.meta.url));
const VALID_AGENTS = new Set(['claude', 'codex', 'kimi']);
const VALID_LEDGER_MODES = new Set(['block', 'warn', 'off']);
const EARLY_PROJECT_PATHS = [
  '.tidykeep', '.tidykeep/config.jsonc', '.tidykeep/config',
  '.tidykeep/manifest.json', '.tidykeep/manifest',
  INSTALL_TRANSACTION_REL, '.tidykeep/.install-lock',
  '.claude', '.claude/settings.json', '.codex', '.codex/hooks.json', '.agents',
  'AGENTS.md', 'CLAUDE.md', '.gitignore', '.gitattributes', 'STATE.md', 'LEDGER.md',
];

function pkgVersion() {
  try { return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version; }
  catch { return '0.0.0'; }
}

function git(root, ...args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false });
}

export function validateScratchDir(value) {
  return validateProjectDirectoryName(value, '无效 --scratch-dir');
}

export function validateInitOptions(options = {}) {
  const agents = options.agents === undefined ? ['claude', 'codex', 'kimi'] : options.agents;
  if (!Array.isArray(agents) || agents.length === 0 || agents.some((v) => typeof v !== 'string' || !v || !VALID_AGENTS.has(v))) {
    throw new Error(`无效 --agents:仅支持 claude,codex,kimi，且列表不得为空`);
  }
  const ledgerMode = options.ledgerMode;
  if (ledgerMode !== undefined && !VALID_LEDGER_MODES.has(ledgerMode)) {
    throw new Error(`无效 --ledger-mode '${ledgerMode}':仅支持 block|warn|off`);
  }
  const scratchDir = options.scratchDir === undefined ? undefined : validateScratchDir(options.scratchDir);
  return { ...options, agents: [...new Set(agents)], ledgerMode, scratchDir };
}

function validateConfig(config) {
  const result = validateRuntimeConfig(config);
  if (result.errors.length) {
    const details = result.errors.map(({ key, reason }) => `${key}: ${reason}`).join('; ');
    throw new Error(`config.jsonc 严格校验失败:${details}`);
  }
  // runtime 支持一般安全相对目录；安装器还要创建/ignore 一个稳定根目录，故进一步
  // 收紧为单目录名，防止 CLI 与 config 的同一选项产生两套边界。
  validateScratchDir(config.SCRATCH_DIR);
  return result.config;
}

function renderConfigFromLegacy(template, legacy) {
  let out = template;
  for (const [key, value] of Object.entries(legacy)) {
    if (key in DEFAULT_CONFIG) out = replaceJsoncValue(out, key, value);
  }
  return out;
}

function planConfig(target, options) {
  const tk = join(target, '.tidykeep');
  const path = join(tk, 'config.jsonc');
  const legacyPath = join(tk, 'config');
  const existed = existsSync(path);
  let legacy = null;
  const legacyBefore = existsSync(legacyPath) ? readFileSync(legacyPath) : null;
  if (legacyBefore) legacy = parseLegacyConfig(legacyBefore.toString('utf8'));
  let text;
  const before = existed ? readFileSync(path) : null;
  if (existed) text = before.toString('utf8');
  else {
    text = readFileSync(join(PAYLOAD, 'config.jsonc'), 'utf8');
    if (legacy) text = renderConfigFromLegacy(text, legacy);
  }
  // 先解析现有文件，损坏配置不能被“补键”掩盖。
  parseJsonc(text);
  text = appendMissingJsoncValues(text, DEFAULT_CONFIG);
  if (options.scratchDir !== undefined) text = replaceJsoncValue(text, 'SCRATCH_DIR', options.scratchDir);
  if (options.ledgerMode !== undefined) text = replaceJsoncValue(text, 'ENFORCE_LEDGER', options.ledgerMode);
  let raw = parseJsonc(text);
  // 旧 auto 的真实运行语义早已是 remind；升级时把文本也原位归一，避免配置写着
  // “自动提交”而 runtime 实际从不提交的认知漂移。
  if (raw.AUTO_COMMIT === 'auto') {
    text = replaceJsoncValue(text, 'AUTO_COMMIT', 'remind');
    raw = parseJsonc(text);
  }
  const config = validateConfig(raw);
  return { legacyPath, before, text, config, legacy, legacyBefore };
}

function planBlock(target, rel, begin, end, content) {
  const path = join(target, rel);
  const existed = existsSync(path);
  const before = existed ? readFileSync(path) : null;
  const result = upsertBlockText(before?.toString('utf8') ?? '', begin, end, content);
  if (result.status === 'unpaired') throw new Error(`${rel} 中 tidykeep 标记不成对`);
  return { rel, before, text: result.text };
}

function planSettings(target, rel, groups) {
  const path = join(target, rel);
  const existed = existsSync(path);
  const before = existed ? readFileSync(path) : null;
  const result = mergeSettingsText(before?.toString('utf8'), groups);
  if (result.status === 'skipped') {
    if (result.reason === 'descriptor-drift') throw new Error(`${rel} 含用户改过的 tidykeep hook 描述符(${result.detail})，拒绝注入重复条目`);
    throw new Error(`${rel} ${result.reason === 'invalid-json' ? '不是合法 JSON' : `hooks 结构无效(${result.detail})`}`);
  }
  return { rel, before, text: result.text };
}

function normalizedManagedData(source) {
  return Buffer.from(readFileSync(source, 'utf8').replace(/\r\n?/g, '\n'));
}

function walkFiles(sourceDir, relBase, out, mode) {
  for (const name of readdirSync(sourceDir).sort()) {
    const source = join(sourceDir, name);
    const rel = `${relBase}/${name}`;
    const stat = statSync(source);
    if (stat.isDirectory()) walkFiles(source, rel, out, mode);
    else if (stat.isFile()) out.push({ source, rel, mode, incomingHash: sha256(normalizedManagedData(source)) });
  }
}

function desiredManagedAssets(agents) {
  const assets = [];
  // runtime 始终由 `node <file>` 调用且没有 shebang，不授予无意义的执行位；
  // 只有真正由 Git 直接执行的 githooks 需要 0755。
  walkFiles(join(PAYLOAD, 'runtime'), '.tidykeep/runtime', assets, 0o644);
  walkFiles(join(PAYLOAD, 'githooks'), '.tidykeep/githooks', assets, 0o755);
  assets.push({
    source: join(PAYLOAD, 'docs', 'workflows.md'), rel: '.tidykeep/docs/workflows.md', mode: 0o644,
    incomingHash: sha256(normalizedManagedData(join(PAYLOAD, 'docs', 'workflows.md'))),
  });
  if (agents.has('claude')) assets.push({
    source: join(PAYLOAD, 'skill', 'SKILL.md'), rel: '.claude/skills/tidykeep/SKILL.md', mode: 0o644,
    incomingHash: sha256(normalizedManagedData(join(PAYLOAD, 'skill', 'SKILL.md'))),
  });
  if (agents.has('kimi')) assets.push({
    source: join(PAYLOAD, 'skill', 'SKILL.md'), rel: '.agents/skills/tidykeep/SKILL.md', mode: 0o644,
    incomingHash: sha256(normalizedManagedData(join(PAYLOAD, 'skill', 'SKILL.md'))),
  });
  return assets;
}

function preflightManaged(target, manifest, assets, interruptedTransaction = false) {
  const desired = new Set(assets.map((asset) => asset.rel));
  const obsolete = [];
  for (const asset of assets) {
    const path = join(target, asset.rel);
    asset.before = existsSync(path) ? readFileSync(path) : null;
    if (!asset.before) continue;
    const beforeHash = sha256(asset.before);
    const record = getFileRecord(manifest, asset.rel);
    if (record?.managed) {
      if (interruptedTransaction && beforeHash === asset.incomingHash) continue;
      const knownPublished = beforeHash === asset.incomingHash
        || isKnownPublishedManagedAssetHash(asset.rel, beforeHash);
      if (!record.hash || record.hash !== beforeHash || !knownPublished) {
        throw new Error(`${asset.rel} 已被用户修改，拒绝覆盖`);
      }
      continue;
    }
    // 中断事务可能已把一部分目标写成当前 payload，但 manifest 尚未提交。旧
    // stage/journal 已经验证布局后丢弃；这里只接纳当前包的精确公开字节。
    if (interruptedTransaction && beforeHash === asset.incomingHash) continue;
    // v1/v2 没有 managed hash；仅当内容与本包当前 payload 完全一致时安全接管。
    if (manifest.legacyVersion
        && (beforeHash === asset.incomingHash
          || isKnownLegacyV2AssetHash(manifest, asset.rel, beforeHash))) continue;
    const label = asset.rel.includes('/skills/tidykeep/') ? '同名 tidykeep skill 已存在' : '存在未归属 tidykeep 的文件';
    throw new Error(`${asset.rel}: ${label}，拒绝覆盖`);
  }
  for (const [rel, raw] of Object.entries(manifest.files ?? {})) {
    const record = getFileRecord({ files: { [rel]: raw } }, rel);
    if (!record?.managed || desired.has(rel)) continue;
    const path = join(target, rel);
    const before = existsSync(path) ? readFileSync(path) : null;
    const beforeHash = before ? sha256(before) : null;
    if (before && (!record.hash || record.hash !== beforeHash
        || !isKnownPublishedManagedAssetHash(rel, beforeHash))) {
      throw new Error(`${rel} 是已被用户修改的旧 managed 文件，拒绝删除`);
    }
    obsolete.push({ rel, before });
  }
  return obsolete;
}

function planGitHooks(target, noGitHooks) {
  if (noGitHooks) return { status: 'none', current: '' };
  const probe = git(target, 'rev-parse', '--git-dir');
  if (probe.error?.code === 'ENOENT') return { status: 'nogit', current: '' };
  if (probe.error) throw new Error(`git preflight 失败:${probe.error.message}`);
  if (probe.status !== 0) {
    const note = `${probe.stdout ?? ''}\n${probe.stderr ?? ''}`;
    if (/not a git repository/i.test(note)) return { status: 'nogit', current: '' };
    throw new Error(`git preflight 失败:${(probe.stderr ?? '').trim() || `exit ${probe.status}`}`);
  }
  const current = git(target, 'config', 'core.hooksPath');
  if (current.error) throw new Error(`读取 core.hooksPath 失败:${current.error.message}`);
  if (current.status !== 0 && current.status !== 1) throw new Error(`读取 core.hooksPath 失败:${(current.stderr ?? '').trim()}`);
  const value = current.status === 0 ? (current.stdout ?? '').trim() : '';
  if (!value || value === '.tidykeep/githooks') return { status: 'set', current: value };
  return { status: 'external', current: value, inspection: inspectExternalHooks(target, value) };
}

function removeEmptyParents(target, rel) {
  let dir = dirname(join(target, rel));
  while (dir !== target && dir.startsWith(target)) {
    try { rmdirSync(dir); } catch { break; }
    dir = dirname(dir);
  }
}

function managedData(asset) {
  return normalizedManagedData(asset.source);
}

function plannedManagedRecord(hash) {
  return {
    // committed manifest 必须跨机器、跨中断点字节稳定。机器资产的所有权由
    // 精确白名单 + 已发布内容共同证明，不依赖目标项目先前是否已有该路径。
    ownership: 'created',
    hash,
    kind: 'managed',
    managed: true,
  };
}

function initImpl(target, options, log) {
  assertNoProjectSymlinks(target, EARLY_PROJECT_PATHS);
  const manifest = loadManifest(target);
  if (manifest.loadError) throw new Error(`manifest.json 损坏:${manifest.loadError.message}`);
  const legacyPythonBefore = new Map();
  for (const name of ['guard_stale_names.py', 'stop_sync_check.py']) {
    const rel = `.tidykeep/hooks/${name}`;
    const path = join(target, rel);
    legacyPythonBefore.set(rel, existsSync(path) ? readFileSync(path) : null);
  }
  if (manifest.legacyVersion === 1) {
    for (const [rel, before] of legacyPythonBefore) {
      if (before && !isKnownLegacyV1PythonHookHash(manifest, rel, sha256(before))) {
        throw new Error(`${rel} 与旧版工具文件同名但内容未知，拒绝迁移；请先人工确认并移走该文件`);
      }
    }
  }
  const selected = new Set(options.agents);
  const allAgents = new Set([...(manifest.agents ?? []), ...selected]);
  let interruptedTransaction = hasInstallTransaction(target);
  if (interruptedTransaction && !options.dryRun) {
    recoverInstallTransaction(target, log);
    interruptedTransaction = true; // preflight 可接纳已落地且精确等于当前 payload 的前缀
  }
  const configPlan = planConfig(target, options);

  const blockPlans = [
    planBlock(target, 'AGENTS.md', MD_BEGIN, MD_END, readFileSync(join(PAYLOAD, 'rules.md'), 'utf8')),
    planBlock(target, '.gitignore', HASH_BEGIN, HASH_END, gitignoreBlock(configPlan.config.SCRATCH_DIR)),
    planBlock(target, '.gitattributes', HASH_BEGIN, HASH_END, GITATTRIBUTES_BLOCK),
  ];
  if (allAgents.has('claude')) blockPlans.push(planBlock(target, 'CLAUDE.md', MD_BEGIN, MD_END, CLAUDE_POINTER));

  const settingsPlans = [];
  if (allAgents.has('claude')) settingsPlans.push(planSettings(target, '.claude/settings.json', claudeHookGroups()));
  if (allAgents.has('codex')) settingsPlans.push(planSettings(target, '.codex/hooks.json', codexHookGroups()));

  const assets = desiredManagedAssets(allAgents);
  const obsolete = preflightManaged(target, manifest, assets, interruptedTransaction);
  const writePaths = [
    ...EARLY_PROJECT_PATHS, ...assets.map(({ rel }) => rel), ...obsolete.map(({ rel }) => rel),
    ...blockPlans.map(({ rel }) => rel), ...settingsPlans.map(({ rel }) => rel),
    '.tidykeep/backup', '.tidykeep/.state', '.tidykeep/allowlist',
    '.tidykeep/hooks/guard_stale_names.py', '.tidykeep/hooks/stop_sync_check.py',
    configPlan.config.SCRATCH_DIR,
  ];
  assertNoProjectSymlinks(target, writePaths);
  const gitPlan = planGitHooks(target, options.noGitHooks);
  let kimiPlan = null;
  if (allAgents.has('kimi')) {
    kimiPlan = preflightKimiGlobal(target, { payloadDir: PAYLOAD, ownershipContext: manifest });
    if (!kimiPlan.ok) throw new Error(kimiPlan.problem);
  }

  if (options.dryRun) {
    log(`(dry-run)将安装到: ${target};本次接入=${[...selected].join(',')};已有接入保留;preflight 通过,不写任何文件`);
    return 0;
  }

  const entries = [];
  const recordUpdates = new Map();
  const addWrite = (rel, data, mode = 0o644, managed = false, before = undefined) => {
    entries.push({ rel, operation: 'write', data, mode, managed, before });
  };
  const addDelete = (rel, managed = false, before = undefined) => entries.push({
    rel, operation: 'delete', managed, before,
  });
  const setRecord = (rel, record) => recordUpdates.set(rel, record);

  const configData = Buffer.from(configPlan.text);
  addWrite('.tidykeep/config.jsonc', configData, 0o644, false, configPlan.before);

  for (const { rel, before } of obsolete) {
    addDelete(rel, true, before);
    setRecord(rel, null);
  }
  for (const asset of assets) {
    const data = managedData(asset);
    addWrite(asset.rel, data, asset.mode, true, asset.before);
    setRecord(asset.rel, plannedManagedRecord(sha256(data)));
  }

  if (configPlan.legacy && existsSync(configPlan.legacyPath)) {
    addDelete('.tidykeep/config', false, configPlan.legacyBefore);
  }
  // 旧 Python 区仍只删除已发布 hash 精确匹配的工具文件。
  for (const name of ['guard_stale_names.py', 'stop_sync_check.py']) {
    const rel = `.tidykeep/hooks/${name}`;
    const record = getFileRecord(manifest, rel);
    const before = legacyPythonBefore.get(rel);
    if (before && isKnownLegacyV1PythonHookHash(manifest, rel, sha256(before))) {
      addDelete(rel, false, before);
    } else if (!before && record) {
      addDelete(rel, false, null);
    }
  }

  const allowRel = '.tidykeep/allowlist';
  const allowPath = join(target, allowRel);
  if (!existsSync(allowPath)) {
    const data = readFileSync(join(PAYLOAD, 'allowlist'));
    addWrite(allowRel, data, 0o644, false, null);
  }

  for (const plan of blockPlans) {
    const data = Buffer.from(plan.text);
    addWrite(plan.rel, data, 0o644, false, plan.before);
  }

  const createdKnowledge = [];
  for (const name of ['STATE.md', 'LEDGER.md']) {
    const path = join(target, name);
    const existed = existsSync(path);
    if (!existed) {
      const data = readFileSync(join(PAYLOAD, name));
      addWrite(name, data, 0o644, false, null);
      createdKnowledge.push(name);
    }
  }

  for (const plan of settingsPlans) {
    const data = Buffer.from(plan.text);
    addWrite(plan.rel, data, 0o644, false, plan.before);
  }

  // 全部 stage 完成、journal 原子落盘后才开始改目标；异常退出后，下次 init
  // 验证并丢弃旧事务证据，再依据当前目标字节生成全新计划。
  assertNoProjectSymlinks(target, [...writePaths, INSTALL_TRANSACTION_REL]);
  preflightManaged(target, manifest, assets, interruptedTransaction);
  const transactionPlan = {
    entries,
    records: [...recordUpdates].map(([rel, record]) => ({ rel, record })),
    metadata: {
      toolVersion: pkgVersion(), runtimeVersion: pkgVersion(),
      agents: [...allAgents],
    },
  };
  const journal = prepareInstallTransaction(target, transactionPlan);
  const committedManifest = applyInstallTransaction(target, journal);
  try { unlinkSync(join(target, '.tidykeep', 'manifest')); } catch { /* 非旧安装 */ }
  for (const { rel } of obsolete) removeEmptyParents(target, rel);
  try { rmdirSync(join(target, '.tidykeep', 'hooks')); } catch { /* 非空则保留 */ }
  mkdirSync(join(target, '.tidykeep', '.state'), { recursive: true });
  mkdirSync(join(target, configPlan.config.SCRATCH_DIR), { recursive: true });
  for (const name of createdKnowledge) log(`${name} 已创建`);

  let externalProblem = false;
  if (allAgents.has('kimi')) {
    // manifest 只记录 agents 意图；用户级路径与中间状态均从现场注册/TOML 推导。
    // 若在 shim/TOML/注册中断，uninstall 会因精确注册缺失而 fail-closed。
    const result = installKimiGlobal(target, { payloadDir: PAYLOAD, ownershipContext: committedManifest, log });
    if (result.status.startsWith('problem-')) externalProblem = true;
    else if (result.status === 'installed') log('Kimi 层就绪(全局 hooks 经 ~/.tidykeep/kimi-shim.mjs 路由,未启用项目零影响)');
  }

  if (gitPlan.status === 'set') {
    if (!gitPlan.current) {
      const result = git(target, 'config', 'core.hooksPath', '.tidykeep/githooks');
      if (result.error || result.status !== 0) {
        externalProblem = true;
        const detail = result.error?.message ?? ((result.stderr ?? '').trim() || `exit ${result.status}`);
        log(`外部接线失败:无法设置 git core.hooksPath:${detail}`);
      } else {
        log('git core.hooksPath -> .tidykeep/githooks(原 .git/hooks 同名 hook 会被链式执行)');
      }
    }
  } else if (gitPlan.status === 'external') {
    if (gitPlan.inspection.ok) {
      log(`外部 core.hooksPath=${gitPlan.current} 已完整链入 tidykeep`);
    } else {
      externalProblem = true;
      log(`检测到已有 core.hooksPath=${gitPlan.current}(如 husky),未覆盖，但 tidykeep 接线尚未完整生效。请在其 pre-commit/commit-msg 中各加一行:`);
      log('  sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/pre-commit" "$@" || exit $?');
      log('  sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/commit-msg" "$@" || exit $?');
    }
  } else if (gitPlan.status === 'nogit') {
    log('非 git 仓库或 git 不可用:跳过 git hooks 层');
  }
  if (externalProblem) {
    log('本地文件已安装，但外部接线未完成；按上方提示处理后重跑 init 即可续接');
    return 1;
  }

  log(`安装完成 ✅(v${pkgVersion()})`);
  log('下一步: 1) 在任一 Agent 里说"tidykeep 初始化扫描"建立台账;');
  log('        2) 将 AGENTS.md CLAUDE.md STATE.md LEDGER.md .tidykeep .claude .codex .agents 提交入库;');
  log('        3) 团队成员克隆后执行一次: node .tidykeep/runtime/enable-githooks.mjs');
  return 0;
}

export function init(targetArg, rawOptions = {}) {
  const log = (message) => console.log(`[tidykeep] ${message}`);
  let target;
  let lock = null;
  let controlDirExisted = true;
  try {
    target = canonicalProjectRoot(targetArg || process.cwd());
    controlDirExisted = existsSync(join(target, '.tidykeep'));
    const options = validateInitOptions(rawOptions);
    assertNoProjectSymlinks(target, ['.tidykeep', '.tidykeep/.install-lock', INSTALL_TRANSACTION_REL]);
    assertGitProjectRoot(target, 'init');
    if (options.dryRun && hasInstallTransaction(target)) {
      throw new Error('存在中断安装事务；dry-run 不会改动它，请不带 --dry-run 重跑 init 以验证、丢弃并按现场重规划');
    }
    if (!options.dryRun) {
      lock = acquireProjectLock(target, 'init');
    }
    log(`安装到: ${target}`);
    return initImpl(target, options, log);
  } catch (error) {
    console.error(`[tidykeep] 错误: ${error?.message ?? error}`);
    return 1;
  } finally {
    releaseProjectLock(lock);
    if (target && lock && !controlDirExisted) {
      // 首次 preflight/锁失败且没有安装内容时不留下误导 status 的空控制目录。
      try { rmdirSync(join(target, '.tidykeep')); } catch { /* 正常安装或中断事务均非空 */ }
    }
  }
}
