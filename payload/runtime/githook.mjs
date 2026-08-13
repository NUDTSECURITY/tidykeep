#!/usr/bin/env node
// tidykeep git hook 业务逻辑(vendored;由 `npx tidykeep init` 刷新,请勿手改)。
// 用法: node githook.mjs pre-commit | commit-msg <msgfile>
// 对所有 agent 与人类生效的兜底强制层;逃生门:TIDYKEEP_SKIP=1 git commit ...
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as core from './core.mjs';
import * as msg from './messages.mjs';

function git(root, ...args) {
  return spawnSync('git', root ? ['-C', root, ...args] : args, {
    encoding: 'utf8', shell: false, timeout: 15000,
  });
}

function requireGit(result, action, { allowUnset = false } = {}) {
  if (!result.error && result.status === 0) return result;
  if (allowUnset && !result.error && result.status === 1) return result;
  const detail = ((result.stderr ?? '') + (result.error?.message ?? '')).trim();
  throw new Error(`${action} 失败${detail ? `: ${detail}` : ''}`);
}

function stagedPaths(root, extra = []) {
  // -z:NUL 分隔且无 quotepath 转义——否则非 ASCII 文件名被输出成
  // C 风格八进制转义串,命名与台账检查整体被绕过
  const r = requireGit(
    git(root, 'diff', '--cached', '--name-only', '-z', ...extra),
    '读取暂存区路径',
  );
  return (r.stdout ?? '').split('\0').filter(Boolean);
}

function stagedEntries(root) {
  const result = requireGit(
    git(root, 'diff', '--cached', '--name-status', '-z'),
    '读取暂存区状态',
  );
  const fields = (result.stdout ?? '').split('\0');
  const entries = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    if (!status) continue;
    if (/^[RC]/.test(status)) {
      const previous = fields[i++];
      const next = fields[i++];
      if (status[0] === 'R' && previous) entries.push(['D ', previous]);
      if (next) entries.push([`${status[0]} `, next]);
    } else {
      const path = fields[i++];
      if (path) entries.push([`${status[0]} `, path]);
    }
  }
  return entries;
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function headLedger(root) {
  const head = git(root, 'rev-parse', '--verify', 'HEAD');
  if (head.error) throw new Error(`读取 HEAD 失败: ${head.error.message}`);
  if (head.status !== 0) {
    // 未出生分支是合法的首次提交;其他无法解析 HEAD 的情形仍须 fail-closed。
    const symbolic = git(root, 'symbolic-ref', '-q', 'HEAD');
    if (symbolic.error || symbolic.status !== 0) {
      throw new Error('读取 HEAD 失败: 当前 HEAD 既非有效提交也非未出生分支');
    }
    const ref = symbolic.stdout.trim();
    const exists = git(root, 'show-ref', '--verify', '--quiet', ref);
    if (exists.error || (exists.status !== 0 && exists.status !== 1)) {
      throw new Error(`检查 HEAD 引用失败${exists.error ? `: ${exists.error.message}` : ''}`);
    }
    if (exists.status === 1) return '';
    throw new Error('读取 HEAD 失败: 分支引用存在但提交无法解析');
  }
  const tree = requireGit(
    git(root, 'ls-tree', '--name-only', '-z', 'HEAD', '--', 'LEDGER.md'),
    '检查 HEAD:LEDGER.md',
  );
  if (!tree.stdout) return '';
  return requireGit(git(root, 'show', 'HEAD:LEDGER.md'), '读取 HEAD:LEDGER.md').stdout ?? '';
}

function indexLedger(root) {
  return requireGit(git(root, 'show', ':LEDGER.md'), '读取暂存区 LEDGER.md').stdout ?? '';
}

function main() {
  if (process.env.TIDYKEEP_SKIP === '1') return 0;
  const mode = process.argv[2];
  const top = requireGit(git(null, 'rev-parse', '--show-toplevel'), '解析仓库根目录');
  const root = top.stdout.trim();
  const cfg = core.loadConfig(root);
  const allow = core.loadAllowlist(root);
  const scratch = cfg.SCRATCH_DIR ?? '.tmp';

  if (mode === 'pre-commit') {
    const entries = stagedEntries(root);
    if (cfg.GUARD !== false) {
      const bad = core.checkStagedNames(stagedPaths(root, ['--diff-filter=ACR']), cfg, allow);
      if (bad.length) {
        process.stderr.write(msg.msgPreCommitStale(bad, scratch) + '\n');
        return 1;
      }
    }
    const enforce = String(cfg.ENFORCE_LEDGER ?? 'block').toLowerCase();
    if (enforce !== 'off') {
      const sync = core.ledgerSyncCheck(entries, cfg);
      let missing = [];
      if (sync.workChanged && sync.ledgerChanged) {
        const coverage = core.ledgerCoverageCheck(
          sync.changes,
          headLedger(root),
          indexLedger(root),
          localDate(),
        );
        missing = coverage.missing;
      }
      if (sync.needSync || missing.length) {
        const detail = missing.length ? `\n未逐文件覆盖: ${missing.map((item) => item.path).join('、')}` : '';
        if (enforce === 'block') {
          process.stderr.write(msg.msgPreCommitLedger(true) + detail + '\n');
          return 1;
        }
        process.stderr.write(msg.msgPreCommitLedger(false) + detail + '\n');
      }
    }
    return 0;
  }

  if (mode === 'commit-msg') {
    const msgfile = process.argv[3];
    if (!msgfile) throw new Error('commit-msg 缺少提交信息文件参数');
    const comment = requireGit(
      git(root, 'config', '--get', 'core.commentChar'),
      '读取 core.commentChar',
      { allowUnset: true },
    );
    const configured = comment.status === 0 ? comment.stdout.trim() : '';
    // auto 不是字符 '#':Git 会按本次消息选择实际注释字符，交给 core 从
    // scissors/模板内容推断；未配置时才使用 Git 默认值 #。
    const commentChar = configured === 'auto' ? 'auto' : (configured ? configured[0] : '#');
    const r = core.checkCommitMsg(readFileSync(msgfile, 'utf8'), cfg, { commentChar });
    if (!r.ok) {
      process.stderr.write(msg.msgCommitMsgRejected(r, cfg) + '\n');
      return 1;
    }
    return 0;
  }
  throw new Error(`未知 git hook 模式: ${mode || '(空)'}`);
}

try {
  process.exit(main());
} catch (err) {
  // git hooks 是最终硬边界:内部/Git 故障必须拒绝,显式 TIDYKEEP_SKIP=1 仍可逃生。
  process.stderr.write(`[tidykeep] hook 内部错误,本次提交已拒绝: ${err?.message ?? err}\n`);
  process.stderr.write('[tidykeep] 修复后重试;紧急逃生可显式使用 TIDYKEEP_SKIP=1 git commit ...\n');
  process.exit(1);
}
