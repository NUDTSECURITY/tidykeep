// CLI 端到端:真实子进程跑 bin/tidykeep.mjs,覆盖 init 幂等 / uninstall 回滚 /
// 旧 bash 版迁移 / Kimi 全局注入与引用计数卸载 / status。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, symlinkSync, rmSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isolatedEnv, makeTempDir } from '../helpers/temp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'tidykeep.mjs');
const REPO = join(HERE, '..', '..');

function makeEnvHome() {
  const base = makeTempDir('home-');
  const kimiHome = join(base, '.kimi-code');
  mkdirSync(kimiHome, { recursive: true });
  writeFileSync(join(kimiHome, 'config.toml'), '# 用户已有配置\nmodel = "kimi"\n');
  return {
    base,
    kimiHome,
    env: isolatedEnv({
      KIMI_CODE_HOME: kimiHome,
      TIDYKEEP_USER_DIR: join(base, '.tidykeep'),
      CLAUDE_PROJECT_DIR: '',
    }),
  };
}

function makeRepo() {
  const root = makeTempDir('cli-');
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 't']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 't@t']);
  return root;
}

const run = (args, env, cwd) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', env, cwd });

const gitStatus = (root) => execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim();

const LEGACY_V2_PRECOMMIT = `#!/bin/sh
# tidykeep git hook shim(由 \`npx tidykeep init\` 管理;检查逻辑在 .tidykeep/runtime/githook.mjs)
[ "\${TIDYKEEP_SKIP:-0}" = "1" ] && exit 0
root=\$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
# 链式执行接管前的本地 hook(Windows 下 -x 不可靠,判 -f 后用 sh 显式执行)
legacy="\$root/.git/hooks/pre-commit"
if [ -f "\$legacy" ] && [ "\$(git config core.hooksPath 2>/dev/null)" = ".tidykeep/githooks" ]; then
  sh "\$legacy" "\$@" || exit \$?
fi
if command -v node >/dev/null 2>&1; then
  exec node "\$root/.tidykeep/runtime/githook.mjs" pre-commit "\$@"
fi
echo "[tidykeep] 警告: 未找到 node,跳过 tidykeep 检查(guardrail 降级放行)" >&2
exit 0
`;

// 已发布 v2 shim 的固定迁移夹具。不能从 Git HEAD 读取，否则提交当前实现后
// “历史版本”会悄悄变成当前版本，测试便失去所有权边界的证明力。
const PUBLISHED_V2_KIMI_SHIM = [
  "#!/usr/bin/env node",
  "// tidykeep 用户级路由 shim(安装于 ~/.tidykeep/;由 `npx tidykeep init` 刷新)。",
  "// Kimi Code 的 hooks 只能配置在用户全局 config.toml,本 shim 负责把事件路由到",
  "// \"启用了 tidykeep 的项目\"里 vendored 的 runtime(版本随项目);未启用的项目",
  "// 立即放行(exit 0),对其他项目零影响。",
  "// 用法: node kimi-shim.mjs kimi-pretooluse | kimi-stop",
  "import { existsSync, readFileSync } from 'node:fs';",
  "import { dirname, join, resolve } from 'node:path';",
  "import { spawnSync } from 'node:child_process';",
  "",
  "try {",
  "  const flavor = process.argv[2] ?? '';",
  "  const input = readFileSync(0, 'utf8');",
  "  let cwd = process.cwd();",
  "  try {",
  "    const p = JSON.parse(input);",
  "    if (p && typeof p.cwd === 'string' && p.cwd) cwd = p.cwd;",
  "  } catch { /* 无法解析时退回进程 cwd */ }",
  "",
  "  let dir = resolve(cwd);",
  "  let hookPath = null;",
  "  for (;;) {",
  "    const candidate = join(dir, '.tidykeep', 'runtime', 'hook.mjs');",
  "    if (existsSync(candidate)) { hookPath = candidate; break; }",
  "    const parent = dirname(dir);",
  "    if (parent === dir) break;",
  "    dir = parent;",
  "  }",
  "  if (hookPath) {",
  "    const r = spawnSync(process.execPath, [hookPath, flavor], { input, encoding: 'utf8' });",
  "    // 只转发契约内的结果(0=放行/警示,2=阻断);runtime 损坏等其他退出码",
  "    // 一律静默放行,不向 agent 泄露 Node 堆栈",
  "    if (r.status === 2) {",
  "      if (r.stdout) process.stdout.write(r.stdout);",
  "      if (r.stderr) process.stderr.write(r.stderr);",
  "      process.exit(2);",
  "    }",
  "    if (r.status === 0 && r.stdout) process.stdout.write(r.stdout);",
  "    process.exit(0);",
  "  }",
  "} catch { /* shim 自身故障一律放行 */ }",
  "process.exit(0);",
  "",
].join('\n');

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
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(root, '.tidykeep', 'runtime', 'hook.mjs')).mode & 0o111, 0,
      '由 node 加载的 runtime 不应带冗余执行位');
    assert.notEqual(statSync(join(root, '.tidykeep', 'githooks', 'pre-commit')).mode & 0o111, 0,
      'Git 直接执行的 hook 必须保留执行位');
  }
  assert.ok(existsSync(join(root, 'STATE.md')) && existsSync(join(root, 'LEDGER.md')));
  assert.ok(readFileSync(join(root, '.gitignore'), 'utf8').includes('.tidykeep/.state/'));
  const attributes = readFileSync(join(root, '.gitattributes'), 'utf8');
  assert.ok(attributes.includes('.tidykeep/docs/workflows.md text eol=lf'));
  assert.ok(attributes.includes('.claude/skills/tidykeep/SKILL.md text eol=lf'));
  assert.ok(attributes.includes('.agents/skills/tidykeep/SKILL.md text eol=lf'));
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
  assert.equal(existsSync(join(root, '.tidykeep')), true, '项目配置与 allowlist 默认保留');
  assert.equal(existsSync(join(root, '.tidykeep', 'manifest.json')), false);
  assert.equal(existsSync(join(root, '.tidykeep', 'config.jsonc')), true);
  assert.equal(existsSync(join(root, '.tidykeep', 'allowlist')), true);
  const statusAfter = run(['status', root, '--json'], env);
  assert.equal(statusAfter.status, 0);
  const statusReport = JSON.parse(statusAfter.stdout);
  assert.equal(statusReport.installed, false, '仅保留配置不得误报为仍安装');
  assert.equal(statusReport.retainedConfiguration, true);
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

test('uninstall: 即使 manifest agents 漂移丢失 kimi，精确项目注册仍会安全清理', () => {
  const { env, kimiHome } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root], env).status, 0);
  const manifestPath = join(root, '.tidykeep', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.agents = manifest.agents.filter((agent) => agent !== 'kimi');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const result = run(['uninstall', root], env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(kimiHome, 'config.toml'), 'utf8').includes('[[hooks]]'), false);
  assert.equal(existsSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs')), false);
});

test('uninstall --purge: STATE/LEDGER 精确等于当前模板时一并移除', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root], env).status, 0);
  assert.equal(run(['uninstall', root, '--purge'], env).status, 0);
  assert.equal(existsSync(join(root, 'STATE.md')), false);
  assert.equal(existsSync(join(root, 'LEDGER.md')), false);
});

