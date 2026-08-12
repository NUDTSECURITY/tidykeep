// 适配器端到端:以真实子进程执行 hook.mjs,灌 stdin fixture,断言输出与退出码。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_SRC = join(HERE, '..', '..', 'payload', 'runtime');

/** 建一个装好 runtime 的临时项目(可选 git init) */
function makeProject({ git = false, config = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tk-hook-'));
  mkdirSync(join(root, '.tidykeep', '.state'), { recursive: true });
  mkdirSync(join(root, '.tmp'), { recursive: true });
  cpSync(RUNTIME_SRC, join(root, '.tidykeep', 'runtime'), { recursive: true });
  if (config) writeFileSync(join(root, '.tidykeep', 'config.jsonc'), JSON.stringify(config));
  if (git) {
    for (const args of [['init', '-q'], ['config', 'user.name', 't'], ['config', 'user.email', 't@t']]) {
      execFileSync('git', ['-C', root, ...args]);
    }
  }
  return root;
}

function runHook(root, flavor, payload, env = {}) {
  return spawnSync('node', [join(root, '.tidykeep', 'runtime', 'hook.mjs'), flavor], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env },
  });
}

const claudeWrite = (root, file) => ({ tool_name: 'Write', tool_input: { file_path: file }, cwd: root, session_id: 's1' });

// ---------- claude-pretooluse ----------

test('claude: Write 系统 /tmp → deny JSON', () => {
  const root = makeProject();
  const r = runHook(root, 'claude-pretooluse', claudeWrite(root, '/tmp/probe.sh'));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('.tmp'));
});

