#!/usr/bin/env node
// tidykeep git hook 业务逻辑(vendored;由 `npx tidykeep init` 刷新,请勿手改)。
// 用法: node githook.mjs pre-commit | commit-msg <msgfile>
// 对所有 agent 与人类生效的兜底强制层;逃生门:TIDYKEEP_SKIP=1 git commit ...
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as core from './core.mjs';
import * as msg from './messages.mjs';

function git(root, ...args) {
  return spawnSync('git', root ? ['-C', root, ...args] : args, { encoding: 'utf8', shell: false });
}

function stagedPaths(root, extra = []) {
  const r = git(root, 'diff', '--cached', '--name-only', ...extra);
  if (r.status !== 0) return [];
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

function main() {
  if (process.env.TIDYKEEP_SKIP === '1') return 0;
  const mode = process.argv[2];
  const top = git(null, 'rev-parse', '--show-toplevel');
  if (top.status !== 0) return 0;
  const root = top.stdout.trim();
  const cfg = core.loadConfig(root);
  const allow = core.loadAllowlist(root);
  const scratch = cfg.SCRATCH_DIR ?? '.tmp';

  if (mode === 'pre-commit') {
    if (cfg.GUARD !== false) {
      const bad = core.checkStagedNames(stagedPaths(root, ['--diff-filter=ACR']), cfg, allow);
      if (bad.length) {
        process.stderr.write(msg.msgPreCommitStale(bad, scratch) + '\n');
        return 1;
      }
    }
    const enforce = String(cfg.ENFORCE_LEDGER ?? 'block').toLowerCase();
    if (enforce !== 'off') {
      const { workHit, ledgerHit } = core.stagedLedgerSync(stagedPaths(root), cfg);
      if (workHit && !ledgerHit) {
        if (enforce === 'block') {
          process.stderr.write(msg.msgPreCommitLedger(true) + '\n');
          return 1;
        }
        process.stderr.write(msg.msgPreCommitLedger(false) + '\n');
      }
    }
    return 0;
  }

  if (mode === 'commit-msg') {
    const msgfile = process.argv[3];
    if (!msgfile) return 0;
    const r = core.checkCommitMsg(readFileSync(msgfile, 'utf8'), cfg);
    if (!r.ok) {
      process.stderr.write(msg.msgCommitMsgRejected(r, cfg) + '\n');
      return 1;
    }
    return 0;
  }
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  // 工具自身故障不应卡死人类提交(guardrail 定位);告警可见,便于上报
  process.stderr.write(`[tidykeep] hook 内部错误,本次放行: ${err?.message ?? err}\n`);
  process.exit(0);
}