test('旧 bash 版迁移遇到同名未知 Python 文件时 preflight fail-closed', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  mkdirSync(join(root, '.tidykeep', 'hooks'), { recursive: true });
  writeFileSync(join(root, '.tidykeep', 'config'), 'GUARD="on"\nENFORCE_LEDGER="warn"\nSCRATCH_DIR=".scratch"\nSTALE_ERE="xx\\.py$"\n');
  writeFileSync(join(root, '.tidykeep', 'manifest'), 'created STATE.md\nhookspath set\n');
  writeFileSync(join(root, '.tidykeep', 'hooks', 'guard_stale_names.py'), '# 旧实现');
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{
      type: 'command', command: 'python3',
      args: ['${CLAUDE_PROJECT_DIR}/.tidykeep/hooks/guard_stale_names.py'],
      timeout: 20, statusMessage: 'tidykeep: 检查文件命名',
    }] }] },
  }));
  const r = run(['init', root], env);
  assert.notEqual(r.status, 0, r.stderr);
  assert.ok((r.stdout + r.stderr).includes('内容未知'));
  assert.equal(existsSync(join(root, '.tidykeep', 'config.jsonc')), false);
  assert.equal(existsSync(join(root, '.tidykeep', 'config')), true);
  assert.equal(readFileSync(join(root, '.tidykeep', 'hooks', 'guard_stale_names.py'), 'utf8'), '# 旧实现',
    '内容不匹配已发布 hash 的同名 Python 文件必须保留');
  const settings = readFileSync(join(root, '.claude', 'settings.json'), 'utf8');
  assert.equal(settings.includes('python3'), true);
  assert.equal(settings.includes('hook.mjs'), false);
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

test('--agents 重装是 additive：本次只新增指定 agent，既有接入与文件保留', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root, '--agents', 'claude', '--no-git-hooks'], env).status, 0);
  assert.equal(run(['init', root, '--agents', 'codex', '--no-git-hooks'], env).status, 0);
  const manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.deepEqual(new Set(manifest.agents), new Set(['claude', 'codex']));
  assert.equal(existsSync(join(root, '.claude', 'skills', 'tidykeep', 'SKILL.md')), true);
  assert.equal(existsSync(join(root, '.codex', 'hooks.json')), true);
});

test('--agents additive 重装拒绝被用户修改的 Kimi shim，项目文件零写入', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root, '--agents', 'claude,kimi', '--no-git-hooks'], env).status, 0);

  const digest = (data) => createHash('sha256').update(data).digest('hex');
  const runtimeRel = '.tidykeep/runtime/hook.mjs';
  const runtimeBefore = readFileSync(join(root, runtimeRel));
  const manifestPath = join(root, '.tidykeep', 'manifest.json');
  const manifestBefore = readFileSync(manifestPath);

  const settingsPath = join(root, '.claude', 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{
      type: 'command', command: 'python3',
      args: ['${CLAUDE_PROJECT_DIR}/.tidykeep/hooks/guard_stale_names.py'],
      timeout: 20, statusMessage: 'tidykeep: 检查文件命名',
    }] }] },
  }, null, 2) + '\n');
  const unknownShim = Buffer.from('#!/usr/bin/env node\n// 用户接管后的未知 shim\n');
  writeFileSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs'), unknownShim);
  writeFileSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.sha256'), digest(unknownShim) + '\n');

  const result = run(['init', root, '--agents', 'codex', '--no-git-hooks'], env);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok((result.stdout + result.stderr).includes('kimi-shim.mjs 已被用户修改'));
  assert.deepEqual(readFileSync(join(root, runtimeRel)), runtimeBefore);
  assert.equal(readFileSync(settingsPath, 'utf8').includes('python3'), true);
  assert.deepEqual(readFileSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs')), unknownShim);
  assert.equal(existsSync(join(root, '.codex', 'hooks.json')), false);
  assert.deepEqual(readFileSync(manifestPath), manifestBefore);
  assert.deepEqual(
    new Set(JSON.parse(readFileSync(manifestPath, 'utf8')).agents),
    new Set(['claude', 'kimi']),
  );
});

test('--agents additive 重装会 preflight 既有集成，用户 drift 时不做局部新增', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root, '--agents', 'claude', '--no-git-hooks'], env).status, 0);
  const settingsPath = join(root, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  settings.hooks.Stop[0].hooks[0].timeout = 99;
  const drifted = JSON.stringify(settings, null, 2) + '\n';
  writeFileSync(settingsPath, drifted);

  const result = run(['init', root, '--agents', 'codex', '--no-git-hooks'], env);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(settingsPath, 'utf8'), drifted);
  assert.equal(existsSync(join(root, '.codex')), false, '完整 preflight 失败前不得局部新增 Codex');
});

test('Kimi 全局 config.toml 已有内联 hooks 数组 → 明确不支持且 preflight 零写入', () => {
  const { env, kimiHome } = makeEnvHome();
  writeFileSync(join(kimiHome, 'config.toml'), 'hooks = []\n');
  const root = makeRepo();
  const r = run(['init', root], env);
  assert.notEqual(r.status, 0);
  assert.ok((r.stdout + r.stderr).includes('不支持安全自动合并'));
  assert.ok((r.stdout + r.stderr).includes('移除/改写'));
  assert.ok((r.stdout + r.stderr).includes('重跑 init'));
  assert.equal(readFileSync(join(kimiHome, 'config.toml'), 'utf8'), 'hooks = []\n');
  assert.equal(existsSync(join(root, '.tidykeep', 'runtime', 'hook.mjs')), false, '不支持的全局格式应在本地部署前拒绝');
  assert.equal(existsSync(join(root, '.tidykeep', 'manifest.json')), false);
  assert.equal(existsSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs')), false);
});

test('Kimi config 同时有孤立 END 与内联 hooks 时优先报不成对，且 preflight 零写入', () => {
  const { env, kimiHome } = makeEnvHome();
  const original = '# <<< tidykeep <<<\nhooks = []\n';
  writeFileSync(join(kimiHome, 'config.toml'), original);
  const root = makeRepo();
  const r = run(['init', root], env);
  assert.notEqual(r.status, 0);
  assert.ok((r.stdout + r.stderr).includes('不成对'));
  assert.equal(readFileSync(join(kimiHome, 'config.toml'), 'utf8'), original);
  assert.equal(existsSync(join(root, '.tidykeep')), false);
  assert.equal(existsSync(env.TIDYKEEP_USER_DIR), false);
});

test('Kimi 安装与重装不生成无人消费的滚动 config.toml backup', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root, '--agents', 'kimi', '--no-git-hooks'], env).status, 0);
  assert.equal(run(['init', root, '--agents', 'kimi', '--no-git-hooks'], env).status, 0);
  assert.equal(existsSync(join(env.TIDYKEEP_USER_DIR, 'backup')), false);
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

