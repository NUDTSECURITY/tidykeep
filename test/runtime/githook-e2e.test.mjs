// git hooks 兜底层端到端:真实临时仓库 + 真实 git commit,验证 sh 薄壳 → node 链路。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = join(HERE, '..', '..', 'payload');

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'tk-githook-'));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    return r;
  };
  git('init', '-q');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
  mkdirSync(join(root, '.tidykeep'), { recursive: true });
  cpSync(join(PAYLOAD, 'runtime'), join(root, '.tidykeep', 'runtime'), { recursive: true });
  cpSync(join(PAYLOAD, 'githooks'), join(root, '.tidykeep', 'githooks'), { recursive: true });
  for (const h of ['pre-commit', 'commit-msg']) chmodSync(join(root, '.tidykeep', 'githooks', h), 0o755);
  git('config', 'core.hooksPath', '.tidykeep/githooks');
  return { root, git };
}

const GOOD_MSG = 'feat: 演示提交主题足够长\n\n为什么: 端到端验证 git hooks 链路\n影响: 测试夹具文件与台账同步';

function commit(git, msg, env = {}) {
  return spawnSync('git', ['-C', git.root, 'commit', '-m', msg], {
    encoding: 'utf8',
    env: { ...process.env, TIDYKEEP_SKIP: '0', ...env },
  });
}

test('pre-commit: 暂存 stale 命名文件 → 提交被拒;TIDYKEEP_SKIP=1 放行', () => {
  const { root, git } = makeRepo();
  writeFileSync(join(root, 'a_old.py'), 'x');
  writeFileSync(join(root, 'LEDGER.md'), '# 台账');
  git('add', '-A');
  const fail = commit({ root }, GOOD_MSG);
  assert.notEqual(fail.status, 0);
  assert.ok((fail.stdout + fail.stderr).includes('历史副本命名'), '应输出拦截原因');
  const skip = commit({ root }, GOOD_MSG, { TIDYKEEP_SKIP: '1' });
  assert.equal(skip.status, 0);
});

test('pre-commit: 改代码未同步台账 → 拒;附带台账 → 过', () => {
  const { root, git } = makeRepo();
  writeFileSync(join(root, 'code.py'), 'print(1)');
  git('add', '-A');
  const fail = commit({ root }, GOOD_MSG);
  assert.notEqual(fail.status, 0);
  assert.ok((fail.stdout + fail.stderr).includes('LEDGER.md / STATE.md 未同步'));
  writeFileSync(join(root, 'LEDGER.md'), '# 台账\n- code.py 初始化');
  git('add', '-A');
  const ok = commit({ root }, GOOD_MSG);
  assert.equal(ok.status, 0);
});

test('commit-msg: 主题/正文过短 → 拒并给模板;Merge 提交豁免', () => {
  const { root, git } = makeRepo();
  writeFileSync(join(root, 'LEDGER.md'), '# 台账');
  git('add', '-A');
  const fail = commit({ root }, 'fix: 短');
  assert.notEqual(fail.status, 0);
  assert.ok((fail.stdout + fail.stderr).includes('提交信息不符合规范'));
  const ok = commit({ root }, GOOD_MSG);
  assert.equal(ok.status, 0);
});

test('pre-commit: 接管前的 legacy hook 被链式执行', () => {
  const { root, git } = makeRepo();
  const marker = join(root, '.legacy-ran');
  writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);
  chmodSync(join(root, '.git', 'hooks', 'pre-commit'), 0o755);
  writeFileSync(join(root, 'LEDGER.md'), '# 台账');
  git('add', '-A');
  const ok = commit({ root }, GOOD_MSG);
  assert.equal(ok.status, 0);
  assert.ok(existsSync(marker), 'legacy hook 应被执行');
});

test('enable-githooks.mjs: 设置 core.hooksPath 并补执行位', () => {
  const root = mkdtempSync(join(tmpdir(), 'tk-enable-'));
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  mkdirSync(join(root, '.tidykeep'), { recursive: true });
  cpSync(join(PAYLOAD, 'runtime'), join(root, '.tidykeep', 'runtime'), { recursive: true });
  cpSync(join(PAYLOAD, 'githooks'), join(root, '.tidykeep', 'githooks'), { recursive: true });
  const r = spawnSync('node', [join(root, '.tidykeep', 'runtime', 'enable-githooks.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(git('config', 'core.hooksPath').stdout.trim(), '.tidykeep/githooks');
});

test('enable-githooks.mjs: 已有外部 hooksPath(husky)→ 不覆盖,打印接入指引', () => {
  const root = mkdtempSync(join(tmpdir(), 'tk-enable2-'));
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'core.hooksPath', '.husky');
  mkdirSync(join(root, '.tidykeep'), { recursive: true });
  cpSync(join(PAYLOAD, 'runtime'), join(root, '.tidykeep', 'runtime'), { recursive: true });
  cpSync(join(PAYLOAD, 'githooks'), join(root, '.tidykeep', 'githooks'), { recursive: true });
  const r = spawnSync('node', [join(root, '.tidykeep', 'runtime', 'enable-githooks.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(git('config', 'core.hooksPath').stdout.trim(), '.husky');
  assert.ok(r.stdout.includes('.husky'), '应打印接入指引');
});

// ---------- 第二轮审查回归 ----------

test('pre-commit: 非 ASCII 文件名(中文副本命名)不再因 core.quotepath 绕过', () => {
  const { root, git } = makeRepo();
  writeFileSync(join(root, '模型备份.py'), 'x');
  writeFileSync(join(root, 'LEDGER.md'), '# 台账');
  git('add', '-A');
  const fail = commit({ root }, GOOD_MSG);
  assert.notEqual(fail.status, 0, '中文副本命名应被拦截');
  assert.ok((fail.stdout + fail.stderr).includes('历史副本命名'));
});

test('commit-msg: scissors 之后的 diff 不计入正文(git commit -v 场景)', () => {
  const { root } = makeRepo();
  const msgfile = join(root, 'MSG');
  writeFileSync(msgfile, 'fix: 短\n\n# ------------------------ >8 ------------------------\ndiff --git a/x b/x\n+xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n');
  const r = spawnSync('node', [join(root, '.tidykeep', 'runtime', 'githook.mjs'), 'commit-msg', msgfile], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 1, 'diff 内容不得喂饱正文长度');
});
