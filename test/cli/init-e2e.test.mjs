import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnv, makeTempDir } from '../helpers/temp.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI = join(ROOT, 'bin', 'tidykeep.mjs');

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8', env: isolatedEnv(), timeout: 30_000, ...opts,
  });
}

function gitInit(dir) {
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 't@example.com'],
    ['config', 'user.name', 'tidykeep test'],
  ]) {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
}

const SKILL_FILES = [
  '.claude/skills/tidykeep/SKILL.md',
  '.claude/skills/tidykeep/references/governance.md',
  '.agents/skills/tidykeep/SKILL.md',
  '.claude/skills/sdlc/SKILL.md',
  '.agents/skills/sdlc/SKILL.md',
  '.agents/skills/sdlc/templates/poc-test-case.md',
  '.claude/skills/blind-test/SKILL.md',
  '.agents/skills/blind-test/references/mutation-check.md',
];

test('init:全新安装铺齐两处 skill、三个标记块与 STATE.md', () => {
  const dir = makeTempDir('tk-init-');
  gitInit(dir);
  const r = run(['init', dir]);
  assert.equal(r.status, 0, r.stderr);

  for (const rel of SKILL_FILES) {
    assert.ok(existsSync(join(dir, rel)), `缺少 ${rel}`);
  }
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /tidykeep 协议/);
  assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /@AGENTS\.md/);
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /\.tmp\//);
  assert.ok(existsSync(join(dir, 'STATE.md')));
  // 不再安装任何 hook 资产
  assert.ok(!existsSync(join(dir, '.tidykeep')), '不应再创建 .tidykeep/');
  assert.ok(!existsSync(join(dir, 'LEDGER.md')), '不应再创建 LEDGER.md');
});

test('init:重跑幂等,不重复注入标记块', () => {
  const dir = makeTempDir('tk-idem-');
  gitInit(dir);
  assert.equal(run(['init', dir]).status, 0);
  const first = readFileSync(join(dir, 'AGENTS.md'), 'utf8');

  const second = run(['init', dir]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /无变化/);
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), first);
  assert.equal(first.match(/tidykeep:begin/g).length, 1);
});

// 验收条款(D-013):payload 内容变化时,重跑 init 必须把目标文件刷回发布内容。
// 由变异检查发现——此前把 `before && before.equals(data)` 削成 `before` 也全绿,
// 说明「升级」这条唯一的产品承诺当时没有任何断言守着。
test('init:目标文件内容陈旧时重跑刷新回发布内容', () => {
  const dir = makeTempDir('tk-upgrade-');
  gitInit(dir);
  assert.equal(run(['init', dir]).status, 0);

  const installed = join(dir, '.claude/skills/tidykeep/SKILL.md');
  const shipped = readFileSync(installed, 'utf8');
  writeFileSync(installed, '# 冒充旧版本\n');

  const again = run(['init', dir]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(installed, 'utf8'), shipped, '陈旧文件必须被刷新');
  assert.match(again.stdout, /刷新/);
});

test('init:保留用户既有 AGENTS.md 与 .gitignore 内容', () => {
  const dir = makeTempDir('tk-keep-');
  gitInit(dir);
  writeFileSync(join(dir, 'AGENTS.md'), '# 我自己的规则\n\n不要动我。\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');

  assert.equal(run(['init', dir]).status, 0);
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /不要动我。/);
  assert.match(agents, /tidykeep 协议/);
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /node_modules\//);
});

test('init:STATE.md 已存在时永不覆盖', () => {
  const dir = makeTempDir('tk-state-');
  gitInit(dir);
  writeFileSync(join(dir, 'STATE.md'), '# 我的既有知识\n');
  assert.equal(run(['init', dir]).status, 0);
  assert.equal(readFileSync(join(dir, 'STATE.md'), 'utf8'), '# 我的既有知识\n');
});

test('init:标记不成对时整体拒绝且不改写任何文件', () => {
  const dir = makeTempDir('tk-unpaired-');
  gitInit(dir);
  assert.equal(run(['init', dir]).status, 0);
  const agentsPath = join(dir, 'AGENTS.md');
  writeFileSync(agentsPath, readFileSync(agentsPath, 'utf8').replace('<!-- tidykeep:end -->', ''));
  const broken = readFileSync(agentsPath, 'utf8');

  const r = run(['init', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /标记不成对/);
  assert.equal(readFileSync(agentsPath, 'utf8'), broken, '拒绝时不得改写文件');
});

test('init --dry-run:只打印不落盘', () => {
  const dir = makeTempDir('tk-dry-');
  gitInit(dir);
  const r = run(['init', dir, '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry-run/);
  assert.ok(!existsSync(join(dir, 'AGENTS.md')));
  assert.ok(!existsSync(join(dir, '.claude')));
});

test('init:非 Git 目录可安装', () => {
  const dir = makeTempDir('tk-nogit-');
  // 测试临时目录位于本仓库内，git 会一路向上找到 tidykeep 仓库根。用 ceiling
  // 挡住向上搜索，才能真正模拟一个独立的非 Git 目录。
  const r = run(['init', dir], {
    env: { ...isolatedEnv(), GIT_CEILING_DIRECTORIES: dirname(dir) },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, '.claude/skills/tidykeep/SKILL.md')));
});

test('init:拒绝 Git 仓库的子目录', () => {
  const dir = makeTempDir('tk-sub-');
  gitInit(dir);
  const sub = join(dir, 'packages', 'app');
  mkdirSync(sub, { recursive: true });
  const r = run(['init', sub]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /子目录/);
});

test('uninstall:剥块删文件清空目录,STATE.md 保留', () => {
  const dir = makeTempDir('tk-un-');
  gitInit(dir);
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  assert.equal(run(['init', dir]).status, 0);

  const r = run(['uninstall', dir]);
  assert.equal(r.status, 0, r.stderr);
  for (const rel of SKILL_FILES) {
    assert.ok(!existsSync(join(dir, rel)), `${rel} 应被移除`);
  }
  // 空壳目录也要清掉，不留 .claude/skills/tidykeep/references/
  assert.ok(!existsSync(join(dir, '.claude')), '.claude 空目录应被清除');
  assert.ok(!existsSync(join(dir, '.agents')), '.agents 空目录应被清除');
  assert.ok(existsSync(join(dir, 'STATE.md')), 'STATE.md 必须保留');
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8').trim(), 'node_modules/');
});

test('uninstall:skill 文件被改过则保守保留并非零退出', () => {
  const dir = makeTempDir('tk-un-mod-');
  gitInit(dir);
  assert.equal(run(['init', dir]).status, 0);
  const target = join(dir, '.claude/skills/tidykeep/SKILL.md');
  writeFileSync(target, `${readFileSync(target, 'utf8')}\n<!-- 我改了 -->\n`);

  const r = run(['uninstall', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /内容与发布版本不一致/);
  assert.ok(existsSync(target), '被改过的文件必须保留');
});

test('CLI:拒绝已删除的旧子命令与旧选项', () => {
  const dir = makeTempDir('tk-cli-');
  for (const args of [['doctor', dir], ['status', dir], ['enable-githooks', dir]]) {
    const r = run(args);
    assert.equal(r.status, 1, `${args[0]} 应已不存在`);
    assert.match(r.stderr, /未知命令/);
  }
  const legacy = run(['init', dir, '--agents', 'claude']);
  assert.equal(legacy.status, 1);
  assert.match(legacy.stderr, /不支持选项|无效命令行参数/);
});
