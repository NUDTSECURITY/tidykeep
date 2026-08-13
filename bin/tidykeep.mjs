#!/usr/bin/env node
// tidykeep CLI 入口:npx tidykeep <init|uninstall|status|enable-githooks> [dir] [选项]
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const HELP = `tidykeep — 跨 Agent 的项目知识保鲜工具(Claude Code / Codex / Kimi)

用法:
  npx tidykeep init [dir]              安装/升级(幂等,重跑即升级)
      --agents claude,codex,kimi       本次接入指定 agent(已有接入保留;默认三家)
      --ledger-mode block|warn|off     台账强制等级(写入 config.jsonc)
      --scratch-dir .tmp               草稿区目录名
      --no-git-hooks                   不接管 git hooks
      --dry-run                        只打印动作
  npx tidykeep uninstall [dir]         卸载(标记块精确回滚)
      --purge                          连 STATE.md / LEDGER.md 一并移除
  npx tidykeep status [dir] [--json]   安装状态速览
  npx tidykeep doctor [dir] [--fix]    深度体检(执行位/EOL/条目/探针;--fix 修安全项)
  npx tidykeep enable-githooks [dir]   启用 git hooks(团队成员克隆后一次)
`;

let values;
let positionals;
try {
  ({ values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      agents: { type: 'string' },
      'ledger-mode': { type: 'string' },
      'scratch-dir': { type: 'string' },
      'no-git-hooks': { type: 'boolean', default: false },
      purge: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      fix: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  }));
} catch (error) {
  console.error(`[tidykeep] 无效命令行参数: ${error?.message ?? error}`);
  process.exit(1);
}

const [cmd, dirArg, ...extraPositionals] = positionals;

if (values.version && cmd) {
  console.error('[tidykeep] --version/-v 不能与命令同时使用');
  process.exit(1);
}
if (values.version) {
  console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  process.exit(0);
}
if (values.help || !cmd) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}
if (extraPositionals.length) {
  console.error(`[tidykeep] 无效位置参数: ${extraPositionals.join(' ')}`);
  process.exit(1);
}

const common = { dryRun: values['dry-run'] };
const supplied = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => arg.split('=')[0]));
const allowedOptions = {
  init: new Set(['--agents', '--ledger-mode', '--scratch-dir', '--no-git-hooks', '--dry-run']),
  uninstall: new Set(['--purge', '--dry-run']),
  status: new Set(['--json']),
  doctor: new Set(['--fix']),
  'enable-githooks': new Set(),
};
if (cmd in allowedOptions) {
  const invalid = [...supplied].filter((option) => !allowedOptions[cmd].has(option));
  if (invalid.length) {
    console.error(`[tidykeep] ${cmd} 不支持选项: ${invalid.join(', ')}`);
    process.exit(1);
  }
}
let code = 0;
switch (cmd) {
  case 'init': {
    const { init } = await import('../src/commands/init.mjs');
    code = init(dirArg, {
      ...common,
      agents: values.agents !== undefined ? values.agents.split(',').map((s) => s.trim()) : undefined,
      ledgerMode: values['ledger-mode'],
      scratchDir: values['scratch-dir'],
      noGitHooks: values['no-git-hooks'],
    });
    break;
  }
  case 'uninstall': {
    const { uninstall } = await import('../src/commands/uninstall.mjs');
    code = uninstall(dirArg, { ...common, purge: values.purge });
    break;
  }
  case 'status': {
    const { status } = await import('../src/commands/status.mjs');
    code = status(dirArg, { json: values.json });
    break;
  }
  case 'doctor': {
    const { doctor } = await import('../src/commands/doctor.mjs');
    code = doctor(dirArg, { fix: values.fix });
    break;
  }
  case 'enable-githooks': {
    const target = resolve(dirArg || process.cwd());
    const r = spawnSync(process.execPath, [join(target, '.tidykeep', 'runtime', 'enable-githooks.mjs')], { stdio: 'inherit' });
    code = r.status ?? 1;
    break;
  }
  default:
    console.error(`[tidykeep] 未知命令: ${cmd}\n`);
    console.log(HELP);
    code = 1;
}
process.exit(code);
