import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  inspectKimiTomlBlock, installKimiGlobal, kimiPaths, preflightKimiGlobal,
  uninstallKimiGlobal,
} from '../../src/lib/kimi.mjs';
import { loadManifest } from '../../src/lib/manifest.mjs';
import { uninstall } from '../../src/commands/uninstall.mjs';
import { makeTempDir } from '../helpers/temp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = join(HERE, '..', '..', 'payload');

function fixture() {
  const base = makeTempDir('kimi-ownership-');
  const project = join(base, 'project');
  const other = join(base, 'other');
  const kimiHome = join(base, '.kimi-code');
  const userDir = join(base, '.tidykeep-user');
  mkdirSync(project, { recursive: true });
  mkdirSync(other, { recursive: true });
  mkdirSync(kimiHome, { recursive: true });
  writeFileSync(join(kimiHome, 'config.toml'), '# user config\nmodel = "kimi"\n');
  const env = { ...process.env, KIMI_CODE_HOME: kimiHome, TIDYKEEP_USER_DIR: userDir };
  return { base, project, other, kimiHome, userDir, env, paths: kimiPaths(env) };
}

function globalSnapshot(paths) {
  const read = (path) => existsSync(path) ? readFileSync(path, 'utf8') : null;
  let registrations = [];
  try {
    registrations = readdirSync(paths.projectsDir).sort().map((name) => [
      name, readFileSync(join(paths.projectsDir, name), 'utf8'),
    ]);
  } catch { /* 尚无注册目录 */ }
  return {
    config: read(paths.configToml),
    shim: read(paths.shim),
    shimHash: read(paths.shimHash),
    registrations,
  };
}

test('Kimi 卸载：伪造 manifest 但当前项目无精确注册时，全局状态零改动', () => {
  const f = fixture();
  assert.equal(installKimiGlobal(f.project, { env: f.env, payloadDir: PAYLOAD }).status, 'installed');
  const before = globalSnapshot(f.paths);

  const result = uninstallKimiGlobal(f.other, {
    env: f.env,
    payloadDir: PAYLOAD,
    ownershipContext: { kimi: { status: 'installed' }, agents: ['kimi'] },
  });

  assert.equal(result.status, 'not-installed');
  assert.deepEqual(globalSnapshot(f.paths), before);
});

test('Kimi 卸载：仅有 agents 意图但现场无注册、全局块或 shim 时安全 no-op', () => {
  const f = fixture();
  const result = uninstallKimiGlobal(f.project, {
    env: f.env, ownershipContext: { agents: ['kimi'] },
  });
  assert.equal(result.status, 'not-installed');
  assert.equal(existsSync(f.paths.shim), false);
  assert.equal(readFileSync(f.paths.configToml, 'utf8'), '# user config\nmodel = "kimi"\n');
});

test('Kimi 卸载：注册文件内容漂移时不删 marker、不剥 TOML、不删 shim', () => {
  const f = fixture();
  assert.equal(installKimiGlobal(f.project, { env: f.env, payloadDir: PAYLOAD }).status, 'installed');
  const marker = join(f.paths.projectsDir, readdirSync(f.paths.projectsDir)[0]);
  writeFileSync(marker, `${f.other}\n`);
  const before = globalSnapshot(f.paths);

  const result = uninstallKimiGlobal(f.project, { env: f.env, payloadDir: PAYLOAD });

  assert.equal(result.status, 'problem-registration-mismatch');
  assert.deepEqual(globalSnapshot(f.paths), before);
});

test('Kimi TOML：只接受完整已知块，字段漂移使 init/uninstall 均 fail-closed', () => {
  const f = fixture();
  assert.equal(installKimiGlobal(f.project, { env: f.env, payloadDir: PAYLOAD }).status, 'installed');
  const exact = readFileSync(f.paths.configToml, 'utf8');
  assert.deepEqual(inspectKimiTomlBlock(exact, f.paths.shim), { status: 'exact', count: 1 });

  const drift = exact.replace('timeout = 20', 'timeout = 21');
  writeFileSync(f.paths.configToml, drift);
  const before = globalSnapshot(f.paths);
  const preflight = preflightKimiGlobal(f.project, { env: f.env, payloadDir: PAYLOAD });
  assert.equal(preflight.status, 'problem-block-drift');
  assert.equal(uninstallKimiGlobal(f.project, { env: f.env, payloadDir: PAYLOAD }).status, 'problem-block-drift');
  assert.deepEqual(globalSnapshot(f.paths), before);
});

