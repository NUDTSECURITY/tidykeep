#!/usr/bin/env node
// tidykeep CLI 入口:npx tidykeep <init|uninstall> [dir] [选项]
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';

const HELP = `tidykeep — 跨 Agent 的项目知识保鲜协议(Claude Code / Codex / Kimi Code)

用法:
  npx tidykeep init [dir]        安装/升级(幂等,重跑即升级)
      --dry-run                  只打印将要发生的改动
  npx tidykeep uninstall [dir]   卸载(标记块精确剥离;STATE.md 始终保留)

安装内容:
  .claude/skills/{tidykeep,sdlc}/  与  .agents/skills/{tidykeep,sdlc}/
  AGENTS.md / CLAUDE.md / .gitignore 的 tidykeep 标记块
  STATE.md(仅当不存在时创建)

本协议靠约定执行,不安装任何 hook,也不拦截任何操作。
`;

let values;
let positionals;
try {
  ({ values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
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

const supplied = new Set(
  process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => arg.split('=')[0]),
);
const allowedOptions = {
  init: new Set(['--dry-run']),
  uninstall: new Set([]),
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
    code = init(dirArg, { dryRun: values['dry-run'] });
    break;
  }
  case 'uninstall': {
    const { uninstall } = await import('../src/commands/uninstall.mjs');
    code = uninstall(dirArg, {});
    break;
  }
  default:
    console.error(`[tidykeep] 未知命令: ${cmd}\n`);
    console.log(HELP);
    code = 1;
}
process.exit(code);
