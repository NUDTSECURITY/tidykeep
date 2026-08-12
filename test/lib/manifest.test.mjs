import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadManifest, saveManifest, recordFile, wasCreated, parseLegacyManifest,
} from '../../src/lib/manifest.mjs';

test('recordFile: 同一文件只记首次状态(first-wins,对齐初稿)', () => {
  const m = loadManifest('/nonexistent-dir-x');
  recordFile(m, 'AGENTS.md', 'created');
  recordFile(m, 'AGENTS.md', 'modified');
  assert.equal(m.files['AGENTS.md'], 'created');
  assert.equal(wasCreated(m, 'AGENTS.md'), true);
  assert.equal(wasCreated(m, 'CLAUDE.md'), false);
});

test('load/save 往返', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-manifest-'));
  mkdirSync(join(dir, '.tidykeep'), { recursive: true });
  const m = loadManifest(dir);
  recordFile(m, 'STATE.md', 'created');
  m.hookspath = 'set';
  saveManifest(dir, m);
  const m2 = loadManifest(dir);
  assert.equal(m2.files['STATE.md'], 'created');
  assert.equal(m2.hookspath, 'set');
  assert.equal(m2.manifestVersion, 2);
});

test('parseLegacyManifest: 旧纯文本清单迁移', () => {
  const legacy = [
    'created AGENTS.md',
    'modified CLAUDE.md',
    'created .claude/settings.json',
    'hookspath set',
    'skill installed',
  ].join('\n');
  const m = parseLegacyManifest(legacy);
  assert.equal(m.files['AGENTS.md'], 'created');
  assert.equal(m.files['CLAUDE.md'], 'modified');
  assert.equal(m.hookspath, 'set');
});

test('loadManifest: 存在旧文本清单时自动迁移读取', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-manifest2-'));
  mkdirSync(join(dir, '.tidykeep'), { recursive: true });
  writeFileSync(join(dir, '.tidykeep', 'manifest'), 'created STATE.md\nhookspath external\n');
  const m = loadManifest(dir);
  assert.equal(m.files['STATE.md'], 'created');
  assert.equal(m.hookspath, 'external');
});

test('recordFile: 新状态为 created 时刷新过期的 modified 记录(用户删文件后 re-init)', () => {
  const m = loadManifest('/nonexistent-dir-y');
  recordFile(m, 'AGENTS.md', 'modified');
  recordFile(m, 'AGENTS.md', 'created');
  assert.equal(m.files['AGENTS.md'], 'created');
  recordFile(m, 'AGENTS.md', 'modified');
  assert.equal(m.files['AGENTS.md'], 'created', 'created 不被后续 modified 降级');
});
