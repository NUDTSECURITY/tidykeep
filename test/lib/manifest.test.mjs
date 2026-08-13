import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fileMatchesRecord, getFileRecord, loadManifest, saveManifest, parseLegacyManifest,
} from '../../src/lib/manifest.mjs';
import { makeTempDir } from '../helpers/temp.mjs';

test('load/save 只持久化机器资产，剔除用户文件 hash 与本机状态', () => {
  const dir = makeTempDir('manifest-');
  mkdirSync(join(dir, '.tidykeep'), { recursive: true });
  const m = loadManifest(dir);
  const state = join(dir, 'STATE.md');
  writeFileSync(state, 'state\n');
  m.files['STATE.md'] = {
    ownership: 'created', hash: 'b'.repeat(64), kind: 'generated', managed: false,
  };
  m.files['.tidykeep/runtime/core.mjs'] = {
    ownership: 'created', hash: 'a'.repeat(64), kind: 'managed', managed: true,
  };
  m.hookspath = 'set';
  m.uninstallProblems = ['STATE.md 已被用户修改'];
  m.installedAt = '2026-08-12T00:00:00.000Z';
  m.kimi = { status: 'installed', configToml: '/home/alice/.kimi-code/config.toml' };
  saveManifest(dir, m);
  const m2 = loadManifest(dir);
  assert.equal(getFileRecord(m2, 'STATE.md'), null);
  assert.equal(fileMatchesRecord(m2, 'STATE.md', state), false);
  assert.deepEqual(getFileRecord(m2, '.tidykeep/runtime/core.mjs'), {
    ownership: 'created', hash: 'a'.repeat(64), kind: 'managed', managed: true,
  });
  writeFileSync(state, 'user changed\n');
  assert.equal(m2.manifestVersion, 3);
  assert.deepEqual(Object.keys(m2), ['manifestVersion', 'toolVersion', 'runtimeVersion', 'agents', 'files']);
  const raw = readFileSync(join(dir, '.tidykeep', 'manifest.json'), 'utf8');
  assert.equal(raw.includes('/home/alice'), false);
  assert.equal(raw.includes('installedAt'), false);
  assert.equal(raw.includes('hookspath'), false);
  assert.equal(raw.includes('uninstallProblems'), false);
  assert.deepEqual(readdirSync(join(dir, '.tidykeep')), ['manifest.json']);
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
  assert.equal(getFileRecord(m, 'AGENTS.md').ownership, 'created');
  assert.equal(getFileRecord(m, 'CLAUDE.md').ownership, 'modified');
  assert.equal(getFileRecord(m, 'AGENTS.md').hash, null);
  assert.equal('hookspath' in m, false);
});

test('loadManifest: 存在旧文本清单时自动迁移读取', () => {
  const dir = makeTempDir('manifest-legacy-');
  mkdirSync(join(dir, '.tidykeep'), { recursive: true });
  writeFileSync(join(dir, '.tidykeep', 'manifest'), 'created STATE.md\nhookspath external\n');
  const m = loadManifest(dir);
  assert.equal(getFileRecord(m, 'STATE.md').ownership, 'created');
  assert.equal(m.legacyVersion, 1);
  assert.equal('hookspath' in m, false);
});