test('uninstall: settings.json 无法解析时原文件保留且不生成隐私备份', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'settings.json'), '{"permissions":{"allow":["Bash(ls:*)"]}}');
  assert.equal(run(['init', root], env).status, 0);
  writeFileSync(join(root, '.claude', 'settings.json'),
    readFileSync(join(root, '.claude', 'settings.json'), 'utf8') + '// 用户手滑加的注释');
  const r = run(['uninstall', root], env);
  assert.notEqual(r.status, 0, '仍有无法安全剥离的 settings 时应报告部分卸载');
  assert.equal(existsSync(join(root, '.tidykeep', 'backup', 'settings.json.bak')), false);
  assert.ok(readFileSync(join(root, '.claude', 'settings.json'), 'utf8').includes('用户手滑'));
  assert.ok((r.stdout + r.stderr).includes('无法解析'));
});

test('uninstall: 预存 backup 与未知 state 永不递归删除或写入 manifest', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  mkdirSync(join(root, '.tidykeep', 'backup'), { recursive: true });
  writeFileSync(join(root, '.tidykeep', 'backup', 'user.txt'), '用户备份\n');
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'settings.json'), '{"permissions":{"allow":[]}}\n');
  assert.equal(run(['init', root, '--agents', 'claude'], env).status, 0);
  const manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.equal(manifest.files['.tidykeep/backup/settings.json.bak'], undefined);

  const state = join(root, '.tidykeep', '.state');
  writeFileSync(join(state, 'stop-once-valid'), '1');
  writeFileSync(join(state, 'user.txt'), '用户状态\n');
  const result = run(['uninstall', root], env);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(root, '.tidykeep', 'backup', 'user.txt'), 'utf8'), '用户备份\n');
  assert.equal(existsSync(join(state, 'stop-once-valid')), false, '精确运行时标记可清理');
  assert.equal(readFileSync(join(state, 'user.txt'), 'utf8'), '用户状态\n');
});

test('init 不创建永久 settings 备份', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'settings.json'), '{"permissions":{"allow":[]}}\n');
  assert.equal(run(['init', root, '--agents', 'claude'], env).status, 0);
  const backup = join(root, '.tidykeep', 'backup', 'settings.json.bak');
  assert.equal(existsSync(backup), false);
  const result = run(['uninstall', root], env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(backup), false);
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
  assert.notEqual(run(['init', root], env).status, 0);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), broken, 're-init 不得改写不成对文件');
  const r = run(['uninstall', root], env);
  assert.notEqual(r.status, 0, '不成对标记导致集成残留时应返回非零');
  const after = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.ok(after.includes('user appendix'), '用户内容不得被删');
  assert.ok((r.stdout + r.stderr).includes('不成对'), '应警告标记不成对');
});

test('Kimi 引用计数:symlink 路径 init、真实路径 uninstall 视为同一项目,全局块正确移除', () => {
  const { env, kimiHome } = makeEnvHome();
  const root = makeRepo();
  const link = root + '-link';
  symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(run(['init', link], env).status, 0);
  assert.ok(readFileSync(join(kimiHome, 'config.toml'), 'utf8').includes('[[hooks]]'));
  assert.equal(run(['uninstall', root], env).status, 0);
  assert.equal(readFileSync(join(kimiHome, 'config.toml'), 'utf8').includes('[[hooks]]'), false,
    'symlink 与真实路径应归一,最后一个项目卸载后全局块移除');
});

test('codex hooks 命令基于 git 根解析(官方:hook cwd 是会话目录而非仓库根)', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  run(['init', root], env);
  const codex = readFileSync(join(root, '.codex', 'hooks.json'), 'utf8');
  assert.ok(codex.includes('git rev-parse --show-toplevel'));
});

test('重跑 init 不重置自定义草稿区的 .gitignore 条目', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  run(['init', root, '--scratch-dir', '.scratch'], env);
  run(['init', root], env);
  const gi = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.ok(gi.includes('.scratch/'), '自定义草稿区条目应保留');
  assert.ok(!gi.includes('\n.tmp/'), '不应被重置回默认 .tmp/');
});

test('首次 init 自建的 settings.json 不会在重跑时被当作"原始备份"', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  run(['init', root], env);
  run(['init', root], env);
  assert.equal(existsSync(join(root, '.tidykeep', 'backup', 'settings.json.bak')), false);
});

test('manifest 丢失时 uninstall 仍还原指向 .tidykeep/githooks 的 hooksPath', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  run(['init', root], env);
  rmSync(join(root, '.tidykeep', 'manifest.json'), { force: true });
  run(['uninstall', root], env);
  const hp = spawnSync('git', ['-C', root, 'config', 'core.hooksPath'], { encoding: 'utf8' });
  assert.equal((hp.stdout ?? '').trim(), '');
});

test('CLI 对 agents/ledger-mode/scratch-dir 做严格校验,失败时不落任何安装产物', () => {
  const invalidArgs = [
    ['--agents', 'claude,unknown'],
    ['--agents', ''],
    ['--agents', 'claude,,codex'],
    ['--ledger-mode', 'loud'],
    ['--scratch-dir', '../escape'],
    ['--scratch-dir', 'nested/work'],
    ['--scratch-dir', 'nested\\work'],
    ['--scratch-dir', '/absolute'],
    ['--scratch-dir', '.tidykeep'],
  ];
  for (const tail of invalidArgs) {
    const { env } = makeEnvHome();
    const root = makeRepo();
    const r = run(['init', root, ...tail], env);
    assert.notEqual(r.status, 0, `${tail.join(' ')} 应失败`);
    assert.ok((r.stdout + r.stderr).includes('无效'), r.stdout + r.stderr);
    assert.equal(existsSync(join(root, '.tidykeep')), false, '校验失败不得开始安装');
  }
});

test('CLI 拒绝跨子命令选项与文件系统根目标', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  for (const args of [
    ['status', root, '--purge'],
    ['uninstall', root, '--agents', 'claude'],
    ['init', root, '--purge'],
  ]) {
    const r = run(args, env);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).includes('不支持选项'));
  }
  const fsRoot = dirname(root) === root ? root : '/';
  for (const cmd of ['init', 'uninstall']) {
    const r = run([cmd, fsRoot], env);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).includes('文件系统根目录'));
  }
});

