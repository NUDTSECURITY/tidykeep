// `tidykeep uninstall`：标记块与精确 hook 条目做外科剥离；机器资产只有在
// manifest 与已发布内容双重匹配时才删除，用户内容/配置/备份原地保留。
import {
  existsSync, lstatSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stripBlockText, upsertBlockText } from '../lib/markers.mjs';
import {
  fileHash, fileMatchesRecord, getFileRecord, loadManifest, saveManifest,
} from '../lib/manifest.mjs';
import { mergeSettingsText, stripSettingsText } from '../lib/settings-json.mjs';
import { atomicWriteFile, sha256 } from '../lib/fs-safe.mjs';
import { isKnownLegacyV2Asset, isKnownPublishedManagedAsset } from '../lib/legacy-assets.mjs';
import {
  MD_BEGIN, MD_END, HASH_BEGIN, HASH_END, CLAUDE_POINTER, GITATTRIBUTES_BLOCK,
  claudeHookGroups, codexHookGroups, gitignoreBlock,
} from '../lib/blocks.mjs';
import { hasExactKimiRegistration, uninstallKimiGlobal } from '../lib/kimi.mjs';
import { parseJsonc } from '../lib/jsonc.mjs';
import {
  assertGitProjectRoot, assertNoProjectSymlinks, canonicalProjectRoot, validateProjectDirectoryName,
} from '../lib/project-paths.mjs';
import { acquireProjectLock, releaseProjectLock } from '../lib/project-lock.mjs';
import { hasInstallTransaction, INSTALL_TRANSACTION_REL } from '../lib/install-transaction.mjs';

const PAYLOAD = fileURLToPath(new URL('../../payload/', import.meta.url));
const EARLY_PROJECT_PATHS = [
  '.tidykeep', '.tidykeep/config.jsonc', '.tidykeep/config',
  '.tidykeep/manifest.json', '.tidykeep/manifest',
  INSTALL_TRANSACTION_REL, '.tidykeep/.install-lock',
  '.claude', '.claude/settings.json', '.codex', '.codex/hooks.json', '.agents',
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.gitignore', '.gitattributes',
  'STATE.md', 'LEDGER.md',
];
function git(root, ...args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false });
}

function tryRmdir(path) {
  try { rmdirSync(path); } catch { /* 非空或不存在则保留 */ }
}

function removeEmptyParents(target, rel) {
  let dir = dirname(join(target, rel));
  while (dir !== target && dir.startsWith(target)) {
    try { rmdirSync(dir); } catch { break; }
    dir = dirname(dir);
  }
}

function knownPayloadFiles() {
  const out = new Map();
  const walk = (sourceDir, relBase) => {
    for (const name of readdirSync(sourceDir)) {
      const source = join(sourceDir, name);
      const rel = `${relBase}/${name}`;
      if (statSync(source).isDirectory()) walk(source, rel);
      else out.set(rel, source);
    }
  };
  walk(join(PAYLOAD, 'runtime'), '.tidykeep/runtime');
  walk(join(PAYLOAD, 'githooks'), '.tidykeep/githooks');
  out.set('.tidykeep/docs/workflows.md', join(PAYLOAD, 'docs', 'workflows.md'));
  out.set('.claude/skills/tidykeep/SKILL.md', join(PAYLOAD, 'skill', 'SKILL.md'));
  out.set('.agents/skills/tidykeep/SKILL.md', join(PAYLOAD, 'skill', 'SKILL.md'));
  return out;
}

function matchesPayloadTemplate(target, rel) {
  const source = rel === 'STATE.md' || rel === 'LEDGER.md' ? join(PAYLOAD, rel) : null;
  const path = join(target, rel);
  return Boolean(source && existsSync(path) && fileHash(path) === fileHash(source));
}

function normalizedPayloadHash(source) {
  return sha256(Buffer.from(readFileSync(source, 'utf8').replace(/\r\n?/g, '\n')));
}