test('loadManifest: v2 字符串记录迁移为 v3 所有权对象,未知字段不伪造 hash', () => {
  const dir = makeTempDir('manifest-v2-');
  mkdirSync(join(dir, '.tidykeep'), { recursive: true });
  writeFileSync(join(dir, '.tidykeep', 'manifest.json'), JSON.stringify({
    manifestVersion: 2,
    files: { 'STATE.md': 'created', 'AGENTS.md': 'modified' },
    backups: ['dead-field'],
  }));
  const m = loadManifest(dir);
  assert.equal(m.manifestVersion, 3);
  assert.equal(m.legacyVersion, 2);
  assert.deepEqual(getFileRecord(m, 'STATE.md'), {
    ownership: 'created', hash: null, kind: 'legacy', managed: false,
  });
  assert.equal('backups' in m, false, '无语义 backups 字段不应继续传播');
  saveManifest(dir, m);
  const raw = JSON.parse(readFileSync(join(dir, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.equal(raw.manifestVersion, 3);
  assert.equal('legacyVersion' in raw, false);
  assert.equal('backups' in raw, false);
});

test('loadManifest: traversal 与原型链路径 fail-closed,不进入 files 映射', () => {
  for (const rel of ['../../outside', '__proto__/polluted', 'x/constructor/y', 'x\\..\\outside']) {
    const dir = makeTempDir('manifest-hostile-');
    mkdirSync(join(dir, '.tidykeep'), { recursive: true });
    const json = `{"manifestVersion":3,"files":{${JSON.stringify(rel)}:{"ownership":"created","hash":null,"managed":true}}}`;
    writeFileSync(join(dir, '.tidykeep', 'manifest.json'), json);
    const manifest = loadManifest(dir);
    assert.ok(manifest.loadError, `${rel} 必须拒绝`);
    assert.equal(Object.getPrototypeOf(manifest.files), null);
    assert.equal({}.polluted, undefined);
  }
});

test('loadManifest: 拒绝未来版本与异常 schema，避免静默降级覆盖', () => {
  for (const raw of [
    [],
    { manifestVersion: 4, files: {} },
    { manifestVersion: 3.5, files: {} },
    { manifestVersion: 3, agents: ['future-agent'], files: {} },
    { manifestVersion: 3, files: [] },
    { manifestVersion: 3, files: { 'STATE.md': { ownership: 'created', hash: 'bad', managed: true } } },
    { manifestVersion: 3, files: { 'STATE.md': { ownership: 'created', hash: null, managed: 'yes' } } },
    { manifestVersion: 3, files: { 'src/app.js': { ownership: 'created', hash: 'a'.repeat(64), kind: 'managed', managed: true } } },
    { manifestVersion: 3, files: { 'STATE.md': { ownership: 'created', hash: 'a'.repeat(64), kind: 'managed', managed: true } } },
    { manifestVersion: 3, files: { '.tidykeep/runtime/core.mjs': { ownership: 'created', hash: 'a'.repeat(64), kind: 'generated', managed: true } } },
    { manifestVersion: 3, files: {}, backups: [] },
  ]) {
    const dir = makeTempDir('manifest-schema-');
    mkdirSync(join(dir, '.tidykeep'), { recursive: true });
    writeFileSync(join(dir, '.tidykeep', 'manifest.json'), JSON.stringify(raw));
    assert.ok(loadManifest(dir).loadError, JSON.stringify(raw));
  }
});

test('loadManifest: 旧 v3 本机字段可兼容读取，下次保存仅留稳定 schema', () => {
  const dir = makeTempDir('manifest-v3-portable-');
  mkdirSync(join(dir, '.tidykeep'), { recursive: true });
  writeFileSync(join(dir, '.tidykeep', 'manifest.json'), JSON.stringify({
    manifestVersion: 3,
    toolVersion: '0.1.0',
    runtimeVersion: '0.1.0',
    installedAt: '2026-08-12T00:00:00.000Z',
    agents: ['kimi', 'claude'],
    files: {},
    hookspath: 'set',
    kimi: { status: 'installed', configToml: '/Users/alice/.kimi-code/config.toml' },
    uninstallProblems: ['/Users/alice/.tidykeep/kimi-shim.mjs 已被修改'],
  }));
  const manifest = loadManifest(dir);
  assert.equal(manifest.loadError, undefined);
  assert.deepEqual(manifest.agents, ['claude', 'kimi']);
  assert.deepEqual(Object.keys(manifest), ['manifestVersion', 'toolVersion', 'runtimeVersion', 'agents', 'files']);
  saveManifest(dir, manifest);
  const raw = JSON.parse(readFileSync(join(dir, '.tidykeep', 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(raw), ['manifestVersion', 'toolVersion', 'runtimeVersion', 'agents', 'files']);
  assert.equal(JSON.stringify(raw).includes('/Users/alice'), false);
});

test('loadManifest: managed 删除权限只授予精确机器资产白名单', () => {
  const dir = makeTempDir('manifest-managed-');
  mkdirSync(join(dir, '.tidykeep'), { recursive: true });
  const record = { ownership: 'created', hash: 'a'.repeat(64), kind: 'managed', managed: true };
  writeFileSync(join(dir, '.tidykeep', 'manifest.json'), JSON.stringify({
    manifestVersion: 3,
    files: {
      '.tidykeep/runtime/core.mjs': record,
      '.tidykeep/githooks/pre-commit': record,
      '.claude/skills/tidykeep/SKILL.md': record,
    },
  }));
  const manifest = loadManifest(dir);
  assert.equal(manifest.loadError, undefined);
  assert.equal(getFileRecord(manifest, '.tidykeep/runtime/core.mjs').managed, true);
});
