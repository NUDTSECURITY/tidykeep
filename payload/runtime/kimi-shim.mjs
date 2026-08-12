#!/usr/bin/env node
// tidykeep 用户级路由 shim(安装于 ~/.tidykeep/;由 `npx tidykeep init` 刷新)。
// Kimi Code 的 hooks 只能配置在用户全局 config.toml,本 shim 负责把事件路由到
// "启用了 tidykeep 的项目"里 vendored 的 runtime(版本随项目);未启用的项目
// 立即放行(exit 0),对其他项目零影响。
// 用法: node kimi-shim.mjs kimi-pretooluse | kimi-stop
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

try {
  const flavor = process.argv[2] ?? '';
  const input = readFileSync(0, 'utf8');
  let cwd = process.cwd();
  try {
    const p = JSON.parse(input);
    if (p && typeof p.cwd === 'string' && p.cwd) cwd = p.cwd;
  } catch { /* 无法解析时退回进程 cwd */ }

  let dir = resolve(cwd);
  let hookPath = null;
  for (;;) {
    const candidate = join(dir, '.tidykeep', 'runtime', 'hook.mjs');
    if (existsSync(candidate)) { hookPath = candidate; break; }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (hookPath) {
    const r = spawnSync(process.execPath, [hookPath, flavor], {
      input,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    process.exit(r.status ?? 0);
  }
} catch { /* shim 自身故障一律放行 */ }
process.exit(0);
