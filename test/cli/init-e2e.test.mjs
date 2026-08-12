// CLI 端到端:真实子进程跑 bin/tidykeep.mjs,覆盖 init 幂等 / uninstall 回滚 /
// 旧 bash 版迁移 / Kimi 全局注入与引用计数卸载 / status。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'tidykeep.mjs');

function makeEnvHome() {
  const base = mkdtempSync(join(tmpdir(), 'tk-home-'));
  const kimiHome = join(base, '.kimi-code');
  mkdirSync(kimiHome, { recursive: true });
  writeFileSync(join(kimiHome, 'config.toml'), '# 用户已有配置\nmodel = "kimi"\n');
  return {
    base,
    kimiHome,
    env: {
      ...process.env,
      KIMI_CODE_HOME: kimiHome,
      TIDYKEEP_USER_DIR: join(base, '.tidykeep'),
      CLAUDE_PROJECT_DIR: '',
    },
  };
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'tk-cli-'));
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 't']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 't@t']);
  return root;
}

const run = (args, env, cwd) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', env, cwd });

const gitStatus = (root) => execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim();

test('init: 全量安装 → 各注入点就位;二次 init 幂等(git diff 为空)', () => {
  const { env, kimiHome } = makeEnvHome();
  const root = makeRepo();
  writeFileSync(join(root, 'AGENTS.md'), '# 项目已有的说明\n');
  const r = run(['init', root], env);
  assert.equal(r.status, 0, r.stderr);

  // 注入点断言
  assert.ok(readFileSync(join(root, 'AGENTS.md'), 'utf8').includes('tidykeep 协议'));
  assert.ok(readFileSync(join(root, 'AGENTS.md'), 'utf8').startsWith('# 项目已有的说明'));
  assert.ok(readFileSync(join(root, 'CLAUDE.md'), 'utf8').includes('@AGENTS.md'));
  const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  assert.ok(JSON.stringify(settings.hooks.PreToolUse).includes('.tidykeep/runtime/hook.mjs'));
  assert.ok(settings.hooks.Stop);
  const codex = JSON.parse(readFileSync(join(root, '.codex', 'hooks.json'), 'utf8'));
  assert.ok(JSON.stringify(codex.hooks.PreToolUse).includes('codex-pretooluse'));
  assert.ok(existsSync(join(root, '.claude', 'skills', 'tidykeep', 'SKILL.md')));
  assert.ok(existsSync(join(root, '.agents', 'skills', 'tidykeep', 'SKILL.md')));
  assert.ok(existsSync(join(root, '.tidykeep', 'runtime', 'hook.mjs')));
  assert.ok(existsSync(join(root, '.tidykeep', 'docs', 'workflows.md')));
  assert.ok(existsSync(join(root, 'STATE.md')) && existsSync(join(root, 'LEDGER.md')));
  assert.ok(readFileSync(join(root, '.gitignore'), 'utf8').includes('.tidykeep/.state/'));
  const hooksPath = execFileSync('git', ['-C', root, 'config', 'core.hooksPath'], { encoding: 'utf8' }).trim();
  assert.equal(hooksPath, '.tidykeep/githooks');
  // Kimi 全局
  const toml = readFileSync(join(kimiHome, 'config.toml'), 'utf8');
  assert.ok(toml.includes('# 用户已有配置'));
  assert.ok(toml.includes('[[hooks]]') && toml.includes('kimi-pretooluse'));
  assert.ok(existsSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs')));

  // 幂等:提交后重跑,工作区不变、kimi toml 字节不变
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'snapshot after first init for idempotency check'], { env: { ...env, TIDYKEEP_SKIP: '1' } });
  const r2 = run(['init', root], env);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(gitStatus(root), '', '二次 init 后 git 工作区应无差异');
  assert.equal(readFileSync(join(kimiHome, 'config.toml'), 'utf8'), toml);
});

