// doctor 端到端:检测执行位缺失 / CRLF 污染 / runtime 探针 / 版本漂移,--fix 修复安全项。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'tidykeep.mjs');

function makeInstalledRepo() {
  const base = mkdtempSync(join(tmpdir(), 'tk-doc-home-'));
  const env = {
    ...process.env,
    KIMI_CODE_HOME: join(base, '.kimi-code'),
    TIDYKEEP_USER_DIR: join(base, '.tidykeep'),
    CLAUDE_PROJECT_DIR: '',
  };
  const root = mkdtempSync(join(tmpdir(), 'tk-doc-'));
  execFileSync('git', ['-C', root, 'init', '-q']);
  const r = spawnSync('node', [BIN, 'init', root], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return { root, env };
}

test('doctor: 健康安装 → 全部通过,exit 0', () => {
  const { root, env } = makeInstalledRepo();
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('✔'));
  assert.ok(!r.stdout.includes('✖'), r.stdout);
});

test('doctor: 执行位缺失与 CRLF 污染被检出,--fix 修复', () => {
  const { root, env } = makeInstalledRepo();
  const shim = join(root, '.tidykeep', 'githooks', 'pre-commit');
  chmodSync(shim, 0o644);
  writeFileSync(shim, readFileSync(shim, 'utf8').replaceAll('\n', '\r\n'));
  const r1 = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r1.status, 0, '有问题时应非零退出');
  assert.ok(r1.stdout.includes('✖'));
  const r2 = spawnSync('node', [BIN, 'doctor', root, '--fix'], { encoding: 'utf8', env });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.ok(!readFileSync(shim, 'utf8').includes('\r'), 'CRLF 应被修复');
  assert.ok(statSync(shim).mode & 0o100, '执行位应被补上');
});

test('doctor: 未安装项目 → 明确报告,exit 非零', () => {
  const root = mkdtempSync(join(tmpdir(), 'tk-doc-bare-'));
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.ok((r.stdout + r.stderr).includes('未安装'));
});