test('claude: Write 正常文件 → 静默放行', () => {
  const root = makeProject();
  const r = runHook(root, 'claude-pretooluse', claudeWrite(root, join(root, 'ok.py')));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('claude: Write stale 命名 → deny;草稿区内 → 放行', () => {
  const root = makeProject();
  const deny = runHook(root, 'claude-pretooluse', claudeWrite(root, join(root, 'train_v2.py')));
  assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const ok = runHook(root, 'claude-pretooluse', claudeWrite(root, join(root, '.tmp', 'x_old.py')));
  assert.equal(ok.stdout.trim(), '');
});

test('claude: Edit 已存在的 stale 文件 → 放行(避免自锁);Edit 新建 stale → deny', () => {
  const root = makeProject();
  writeFileSync(join(root, 'legacy_old.py'), 'x');
  const editExisting = runHook(root, 'claude-pretooluse', { tool_name: 'Edit', tool_input: { file_path: join(root, 'legacy_old.py') }, cwd: root });
  assert.equal(editExisting.stdout.trim(), '');
  const editNew = runHook(root, 'claude-pretooluse', { tool_name: 'Edit', tool_input: { file_path: join(root, 'ghost_old.py') }, cwd: root });
  assert.equal(JSON.parse(editNew.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('claude: Bash 写系统 tmp → deny;畸形 stdin → 静默放行', () => {
  const root = makeProject();
  const r = runHook(root, 'claude-pretooluse', { tool_name: 'Bash', tool_input: { command: 'echo x > /tmp/leak.txt' }, cwd: root });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const bad = spawnSync('node', [join(root, '.tidykeep', 'runtime', 'hook.mjs'), 'claude-pretooluse'], { input: '不是json', encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout.trim(), '');
});

test('未启用 tidykeep 的项目(找不到 .tidykeep)→ 放行', () => {
  const root = makeProject();
  const bare = mkdtempSync(join(tmpdir(), 'tk-bare-'));
  const r = spawnSync('node', [join(root, '.tidykeep', 'runtime', 'hook.mjs'), 'claude-pretooluse'], {
    input: JSON.stringify(claudeWrite(bare, '/tmp/x.sh')),
    encoding: 'utf8',
    cwd: bare,
    env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

// ---------- codex-pretooluse ----------

test('codex: apply_patch Add stale 文件 → deny;Update 原文件 → 放行', () => {
  const root = makeProject();
  const patch = (verb, f) => `*** Begin Patch\n*** ${verb}: ${f}\n+x\n*** End Patch`;
  const deny = runHook(root, 'codex-pretooluse', { tool_name: 'apply_patch', tool_input: { command: patch('Add File', 'src/train_v2.py') }, cwd: root });
  assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const ok = runHook(root, 'codex-pretooluse', { tool_name: 'apply_patch', tool_input: { command: patch('Update File', 'src/train.py') }, cwd: root });
  assert.equal(ok.stdout.trim(), '');
  // command 为 ["apply_patch", "<patch>"] 数组形态
  const denyArr = runHook(root, 'codex-pretooluse', { tool_name: 'apply_patch', tool_input: { command: ['apply_patch', patch('Add File', 'b_old.py')] }, cwd: root });
  assert.equal(JSON.parse(denyArr.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('codex: shell 命令 mktemp → deny', () => {
  const root = makeProject();
  const r = runHook(root, 'codex-pretooluse', { tool_name: 'Bash', tool_input: { command: 'f=$(mktemp) && echo $f' }, cwd: root });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

// ---------- kimi-pretooluse ----------

test('kimi: deny → exit 2 且 stderr 带理由;字段名防御式解析', () => {
  const root = makeProject();
  const r = runHook(root, 'kimi-pretooluse', { tool: 'WriteFile', tool_input: { path: join(root, 'train_v2.py') }, cwd: root });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('train_v2.py'));
  const ok = runHook(root, 'kimi-pretooluse', { tool_name: 'shell', tool_input: { command: 'ls -la' }, cwd: root });
  assert.equal(ok.status, 0);
});

// ---------- stop(三家) ----------

function dirtyRepo() {
  const root = makeProject({ git: true });
  writeFileSync(join(root, 'LEDGER.md'), '# 台账\n');
  writeFileSync(join(root, 'code.py'), 'print(1)\n');
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'base commit for fixture']);
  writeFileSync(join(root, 'code.py'), 'print(2)\n'); // 改代码不改台账
  return root;
}

test('claude-stop: 改码未同步台账 → block 一次;第二次放行(会话标记);stop_hook_active 放行', () => {
  const root = dirtyRepo();
  const p = { cwd: root, session_id: 'sx' };
  const r1 = runHook(root, 'claude-stop', p);
  const out = JSON.parse(r1.stdout);
  assert.equal(out.decision, 'block');
  assert.ok(out.reason.includes('LEDGER'));
  const r2 = runHook(root, 'claude-stop', p);
  assert.equal(r2.stdout.trim(), '');
  const r3 = runHook(root, 'claude-stop', { cwd: root, session_id: 'sy', stop_hook_active: true });
  assert.equal(r3.stdout.trim(), '');
});

test('claude-stop: 台账已同步 → 放行;warn 模式 → additionalContext', () => {
  const root = dirtyRepo();
  writeFileSync(join(root, 'LEDGER.md'), '# 台账\n- 更新\n');
  assert.equal(runHook(root, 'claude-stop', { cwd: root, session_id: 'sz' }).stdout.trim(), '');
  const warnRoot = dirtyRepo();
  writeFileSync(join(warnRoot, '.tidykeep', 'config.jsonc'), '{ "ENFORCE_LEDGER": "warn" }');
  const r = runHook(warnRoot, 'claude-stop', { cwd: warnRoot, session_id: 'sw' });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.additionalContext.includes('LEDGER'), true);
});

test('claude-stop: 草稿区残留 → block 并点名文件', () => {
  const root = makeProject({ git: true });
  writeFileSync(join(root, '.tmp', 'leftover.sh'), 'x');
  const r = runHook(root, 'claude-stop', { cwd: root, session_id: 'sl' });
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.ok(out.reason.includes('leftover.sh'));
});

test('kimi-stop: block → exit 2 + stderr', () => {
  const root = dirtyRepo();
  const r = runHook(root, 'kimi-stop', { cwd: root, session_id: 'k1' });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('LEDGER'));
});

test('codex-stop: 与 claude 同构 block JSON', () => {
  const root = dirtyRepo();
  const r = runHook(root, 'codex-stop', { cwd: root, session_id: 'c1' });
  assert.equal(JSON.parse(r.stdout).decision, 'block');
});

test('codex-stop warn 模式 → systemMessage(Codex Stop 官方不支持 additionalContext)', () => {
  const root = dirtyRepo();
  writeFileSync(join(root, '.tidykeep', 'config.jsonc'), '{ "ENFORCE_LEDGER": "warn" }');
  const r = runHook(root, 'codex-stop', { cwd: root, session_id: 'cw' });
  const out = JSON.parse(r.stdout);
  assert.ok(out.systemMessage.includes('LEDGER'));
  assert.equal(out.hookSpecificOutput, undefined);
});