test('uninstall 未安装项目是纯 no-op，不触碰全局 Kimi 注册', () => {
  const { env } = makeEnvHome();
  const installed = makeRepo();
  assert.equal(run(['init', installed], env).status, 0);
  const projects = join(env.TIDYKEEP_USER_DIR, 'projects.d');
  const before = readdirSync(projects).sort();
  const untouched = makeRepo();
  writeFileSync(join(untouched, 'AGENTS.md'), '# user project\n');

  const r = run(['uninstall', untouched], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok((r.stdout + r.stderr).includes('未安装'));
  assert.deepEqual(readdirSync(projects).sort(), before);
  assert.equal(readFileSync(join(untouched, 'AGENTS.md'), 'utf8'), '# user project\n');
});

test('claude-only 项目卸载不因无关全局 Kimi 状态而清理它', () => {
  const { env } = makeEnvHome();
  const kimiProject = makeRepo();
  assert.equal(run(['init', kimiProject, '--agents', 'kimi', '--no-git-hooks'], env).status, 0);
  const projects = join(env.TIDYKEEP_USER_DIR, 'projects.d');
  const shim = join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs');
  const beforeProjects = readdirSync(projects).sort();
  const beforeShim = readFileSync(shim);

  const claudeProject = makeRepo();
  assert.equal(run(['init', claudeProject, '--agents', 'claude', '--no-git-hooks'], env).status, 0);
  assert.equal(run(['uninstall', claudeProject], env).status, 0);
  assert.deepEqual(readdirSync(projects).sort(), beforeProjects);
  assert.deepEqual(readFileSync(shim), beforeShim);
});

test('已有 config 升级自动补缺省键并保留用户注释/值,写回不留临时文件', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  mkdirSync(join(root, '.tidykeep'), { recursive: true });
  writeFileSync(join(root, '.tidykeep', 'config.jsonc'), `{
  // 用户解释
  "GUARD": false,
  "SCRATCH_DIR": ".work" // 保留
}
`);
  const r = run(['init', root], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const text = readFileSync(join(root, '.tidykeep', 'config.jsonc'), 'utf8');
  assert.ok(text.includes('// 用户解释'));
  assert.ok(text.includes('"GUARD": false'));
  assert.ok(text.includes('"AUTO_COMMIT": "off"'));
  assert.ok(readFileSync(join(root, '.gitignore'), 'utf8').includes('.work/'));
  assert.equal(readdirSync(join(root, '.tidykeep')).some((n) => n.includes('atomic-')), false);
});

test('已有 config 非法、危险 WATCH_FILES 或 scratch 不安全时 preflight 中止,旧 runtime 不得先被删除', () => {
  const { env } = makeEnvHome();
  for (const config of [
    '{ not json',
    '{ "SCRATCH_DIR": "../escape" }',
    '{ "WATCH_FILES": ["package.json", "../outside"] }',
    '{ "UNKNOWN_TYPO": true }',
  ]) {
    const root = makeRepo();
    mkdirSync(join(root, '.tidykeep', 'runtime'), { recursive: true });
    writeFileSync(join(root, '.tidykeep', 'runtime', 'sentinel.mjs'), 'keep me\n');
    writeFileSync(join(root, '.tidykeep', 'config.jsonc'), config);
    const r = run(['init', root], env);
    assert.notEqual(r.status, 0);
    assert.equal(readFileSync(join(root, '.tidykeep', 'runtime', 'sentinel.mjs'), 'utf8'), 'keep me\n');
    assert.equal(existsSync(join(root, 'AGENTS.md')), false, 'preflight 失败不得产生后续文件');
  }
});

test('config 中旧 AUTO_COMMIT=auto 在升级时原位归一为 remind', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  mkdirSync(join(root, '.tidykeep'), { recursive: true });
  writeFileSync(join(root, '.tidykeep', 'config.jsonc'), `{
  // 旧值只表示提醒，绝不能恢复自动提交
  "AUTO_COMMIT": "auto",
  "SCRATCH_DIR": ".tmp"
}\n`);
  const r = run(['init', root, '--agents', 'claude', '--no-git-hooks'], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const text = readFileSync(join(root, '.tidykeep', 'config.jsonc'), 'utf8');
  assert.ok(text.includes('// 旧值只表示提醒'));
  assert.ok(text.includes('"AUTO_COMMIT": "remind"'));
  assert.equal(text.includes('"AUTO_COMMIT": "auto"'), false);
});

test('settings 结构错误和 marker 不成对均在 preflight 阶段阻止整个升级', () => {
  const { env } = makeEnvHome();
  const cases = [
    (root) => {
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: {} } }));
    },
    (root) => writeFileSync(join(root, 'AGENTS.md'), '<!-- tidykeep:begin -->\nbroken\n'),
  ];
  for (const arrange of cases) {
    const root = makeRepo();
    mkdirSync(join(root, '.tidykeep', 'runtime'), { recursive: true });
    writeFileSync(join(root, '.tidykeep', 'runtime', 'sentinel.mjs'), 'old runtime\n');
    arrange(root);
    const r = run(['init', root], env);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(join(root, '.tidykeep', 'runtime', 'sentinel.mjs'), 'utf8'), 'old runtime\n');
    assert.equal(existsSync(join(root, 'STATE.md')), false);
  }
});

test('漂移的 tidykeep hook 描述符使 init 在部署前失败，settings 字节不变', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const settingsPath = join(root, '.claude', 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  const before = JSON.stringify({
    hooks: { Stop: [{ hooks: [{
      type: 'command', command: 'node',
      args: ['${CLAUDE_PROJECT_DIR}/.tidykeep/runtime/hook.mjs', 'claude-stop'],
      timeout: 99, statusMessage: 'tidykeep: 收尾检查',
    }] }] },
  }, null, 2) + '\n';
  writeFileSync(settingsPath, before);
  const r = run(['init', root, '--agents', 'claude', '--no-git-hooks'], env);
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok((r.stdout + r.stderr).includes('描述符'));
  assert.equal(readFileSync(settingsPath, 'utf8'), before);
  assert.equal(existsSync(join(root, '.tidykeep', 'runtime')), false);
});

test('exact tidykeep handler 位于错误 matcher 时也拒绝 init，避免静默重建', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const settingsPath = join(root, '.claude', 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  const before = JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{
      type: 'command', command: 'node',
      args: ['${CLAUDE_PROJECT_DIR}/.tidykeep/runtime/hook.mjs', 'claude-pretooluse'],
      timeout: 20, statusMessage: 'tidykeep: 检查文件命名',
    }] }] },
  }, null, 2) + '\n';
  writeFileSync(settingsPath, before);
  const r = run(['init', root, '--agents', 'claude', '--no-git-hooks'], env);
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(settingsPath, 'utf8'), before);
  assert.equal(existsSync(join(root, '.tidykeep', 'runtime')), false);
});

test('恶意 manifest 路径使 init/uninstall fail-closed，项目外哨兵零触碰', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const outside = makeTempDir('outside-sentinel-');
  const sentinel = join(outside, 'sentinel');
  writeFileSync(sentinel, 'do not touch\n');
  const rel = relative(root, sentinel).replaceAll('\\', '/');
  mkdirSync(join(root, '.tidykeep'), { recursive: true });
  writeFileSync(join(root, '.tidykeep', 'manifest.json'), JSON.stringify({
    manifestVersion: 3,
    agents: ['kimi'],
    files: { [rel]: { ownership: 'created', hash: '0'.repeat(64), kind: 'managed', managed: true } },
    kimi: { status: 'installed' },
  }));
  for (const args of [['init', root], ['uninstall', root]]) {
    const r = run(args, env);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).includes('manifest.json 损坏'));
    assert.equal(readFileSync(sentinel, 'utf8'), 'do not touch\n');
    assert.equal(existsSync(join(root, 'AGENTS.md')), false);
  }
});

