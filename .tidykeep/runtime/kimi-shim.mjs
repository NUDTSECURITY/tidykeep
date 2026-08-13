#!/usr/bin/env node
// tidykeep 用户级路由 shim(安装于 ~/.tidykeep/;由 `npx tidykeep init` 刷新)。
// Kimi Code 的 hooks 只能配置在用户全局 config.toml,本 shim 负责把事件路由到
// "启用了 tidykeep 的项目"里 vendored 的 runtime(版本随项目);未启用的项目
// 立即放行(exit 0),对其他项目零影响。
// 用法: node kimi-shim.mjs kimi-pretooluse | kimi-stop
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

try {
  const flavor = process.argv[2] ?? '';
  if (!['kimi-pretooluse', 'kimi-stop'].includes(flavor)) process.exit(0);
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
    // 嵌套 Git 工作区未启用 tidykeep 时到此为止,不得继承外层项目 runtime。
    if (existsSync(join(dir, '.git'))) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (hookPath) {
    // 仅项目注册 marker 能授权全局 shim 执行项目内代码。项目 manifest 与
    // `.tidykeep/runtime` 路径本身都不构成授权，避免任意仓库伪装成已接入项目。
    const realRoot = realpathSync(dir);
    let key = realRoot.replaceAll('\\', '/');
    if (process.platform === 'win32') key = key.toLowerCase();
    const userDir = process.env.TIDYKEEP_USER_DIR || join(homedir(), '.tidykeep');
    const marker = join(userDir, 'projects.d', createHash('sha1').update(key).digest('hex'));
    const markerStat = lstatSync(marker);
    const markerReal = realpathSync(marker);
    if (!markerStat.isFile() || markerStat.isSymbolicLink()
        || resolve(markerReal) !== resolve(marker)
        || readFileSync(marker, 'utf8') !== `${key}\n`) process.exit(0);

    const hookStat = lstatSync(hookPath);
    const expectedHook = join(realRoot, '.tidykeep', 'runtime', 'hook.mjs');
    const realHook = realpathSync(hookPath);
    if (!hookStat.isFile() || hookStat.isSymbolicLink()
        || resolve(realHook) !== resolve(expectedHook)) process.exit(0);
    const r = spawnSync(process.execPath, [hookPath, flavor], {
      input,
      encoding: 'utf8',
      env: { ...process.env, TIDYKEEP_PARENT_PID: String(process.ppid) },
      timeout: 35000,
    });
    // 只转发契约内的结果(0=放行/警示,2=阻断);runtime 损坏等其他退出码
    // 一律静默放行,不向 agent 泄露 Node 堆栈
    if (r.status === 2) {
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      process.exit(2);
    }
    if (r.status === 0 && r.stdout) process.stdout.write(r.stdout);
    process.exit(0);
  }
} catch { /* shim 自身故障一律放行 */ }
process.exit(0);