test('uninstall: 标记块剥离、created 文件删除、hooksPath 还原、Kimi 全局块随最后一个项目移除', () => {
  const { env, kimiHome } = makeEnvHome();
  const root = makeRepo();
  writeFileSync(join(root, 'AGENTS.md'), '# 项目已有的说明\n');
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'pristine snapshot before tidykeep init'], { env: { ...env, TIDYKEEP_SKIP: '1' } });

  assert.equal(run(['init', root], env).status, 0);
  // 第二个项目也接入,验证引用计数
  const root2 = makeRepo();
  assert.equal(run(['init', root2], env).status, 0);

  const r = run(['uninstall', root], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8').includes('tidykeep'), false);
  assert.ok(readFileSync(join(root, 'AGENTS.md'), 'utf8').includes('# 项目已有的说明'));
  assert.equal(existsSync(join(root, 'CLAUDE.md')), false, '本工具创建且剥空的指针文件应删除');
  assert.equal(existsSync(join(root, '.claude', 'settings.json')), false);
  assert.equal(existsSync(join(root, '.codex', 'hooks.json')), false);
  assert.equal(existsSync(join(root, '.tidykeep')), false);
  assert.equal(existsSync(join(root, '.claude', 'skills', 'tidykeep')), false);
  assert.equal(existsSync(join(root, '.agents', 'skills', 'tidykeep')), false);
  assert.ok(existsSync(join(root, 'STATE.md')), '默认保留 STATE.md(项目知识)');
  const hp = spawnSync('git', ['-C', root, 'config', 'core.hooksPath'], { encoding: 'utf8' });
  assert.equal(hp.stdout.trim(), '');
  // root2 还在用 → 全局块保留
  assert.ok(readFileSync(join(kimiHome, 'config.toml'), 'utf8').includes('[[hooks]]'));
  // 卸掉 root2 → 全局块与 shim 移除,用户自有内容原样
  assert.equal(run(['uninstall', root2], env).status, 0);
  const finalToml = readFileSync(join(kimiHome, 'config.toml'), 'utf8');
  assert.equal(finalToml.includes('[[hooks]]'), false);
  assert.ok(finalToml.includes('# 用户已有配置') && finalToml.includes('model = "kimi"'));
  assert.equal(existsSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs')), false);
});

test('uninstall --purge: STATE/LEDGER(本工具创建)一并移除', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root], env).status, 0);
  assert.equal(run(['uninstall', root, '--purge'], env).status, 0);
  assert.equal(existsSync(join(root, 'STATE.md')), false);
  assert.equal(existsSync(join(root, 'LEDGER.md')), false);
});

test('旧 bash 版迁移:KEY=VALUE config 携值转 jsonc,python hooks 与 settings 条目被替换', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  mkdirSync(join(root, '.tidykeep', 'hooks'), { recursive: true });
  writeFileSync(join(root, '.tidykeep', 'config'), 'GUARD="on"\nENFORCE_LEDGER="warn"\nSCRATCH_DIR=".scratch"\nSTALE_ERE="xx\\.py$"\n');
  writeFileSync(join(root, '.tidykeep', 'manifest'), 'created STATE.md\nhookspath set\n');
  writeFileSync(join(root, '.tidykeep', 'hooks', 'guard_stale_names.py'), '# 旧实现');
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'python3', args: ['${CLAUDE_PROJECT_DIR}/.tidykeep/hooks/guard_stale_names.py'] }] }] },
  }));
  const r = run(['init', root], env);
  assert.equal(r.status, 0, r.stderr);
  const cfgText = readFileSync(join(root, '.tidykeep', 'config.jsonc'), 'utf8');
  assert.ok(cfgText.includes('"ENFORCE_LEDGER": "warn"'));
  assert.ok(cfgText.includes('".scratch"'));
  assert.ok(cfgText.includes('xx\\\\.py$'), 'STALE_ERE 值应迁移为 STALE_RE');
  assert.equal(existsSync(join(root, '.tidykeep', 'config')), false, '旧 config 应删除');
  assert.equal(existsSync(join(root, '.tidykeep', 'hooks')), false, '旧 python hooks 应删除');
  assert.equal(existsSync(join(root, '.tidykeep', 'manifest')), false, '旧文本清单应迁移后删除');
  const settings = readFileSync(join(root, '.claude', 'settings.json'), 'utf8');
  assert.equal(settings.includes('python3'), false);
  assert.ok(settings.includes('hook.mjs'));
});