test('manifest 不得把普通项目文件伪装成 managed 资产后授权删除', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const sentinel = join(root, 'src', 'app.js');
  mkdirSync(dirname(sentinel), { recursive: true });
  writeFileSync(sentinel, 'user source\n');
  mkdirSync(join(root, '.tidykeep'), { recursive: true });
  writeFileSync(join(root, '.tidykeep', 'manifest.json'), JSON.stringify({
    manifestVersion: 3,
    files: {
      'src/app.js': {
        ownership: 'created',
        hash: createHash('sha256').update('user source\n').digest('hex'),
        kind: 'managed',
        managed: true,
      },
    },
  }));
  for (const command of ['init', 'uninstall']) {
    const r = run([command, root, ...(command === 'init' ? ['--no-git-hooks'] : [])], env);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(sentinel, 'utf8'), 'user source\n');
  }
});

test('项目控制目录为 symlink 时 init/uninstall 均拒绝，不沿链接写出项目外', {
  skip: process.platform === 'win32',
}, () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const outside = makeTempDir('symlink-target-');
  const sentinel = join(outside, 'sentinel');
  writeFileSync(sentinel, 'do not touch\n');
  symlinkSync(outside, join(root, '.tidykeep'));
  for (const args of [['init', root, '--agents', 'claude'], ['uninstall', root]]) {
    const r = run(args, env);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).includes('符号链接'));
    assert.equal(readFileSync(sentinel, 'utf8'), 'do not touch\n');
  }
  assert.deepEqual(readdirSync(outside), ['sentinel']);
});

test('首次安装遇到同名 tidykeep skill 冲突时拒绝覆盖且不开始部署 runtime', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const skill = join(root, '.claude', 'skills', 'tidykeep', 'SKILL.md');
  mkdirSync(dirname(skill), { recursive: true });
  writeFileSync(skill, '# user-owned tidykeep skill\n');
  const r = run(['init', root, '--agents', 'claude'], env);
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(skill, 'utf8'), '# user-owned tidykeep skill\n');
  assert.equal(existsSync(join(root, '.tidykeep', 'runtime')), false);
});

test('真实 v2 清单可按历史 hash 接管已知机器文件；同路径用户文件仍拒绝覆盖', () => {
  const { env } = makeEnvHome();
  for (const [content, shouldPass] of [
    [LEGACY_V2_PRECOMMIT, true],
    ['#!/bin/sh\n# user-owned hook\nexit 0\n', false],
  ]) {
    const root = makeRepo();
    const hook = join(root, '.tidykeep', 'githooks', 'pre-commit');
    mkdirSync(dirname(hook), { recursive: true });
    writeFileSync(hook, content);
    writeFileSync(join(root, '.tidykeep', 'manifest.json'), JSON.stringify({
      manifestVersion: 2,
      toolVersion: '0.1.0',
      runtimeVersion: '0.1.0',
      installedAt: '2026-08-12T00:00:00.000Z',
      agents: ['claude'],
      files: {},
      hookspath: 'none',
    }, null, 2));
    const r = run(['init', root, '--agents', 'claude', '--no-git-hooks'], env);
    assert.equal(r.status === 0, shouldPass, r.stdout + r.stderr);
    if (shouldPass) {
      assert.notEqual(readFileSync(hook, 'utf8'), LEGACY_V2_PRECOMMIT, '历史机器文件应升级为当前 payload');
      const manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
      assert.equal(manifest.manifestVersion, 3);
      assert.equal(manifest.files['.tidykeep/githooks/pre-commit'].managed, true);
    } else {
      assert.equal(readFileSync(hook, 'utf8'), content);
      assert.equal(existsSync(join(root, 'AGENTS.md')), false, '冲突应在写入前终止');
    }
  }
});

test('真实 v2 Kimi 安装可接管已发布旧 shim 并补所有权 hash', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  mkdirSync(join(root, '.tidykeep'), { recursive: true });
  writeFileSync(join(root, '.tidykeep', 'manifest.json'), JSON.stringify({
    manifestVersion: 2,
    toolVersion: '0.1.0',
    runtimeVersion: '0.1.0',
    installedAt: '2026-08-12T00:00:00.000Z',
    agents: ['kimi'],
    files: {},
    hookspath: 'none',
    kimi: { status: 'installed', configToml: env.KIMI_CODE_HOME + '/config.toml' },
  }, null, 2));
  mkdirSync(env.TIDYKEEP_USER_DIR, { recursive: true });
  writeFileSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs'), PUBLISHED_V2_KIMI_SHIM);
  assert.equal(existsSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.sha256')), false, 'v2 尚无所有权 hash');

  const r = run(['init', root, '--agents', 'kimi', '--no-git-hooks'], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(
    readFileSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs')),
    readFileSync(join(REPO, 'payload', 'runtime', 'kimi-shim.mjs')),
  );
  assert.match(readFileSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.sha256'), 'utf8'), /^[a-f0-9]{64}\n$/);
});

test('--no-git-hooks 重装不改既有 Git 接线，manifest 不持久化本机 hooksPath', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root, '--agents', 'claude'], env).status, 0);
  assert.equal(run(['init', root, '--agents', 'claude', '--no-git-hooks'], env).status, 0);
  assert.equal(execFileSync('git', ['-C', root, 'config', 'core.hooksPath'], { encoding: 'utf8' }).trim(), '.tidykeep/githooks');
  const manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.equal('hookspath' in manifest, false);
});

test('外部 hooksPath 未完整链入时 init 非零，补齐两条接线后重跑成功', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  execFileSync('git', ['-C', root, 'config', 'core.hooksPath', '.husky']);
  mkdirSync(join(root, '.husky'));
  writeFileSync(join(root, '.husky', 'pre-commit'), '# 只有示例: .tidykeep/githooks/pre-commit\n');
  writeFileSync(join(root, '.husky', 'commit-msg'), 'echo .tidykeep/githooks/commit-msg\n');
  const first = run(['init', root, '--agents', 'claude'], env);
  assert.notEqual(first.status, 0, first.stdout + first.stderr);
  assert.ok((first.stdout + first.stderr).includes('接线尚未完整生效'));
  let manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.equal('hookspath' in manifest, false);

  for (const name of ['pre-commit', 'commit-msg']) {
    writeFileSync(join(root, '.husky', name),
      `sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/${name}" "$@" || exit $?\n`);
  }
  const second = run(['init', root, '--agents', 'claude'], env);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.ok(second.stdout.includes('已完整链入'));
  manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.equal('hookspath' in manifest, false);
});

test('uninstall: 外部 hooksPath 保守保留 githooks/runtime，解除接管后可重跑', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  execFileSync('git', ['-C', root, 'config', 'core.hooksPath', '.husky']);
  mkdirSync(join(root, '.husky'));
  for (const name of ['pre-commit', 'commit-msg']) {
    writeFileSync(join(root, '.husky', name),
      `exec sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/${name}" "$@"\n`);
  }
  assert.equal(run(['init', root, '--agents', 'claude'], env).status, 0);

  // 变量间接执行无法靠 literal parser 可靠证伪；外部 hooksPath 存在时一律保守。
  writeFileSync(join(root, '.husky', 'pre-commit'),
    `TK="$(git rev-parse --show-toplevel)/.tidykeep/githooks/pre-commit"\n"$TK" "$@"\n`);
  writeFileSync(join(root, '.husky', 'commit-msg'), '# 接线已移除\n');
  const first = run(['uninstall', root], env);
  assert.notEqual(first.status, 0, first.stdout + first.stderr);
  assert.ok((first.stdout + first.stderr).includes('无法证明不存在间接 tidykeep 接线'));
  assert.equal(existsSync(join(root, '.tidykeep', 'githooks', 'pre-commit')), true);
  assert.equal(existsSync(join(root, '.tidykeep', 'runtime', 'hook.mjs')), true);

  writeFileSync(join(root, '.husky', 'pre-commit'), '# 接线已移除\n');
  execFileSync('git', ['-C', root, 'config', '--unset', 'core.hooksPath']);
  const second = run(['uninstall', root], env);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(existsSync(join(root, '.tidykeep', 'runtime')), false);
  assert.equal(existsSync(join(root, '.tidykeep', 'githooks')), false);
  assert.equal(existsSync(join(root, '.tidykeep', 'config.jsonc')), true);
});

