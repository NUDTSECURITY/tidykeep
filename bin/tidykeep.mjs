#!/usr/bin/env node
// tidykeep CLI 入口:npx tidykeep <init|uninstall|status|enable-githooks> [dir] [选项]
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const HELP = `tidykeep — 跨 Agent 的项目知识保鲜工具(Claude Code / Codex / Kimi)

用法:
  npx tidykeep init [dir]              安装/升级(幂等,重跑即升级)
      --agents claude,codex,kimi       只装指定 agent(默认三家全装)
      --ledger-mode block|warn|off     台账强制等级(写入 config.jsonc)
      --scratch-dir .tmp               草稿区目录名
      --no-git-hooks                   不接管 git hooks
      --dry-run                        只打印动作
  npx tidykeep uninstall [dir]         卸载(标记块精确回滚)
      --purge                          连 STATE.md / LEDGER.md 一并移除
  npx tidykeep status [dir] [--json]   安装状态体检
  npx tidykeep enable-githooks [dir]   启用 git hooks(团队成员克隆后一次)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    agents: { type: 'string' },
    'ledger-mode': { type: 'string' },
    'scratch-dir': { type: 'string' },
    'no-git-hooks': { type: 'boolean', default: false },
    purge: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  },
});

const [cmd, dirArg] = positionals;

if (values.version) {
  console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  process.exit(0);
}
if (values.help || !cmd) {
  console.log(HELP);
  process.exit(cmd ? 0 : 1);
}

const common = { dryRun: values['dry-run'] };
let code = 0;
switch (cmd) {
  case 'init': {
    const { init } = await import('../src/commands/init.mjs');
    code = init(dirArg, {
      ...common,
      agents: values.agents ? values.agents.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
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
  case 'enable-githooks': {
    const target = resolve(dirArg || process.cwd());
    const r = spawnSync('node', [join(target, '.tidykeep', 'runtime', 'enable-githooks.mjs')], { stdio: 'inherit' });
    code = r.status ?? 1;
    break;
  }
  default:
    console.error(`[tidykeep] 未知命令: ${cmd}\n`);
    console.log(HELP);
    code = 1;
}
process.exit(code);