function uninstallImpl(target, options, log, gitContext) {
  assertNoProjectSymlinks(target, EARLY_PROJECT_PATHS);
  if (!existsSync(join(target, '.tidykeep'))) {
    log(`未安装:${target};未触碰项目或用户级 Kimi 状态`);
    return 0;
  }
  const manifest = loadManifest(target);
  const problems = [];
  if (manifest.loadError) throw new Error(`manifest.json 损坏:${manifest.loadError.message}`);
  let scratch = '.tmp';
  const configPath = join(target, '.tidykeep', 'config.jsonc');
  if (existsSync(configPath)) {
    try {
      const value = parseJsonc(readFileSync(configPath, 'utf8'))?.SCRATCH_DIR;
      if (value !== undefined) scratch = validateProjectDirectoryName(value, 'SCRATCH_DIR');
    } catch { problems.push('.tidykeep/config.jsonc 无法解析'); }
  }

  const projectPaths = [
    ...EARLY_PROJECT_PATHS, ...Object.keys(manifest.files ?? {}),
    '.tidykeep/runtime', '.tidykeep/githooks', '.tidykeep/docs', '.tidykeep/backup',
    '.tidykeep/.state', '.tidykeep/allowlist',
    '.claude/skills/tidykeep/SKILL.md', '.agents/skills/tidykeep/SKILL.md',
  ];
  assertNoProjectSymlinks(target, projectPaths);

  // Kimi 必须最先处理；全局块不成对时保留注册、shim 以及本项目可路由 runtime。
  const kimiTracked = (manifest.agents ?? []).includes('kimi') || hasExactKimiRegistration(target);
  let preserveRuntime = false;
  if (kimiTracked) {
    const result = uninstallKimiGlobal(target, { ownershipContext: manifest, log });
    if (result.status.startsWith('problem-')) {
      problems.push(result.problem ?? result.status);
      preserveRuntime = true;
    }
  }

  const generatedBlocks = new Map([
    ['AGENTS.md', readFileSync(join(PAYLOAD, 'rules.md'), 'utf8')],
    ['CLAUDE.md', CLAUDE_POINTER],
    ['.gitignore', gitignoreBlock(scratch)],
    ['.gitattributes', GITATTRIBUTES_BLOCK],
  ]);
  const stripMarked = (rel, begin, end) => {
    const path = join(target, rel);
    if (!existsSync(path)) { delete manifest.files[rel]; return; }
    const before = readFileSync(path, 'utf8');
    const result = stripBlockText(before, begin, end);
    if (result.status === 'unpaired') {
      const problem = `${rel} 中 tidykeep 标记不成对`;
      problems.push(problem);
      log(`警告: ${problem},为避免误删用户内容未改动`);
      return;
    }
    if (!result.stripped) { delete manifest.files[rel]; return; }
    const generated = generatedBlocks.get(rel);
    const exactToolOnly = generated !== undefined
      && before === upsertBlockText('', begin, end, generated).text;
    if (!result.text.trim() && exactToolOnly) {
      unlinkSync(path);
      removeEmptyParents(target, rel);
      log(`已删除 ${rel}(内容精确等于工具生成模板)`);
    } else {
      atomicWriteFile(path, result.text);
      log(`已移除 ${rel} 中的 tidykeep 块`);
    }
    delete manifest.files[rel];
  };
  for (const rel of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) stripMarked(rel, MD_BEGIN, MD_END);
  for (const rel of ['.gitignore', '.gitattributes']) stripMarked(rel, HASH_BEGIN, HASH_END);

  const generatedSettings = new Map([
    ['.claude/settings.json', mergeSettingsText(undefined, claudeHookGroups()).text],
    ['.codex/hooks.json', mergeSettingsText(undefined, codexHookGroups()).text],
  ]);
  for (const rel of ['.claude/settings.json', '.codex/hooks.json']) {
    const path = join(target, rel);
    if (!existsSync(path)) { delete manifest.files[rel]; continue; }
    const before = readFileSync(path, 'utf8');
    const result = stripSettingsText(before);
    if (result.status === 'skipped') {
      const problem = `${rel} ${result.reason === 'invalid-json' ? '无法解析' : 'hooks 结构无效'}`;
      problems.push(problem);
      preserveRuntime = true;
      log(`警告: ${problem},未改动;请手工移除 tidykeep 条目`);
      continue;
    }
    if (result.candidatesRemaining) {
      const problem = `${rel} 含用户改过的 tidykeep hook 描述符,已保留对应 runtime`;
      problems.push(problem);
      preserveRuntime = true;
      log(`警告: ${problem}`);
    }
    if (result.status === 'empty' && before === generatedSettings.get(rel)) {
      unlinkSync(path);
      removeEmptyParents(target, rel);
      log(`已删除 ${rel}(内容精确等于工具生成设置)`);
    } else {
      atomicWriteFile(path, result.text || '{}\n');
      log(`已移除 ${rel} 中的 tidykeep hooks`);
    }
    delete manifest.files[rel];
  }

  // 先处理本地 Git 接线；查询、还原或外部链路无法证明已解除时，必须同时
  // 保留 githooks 与 runtime，避免留下仍会执行但目标已消失的悬空 hook。
  let preserveGitHooks = false;
  const hooksPath = git(target, 'config', 'core.hooksPath');
  if (!hooksPath.error && hooksPath.status === 0 && (hooksPath.stdout ?? '').trim() === '.tidykeep/githooks') {
    const unset = git(target, 'config', '--unset', 'core.hooksPath');
    if (unset.error || unset.status !== 0) {
      preserveGitHooks = true;
      preserveRuntime = true;
      const problem = `无法还原 git core.hooksPath:${unset.error?.message ?? (unset.stderr ?? '').trim()}`;
      problems.push(problem);
      log(`警告: ${problem};保留 githooks 与 runtime`);
    } else log('已还原 git core.hooksPath');
  } else if (!hooksPath.error && hooksPath.status === 0 && (hooksPath.stdout ?? '').trim()) {
    const externalPath = (hooksPath.stdout ?? '').trim();
    // 外部脚本可经变量、source 或其他脚本间接调用；静态分析不能把“没找到字面量”
    // 当作未接线的证明。用户须先移除接线并 unset/改回 hooksPath，再重跑卸载。
    preserveGitHooks = true;
    preserveRuntime = true;
    const problem = `core.hooksPath=${externalPath} 仍由外部系统接管，无法证明不存在间接 tidykeep 接线;请先移除接线并 unset core.hooksPath 后重跑 uninstall`;
    problems.push(problem);
    log(`警告: ${problem};保留 githooks 与 runtime`);
  } else if ((hooksPath.error || ![0, 1].includes(hooksPath.status))
      && gitContext.status !== 'none') {
    preserveGitHooks = true;
    preserveRuntime = true;
    const detail = hooksPath.error?.message ?? ((hooksPath.stderr ?? '').trim() || `exit ${hooksPath.status}`);
    const problem = `无法读取 git core.hooksPath，不能确认接线已解除:${detail}`;
    problems.push(problem);
    log(`警告: ${problem};保留 githooks 与 runtime`);
  }

  const known = knownPayloadFiles();
  const managedRels = new Set();
  for (const [rel] of Object.entries(manifest.files ?? {})) {
    const record = getFileRecord(manifest, rel);
    if (!record?.managed) continue;
    managedRels.add(rel);
    const path = join(target, rel);
    if (!existsSync(path)) { delete manifest.files[rel]; continue; }
    if ((preserveRuntime && rel.startsWith('.tidykeep/runtime/'))
        || (preserveGitHooks && rel.startsWith('.tidykeep/githooks/'))) continue;
    const source = known.get(rel);
    const publishedContent = (source && fileHash(path) === normalizedPayloadHash(source))
      || isKnownPublishedManagedAsset(rel, path);
    if (fileMatchesRecord(manifest, rel, path) && publishedContent) {
      unlinkSync(path);
      delete manifest.files[rel];
      removeEmptyParents(target, rel);
    } else {
      const problem = `${rel} 已被用户修改,未删除`;
      problems.push(problem);
      log(`警告: ${problem}`);
    }
  }

  // v1/v2 没有 managed 记录；内容与当前 payload 完全相同时才可安全清理。
  if (manifest.legacyVersion) {
    for (const [rel, source] of known) {
      if (managedRels.has(rel)) continue;
      const path = join(target, rel);
      if (!existsSync(path)) continue;
      if ((preserveRuntime && rel.startsWith('.tidykeep/runtime/'))
          || (preserveGitHooks && rel.startsWith('.tidykeep/githooks/'))) continue;
      if (fileHash(path) === normalizedPayloadHash(source) || isKnownLegacyV2Asset(manifest, rel, path)) {
        unlinkSync(path);
        removeEmptyParents(target, rel);
      }
    }
  }

  if (options.purge) {
    for (const rel of ['STATE.md', 'LEDGER.md']) {
      const path = join(target, rel);
      if (!existsSync(path)) { delete manifest.files[rel]; continue; }
      if (matchesPayloadTemplate(target, rel)) {
        unlinkSync(path);
        delete manifest.files[rel];
        log(`--purge 已删除 ${rel}`);
      } else {
        const problem = `${rel} 内容不等于工具知识模板,--purge 未删除`;
        problems.push(problem);
        log(`警告: ${problem}`);
      }
    }
  } else {
    log(`已保留 STATE.md / LEDGER.md / ${scratch}/(项目知识;--purge 可移除未修改模板)`);
  }

  // 配置和 allowlist 属于项目输入，manifest 不持久化其 hash，卸载始终保留。
  for (const rel of ['.tidykeep/config.jsonc', '.tidykeep/allowlist']) {
    const path = join(target, rel);
    if (!existsSync(path)) { delete manifest.files[rel]; continue; }
    delete manifest.files[rel];
    log(`已保留 ${rel}(项目配置)`);
  }

  const stateDir = join(target, '.tidykeep', '.state');
  if (existsSync(stateDir)) {
    for (const name of readdirSync(stateDir)) {
      const path = join(stateDir, name);
      try {
        const stat = lstatSync(path);
        if (stat.isFile() && /^stop-once-[A-Za-z0-9._-]+$/.test(name)
            && readFileSync(path, 'utf8') === '1') unlinkSync(path);
      } catch { /* 未知或并发变化的内容由 residual 报告，绝不递归删除 */ }
    }
    tryRmdir(stateDir);
    if (existsSync(stateDir)) {
      const problem = `.tidykeep/.state 含非工具状态:${readdirSync(stateDir).join(',')}`;
      problems.push(problem);
      log(`警告: ${problem};未删除`);
    }
  }
  for (const dir of [
    join(target, '.claude', 'skills', 'tidykeep'), join(target, '.agents', 'skills', 'tidykeep'),
  ]) tryRmdir(dir);
  for (const dir of [
    join(target, '.claude', 'skills'), join(target, '.claude'),
    join(target, '.agents', 'skills'), join(target, '.agents'), join(target, '.codex'),
    ...(!preserveRuntime ? [join(target, '.tidykeep', 'runtime')] : []),
    ...(!preserveGitHooks ? [join(target, '.tidykeep', 'githooks')] : []),
    join(target, '.tidykeep', 'docs'),
  ]) tryRmdir(dir);

  const backupDir = join(target, '.tidykeep', 'backup');
  if (existsSync(backupDir)) log('已保留 .tidykeep/backup/ 中的既有备份/用户内容');
  delete manifest.files['.tidykeep/backup/settings.json.bak'];
  delete manifest.files['.tidykeep/backup/codex-hooks.json.bak'];

  const tk = join(target, '.tidykeep');
  const residual = existsSync(tk)
    ? readdirSync(tk).filter((name) => ![
      'manifest.json', 'manifest', '.install-lock', 'config.jsonc', 'allowlist', 'backup',
    ].includes(name))
    : [];
  if (residual.length) {
    const problem = `.tidykeep 仍含无法证明所有权的内容:${residual.join(',')}`;
    problems.push(problem);
    log(`警告: ${problem}`);
  }
  if (problems.length) {
    if (existsSync(tk)) {
      saveManifest(target, manifest);
    }
    log(`卸载完成,但保留 ${new Set(problems).size} 项用户修改/待处理内容`);
  } else {
    rmSync(join(tk, 'manifest.json'), { force: true });
    rmSync(join(tk, 'manifest'), { force: true });
    tryRmdir(tk);
    log(existsSync(tk)
      ? '卸载完成 ✅(项目配置/allowlist/既有备份已保留)'
      : '卸载完成 ✅');
  }
  return problems.length ? 1 : 0;
}

export function uninstall(targetArg, options = {}) {
  const log = (message) => console.log(`[tidykeep] ${message}`);
  let target;
  let lock = null;
  try {
    target = canonicalProjectRoot(targetArg || process.cwd());
    assertNoProjectSymlinks(target, ['.tidykeep', '.tidykeep/.install-lock', INSTALL_TRANSACTION_REL]);
    const gitContext = assertGitProjectRoot(target, 'uninstall');
    if (options.dryRun) { log(`(dry-run)将从 ${target} 卸载;不写任何文件`); return 0; }
    log(`从 ${target} 卸载`);
    if (existsSync(join(target, '.tidykeep'))) {
      lock = acquireProjectLock(target, 'uninstall');
      if (hasInstallTransaction(target)) {
        throw new Error('存在中断安装事务；uninstall 不会信任项目内 journal，请先重跑 init 验证、丢弃旧 staging 并按现场重规划，再卸载');
      }
    }
    return uninstallImpl(target, options, log, gitContext);
  }
  catch (error) {
    console.error(`[tidykeep] 卸载错误:${error?.message ?? error}`);
    return 1;
  } finally {
    releaseProjectLock(lock);
  }
}
