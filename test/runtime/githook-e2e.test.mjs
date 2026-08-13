// git hooks 兜底层端到端:真实临时仓库 + 真实 git commit,验证 sh 薄壳 → node 链路。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, writeFileSync, readFileSync, cpSync, chmodSync, existsSync, symlinkSync,
  statSync, unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempDir, isolatedEnv } from '../helpers/temp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = join(HERE, '..', '..', 'payload');
const localDate = (date = new Date()) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');
const TODAY = localDate();

function makeRepo() {
  const root = makeTempDir('githook-');
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
    env: isolatedEnv({ TIDYKEEP_SKIP: '0', ...env }),
    timeout: 15000,
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
  assert.ok((fail.stdout + fail.stderr).includes('LEDGER.md 缺少逐文件收尾证据'));
  writeFileSync(join(root, 'LEDGER.md'), `# 台账\n\n## code.py\n- 最后核对: ${TODAY}\n- DONE:\n  - [x] ${TODAY} 初始化实现\n`);
  git('add', '-A');
  const ok = commit({ root }, GOOD_MSG);
  assert.equal(ok.status, 0);
});

test('pre-commit: LEDGER 改动必须逐文件覆盖本次暂存变更', () => {
  const { root, git } = makeRepo();
  writeFileSync(join(root, 'code.py'), 'print(1)');
  writeFileSync(join(root, 'LEDGER.md'), `## other.py\n- 最后核对: ${TODAY}\n- DONE:\n  - [x] ${TODAY} 无关条目\n`);
  git('add', '-A');
  const missing = commit({ root }, GOOD_MSG);
  assert.notEqual(missing.status, 0);
  assert.ok((missing.stdout + missing.stderr).includes('code.py'));
  writeFileSync(join(root, 'LEDGER.md'), `## code.py\n- 最后核对: ${TODAY}\n- DONE:\n  - [x] ${TODAY} 覆盖本次实现\n`);
  git('add', '-A');
  assert.equal(commit({ root }, GOOD_MSG).status, 0);
});

