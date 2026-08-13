import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { acquireDirectoryLock, releaseDirectoryLock } from '../../src/lib/directory-lock.mjs';
import { makeTempDir } from '../helpers/temp.mjs';

test('目录锁：未知文件与 symlink 锁 fail-closed，绝不递归删除链接目标', () => {
  const root = makeTempDir('directory-lock-hostile-');
  const lock = join(root, '.lock');
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner'), '2147483647\n');
  writeFileSync(join(lock, 'user-note'), 'keep\n');
  assert.throws(() => acquireDirectoryLock(lock), /未知内容/);
  assert.equal(readFileSync(join(lock, 'user-note'), 'utf8'), 'keep\n');

  const symlinkRoot = makeTempDir('directory-lock-symlink-');
  const outside = join(symlinkRoot, 'outside');
  const symlinkLock = join(symlinkRoot, '.lock');
  mkdirSync(outside);
  writeFileSync(join(outside, 'owner'), '2147483647\n');
  symlinkSync(outside, symlinkLock, 'dir');
  assert.throws(() => acquireDirectoryLock(symlinkLock), /未知内容/);
  assert.equal(readFileSync(join(outside, 'owner'), 'utf8'), '2147483647\n');
});

test('目录锁：release 仅删除自己的 owner，后来者/未知内容均保留', () => {
  const root = makeTempDir('directory-lock-release-');
  const path = join(root, '.lock');
  const lock = acquireDirectoryLock(path);
  writeFileSync(join(path, 'user-note'), 'keep\n');
  releaseDirectoryLock(lock);
  assert.equal(readFileSync(join(path, 'user-note'), 'utf8'), 'keep\n');
  assert.equal(existsSync(join(path, 'owner.json')), true, '布局不再精确时连 owner 也保守保留');

  const root2 = makeTempDir('directory-lock-replaced-');
  const path2 = join(root2, '.lock');
  const lock2 = acquireDirectoryLock(path2);
  const owner = JSON.parse(readFileSync(join(path2, 'owner.json'), 'utf8'));
  writeFileSync(join(path2, 'owner.json'), JSON.stringify({ ...owner, token: 'later-owner' }));
  releaseDirectoryLock(lock2);
  assert.equal(existsSync(path2), true, 'owner token 变化后旧持有者不得删除后来者锁');
});
