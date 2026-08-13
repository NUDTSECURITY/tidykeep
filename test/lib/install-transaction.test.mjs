import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyInstallTransaction, prepareInstallTransaction, recoverInstallTransaction,
} from '../../src/lib/install-transaction.mjs';
import { makeTempDir } from '../helpers/temp.mjs';

const metadata = () => ({
  toolVersion: '0.1.0', runtimeVersion: '0.1.0', agents: ['claude'],
});

function managedRecord(hash) {
  return { ownership: 'created', hash, kind: 'managed', managed: true };
}

test('事务完整 preflight:后一个 stage 损坏时前一个目标字节不变', () => {
  const root = makeTempDir('txn-stage-corrupt-');
  mkdirSync(join(root, '.tidykeep', 'runtime'), { recursive: true });
  const first = '.tidykeep/runtime/core.mjs';
  const second = '.tidykeep/runtime/config.mjs';
  writeFileSync(join(root, first), 'old-first\n');
  writeFileSync(join(root, second), 'old-second\n');
  const journal = prepareInstallTransaction(root, {
    entries: [
      { rel: first, operation: 'write', data: 'new-first\n', mode: 0o755, managed: true, before: Buffer.from('old-first\n') },
      { rel: second, operation: 'write', data: 'new-second\n', mode: 0o755, managed: true, before: Buffer.from('old-second\n') },
    ],
    records: [], metadata: metadata(),
  });
  writeFileSync(join(root, '.tidykeep', '.install-transaction', 'stage', second), 'corrupt\n');
  assert.throws(() => applyInstallTransaction(root, journal), /staging/);
  assert.equal(readFileSync(join(root, first), 'utf8'), 'old-first\n');
  assert.equal(readFileSync(join(root, second), 'utf8'), 'old-second\n');
});

test('prepare 在创建 staging 前核对全部 before 快照，规划后并发编辑零覆盖', () => {
  const root = makeTempDir('txn-before-drift-');
  writeFileSync(join(root, 'AGENTS.md'), 'planned\n');
  const plan = {
    entries: [{
      rel: 'AGENTS.md', operation: 'write', data: 'tool output\n', mode: 0o644,
      managed: false, before: Buffer.from('planned\n'),
    }],
    records: [], metadata: metadata(),
  };
  writeFileSync(join(root, 'AGENTS.md'), 'user concurrent edit\n');
  assert.throws(() => prepareInstallTransaction(root, plan), /开始前文件已变化/);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), 'user concurrent edit\n');
  assert.equal(existsSync(join(root, '.tidykeep', '.install-transaction')), false);
});

test('不可信 journal 无权删除或覆盖普通项目源码', () => {
  for (const operation of ['delete', 'write']) {
    const root = makeTempDir(`txn-hostile-${operation}-`);
    const sentinel = join(root, 'src', 'app.js');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, '.tidykeep', '.install-transaction', 'stage', 'src'), { recursive: true });
    writeFileSync(sentinel, 'user source\n');
    if (operation === 'write') writeFileSync(
      join(root, '.tidykeep', '.install-transaction', 'stage', 'src', 'app.js'), 'attacker\n',
    );
    const beforeHash = '0'.repeat(64);
    const afterHash = operation === 'write' ? '1'.repeat(64) : null;
    writeFileSync(join(root, '.tidykeep', '.install-transaction', 'journal.json'), JSON.stringify({
      version: 1,
      entries: [{
        rel: 'src/app.js', operation, beforeExists: true, beforeHash,
        afterHash, mode: operation === 'write' ? 0o644 : null, managed: false,
      }],
      records: [], metadata: metadata(),
    }));
    assert.throws(() => recoverInstallTransaction(root), /无权改写项目路径/);
    assert.equal(readFileSync(sentinel, 'utf8'), 'user source\n');
  }
});

test('不可信 journal 无权把普通项目文件登记为 managed', () => {
  const root = makeTempDir('txn-hostile-record-');
  mkdirSync(join(root, '.tidykeep', '.install-transaction', 'stage'), { recursive: true });
  writeFileSync(join(root, '.tidykeep', '.install-transaction', 'journal.json'), JSON.stringify({
    version: 1, entries: [],
    records: [{ rel: 'src/app.js', record: managedRecord('a'.repeat(64)) }],
    metadata: metadata(),
  }));
  assert.throws(() => recoverInstallTransaction(root), /无权更新 manifest 路径/);
  assert.equal(existsSync(join(root, '.tidykeep', 'manifest.json')), false);
});

test('journal 缺失仅清理精确 staging，未知内容 fail-closed 保留', () => {
  const root = makeTempDir('txn-uncommitted-');
  const txn = join(root, '.tidykeep', '.install-transaction');
  mkdirSync(join(txn, 'stage', '.tidykeep'), { recursive: true });
  writeFileSync(join(txn, 'stage', '.tidykeep', 'config.jsonc'), '{}\n');
  assert.equal(recoverInstallTransaction(root), false);
  assert.equal(existsSync(txn), false);

  mkdirSync(join(txn, 'stage'), { recursive: true });
  writeFileSync(join(txn, 'user-note'), 'keep me\n');
  assert.throws(() => recoverInstallTransaction(root), /未知内容/);
  assert.equal(readFileSync(join(txn, 'user-note'), 'utf8'), 'keep me\n');
});

test('journal record 必须与同路径 write/delete 一一绑定', () => {
  const root = makeTempDir('txn-record-only-');
  mkdirSync(join(root, '.tidykeep', '.install-transaction', 'stage'), { recursive: true });
  writeFileSync(join(root, '.tidykeep', '.install-transaction', 'journal.json'), JSON.stringify({
    version: 1, entries: [],
    records: [{
      rel: '.tidykeep/runtime/core.mjs',
      record: managedRecord('a'.repeat(64)),
    }],
    metadata: metadata(),
  }));
  assert.throws(() => recoverInstallTransaction(root), /未与文件操作精确绑定/);
  assert.equal(existsSync(join(root, '.tidykeep', 'manifest.json')), false);
});
