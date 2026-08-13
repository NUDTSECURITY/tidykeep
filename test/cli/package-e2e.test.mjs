import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedEnv, makeTempDir } from '../helpers/temp.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

test('npm 包烟测:pack → 离线安装 → CLI/version 与 payload 完整', { timeout: 120_000 }, () => {
  const work = makeTempDir('tk-package-');
  const packDir = join(work, 'pack');
  const consumer = join(work, 'consumer');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), '{"name":"consumer","private":true}\n');
  const env = isolatedEnv({ npm_config_offline: 'true' });

  const packed = spawnSync(NPM, ['pack', '--json', '--pack-destination', packDir], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const [{ filename }] = JSON.parse(packed.stdout);
  const tarball = join(packDir, basename(filename));
  assert.ok(existsSync(tarball), `缺少包文件:${tarball}`);

  const installed = spawnSync(NPM, [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball,
  ], { cwd: consumer, env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);

  const packageRoot = join(consumer, 'node_modules', 'tidykeep');
  const version = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
  const cli = spawnSync(process.execPath, [join(packageRoot, 'bin', 'tidykeep.mjs'), '--version'], {
    cwd: consumer, env, encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim(), version);
  const help = spawnSync(process.execPath, [join(packageRoot, 'bin', 'tidykeep.mjs'), '--help'], {
    cwd: consumer, env, encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /tidykeep init/);
  const ambiguousVersion = spawnSync(process.execPath, [
    join(packageRoot, 'bin', 'tidykeep.mjs'), 'uninstall', consumer, '-v',
  ], { cwd: consumer, env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(ambiguousVersion.status, 1);
  assert.match(ambiguousVersion.stderr, /不能与命令同时使用/);
  for (const rel of [
    'payload/runtime/core.mjs',
    'payload/runtime/config.mjs',
    'payload/runtime/paths.mjs',
    'payload/runtime/write-policy.mjs',
    'payload/runtime/ledger.mjs',
    'payload/runtime/git-policy.mjs',
    'payload/docs/workflows.md',
    'payload/rules.md',
  ]) {
    assert.ok(existsSync(join(packageRoot, rel)), `发布包缺少 ${rel}`);
  }
});
