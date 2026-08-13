// Kimi Code 全局 hooks 路由。用户级状态以 projects.d/ 的每项目原子标记维护，
// 所有变更在带 owner token 的目录锁内完成；卸载遇到不成对标记时绝不先删注册或 shim。
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync,
  unlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertBlockText, stripBlockText } from './markers.mjs';
import { HASH_BEGIN, HASH_END, kimiTomlBlock } from './blocks.mjs';
import { atomicWriteFile, hashFile } from './fs-safe.mjs';
import { isKnownLegacyV2KimiShim } from './legacy-assets.mjs';
import { acquireDirectoryLock, releaseDirectoryLock } from './directory-lock.mjs';
import { toPosix } from '../../payload/runtime/core.mjs';

const CURRENT_SHIM = fileURLToPath(new URL('../../payload/runtime/kimi-shim.mjs', import.meta.url));

function problem(status, message, paths) {
  return { ok: false, status, paths, problem: message };
}

function assertPlainPath(path, finalType) {
  const chain = [];
  let current = resolve(path);
  for (;;) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  chain.reverse();
  for (let index = 0; index < chain.length; index++) {
    let stat;
    try { stat = lstatSync(chain[index]); }
    catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`路径含符号链接:${chain[index]}`);
    const final = index === chain.length - 1;
    if ((!final || finalType === 'directory') && !stat.isDirectory()) {
      throw new Error(`路径组件不是普通目录:${chain[index]}`);
    }
    if (final && finalType === 'file' && !stat.isFile()) {
      throw new Error(`目标不是普通文件:${chain[index]}`);
    }
  }
}

function assertSafeKimiPaths(paths) {
  assertPlainPath(paths.kimiHome, 'directory');
  assertPlainPath(paths.configToml, 'file');
  assertPlainPath(paths.userDir, 'directory');
  assertPlainPath(paths.projectsDir, 'directory');
  assertPlainPath(paths.lockDir, 'directory');
  assertPlainPath(paths.shim, 'file');
  assertPlainPath(paths.shimHash, 'file');
}

export function kimiPaths(env = process.env) {
  const kimiHome = env.KIMI_CODE_HOME || join(homedir(), '.kimi-code');
  const userDir = env.TIDYKEEP_USER_DIR || join(homedir(), '.tidykeep');
  return {
    kimiHome,
    configToml: join(kimiHome, 'config.toml'),
    userDir,
    shim: join(userDir, 'kimi-shim.mjs'),
    shimHash: join(userDir, 'kimi-shim.sha256'),
    projectsDir: join(userDir, 'projects.d'),
    lockDir: join(userDir, '.lock'),
  };
}

function canonicalKey(projectRoot) {
  let abs;
  try { abs = realpathSync(projectRoot); } catch { abs = resolve(projectRoot); }
  let key = toPosix(abs);
  if (process.platform === 'win32') key = key.toLowerCase();
  return key;
}

const entryPath = (projectsDir, key) => join(projectsDir, createHash('sha1').update(key).digest('hex'));

function expectedMarkerText(key) {
  return `${key}\n`;
}

function registrationProblem(paths, key) {
  const marker = entryPath(paths.projectsDir, key);
  if (!existsSync(marker)) {
    return problem(
      'problem-registration-missing',
      `Kimi 项目注册缺失:${marker}；拒绝改动全局 hooks`,
      paths,
    );
  }
  try {
    if (!lstatSync(marker).isFile() || lstatSync(marker).isSymbolicLink()
        || resolve(realpathSync(marker)) !== resolve(marker)
        || readFileSync(marker, 'utf8') !== expectedMarkerText(key)) {
      return problem(
        'problem-registration-mismatch',
        `Kimi 项目注册内容与当前项目不匹配:${marker}；拒绝改动全局 hooks`,
        paths,
      );
    }
  } catch {
    return problem(
      'problem-registration-mismatch',
      `Kimi 项目注册不可读:${marker}；拒绝改动全局 hooks`,
      paths,
    );
  }
  return null;
}

export function hasExactKimiRegistration(projectRoot, env = process.env) {
  const paths = kimiPaths(env);
  return registrationProblem(paths, canonicalKey(projectRoot)) === null;
}

/**
 * 旧版与当前版都使用 HASH 标记。仅标记配对还不足以证明所有权：块内 path、
 * event、command、timeout 必须与由当前 shim 路径生成的完整内容逐字一致。
 */
export function inspectKimiTomlBlock(text, shimPath) {
  const normalized = text.replaceAll('\r\n', '\n');
  const hasBegin = normalized.includes(HASH_BEGIN);
  const hasEnd = normalized.includes(HASH_END);
  if (!hasBegin && !hasEnd) return { status: 'absent', count: 0 };

  const stripped = stripBlockText(text, HASH_BEGIN, HASH_END);
  if (stripped.status === 'unpaired') return { status: 'unpaired', count: 0 };

  const body = kimiTomlBlock(toPosix(shimPath)).replace(/\n+$/, '');
  const expected = `${HASH_BEGIN}\n${body}\n${HASH_END}`;
  let cursor = 0;
  let count = 0;
  for (;;) {
    const begin = normalized.indexOf(HASH_BEGIN, cursor);
    if (begin === -1) break;
    const end = normalized.indexOf(HASH_END, begin + HASH_BEGIN.length);
    if (end === -1) return { status: 'unpaired', count };
    const actual = normalized.slice(begin, end + HASH_END.length);
    if (actual !== expected) return { status: 'drift', count };
    count++;
    cursor = end + HASH_END.length;
  }
  return { status: 'exact', count };
}

