import { lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const PROTOTYPE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const RESERVED_PROJECT_DIRS = new Set([
  '.git', '.tidykeep', '.claude', '.codex', '.agents', '.kimi-code', 'node_modules',
]);

export function validateProjectDirectoryName(value, label = '项目目录名') {
  if (typeof value !== 'string' || !value || value !== value.trim()
      || !/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..'
      || RESERVED_PROJECT_DIRS.has(value.toLowerCase())) {
    throw new Error(`${label} 必须是安全的项目内单目录名:${JSON.stringify(value)}`);
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new Error(`${label} 不能使用 Windows 保留名称:${JSON.stringify(value)}`);
  }
  return value;
}

export function validateProjectRelativePath(value, label = '项目相对路径') {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')
      || isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new Error(`${label} 非法:${JSON.stringify(value)}`);
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || PROTOTYPE_SEGMENTS.has(part))) {
    throw new Error(`${label} 含非法路径段:${JSON.stringify(value)}`);
  }
  return value;
}

export function canonicalProjectRoot(value) {
  const requested = resolve(value);
  let root;
  try { root = realpathSync(requested); } catch { throw new Error(`目标目录不存在或不可访问:${requested}`); }
  let stat;
  try { stat = statSync(root); } catch { throw new Error(`目标目录不可访问:${root}`); }
  if (!stat.isDirectory()) throw new Error(`目标不是目录:${root}`);
  if (dirname(root) === root) throw new Error(`拒绝把文件系统根目录作为目标:${root}`);
  return root;
}

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * 判定 target 与其所属 Git worktree 的边界。Git 会从子目录向父级搜索仓库，直接
 * `git -C target config` 因而可能误改父仓库；所有接线命令必须先经过这里。
 */
export function gitProjectContext(target) {
  const result = spawnSync('git', ['-C', target, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8', shell: false,
  });
  if (result.error?.code === 'ENOENT') return { status: 'unavailable', root: null };
  if (result.error) return { status: 'error', root: null, detail: result.error.message };
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    if (/not a git repository/i.test(detail)) return { status: 'none', root: null };
    return { status: 'error', root: null, detail: detail || `git exit ${result.status}` };
  }
  const raw = (result.stdout ?? '').trim();
  if (!raw) return { status: 'error', root: null, detail: 'git 未返回仓库根目录' };
  let root;
  try { root = realpathSync(raw); } catch (error) {
    return { status: 'error', root: null, detail: `仓库根目录不可访问:${error?.message ?? error}` };
  }
  if (!samePath(root, target)) return { status: 'parent', root };

  const resolveGitPath = (value, label) => {
    const path = isAbsolute(value) ? value : resolve(target, value);
    try { return realpathSync(path); }
    catch (error) { throw new Error(`${label}不可访问:${error?.message ?? error}`); }
  };
  const gitDirResult = spawnSync('git', ['-C', target, 'rev-parse', '--git-dir'], {
    encoding: 'utf8', shell: false,
  });
  const commonDirResult = spawnSync('git', ['-C', target, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8', shell: false,
  });
  for (const [label, probe] of [['git dir', gitDirResult], ['git common dir', commonDirResult]]) {
    if (probe.error || probe.status !== 0 || !(probe.stdout ?? '').trim()) {
      const detail = (probe.error?.message ?? (probe.stderr ?? '').trim()) || `git exit ${probe.status}`;
      return { status: 'error', root, detail: `无法确认 ${label}:${detail}` };
    }
  }
  let gitDir;
  let gitCommonDir;
  try {
    gitDir = resolveGitPath(gitDirResult.stdout.trim(), 'git dir');
    gitCommonDir = resolveGitPath(commonDirResult.stdout.trim(), 'git common dir');
  } catch (error) {
    return { status: 'error', root, detail: error?.message ?? String(error) };
  }
  if (samePath(gitDir, gitCommonDir)) {
    return { status: 'root', root, gitDir, gitCommonDir, mainRoot: root };
  }
  // linked worktree 的 .git 指向 common dir 下的 worktrees/<name>；Git 配置
  // 仍由主仓库 common dir 共享，不能在此把 hooksPath 当成局部状态改写。
  const mainRoot = basename(gitCommonDir) === '.git' ? dirname(gitCommonDir) : null;
  return { status: 'linked', root, gitDir, gitCommonDir, mainRoot };
}

export function assertGitProjectRoot(target, operation = '操作') {
  const context = gitProjectContext(target);
  if (context.status === 'parent') {
    throw new Error(`${operation} 目标位于 Git 仓库子目录:${target};请改用仓库根目录:${context.root}`);
  }
  if (context.status === 'linked') {
    const main = context.mainRoot ?? context.gitCommonDir;
    throw new Error(`${operation} 拒绝 linked worktree:${target};请改在主仓库根操作:${main}`);
  }
  if (context.status === 'error') throw new Error(`${operation} 无法确认 Git 仓库边界:${context.detail}`);
  return context;
}

/**
 * 拒绝项目根以下任一既有 symlink 组件。目标根本身先 realpath，故用户从项目入口
 * symlink 调用仍受支持；但工具不会沿项目内容中的 symlink 写到仓库外。
 */
export function assertNoProjectSymlinks(root, rels) {
  for (const raw of new Set(rels)) {
    const rel = validateProjectRelativePath(raw);
    let current = root;
    for (const part of rel.split('/')) {
      current = join(current, part);
      let stat;
      try { stat = lstatSync(current); }
      catch (error) {
        if (error?.code === 'ENOENT') break;
        throw error;
      }
      if (stat.isSymbolicLink()) throw new Error(`拒绝通过项目内符号链接读写:${rel}`);
    }
  }
}
