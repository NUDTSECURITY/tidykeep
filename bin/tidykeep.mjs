#!/usr/bin/env node
// 个人 Agent Skill 库的安装器:npx tidykeep <list|doctor|init|uninstall> [选项]
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';

const HELP = `tidykeep — 个人 Agent Skill 库(Claude Code / Codex / Kimi Code)

一条命令把库里全部 skill 装到三家 Agent 都能发现的位置。换机器、换环境时
clone 本仓库再跑一次 init 即可,不必逐个下载。

用法:
  npx tidykeep list                    列出库里有哪些 skill
  npx tidykeep doctor                  只校验库自身格式,不写任何文件

  npx tidykeep init                    装到用户级(~),对所有项目生效  ← 默认
  npx tidykeep init --project [dir]    装到指定项目,随仓库分发给团队
      --skills a,b                     只装其中几个(默认全部)
      --dry-run                        只打印将要发生的改动

  npx tidykeep uninstall               从用户级卸载
  npx tidykeep uninstall --project [dir]
      --skills a,b                     只卸其中几个

装到哪里:
  用户级   ~/.claude/skills/  与  ~/.agents/skills/
  项目级   <dir>/.claude/skills/  与  <dir>/.agents/skills/
           另注入 AGENTS.md / CLAUDE.md / .gitignore 标记块与 STATE.md

Codex 只扫 .agents/skills,Claude Code 读 .claude/skills,Kimi Code 两处都读——
所以铺这两处就覆盖三家。安装前会校验 skill 格式,不合规直接拒绝。
`;

let values;
let positionals;
try {
  ({ values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: 'string' },
      skills: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  }));
} catch (error) {
  console.error(`[tidykeep] 无效命令行参数: ${error?.message ?? error}`);
  process.exit(1);
}

const [cmd, ...extraPositionals] = positionals;

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
  console.error('           安装目录请用 --project <dir>;不带该选项即安装到用户级。');
  process.exit(1);
}

const supplied = new Set(
  process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => arg.split('=')[0]),
);
const allowedOptions = {
  list: new Set([]),
  doctor: new Set([]),
  init: new Set(['--project', '--skills', '--dry-run']),
  uninstall: new Set(['--project', '--skills']),
};
if (cmd in allowedOptions) {
  const invalid = [...supplied].filter((option) => !allowedOptions[cmd].has(option));
  if (invalid.length) {
    console.error(`[tidykeep] ${cmd} 不支持选项: ${invalid.join(', ')}`);
    process.exit(1);
  }
}

// --project 不带值时 parseArgs 会报错，所以用空串表示「当前目录」。
const opts = {
  project: supplied.has('--project') ? (values.project ?? '') : undefined,
  skills: values.skills ? values.skills.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  dryRun: values['dry-run'],
};

let code = 0;
switch (cmd) {
  case 'list': {
    const { list } = await import('../src/commands/init.mjs');
    code = list();
    break;
  }
  case 'doctor': {
    const { doctor } = await import('../src/commands/init.mjs');
    code = doctor();
    break;
  }
  case 'init': {
    const { init } = await import('../src/commands/init.mjs');
    code = init(opts);
    break;
  }
  case 'uninstall': {
    const { uninstall } = await import('../src/commands/uninstall.mjs');
    code = uninstall(opts);
    break;
  }
  default:
    console.error(`[tidykeep] 未知命令: ${cmd}\n`);
    console.log(HELP);
    code = 1;
}
process.exit(code);