test('init --agents claude:不触碰 codex/kimi;--no-git-hooks 跳过接管', () => {
  const { env, kimiHome } = makeEnvHome();
  const root = makeRepo();
  const before = readFileSync(join(kimiHome, 'config.toml'), 'utf8');
  const r = run(['init', root, '--agents', 'claude', '--no-git-hooks'], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(root, '.codex')), false);
  assert.equal(existsSync(join(root, '.agents')), false);
  assert.equal(readFileSync(join(kimiHome, 'config.toml'), 'utf8'), before);
  const hp = spawnSync('git', ['-C', root, 'config', 'core.hooksPath'], { encoding: 'utf8' });
  assert.equal(hp.stdout.trim(), '');
});

test('Kimi 全局 config.toml 已有内联 hooks 数组 → 跳过并提示手动合并', () => {
  const { env, kimiHome } = makeEnvHome();
  writeFileSync(join(kimiHome, 'config.toml'), 'hooks = []\n');
  const root = makeRepo();
  const r = run(['init', root], env);
  assert.equal(r.status, 0);
  assert.ok((r.stdout + r.stderr).includes('手动'), '应提示手动合并');
  assert.equal(readFileSync(join(kimiHome, 'config.toml'), 'utf8'), 'hooks = []\n');
});

test('status: 报告安装状态,--json 可解析', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  run(['init', root], env);
  const r = run(['status', root, '--json'], env);
  assert.equal(r.status, 0);
  const s = JSON.parse(r.stdout);
  assert.equal(s.installed, true);
  assert.ok(s.agents.includes('claude'));
});

test('init 后 Claude hook 真实链路可用(灌 stdin 走 vendored runtime)', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  run(['init', root], env);
  const r = spawnSync('node', [join(root, '.tidykeep', 'runtime', 'hook.mjs'), 'claude-pretooluse'], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/probe.sh' }, cwd: root }),
    encoding: 'utf8', cwd: root, env,
  });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

// ---------- 审查确认缺陷的回归测试 ----------

test('uninstall: settings.json 无法解析时,备份保留到项目根并在警告中给出位置', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'settings.json'), '{"permissions":{"allow":["Bash(ls:*)"]}}');
  assert.equal(run(['init', root], env).status, 0);
  writeFileSync(join(root, '.claude', 'settings.json'),
    readFileSync(join(root, '.claude', 'settings.json'), 'utf8') + '// 用户手滑加的注释');
  const r = run(['uninstall', root], env);
  assert.equal(r.status, 0);
  const moved = readdirSync(root).find((n) => n.startsWith('.tidykeep-backup-'));
  assert.ok(moved, '备份目录应保留在项目根');
  assert.ok(existsSync(join(root, moved, 'settings.json.bak')));
  assert.ok((r.stdout + r.stderr).includes(moved), '警告应给出备份新位置');
});

test('uninstall: AGENTS.md 标记不成对 → 拒绝改写并警告,用户内容保留', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  writeFileSync(join(root, 'AGENTS.md'), '# mine\n');
  assert.equal(run(['init', root], env).status, 0);
  const broken = readFileSync(join(root, 'AGENTS.md'), 'utf8').replace('<!-- tidykeep:end -->', '')
    + '\n## user appendix\nvery important\n';
  writeFileSync(join(root, 'AGENTS.md'), broken);
  // re-init 也不得在不成对状态下改写
  assert.equal(run(['init', root], env).status, 0);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), broken, 're-init 不得改写不成对文件');
  const r = run(['uninstall', root], env);
  const after = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.ok(after.includes('user appendix'), '用户内容不得被删');
  assert.ok((r.stdout + r.stderr).includes('不成对'), '应警告标记不成对');
});

test('Kimi 引用计数:symlink 路径 init、真实路径 uninstall 视为同一项目,全局块正确移除', () => {
  const { env, kimiHome } = makeEnvHome();
  const root = makeRepo();
  const link = root + '-link';
  symlinkSync(root, link);
  assert.equal(run(['init', link], env).status, 0);
  assert.ok(readFileSync(join(kimiHome, 'config.toml'), 'utf8').includes('[[hooks]]'));
  assert.equal(run(['uninstall', root], env).status, 0);
  assert.equal(readFileSync(join(kimiHome, 'config.toml'), 'utf8').includes('[[hooks]]'), false,
    'symlink 与真实路径应归一,最后一个项目卸载后全局块移除');
});
