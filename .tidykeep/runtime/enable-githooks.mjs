#!/usr/bin/env node
// 启用 tidykeep git hooks(团队成员克隆仓库后执行一次;离线可用,不依赖 npm)。
// core.hooksPath 是本地 git 配置,不随仓库同步,因此每人一次。
import { chmodSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false });

if (git('rev-parse', '--git-dir').status !== 0) {
  console.log('[tidykeep] 非 git 仓库,跳过 git hooks(建议 git init 后重跑)');
  process.exit(0);
}

const hooksDir = join(root, '.tidykeep', 'githooks');
try {
  for (const f of readdirSync(hooksDir)) {
    try { chmodSync(join(hooksDir, f), 0o755); } catch { /* Windows 无执行位,忽略 */ }
  }
} catch { /* 目录缺失时由 doctor 报告 */ }

const cur = git('config', 'core.hooksPath').stdout.trim();
if (!cur) {
  git('config', 'core.hooksPath', '.tidykeep/githooks');
  console.log('[tidykeep] git hooks 已启用(core.hooksPath -> .tidykeep/githooks;原 .git/hooks 同名 hook 会被链式执行)');
} else if (cur === '.tidykeep/githooks') {
  console.log('[tidykeep] git hooks 已是启用状态');
} else {
  console.log(`[tidykeep] 检测到已有 core.hooksPath=${cur}(如 husky),未覆盖。`);
  console.log(`  请在 ${cur}/pre-commit 与 ${cur}/commit-msg 中各加入一行:`);
  console.log('    sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/pre-commit" "$@" || exit $?');
  console.log('    sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/commit-msg" "$@" || exit $?');
}
