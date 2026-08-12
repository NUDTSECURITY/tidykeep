// `tidykeep status` —— 只读体检:各注入点在/不在、版本、hooksPath、Kimi 全局状态。
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadManifest } from '../lib/manifest.mjs';
import { MD_BEGIN } from '../lib/blocks.mjs';
import { kimiPaths } from '../lib/kimi.mjs';

const hasBlock = (path, begin = MD_BEGIN) => existsSync(path) && readFileSync(path, 'utf8').includes(begin);

export function status(targetArg, opts = {}) {
  const target = resolve(targetArg || process.cwd());
  const installed = existsSync(join(target, '.tidykeep'));
  const manifest = loadManifest(target);
  const hp = spawnSync('git', ['-C', target, 'config', 'core.hooksPath'], { encoding: 'utf8', shell: false });
  const kp = kimiPaths();
  const kimiToml = existsSync(kp.configToml) ? readFileSync(kp.configToml, 'utf8') : '';

  const report = {
    installed,
    target,
    toolVersion: manifest.toolVersion || null,
    agents: manifest.agents ?? [],
    blocks: {
      'AGENTS.md': hasBlock(join(target, 'AGENTS.md')),
      'CLAUDE.md': hasBlock(join(target, 'CLAUDE.md')),
      '.gitignore': hasBlock(join(target, '.gitignore'), '# >>> tidykeep >>>'),
    },
    files: {
      'STATE.md': existsSync(join(target, 'STATE.md')),
      'LEDGER.md': existsSync(join(target, 'LEDGER.md')),
      '.claude/settings.json': existsSync(join(target, '.claude', 'settings.json')),
      '.codex/hooks.json': existsSync(join(target, '.codex', 'hooks.json')),
      runtime: existsSync(join(target, '.tidykeep', 'runtime', 'hook.mjs')),
    },
    gitHooksPath: hp.status === 0 ? hp.stdout.trim() : null,
    kimiGlobalBlock: kimiToml.includes('# >>> tidykeep >>>'),
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(`[tidykeep] ${installed ? '已安装' : '未安装'}: ${target}`);
  if (installed) {
    console.log(`  版本: ${report.toolVersion}  agents: ${report.agents.join(',') || '-'}`);
    for (const [k, v] of Object.entries({ ...report.blocks, ...report.files })) {
      console.log(`  ${v ? '✔' : '✖'} ${k}`);
    }
    console.log(`  git hooksPath: ${report.gitHooksPath || '(未接管)'}  Kimi 全局块: ${report.kimiGlobalBlock ? '在' : '无'}`);
  }
  return 0;
}
