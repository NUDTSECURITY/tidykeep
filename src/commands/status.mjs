// `tidykeep status` —— 只读体检:各注入点在/不在、版本、hooksPath、Kimi 全局状态。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadManifest } from '../lib/manifest.mjs';
import { MD_BEGIN } from '../lib/blocks.mjs';
import { kimiPaths } from '../lib/kimi.mjs';
import { canonicalProjectRoot, gitProjectContext } from '../lib/project-paths.mjs';

const hasBlock = (path, begin = MD_BEGIN) => existsSync(path) && readFileSync(path, 'utf8').includes(begin);

export function status(targetArg, opts = {}) {
  let target;
  try { target = canonicalProjectRoot(targetArg || process.cwd()); }
  catch (error) {
    console.error(`[tidykeep] status 错误:${error?.message ?? error}`);
    return 1;
  }
  const manifestPath = join(target, '.tidykeep', 'manifest.json');
  const manifest = loadManifest(target);
  const installed = existsSync(manifestPath) && !manifest.loadError
    && existsSync(join(target, '.tidykeep', 'runtime', 'hook.mjs'));
  const gitContext = gitProjectContext(target);
  const hp = gitContext.status === 'root' || gitContext.status === 'linked'
    ? spawnSync('git', ['-C', target, 'config', 'core.hooksPath'], { encoding: 'utf8', shell: false })
    : null;
  const kp = kimiPaths();
  const kimiToml = existsSync(kp.configToml) ? readFileSync(kp.configToml, 'utf8') : '';

  const report = {
    installed,
    retainedConfiguration: !installed && (
      existsSync(join(target, '.tidykeep', 'config.jsonc'))
      || existsSync(join(target, '.tidykeep', 'allowlist'))
    ),
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
    gitRepository: gitContext.status,
    gitRepositoryRoot: gitContext.root,
    gitDirectory: gitContext.gitDir ?? null,
    gitCommonDirectory: gitContext.gitCommonDir ?? null,
    gitMainWorktreeRoot: gitContext.mainRoot ?? null,
    gitHooksPath: hp?.status === 0 ? hp.stdout.trim() : null,
    kimiGlobalBlock: kimiToml.includes('# >>> tidykeep >>>'),
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(`[tidykeep] ${installed ? '已安装' : '未安装'}: ${target}`);
  if (report.retainedConfiguration) console.log('  ℹ 保留的项目配置/allowlist 仍在，可供下次 init 复用');
  if (gitContext.status === 'parent') {
    console.log(`  ⚠ 目标是 Git 仓库子目录；未读取父仓库 ${gitContext.root} 的 hooksPath`);
  } else if (gitContext.status === 'linked') {
    console.log(`  ⚠ 目标是 linked worktree；hooksPath 为与主仓库 ${gitContext.mainRoot ?? gitContext.gitCommonDir} 共享的只读报告`);
  } else if (gitContext.status === 'error') {
    console.log(`  ⚠ 无法确认 Git 仓库边界:${gitContext.detail}`);
  }
  if (installed) {
    console.log(`  版本: ${report.toolVersion}  agents: ${report.agents.join(',') || '-'}`);
    for (const [k, v] of Object.entries({ ...report.blocks, ...report.files })) {
      console.log(`  ${v ? '✔' : '✖'} ${k}`);
    }
    console.log(`  git hooksPath: ${report.gitHooksPath || '(未接管)'}  Kimi 全局块: ${report.kimiGlobalBlock ? '在' : '无'}`);
  }
  return 0;
}