test('uninstall: core.hooksPath 查询异常时 fail-closed 并保留 githooks/runtime', {
  skip: process.platform === 'win32',
}, () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root, '--agents', 'claude'], env).status, 0);
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const fakeBin = makeTempDir('uninstall-git-failure-');
  const fakeGit = join(fakeBin, 'git');
  writeFileSync(fakeGit, `#!/bin/sh
case "$*" in
  *"config core.hooksPath"*) echo "simulated query failure" >&2; exit 7 ;;
esac
exec ${JSON.stringify(realGit)} "$@"
`);
  chmodSync(fakeGit, 0o755);
  const result = run(['uninstall', root], { ...env, PATH: `${fakeBin}:${env.PATH}` });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok((result.stdout + result.stderr).includes('无法读取 git core.hooksPath'));
  assert.equal(existsSync(join(root, '.tidykeep', 'githooks', 'pre-commit')), true);
  assert.equal(existsSync(join(root, '.tidykeep', 'runtime', 'hook.mjs')), true);
});

test('enable-githooks 复用当前 Node 绝对路径，不依赖 PATH 中另有 node', { skip: process.platform === 'win32' }, () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const runtime = join(root, '.tidykeep', 'runtime');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, 'enable-githooks.mjs'),
    readFileSync(join(REPO, 'payload', 'runtime', 'enable-githooks.mjs')));
  const githooks = join(root, '.tidykeep', 'githooks');
  mkdirSync(githooks, { recursive: true });
  for (const name of ['pre-commit', 'commit-msg']) {
    writeFileSync(join(githooks, name), readFileSync(join(REPO, 'payload', 'githooks', name)));
  }
  const fakeBin = makeTempDir('git-only-path-');
  symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(fakeBin, 'git'));
  const r = spawnSync(process.execPath, [BIN, 'enable-githooks', root], {
    encoding: 'utf8', env: { ...env, PATH: fakeBin },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(execFileSync('git', ['-C', root, 'config', 'core.hooksPath'], { encoding: 'utf8' }).trim(), '.tidykeep/githooks');
});

test('git config 外部接线失败时返回非零并明确说明本地安装已保留', { skip: process.platform === 'win32' }, () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const fakeBin = makeTempDir('fake-git-');
  const fakeGit = join(fakeBin, 'git');
  writeFileSync(fakeGit, `#!/bin/sh
case "\$*" in
  *"config core.hooksPath .tidykeep/githooks"*) echo "simulated write denial" >&2; exit 13 ;;
esac
exec ${JSON.stringify(realGit)} "\$@"
`);
  chmodSync(fakeGit, 0o755);
  const failedEnv = { ...env, PATH: `${fakeBin}:${env.PATH}` };
  const r = run(['init', root, '--agents', 'claude'], failedEnv);
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok((r.stdout + r.stderr).includes('本地文件已安装'));
  assert.ok((r.stdout + r.stderr).includes('外部接线失败'));
  assert.equal(existsSync(join(root, '.tidykeep', 'runtime', 'hook.mjs')), true);
  const manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.equal('hookspath' in manifest, false);
});

test('manifest 记录 managed hash;用户改过的 runtime/skill 升级拒绝覆盖,卸载也保留', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root], env).status, 0);
  const manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  const runtimeRel = '.tidykeep/runtime/hook.mjs';
  const skillRel = '.claude/skills/tidykeep/SKILL.md';
  assert.equal(manifest.manifestVersion, 3);
  assert.match(manifest.files[runtimeRel].hash, /^[a-f0-9]{64}$/);
  assert.equal(manifest.files[runtimeRel].managed, true);
  assert.match(manifest.files[skillRel].hash, /^[a-f0-9]{64}$/);

  const runtime = join(root, runtimeRel);
  const skill = join(root, skillRel);
  writeFileSync(runtime, '// user edited runtime\n');
  writeFileSync(skill, '# user edited skill\n');
  const upgrade = run(['init', root], env);
  assert.notEqual(upgrade.status, 0, upgrade.stdout + upgrade.stderr);
  assert.equal(readFileSync(runtime, 'utf8'), '// user edited runtime\n');
  assert.equal(readFileSync(skill, 'utf8'), '# user edited skill\n');

  const uninstall = run(['uninstall', root], env);
  assert.notEqual(uninstall.status, 0, '用户修改的 managed 文件仍在时卸载应返回非零');
  assert.equal(readFileSync(runtime, 'utf8'), '// user edited runtime\n');
  assert.equal(readFileSync(skill, 'utf8'), '# user edited skill\n');
  assert.equal(existsSync(join(root, '.tidykeep', 'manifest.json')), true);
});

test('卸载保留用户改过的 tidykeep hook 描述符及其 runtime；用户处理后重装清空遗留状态', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root], env).status, 0);
  const settingsPath = join(root, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  settings.hooks.Stop[0].hooks[0].timeout = 99;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  const removed = run(['uninstall', root], env);
  assert.notEqual(removed.status, 0);
  const after = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(after.hooks.Stop[0].hooks[0].timeout, 99);
  assert.equal(existsSync(join(root, '.tidykeep', 'runtime', 'hook.mjs')), true,
    '仍有 descriptor 指向 runtime 时不得制造悬空 hook');
  let manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.equal('uninstallProblems' in manifest, false);

  delete after.hooks.Stop;
  if (!Object.keys(after.hooks).length) delete after.hooks;
  writeFileSync(settingsPath, JSON.stringify(after, null, 2) + '\n');
  const reinit = run(['init', root], env);
  assert.equal(reinit.status, 0, reinit.stdout + reinit.stderr);
  manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.equal('uninstallProblems' in manifest, false);
});

test('uninstall --purge 只删除精确匹配当前模板的知识文件,用户改过的 STATE/config 保留', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root], env).status, 0);
  writeFileSync(join(root, 'STATE.md'), '# user state\n');
  writeFileSync(join(root, '.tidykeep', 'config.jsonc'),
    readFileSync(join(root, '.tidykeep', 'config.jsonc'), 'utf8').replace('"GUARD": true', '"GUARD": false'));
  writeFileSync(join(root, '.tmp', 'user-draft.txt'), '仍在使用的草稿\n');
  const r = run(['uninstall', root, '--purge'], env);
  assert.notEqual(r.status, 0, '用户修改的 STATE/config 被保留时应返回非零');
  assert.equal(readFileSync(join(root, 'STATE.md'), 'utf8'), '# user state\n');
  assert.ok(readFileSync(join(root, '.tidykeep', 'config.jsonc'), 'utf8').includes('"GUARD": false'));
  assert.equal(existsSync(join(root, 'LEDGER.md')), false, '未修改且 hash 匹配的 LEDGER 应删除');
  assert.equal(readFileSync(join(root, '.tmp', 'user-draft.txt'), 'utf8'), '仍在使用的草稿\n',
    '--purge 不拥有 scratch 内容，不得删除文件或清理目录');
});