test('pre-commit: rename 同时要求旧路径删除与新路径新增都有台账覆盖', () => {
  const { root, git } = makeRepo();
  writeFileSync(join(root, 'old.py'), 'print(1)\n');
  writeFileSync(join(root, 'LEDGER.md'), '## old.py\n- 最后核对: 2000-01-01\n- DONE:\n  - [x] 2000-01-01 初始实现\n');
  git('add', '-A');
  assert.equal(commit({ root }, GOOD_MSG, { TIDYKEEP_SKIP: '1' }).status, 0);

  git('mv', 'old.py', 'new.py');
  writeFileSync(join(root, 'LEDGER.md'), `## old.py\n- 最后核对: 2000-01-01\n- DONE:\n  - [x] 2000-01-01 初始实现\n\n## new.py\n- 最后核对: ${TODAY}\n- DONE:\n  - [x] ${TODAY} 重命名后的实现\n`);
  git('add', '-A');
  const missingOld = commit({ root }, GOOD_MSG);
  assert.notEqual(missingOld.status, 0);
  assert.ok((missingOld.stdout + missingOld.stderr).includes('old.py'));

  writeFileSync(join(root, 'LEDGER.md'), `## new.py\n- 最后核对: ${TODAY}\n- DONE:\n  - [x] ${TODAY} 重命名后的实现\n`);
  git('add', '-A');
  assert.equal(commit({ root }, GOOD_MSG).status, 0);
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

test('TIDYKEEP_SKIP 只跳过 tidykeep,仍执行并尊重 legacy 失败', () => {
  const { root, git } = makeRepo();
  const marker = join(root, '.legacy-ran-on-skip');
  writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch "${marker}"\nexit 7\n`);
  chmodSync(join(root, '.git', 'hooks', 'pre-commit'), 0o755);
  writeFileSync(join(root, 'a_old.py'), 'x');
  writeFileSync(join(root, 'LEDGER.md'), '# 台账');
  git('add', '-A');
  const r = commit({ root }, GOOD_MSG, { TIDYKEEP_SKIP: '1' });
  assert.notEqual(r.status, 0);
  assert.ok(existsSync(marker));
});

test('legacy hook 直接执行并尊重 shebang;无执行位则不运行', { skip: process.platform === 'win32' }, () => {
  const { root, git } = makeRepo();
  const marker = join(root, '.legacy-node-ran');
  const legacy = join(root, '.git', 'hooks', 'pre-commit');
  writeFileSync(legacy, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'yes');\n`);
  chmodSync(legacy, 0o755);
  writeFileSync(join(root, 'LEDGER.md'), '# 台账');
  git('add', '-A');
  const direct = commit({ root }, GOOD_MSG);
  assert.equal(direct.status, 0, direct.stdout + direct.stderr);
  assert.ok(existsSync(marker));

  const { root: root2, git: git2 } = makeRepo();
  const marker2 = join(root2, '.legacy-nonexec-ran');
  const legacy2 = join(root2, '.git', 'hooks', 'pre-commit');
  writeFileSync(legacy2, `#!/bin/sh\ntouch "${marker2}"\n`);
  chmodSync(legacy2, 0o644);
  writeFileSync(join(root2, 'LEDGER.md'), '# 台账');
  git2('add', '-A');
  assert.equal(commit({ root: root2 }, GOOD_MSG).status, 0);
  assert.equal(existsSync(marker2), false);
});

test('linked worktree 从 git common dir 链式执行 legacy hook', () => {
  const { root, git } = makeRepo();
  writeFileSync(join(root, 'LEDGER.md'), '# 台账\n');
  git('add', '-A');
  assert.equal(commit({ root }, GOOD_MSG).status, 0);
  const parent = makeTempDir('worktree-');
  const linked = join(parent, 'linked');
  const added = git('worktree', 'add', '--detach', linked, 'HEAD');
  assert.equal(added.status, 0, added.stderr);

  const marker = join(parent, 'common-legacy-ran');
  const legacy = join(root, '.git', 'hooks', 'pre-commit');
  writeFileSync(legacy, `#!/bin/sh\ntouch "${marker}"\n`);
  chmodSync(legacy, 0o755);
  writeFileSync(join(linked, 'LEDGER.md'), '# 台账\nlinked worktree 更新\n');
  const linkedGit = (...args) => spawnSync('git', ['-C', linked, ...args], { encoding: 'utf8' });
  linkedGit('add', '-A');
  const result = commit({ root: linked }, GOOD_MSG);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(existsSync(marker));
});

test('外部 hooksPath 链入 tidykeep 时不反向调用 common-dir hook 造成递归', () => {
  const { root, git } = makeRepo();
  git('config', 'core.hooksPath', '.git/hooks');
  const external = join(root, '.git', 'hooks', 'pre-commit');
  writeFileSync(external, `#!/bin/sh\nexec sh ${JSON.stringify(join(root, '.tidykeep', 'githooks', 'pre-commit'))} "$@"\n`);
  chmodSync(external, 0o755);
  writeFileSync(join(root, 'LEDGER.md'), '# 台账\n');
  git('add', '-A');
  const result = commit({ root }, GOOD_MSG);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.error, undefined);
});