function acquireUserLock(paths) {
  assertSafeKimiPaths(paths);
  mkdirSync(paths.userDir, { recursive: true });
  assertSafeKimiPaths(paths);
  const lock = acquireDirectoryLock(paths.lockDir, {
    operation: 'kimi-global', attempts: 50, waitMs: 10,
    busyMessage: 'Kimi 用户级状态正被另一 tidykeep 进程修改',
  });
  return () => releaseDirectoryLock(lock);
}

function shimOwnershipOk(paths, incomingHash = null, ownershipContext = null) {
  if (!existsSync(paths.shim)) return true;
  let recorded = '';
  try { recorded = readFileSync(paths.shimHash, 'utf8').trim(); } catch { /* 旧安装没有 hash */ }
  const current = hashFile(paths.shim);
  const published = current === hashFile(CURRENT_SHIM)
    || (incomingHash !== null && current === incomingHash)
    || isKnownLegacyV2KimiShim(ownershipContext, paths.shim);
  return recorded ? current === recorded && published : published;
}

/** 只读统计 runtime 仍可路由的精确注册；不借当前项目卸载删别的项目记录。 */
function liveProjects(projectsDir) {
  let names;
  try { names = readdirSync(projectsDir); } catch { return 0; }
  let live = 0;
  for (const name of names) {
    const marker = join(projectsDir, name);
    let markerText = '';
    try {
      const markerStat = lstatSync(marker);
      if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size > 32_768
          || resolve(realpathSync(marker)) !== resolve(marker)) continue;
      markerText = readFileSync(marker, 'utf8');
    } catch { continue; }
    if (!markerText.endsWith('\n')) continue;
    const project = markerText.slice(0, -1);
    if (!project || project.includes('\n') || entryPath(projectsDir, project) !== marker) continue;
    if (existsSync(join(project, '.tidykeep', 'runtime', 'hook.mjs'))) live++;
  }
  return live;
}

export function preflightKimiGlobal(projectRoot, {
  env = process.env, payloadDir, ownershipContext = null,
}) {
  const paths = kimiPaths(env);
  if (!existsSync(paths.kimiHome)) return { ok: true, status: 'skipped-no-kimi', paths };
  try { assertSafeKimiPaths(paths); }
  catch (error) {
    return problem('problem-path-unsafe', `Kimi 用户路径不安全:${error?.message ?? error}`, paths);
  }
  const toml = existsSync(paths.configToml) ? readFileSync(paths.configToml, 'utf8') : '';
  const ownedBlock = inspectKimiTomlBlock(toml, paths.shim);
  if (ownedBlock.status === 'unpaired') {
    return problem('problem-unpaired', `${paths.configToml} 中 tidykeep 标记不成对`, paths);
  }
  if (ownedBlock.status === 'drift') {
    return problem(
      'problem-block-drift',
      `${paths.configToml} 中 tidykeep 块的 path/event/command/timeout 已漂移，拒绝覆盖`,
      paths,
    );
  }
  const inlineHooks = ownedBlock.status === 'absent' && /^\s*hooks\s*=/m.test(toml);
  if (inlineHooks) {
    return problem(
      'problem-inline-hooks',
      `${paths.configToml} 使用内联 hooks 数组，当前不支持安全自动合并；请先移除/改写为 [[hooks]] 表结构后重跑 init`,
      paths,
    );
  }
  const key = canonicalKey(projectRoot);
  const marker = entryPath(paths.projectsDir, key);
  if (existsSync(marker)) {
    const registration = registrationProblem(paths, key);
    if (registration) return registration;
  }
  const shimSource = join(payloadDir, 'runtime', 'kimi-shim.mjs');
  const incomingHash = hashFile(shimSource);
  if (!shimOwnershipOk(paths, incomingHash, ownershipContext)) {
    return problem('problem-shim-modified', `${paths.shim} 已被用户修改`, paths);
  }
  const block = upsertBlockText(toml, HASH_BEGIN, HASH_END, kimiTomlBlock(toPosix(paths.shim)));
  return {
    ok: true, status: 'ready', paths, toml,
    nextToml: block.text, shimSource, incomingHash,
  };
}