test('伪造 manifest 不能授权删除既有 backup、配置或 allowlist', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root, '--agents', 'claude', '--no-git-hooks'], env).status, 0);
  const backup = join(root, '.tidykeep', 'backup', 'settings.json.bak');
  mkdirSync(dirname(backup), { recursive: true });
  writeFileSync(backup, 'user backup secret\n');
  const config = join(root, '.tidykeep', 'config.jsonc');
  const allowlist = join(root, '.tidykeep', 'allowlist');
  const manifestPath = join(root, '.tidykeep', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [rel, path, kind] of [
    ['.tidykeep/backup/settings.json.bak', backup, 'generated'],
    ['.tidykeep/config.jsonc', config, 'config'],
    ['.tidykeep/allowlist', allowlist, 'config'],
  ]) {
    manifest.files[rel] = {
      ownership: 'created',
      hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
      kind,
      managed: false,
    };
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const result = run(['uninstall', root], env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(backup, 'utf8'), 'user backup secret\n');
  assert.equal(existsSync(config), true);
  assert.equal(existsSync(allowlist), true);
});

test('Kimi 引用计数只统计 runtime 仍存在的项目,陈旧注册不阻止最后一个活项目清理', () => {
  const { env, kimiHome } = makeEnvHome();
  const root1 = makeRepo();
  const root2 = makeRepo();
  assert.equal(run(['init', root1], env).status, 0);
  assert.equal(run(['init', root2], env).status, 0);
  rmSync(join(root2, '.tidykeep'), { recursive: true, force: true });
  assert.equal(run(['uninstall', root1], env).status, 0);
  assert.equal(readFileSync(join(kimiHome, 'config.toml'), 'utf8').includes('[[hooks]]'), false);
  assert.equal(existsSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs')), false);
});

test('Kimi 全局标记不成对时卸载返回 problem 并保留 shim、注册和本项目 runtime', () => {
  const { env, kimiHome } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root], env).status, 0);
  const tomlPath = join(kimiHome, 'config.toml');
  writeFileSync(tomlPath, readFileSync(tomlPath, 'utf8').replace('# <<< tidykeep <<<', ''));
  const beforeMarkers = readdirSync(join(env.TIDYKEEP_USER_DIR, 'projects.d'));
  const r = run(['uninstall', root], env);
  assert.notEqual(r.status, 0, 'Kimi 注册无法安全移除时应返回非零');
  assert.ok((r.stdout + r.stderr).includes('不成对'));
  assert.equal(existsSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs')), true);
  assert.deepEqual(readdirSync(join(env.TIDYKEEP_USER_DIR, 'projects.d')), beforeMarkers);
  assert.equal(existsSync(join(root, '.tidykeep', 'runtime', 'hook.mjs')), true,
    '注册仍在时必须保留可路由的项目 runtime');
});

test('首次安装 managed 写入中断后丢弃不可信 staging，并按现场重新安装', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const failed = run(['init', root, '--agents', 'claude', '--no-git-hooks'], {
    ...env, TIDYKEEP_TEST_FAIL_AFTER_MANAGED_WRITES: '2',
  });
  assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
  assert.ok((failed.stdout + failed.stderr).includes('测试注入'));
  assert.equal(existsSync(join(root, '.tidykeep', '.install-transaction', 'journal.json')), true);
  assert.equal(existsSync(join(root, '.tidykeep', 'manifest.json')), false);

  const resumed = run(['init', root, '--agents', 'claude', '--no-git-hooks'], env);
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  assert.ok(resumed.stdout.includes('已丢弃上次中断事务'));
  assert.equal(existsSync(join(root, '.tidykeep', '.install-transaction')), false);
  const manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.equal(manifest.agents.includes('claude'), true);
  assert.equal(manifest.files['.tidykeep/runtime/hook.mjs'].managed, true);
});

test('恢复从不回放伪造 settings stage，而按现场 settings 重新规划', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const settingsPath = join(root, '.claude', 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  const userSettings = '{"userSetting":true}\n';
  writeFileSync(settingsPath, userSettings);
  const failed = run(['init', root, '--agents', 'claude', '--no-git-hooks'], {
    ...env, TIDYKEEP_TEST_FAIL_AFTER_MANAGED_WRITES: '1',
  });
  assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);

  const txn = join(root, '.tidykeep', '.install-transaction');
  const journalPath = join(txn, 'journal.json');
  const stagePath = join(txn, 'stage', '.claude', 'settings.json');
  const forged = '{"hooks":{},"attacker":true}\n';
  writeFileSync(stagePath, forged);
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const digest = createHash('sha256').update(forged).digest('hex');
  journal.entries.find(({ rel }) => rel === '.claude/settings.json').afterHash = digest;
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + '\n');

  const resumed = run(['init', root, '--agents', 'claude', '--no-git-hooks'], env);
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  assert.ok(resumed.stdout.includes('已丢弃上次中断事务'));
  assert.equal(readFileSync(settingsPath, 'utf8').includes('"attacker"'), false);
  assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).userSetting, true);
  assert.equal(existsSync(txn), false);
});

test('恢复从不回放伪造 managed hook stage，即使 journal hash 同步伪造', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const failed = run(['init', root, '--agents', 'claude', '--no-git-hooks'], {
    ...env, TIDYKEEP_TEST_FAIL_AFTER_MANAGED_WRITES: '1',
  });
  assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);

  const txn = join(root, '.tidykeep', '.install-transaction');
  const journalPath = join(txn, 'journal.json');
  const rel = '.tidykeep/githooks/pre-commit';
  const stagePath = join(txn, 'stage', rel);
  const forged = '#!/bin/sh\necho attacker\n';
  writeFileSync(stagePath, forged);
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const digest = createHash('sha256').update(forged).digest('hex');
  journal.entries.find((entry) => entry.rel === rel).afterHash = digest;
  journal.records.find((entry) => entry.rel === rel).record.hash = digest;
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + '\n');

  const resumed = run(['init', root, '--agents', 'claude', '--no-git-hooks'], env);
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  assert.ok(resumed.stdout.includes('已丢弃上次中断事务'));
  assert.deepEqual(readFileSync(join(root, rel)), readFileSync(join(REPO, 'payload', 'githooks', 'pre-commit')));
  assert.equal(existsSync(stagePath), false);
});