test('enable-githooks.mjs: 设置 core.hooksPath 并补执行位', () => {
  const root = makeTempDir('enable-');
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  mkdirSync(join(root, '.tidykeep'), { recursive: true });
  cpSync(join(PAYLOAD, 'runtime'), join(root, '.tidykeep', 'runtime'), { recursive: true });
  cpSync(join(PAYLOAD, 'githooks'), join(root, '.tidykeep', 'githooks'), { recursive: true });
  const r = spawnSync('node', [join(root, '.tidykeep', 'runtime', 'enable-githooks.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(git('config', 'core.hooksPath').stdout.trim(), '.tidykeep/githooks');
});

test('enable-githooks.mjs: 外部 hooksPath 未完整链入则非零，补齐后成功', () => {
  const root = makeTempDir('enable2-');
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'core.hooksPath', '.husky');
  mkdirSync(join(root, '.tidykeep'), { recursive: true });
  cpSync(join(PAYLOAD, 'runtime'), join(root, '.tidykeep', 'runtime'), { recursive: true });
  cpSync(join(PAYLOAD, 'githooks'), join(root, '.tidykeep', 'githooks'), { recursive: true });
  mkdirSync(join(root, '.husky'));
  writeFileSync(join(root, '.husky', 'pre-commit'), '# sh .tidykeep/githooks/pre-commit\n');
  writeFileSync(join(root, '.husky', 'commit-msg'),
    'if false; then\n sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/commit-msg" "$@" || exit $?\nfi\n');
  const script = join(root, '.tidykeep', 'runtime', 'enable-githooks.mjs');
  const r = spawnSync('node', [script], { cwd: root, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.equal(git('config', 'core.hooksPath').stdout.trim(), '.husky');
  assert.ok(r.stdout.includes('.husky'), '应打印接入指引');
  for (const name of ['pre-commit', 'commit-msg']) {
    writeFileSync(join(root, '.husky', name),
      `exec sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/${name}" "$@"\n`);
  }
  const ready = spawnSync('node', [script], { cwd: root, encoding: 'utf8' });
  assert.equal(ready.status, 0, ready.stdout + ready.stderr);
  assert.ok(ready.stdout.includes('已完整链入'));
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

test('commit-msg: 遵守 core.commentChar,注释不能喂饱正文', () => {
  const { root, git } = makeRepo();
  git('config', 'core.commentChar', ';');
  const msgfile = join(root, 'MSG');
  writeFileSync(msgfile, 'fix: 修复一个足够长的问题主题\n\n; 这是一段足够长但属于注释的文字,不能计入正文长度\n');
  const r = spawnSync('node', [join(root, '.tidykeep', 'runtime', 'githook.mjs'), 'commit-msg', msgfile], {
    cwd: root, encoding: 'utf8', env: isolatedEnv(),
  });
  assert.equal(r.status, 1);
});

test('commit-msg: core.commentChar=auto 传给 runtime 并从 Git 模板推断', () => {
  const { root, git } = makeRepo();
  git('config', 'core.commentChar', 'auto');
  const msgfile = join(root, 'MSG');
  writeFileSync(msgfile, [
    'fix: 修复一个足够长的问题主题',
    '',
    '为什么: x',
    '影响: y',
    '; Please enter the commit message for your changes.',
    '; 这是一段足够长但属于模板注释的文字,不能计入正文长度',
    ';',
  ].join('\n'));
  const r = spawnSync('node', [join(root, '.tidykeep', 'runtime', 'githook.mjs'), 'commit-msg', msgfile], {
    cwd: root, encoding: 'utf8', env: isolatedEnv(),
  });
  assert.equal(r.status, 1, 'auto 推断出的模板注释不得喂饱正文长度');
});

test('githook: git/index 或内部读取失败时 fail-closed', () => {
  const { root } = makeRepo();
  const badIndex = root; // 目录不能作为 Git index,确保 diff --cached 明确失败
  const pre = spawnSync('node', [join(root, '.tidykeep', 'runtime', 'githook.mjs'), 'pre-commit'], {
    cwd: root, encoding: 'utf8', env: isolatedEnv({ GIT_INDEX_FILE: badIndex }),
  });
  assert.notEqual(pre.status, 0);
  const msg = spawnSync('node', [join(root, '.tidykeep', 'runtime', 'githook.mjs'), 'commit-msg', join(root, 'missing-message')], {
    cwd: root, encoding: 'utf8', env: isolatedEnv(),
  });
  assert.notEqual(msg.status, 0);
});

test('shell shim: git 或 node 缺失均 fail-closed', { skip: process.platform === 'win32' }, () => {
  const { root } = makeRepo();
  const hook = join(root, '.tidykeep', 'githooks', 'pre-commit');
  const noTools = spawnSync('/bin/sh', [hook], { cwd: root, encoding: 'utf8', env: { PATH: '' } });
  assert.notEqual(noTools.status, 0);

  const bin = makeTempDir('path-');
  symlinkSync('/usr/bin/git', join(bin, 'git'));
  const noNode = spawnSync('/bin/sh', [hook], { cwd: root, encoding: 'utf8', env: { PATH: bin } });
  assert.notEqual(noNode.status, 0);
});

test('enable-githooks: git config 写入失败时非零退出且不谎报成功', { skip: process.platform === 'win32' }, () => {
  const root = makeTempDir('enable-fail-');
  mkdirSync(join(root, '.tidykeep', 'runtime'), { recursive: true });
  cpSync(join(PAYLOAD, 'runtime', 'enable-githooks.mjs'), join(root, '.tidykeep', 'runtime', 'enable-githooks.mjs'));
  cpSync(join(PAYLOAD, 'githooks'), join(root, '.tidykeep', 'githooks'), { recursive: true });
  mkdirSync(join(root, '.git'));
  const bin = makeTempDir('fake-bin-');
  const fakeGit = join(bin, 'git');
  writeFileSync(fakeGit, '#!/bin/sh\ncase "$*" in\n  *"rev-parse --show-toplevel"*) pwd; exit 0;;\n  *"rev-parse --git-dir"*) echo .git; exit 0;;\n  *"rev-parse --git-common-dir"*) echo .git; exit 0;;\n  *"config core.hooksPath .tidykeep/githooks"*) echo "simulated write denial" >&2; exit 9;;\n  *"config core.hooksPath"*) exit 1;;\nesac\nexit 1\n');
  chmodSync(fakeGit, 0o755);
  const r = spawnSync(process.execPath, [join(root, '.tidykeep', 'runtime', 'enable-githooks.mjs')], {
    cwd: root, encoding: 'utf8', env: isolatedEnv({ PATH: `${bin}:${process.env.PATH}` }),
  });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout.includes('已启用'), false);
  assert.ok(r.stderr.includes('simulated write denial'), r.stdout + r.stderr);
});

test('enable-githooks: vendored runtime 在父仓库子目录时拒绝修改父 hooksPath', () => {
  const parent = makeTempDir('enable-parent-');
  const git = (...args) => spawnSync('git', ['-C', parent, ...args], { encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  git('config', 'core.hooksPath', '.parent-hooks');
  const child = join(parent, 'packages', 'child');
  mkdirSync(join(child, '.tidykeep'), { recursive: true });
  cpSync(join(PAYLOAD, 'runtime'), join(child, '.tidykeep', 'runtime'), { recursive: true });
  cpSync(join(PAYLOAD, 'githooks'), join(child, '.tidykeep', 'githooks'), { recursive: true });
  const result = spawnSync(process.execPath, [join(child, '.tidykeep', 'runtime', 'enable-githooks.mjs')], {
    cwd: child, encoding: 'utf8', env: isolatedEnv(),
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok((result.stdout + result.stderr).includes('Git 仓库子目录'));
  assert.equal(git('config', 'core.hooksPath').stdout.trim(), '.parent-hooks');
});

test('enable-githooks: linked worktree 拒绝修改主仓库共享 hooksPath', {
  skip: process.platform === 'win32',
}, () => {
  const { root, git } = makeRepo();
  writeFileSync(join(root, 'LEDGER.md'), '# ledger\n');
  git('add', '-A');
  git('config', 'core.hooksPath', '.main-hooks');
  assert.equal(git('commit', '-qm', 'seed').status, 0);
  const linked = join(makeTempDir('enable-linked-parent-'), 'linked');
  const added = git('worktree', 'add', '--detach', linked, 'HEAD');
  assert.equal(added.status, 0, added.stderr);

  const result = spawnSync(process.execPath, [join(linked, '.tidykeep', 'runtime', 'enable-githooks.mjs')], {
    cwd: linked, encoding: 'utf8', env: isolatedEnv(),
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok((result.stdout + result.stderr).includes('linked worktree'));
  assert.ok((result.stdout + result.stderr).includes(root));
  assert.equal(git('config', 'core.hooksPath').stdout.trim(), '.main-hooks');
});

test('enable-githooks: githook symlink 异常非零且不修改外部 sentinel', {
  skip: process.platform === 'win32',
}, () => {
  const { root, git } = makeRepo();
  git('config', 'core.hooksPath', '.main-hooks');
  const sentinel = join(makeTempDir('enable-hook-outside-'), 'sentinel');
  writeFileSync(sentinel, '#!/bin/sh\nexit 0\n');
  chmodSync(sentinel, 0o644);
  const before = readFileSync(sentinel);
  const beforeMode = statSync(sentinel).mode & 0o777;
  const hook = join(root, '.tidykeep', 'githooks', 'pre-commit');
  unlinkSync(hook);
  symlinkSync(sentinel, hook);

  const result = spawnSync(process.execPath, [join(root, '.tidykeep', 'runtime', 'enable-githooks.mjs')], {
    cwd: root, encoding: 'utf8', env: isolatedEnv(),
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok((result.stdout + result.stderr).includes('symlink'));
  assert.deepEqual(readFileSync(sentinel), before);
  assert.equal(statSync(sentinel).mode & 0o777, beforeMode);
  assert.equal(git('config', 'core.hooksPath').stdout.trim(), '.main-hooks');
});