test('Kimi config.toml 为 symlink 时 init/uninstall 均 fail-closed 且外部目标不变', {
  skip: process.platform === 'win32',
}, () => {
  const f = fixture();
  const outside = join(f.base, 'outside-config.toml');
  const original = '# external dotfiles target\n';
  writeFileSync(outside, original);
  rmSync(f.paths.configToml);
  symlinkSync(outside, f.paths.configToml);
  const beforeLink = readFileSync(f.paths.configToml, 'utf8');

  const preflight = preflightKimiGlobal(f.project, { env: f.env, payloadDir: PAYLOAD });
  assert.equal(preflight.status, 'problem-path-unsafe');
  assert.equal(installKimiGlobal(f.project, { env: f.env, payloadDir: PAYLOAD }).status, 'problem-path-unsafe');
  assert.equal(uninstallKimiGlobal(f.project, { env: f.env }).status, 'problem-path-unsafe');
  assert.equal(readFileSync(outside, 'utf8'), original);
  assert.equal(readFileSync(f.paths.configToml, 'utf8'), beforeLink);
  assert.equal(existsSync(f.paths.shim), false);
});

test('Kimi 用户锁：活 owner 与崩溃残留均不自动回收，人工确认移除后可继续', () => {
  const f = fixture();
  mkdirSync(f.paths.lockDir, { recursive: true });
  writeFileSync(join(f.paths.lockDir, 'owner'), `${process.pid}\n`); // 兼容旧锁格式
  const old = new Date('2000-01-01T00:00:00.000Z');
  utimesSync(f.paths.lockDir, old, old);
  const before = globalSnapshot(f.paths);
  const blocked = installKimiGlobal(f.project, { env: f.env, payloadDir: PAYLOAD });
  assert.equal(blocked.status, 'problem-busy');
  assert.equal(existsSync(f.paths.lockDir), true, '活进程锁不得仅因 mtime 旧而删除');
  assert.deepEqual(globalSnapshot(f.paths), before);

  rmSync(f.paths.lockDir, { recursive: true, force: true });
  mkdirSync(f.paths.lockDir);
  writeFileSync(join(f.paths.lockDir, 'owner'), '2147483647\n');
  utimesSync(f.paths.lockDir, old, old);
  const deadBlocked = installKimiGlobal(f.project, { env: f.env, payloadDir: PAYLOAD });
  assert.equal(deadBlocked.status, 'problem-busy');
  assert.equal(existsSync(f.paths.lockDir), true, '死 owner 也不得自动回收，避免换锁竞态破坏互斥');
  rmSync(f.paths.lockDir, { recursive: true, force: true });
  const recovered = installKimiGlobal(f.project, { env: f.env, payloadDir: PAYLOAD });
  assert.equal(recovered.status, 'installed');
});

test('manifest 兼容读取旧 Kimi 状态，但不再持久化用户级路径', () => {
  const writeManifest = (raw) => {
    const root = makeTempDir('kimi-manifest-');
    mkdirSync(join(root, '.tidykeep'), { recursive: true });
    writeFileSync(join(root, '.tidykeep', 'manifest.json'), JSON.stringify(raw));
    return loadManifest(root);
  };
  const manifest = writeManifest({
    manifestVersion: 3, files: {}, agents: ['kimi'],
    kimi: { status: 'installing', configToml: '/home/user/.kimi-code/config.toml' },
  });
  assert.equal(manifest.loadError, undefined);
  assert.equal('kimi' in manifest, false);
});

test('uninstall --purge：不推断并删除未登记的旧 scratch 目录', () => {
  const root = makeTempDir('purge-old-scratch-');
  execFileSync('git', ['-C', root, 'init', '-q']);
  mkdirSync(join(root, '.tidykeep'), { recursive: true });
  mkdirSync(join(root, '.tmp'));
  mkdirSync(join(root, 'scratch'));
  writeFileSync(join(root, '.tidykeep', 'config.jsonc'), '{ "SCRATCH_DIR": ".tmp" }\n');
  writeFileSync(join(root, '.tidykeep', 'manifest.json'), JSON.stringify({
    manifestVersion: 3,
    toolVersion: '0.1.0',
    runtimeVersion: '0.1.0',
    agents: [],
    files: {},
  }));

  assert.equal(uninstall(root, { purge: true }), 0, '项目 config 按契约保留但不属于卸载失败');
  assert.equal(existsSync(join(root, '.tmp')), true, '仅凭项目内配置不能证明空目录由工具创建');
  assert.equal(existsSync(join(root, 'scratch')), true, '旧版未登记 scratch 不得被推断为工具所有');
});