export function installKimiGlobal(projectRoot, {
  env = process.env, payloadDir, ownershipContext = null, log = () => {},
}) {
  const first = preflightKimiGlobal(projectRoot, { env, payloadDir, ownershipContext });
  if (!first.ok) { log(`警告: ${first.problem},拒绝覆盖`); return { status: first.status, problem: first.problem }; }
  if (first.status === 'skipped-no-kimi') {
    log(`未检测到 Kimi Code(${first.paths.kimiHome} 不存在),跳过 Kimi hooks 层`);
    return { status: first.status };
  }
  let release;
  try { release = acquireUserLock(first.paths); } catch (error) {
    log(`警告: ${error.message}`);
    return { status: 'problem-busy', problem: error.message };
  }
  try {
    const check = preflightKimiGlobal(projectRoot, { env, payloadDir, ownershipContext });
    if (!check.ok) { log(`警告: ${check.problem},拒绝覆盖`); return { status: check.status, problem: check.problem }; }
    mkdirSync(check.paths.projectsDir, { recursive: true });
    atomicWriteFile(check.paths.shim, readFileSync(check.shimSource), { mode: 0o755 });
    if (process.env.TIDYKEEP_TEST_FAIL_KIMI_AFTER_SHIM === '1') {
      throw new Error('测试注入:Kimi shim 写入后中断');
    }
    atomicWriteFile(check.paths.shimHash, check.incomingHash + '\n');
    if (check.nextToml !== check.toml) atomicWriteFile(check.paths.configToml, check.nextToml);
    const key = canonicalKey(projectRoot);
    atomicWriteFile(entryPath(check.paths.projectsDir, key), expectedMarkerText(key));
    return { status: 'installed' };
  } finally {
    release();
  }
}

export function uninstallKimiGlobal(projectRoot, {
  env = process.env, ownershipContext = null, log = () => {},
}) {
  const paths = kimiPaths(env);
  try { assertSafeKimiPaths(paths); }
  catch (error) {
    const message = `Kimi 用户路径不安全:${error?.message ?? error}`;
    log(`警告: ${message}`);
    return { status: 'problem-path-unsafe', problem: message };
  }
  const key = canonicalKey(projectRoot);
  const missingBeforeLock = !existsSync(paths.userDir) || !existsSync(entryPath(paths.projectsDir, key));
  if (missingBeforeLock) {
    // shim 只会路由精确注册项目；当前项目没有 marker 时，无论其他项目是否
    // 使用共享全局块，都不得借本项目卸载改动全局状态，且本地 runtime 可安全移除。
    log('Kimi 当前项目无精确注册；未触碰其他项目共享的全局 hooks');
    return { status: 'not-installed' };
  }
  let release;
  try { release = acquireUserLock(paths); } catch (error) {
    log(`警告: ${error.message};保留 Kimi shim 与项目注册`);
    return { status: 'problem-busy', problem: error.message };
  }
  let cleanupUserDir = false;
  try {
    const registration = registrationProblem(paths, key);
    if (registration) {
      log(`警告: ${registration.problem}`);
      return { status: registration.status, problem: registration.problem };
    }
    let toml = '';
    if (existsSync(paths.configToml)) toml = readFileSync(paths.configToml, 'utf8');
    const ownedBlock = inspectKimiTomlBlock(toml, paths.shim);
    if (ownedBlock.status === 'unpaired') {
      const problem = `${paths.configToml} 中 tidykeep 标记不成对`;
      log(`警告: ${problem};保留 shim 与项目注册,请手工修复后重试`);
      return { status: 'problem-unpaired', problem };
    }
    if (ownedBlock.status === 'drift') {
      const problem = `${paths.configToml} 中 tidykeep 块的 path/event/command/timeout 已漂移`;
      log(`警告: ${problem};保留全局块、shim 与项目注册,请手工确认`);
      return { status: 'problem-block-drift', problem };
    }

    // 上面已在同一用户级锁中验证内容精确匹配，到此才获得删除权。
    unlinkSync(entryPath(paths.projectsDir, key));
    const remaining = liveProjects(paths.projectsDir);
    if (remaining > 0) {
      log(`Kimi 全局 hooks 保留(仍有 ${remaining} 个项目在用)`);
      return { status: 'kept', remaining };
    }

    const stripped = stripBlockText(toml, HASH_BEGIN, HASH_END);
    if (stripped.stripped) atomicWriteFile(paths.configToml, stripped.text);
    let shimProblem = null;
    if (existsSync(paths.shim) && !shimOwnershipOk(paths, null, ownershipContext)) {
      shimProblem = `${paths.shim} 已被用户修改,未删除`;
      log(`警告: ${shimProblem}`);
    } else {
      try { unlinkSync(paths.shim); } catch { /* 不存在 */ }
      try { unlinkSync(paths.shimHash); } catch { /* 不存在 */ }
    }
    try { rmdirSync(paths.projectsDir); } catch { /* 竞态或非空 */ }
    cleanupUserDir = true;
    log('Kimi 全局 hooks 已移除(最后一个使用项目已卸载)');
    return shimProblem ? { status: 'problem-shim-modified', problem: shimProblem } : { status: 'removed' };
  } finally {
    release();
    // 锁本身位于 userDir；只有先释放锁，空目录清理才可能成功。
    if (cleanupUserDir) {
      try { rmdirSync(paths.userDir); } catch { /* 用户文件或用户修改 shim 保留 */ }
    }
  }
}