test('已有 v3 升级在 preflight 拒绝伪造的历史 managed 字节', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  assert.equal(run(['init', root, '--agents', 'claude', '--no-git-hooks'], env).status, 0);
  const manifestPath = join(root, '.tidykeep', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const rel = '.tidykeep/runtime/config.mjs';
  writeFileSync(join(root, rel), '// old package payload simulation\n');
  manifest.files[rel].hash = createHash('sha256').update('// old package payload simulation\n').digest('hex');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const failed = run(['init', root, '--agents', 'codex', '--no-git-hooks'], {
    ...env, TIDYKEEP_TEST_FAIL_AFTER_MANAGED_WRITES: '1',
  });
  assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
  assert.equal(existsSync(join(root, '.tidykeep', '.install-transaction', 'journal.json')), false);
  assert.ok((failed.stdout + failed.stderr).includes('已被用户修改'));
  assert.equal(readFileSync(join(root, rel), 'utf8'), '// old package payload simulation\n');
});

test('Kimi 部分写失败不把瞬态状态写入 manifest；重跑从现场补注册', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const failed = run(['init', root, '--agents', 'kimi', '--no-git-hooks'], {
    ...env, TIDYKEEP_TEST_FAIL_KIMI_AFTER_SHIM: '1',
  });
  assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
  let manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.equal('kimi' in manifest, false);
  assert.equal(existsSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs')), true);

  const retried = run(['init', root, '--agents', 'kimi', '--no-git-hooks'], env);
  assert.equal(retried.status, 0, retried.stdout + retried.stderr);
  manifest = JSON.parse(readFileSync(join(root, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.equal('kimi' in manifest, false);
  const removed = run(['uninstall', root], env);
  assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  assert.equal(existsSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs')), false);
});

test('项目级活锁阻止并发 init/uninstall，释放后可重跑', () => {
  const { env } = makeEnvHome();
  const root = makeRepo();
  const lock = join(root, '.tidykeep', '.install-lock');
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({
    version: 1, token: 'held', pid: process.pid,
    hostname: execFileSync(process.execPath, ['-e', 'console.log(require("node:os").hostname())'], { encoding: 'utf8' }).trim(),
    operation: 'init', startedAt: '2000-01-01T00:00:00.000Z',
  }));
  for (const args of [
    ['init', root, '--agents', 'claude', '--no-git-hooks'],
    ['uninstall', root],
  ]) {
    const blocked = run(args, env);
    assert.notEqual(blocked.status, 0, blocked.stdout + blocked.stderr);
    assert.ok((blocked.stdout + blocked.stderr).includes('另一个 tidykeep 进程占用'));
  }
  rmSync(lock, { recursive: true, force: true });
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({
    version: 1, token: 'dead', pid: 2147483647,
    hostname: execFileSync(process.execPath, ['-e', 'console.log(require("node:os").hostname())'], { encoding: 'utf8' }).trim(),
    operation: 'init', startedAt: '2000-01-01T00:00:00.000Z',
  }));
  const stale = run(['init', root, '--agents', 'claude', '--no-git-hooks'], env);
  assert.notEqual(stale.status, 0);
  assert.ok((stale.stdout + stale.stderr).includes('人工删除'));
  assert.equal(existsSync(lock), true, '死进程锁也不得自动回收，避免换锁竞态破坏互斥');
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).includes('.install-lock'), false,
    '项目锁必须被 gitignore');
  rmSync(lock, { recursive: true, force: true });
  assert.equal(run(['init', root, '--agents', 'claude', '--no-git-hooks'], env).status, 0);
});

test('dry-run 与 preflight 失败不删除用户预存的空 .tidykeep', () => {
  const { env } = makeEnvHome();
  for (const args of [
    ['init', '--agents', 'claude', '--dry-run'],
    ['uninstall', '--dry-run'],
  ]) {
    const root = makeRepo();
    mkdirSync(join(root, '.tidykeep'));
    assert.equal(run([args[0], root, ...args.slice(1)], env).status, 0);
    assert.equal(existsSync(join(root, '.tidykeep')), true);
  }
  const root = makeRepo();
  mkdirSync(join(root, '.tidykeep'));
  writeFileSync(join(root, 'AGENTS.md'), '<!-- tidykeep:begin -->\nunpaired\n');
  assert.notEqual(run(['init', root, '--agents', 'claude'], env).status, 0);
  assert.equal(existsSync(join(root, '.tidykeep')), true);
});

test('Git 父仓库子目录拒绝 init/uninstall；status 不读取父 hooksPath', () => {
  const { env } = makeEnvHome();
  const parent = makeRepo();
  execFileSync('git', ['-C', parent, 'config', 'core.hooksPath', '.parent-hooks']);
  const child = join(parent, 'packages', 'child');
  mkdirSync(child, { recursive: true });
  for (const args of [
    ['init', child, '--agents', 'claude'],
    ['uninstall', child],
  ]) {
    const result = run(args, env);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok((result.stdout + result.stderr).includes('Git 仓库子目录'));
  }
  const report = JSON.parse(run(['status', child, '--json'], env).stdout);
  assert.equal(report.gitRepository, 'parent');
  assert.equal(report.gitHooksPath, null);
  assert.equal(execFileSync('git', ['-C', parent, 'config', 'core.hooksPath'], { encoding: 'utf8' }).trim(), '.parent-hooks');
  assert.equal(existsSync(join(child, '.tidykeep')), false);
});

test('linked worktree 拒绝可变命令；status 只读报告主仓库共享 hooksPath', {
  skip: process.platform === 'win32',
}, () => {
  const { env } = makeEnvHome();
  const main = makeRepo();
  writeFileSync(join(main, 'seed.txt'), 'seed\n');
  execFileSync('git', ['-C', main, 'add', 'seed.txt']);
  execFileSync('git', ['-C', main, 'commit', '-qm', 'seed']);
  execFileSync('git', ['-C', main, 'config', 'core.hooksPath', '.main-hooks']);
  const linked = join(makeTempDir('linked-worktree-parent-'), 'linked');
  execFileSync('git', ['-C', main, 'worktree', 'add', '--detach', linked, 'HEAD']);

  for (const args of [
    ['init', linked, '--agents', 'claude'],
    ['uninstall', linked],
  ]) {
    const result = run(args, env);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok((result.stdout + result.stderr).includes('linked worktree'), result.stdout + result.stderr);
    assert.ok((result.stdout + result.stderr).includes(main), result.stdout + result.stderr);
  }

  const result = run(['status', linked, '--json'], env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.gitRepository, 'linked');
  assert.equal(report.gitRepositoryRoot, linked);
  assert.equal(report.gitMainWorktreeRoot, main);
  assert.equal(report.gitHooksPath, '.main-hooks');
  assert.notEqual(report.gitDirectory, report.gitCommonDirectory);
  assert.equal(existsSync(join(linked, '.tidykeep')), false);

  mkdirSync(join(linked, '.tidykeep'));
  const doctorResult = run(['doctor', linked, '--fix'], env);
  assert.notEqual(doctorResult.status, 0, doctorResult.stdout + doctorResult.stderr);
  assert.ok((doctorResult.stdout + doctorResult.stderr).includes('linked worktree'));
  assert.ok((doctorResult.stdout + doctorResult.stderr).includes(main));
  assert.equal(execFileSync('git', ['-C', main, 'config', 'core.hooksPath'], { encoding: 'utf8' }).trim(), '.main-hooks');
});
