// doctor 端到端:检测执行位缺失 / CRLF 污染 / runtime 探针 / 版本漂移,--fix 修复安全项。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, statSync, unlinkSync, symlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { makeTempDir, isolatedEnv } from '../helpers/temp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'tidykeep.mjs');

function makeInstalledRepo() {
  const base = makeTempDir('doctor-home-');
  mkdirSync(join(base, '.kimi-code'), { recursive: true });
  const env = isolatedEnv({
    KIMI_CODE_HOME: join(base, '.kimi-code'),
    TIDYKEEP_USER_DIR: join(base, '.tidykeep'),
    CLAUDE_PROJECT_DIR: '',
  });
  const root = makeTempDir('doctor-');
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

test('doctor: CRLF 污染跨平台被检出并由 --fix 修复', () => {
  const { root, env } = makeInstalledRepo();
  const shim = join(root, '.tidykeep', 'githooks', 'pre-commit');
  writeFileSync(shim, readFileSync(shim, 'utf8').replaceAll('\n', '\r\n'));
  const r1 = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r1.status, 0, '有问题时应非零退出');
  assert.ok(r1.stdout.includes('✖'));
  assert.ok(r1.stdout.includes('可 --fix'), '可修项应在逐项输出中明确标识');
  const r2 = spawnSync('node', [BIN, 'doctor', root, '--fix'], { encoding: 'utf8', env });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.ok(!readFileSync(shim, 'utf8').includes('\r'), 'CRLF 应被修复');
});

test('doctor: POSIX 执行位缺失被检出并由 --fix 修复', { skip: process.platform === 'win32' }, () => {
  const { root, env } = makeInstalledRepo();
  const shim = join(root, '.tidykeep', 'githooks', 'pre-commit');
  chmodSync(shim, 0o644);
  const r1 = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r1.status, 0, '有问题时应非零退出');
  assert.ok(r1.stdout.includes('githooks/pre-commit 可执行'));
  assert.ok(r1.stdout.includes('可 --fix'), '可修项应在逐项输出中明确标识');
  const r2 = spawnSync('node', [BIN, 'doctor', root, '--fix'], { encoding: 'utf8', env });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.ok(statSync(shim).mode & 0o100, '执行位应被补上');
});

test('doctor: 未安装项目 → 明确报告,exit 非零', () => {
  const root = makeTempDir('doctor-bare-');
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.ok((r.stdout + r.stderr).includes('未安装'));
});

test('doctor: Git 父仓库子目录明确拒绝，不读取或修复父 hooksPath', () => {
  const parent = makeTempDir('doctor-parent-');
  execFileSync('git', ['-C', parent, 'init', '-q']);
  execFileSync('git', ['-C', parent, 'config', 'core.hooksPath', '.parent-hooks']);
  const child = join(parent, 'packages', 'child');
  mkdirSync(join(child, '.tidykeep'), { recursive: true });
  const result = spawnSync('node', [BIN, 'doctor', child, '--fix'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok((result.stdout + result.stderr).includes('Git 仓库子目录'));
  assert.equal(execFileSync('git', ['-C', parent, 'config', 'core.hooksPath'], { encoding: 'utf8' }).trim(), '.parent-hooks');
});

test('doctor: 严格检出 config 非法值与 runtime 内容漂移', () => {
  const { root, env } = makeInstalledRepo();
  writeFileSync(join(root, '.tidykeep', 'config.jsonc'), '{ "ENFORCE_LEDGER": "blok" }');
  const hook = join(root, '.tidykeep', 'runtime', 'hook.mjs');
  writeFileSync(hook, readFileSync(hook, 'utf8') + '\n// drift\n');
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.ok(r.stdout.includes('config.jsonc'));
  assert.ok(r.stdout.includes('runtime 内容'));
});

test('doctor: 漂移 runtime 永不执行，漂移 githook 的 --fix 也零改动', { skip: process.platform === 'win32' }, () => {
  const { root, env } = makeInstalledRepo();
  const sentinel = join(root, 'doctor-rce-sentinel');
  const hook = join(root, '.tidykeep', 'runtime', 'hook.mjs');
  writeFileSync(hook, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'ran');\n`);
  const gitHook = join(root, '.tidykeep', 'githooks', 'pre-commit');
  writeFileSync(gitHook, '#!/bin/sh\necho attacker\n');
  chmodSync(gitHook, 0o644);
  const before = readFileSync(gitHook);
  const result = spawnSync('node', [BIN, 'doctor', root, '--fix'], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(sentinel), false, 'doctor 不得执行漂移的项目 runtime');
  assert.deepEqual(readFileSync(gitHook), before, 'doctor --fix 不得改写漂移 githook');
  assert.equal(statSync(gitHook).mode & 0o777, 0o644, 'doctor --fix 不得 chmod 漂移 githook');
  assert.ok(result.stdout.includes('runtime 不可信，未执行项目内代码'));
});

test('doctor: 拆分后的每个 runtime 模块都属于完整性与漂移检查', () => {
  const { root, env } = makeInstalledRepo();
  unlinkSync(join(root, '.tidykeep', 'runtime', 'paths.mjs'));
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.ok(r.stdout.includes('runtime 文件完整'));
  assert.ok(r.stdout.includes('paths.mjs'), r.stdout + r.stderr);
});

test('doctor: manifest 必须可解析、为 v3 且覆盖所有 managed asset 所有权', () => {
  const malformed = makeInstalledRepo();
  writeFileSync(join(malformed.root, '.tidykeep', 'manifest.json'), '{ invalid');
  const malformedResult = spawnSync('node', [BIN, 'doctor', malformed.root], {
    encoding: 'utf8', env: malformed.env,
  });
  assert.notEqual(malformedResult.status, 0);
  assert.ok(malformedResult.stdout.includes('manifest.json 可解析且版本为 v3'));
  assert.ok(malformedResult.stdout.includes('无法解析'));

  const incomplete = makeInstalledRepo();
  const manifestPath = join(incomplete.root, '.tidykeep', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.manifestVersion = 2;
  delete manifest.files['.tidykeep/runtime/paths.mjs'];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const incompleteResult = spawnSync('node', [BIN, 'doctor', incomplete.root], {
    encoding: 'utf8', env: incomplete.env,
  });
  assert.notEqual(incompleteResult.status, 0);
  assert.ok(incompleteResult.stdout.includes('manifestVersion=2'));
  assert.ok(incompleteResult.stdout.includes('所有权记录与实际 SHA-256 一致'));
  assert.ok(incompleteResult.stdout.includes('.tidykeep/runtime/paths.mjs'));

  const forged = makeInstalledRepo();
  const forgedManifestPath = join(forged.root, '.tidykeep', 'manifest.json');
  const forgedManifest = JSON.parse(readFileSync(forgedManifestPath, 'utf8'));
  forgedManifest.files['.tidykeep/runtime/paths.mjs'].hash = 'a'.repeat(64);
  writeFileSync(forgedManifestPath, JSON.stringify(forgedManifest, null, 2) + '\n');
  const forgedResult = spawnSync('node', [BIN, 'doctor', forged.root], { encoding: 'utf8', env: forged.env });
  assert.notEqual(forgedResult.status, 0);
  assert.ok(forgedResult.stdout.includes('.tidykeep/runtime/paths.mjs'));
});

test('doctor: workflow/启用 skill 漂移纳入机器区健康检查', () => {
  const { root, env } = makeInstalledRepo();
  const skill = join(root, '.agents', 'skills', 'tidykeep', 'SKILL.md');
  writeFileSync(skill, readFileSync(skill, 'utf8') + '\n漂移\n');
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.ok(r.stdout.includes('workflow/skill 内容'));
  assert.ok(r.stdout.includes('.agents/skills/tidykeep/SKILL.md'));
});

test('doctor: config 缺少当前 schema 键时不得由运行时默认值掩盖', () => {
  const { root, env } = makeInstalledRepo();
  writeFileSync(join(root, '.tidykeep', 'config.jsonc'), '{ "GUARD": true }\n');
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.ok(r.stdout.includes('缺少键'), r.stdout + r.stderr);
  assert.ok(r.stdout.includes('重跑 init'), r.stdout + r.stderr);
});

test('doctor: hooks 必须完整精确,Kimi shim 与项目注册必须存在', () => {
  const { root, env } = makeInstalledRepo();
  const settings = join(root, '.claude', 'settings.json');
  const data = JSON.parse(readFileSync(settings, 'utf8'));
  data.hooks.PreToolUse[0].matcher = 'Read';
  writeFileSync(settings, JSON.stringify(data, null, 2) + '\n');
  unlinkSync(join(env.TIDYKEEP_USER_DIR, 'kimi-shim.mjs'));
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.ok(r.stdout.includes('.claude/settings.json'));
  assert.ok(r.stdout.includes('Kimi shim'));
});

test('doctor: 标记块内容/唯一性与 settings 整体结构都必须精确', () => {
  const marked = makeInstalledRepo();
  const agents = join(marked.root, 'AGENTS.md');
  writeFileSync(agents, readFileSync(agents, 'utf8').replace('tidykeep 协议', '漂移协议'));
  const markedResult = spawnSync('node', [BIN, 'doctor', marked.root], { encoding: 'utf8', env: marked.env });
  assert.notEqual(markedResult.status, 0);
  assert.ok(markedResult.stdout.includes('AGENTS.md tidykeep 块完整精确'));

  const invalid = makeInstalledRepo();
  const settingsPath = join(invalid.root, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  settings.hooks.UserEvent = {}; // tidykeep 候选本身仍精确，但全局 hooks schema 已非法
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  const invalidResult = spawnSync('node', [BIN, 'doctor', invalid.root], { encoding: 'utf8', env: invalid.env });
  assert.notEqual(invalidResult.status, 0);
  assert.ok(invalidResult.stdout.includes('.claude/settings.json tidykeep hooks 完整精确'));
});

test('doctor: Kimi 注册必须是 SHA1 精确路径下的普通文件', { skip: process.platform === 'win32' }, () => {
  const { root, env } = makeInstalledRepo();
  const projects = join(env.TIDYKEEP_USER_DIR, 'projects.d');
  const marker = join(projects, readdirSync(projects)[0]);
  const outside = join(makeTempDir('doctor-marker-outside-'), 'marker');
  writeFileSync(outside, readFileSync(marker));
  unlinkSync(marker);
  symlinkSync(outside, marker);
  const result = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.ok(result.stdout.includes('不是普通文件'), result.stdout + result.stderr);
});

test('doctor: Kimi 全局块必须唯一且事件、命令、timeout 精确', () => {
  const { root, env } = makeInstalledRepo();
  const config = join(env.KIMI_CODE_HOME, 'config.toml');
  writeFileSync(config, readFileSync(config, 'utf8').replace('timeout = 30', 'timeout = 31'));
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.ok(r.stdout.includes('Kimi 全局配置块'));
  assert.ok(r.stdout.includes('timeout 漂移'), r.stdout + r.stderr);
});

test('doctor: Kimi 健康度从现场配置推导，不信任旧 manifest 状态', () => {
  const { root, env } = makeInstalledRepo();
  writeFileSync(join(env.KIMI_CODE_HOME, 'config.toml'), 'hooks = []\n');
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.ok(r.stdout.includes('Kimi shim、精确配置块与项目注册完整'));
  assert.ok(r.stdout.includes('全局配置块缺失'), r.stdout + r.stderr);
});

test('doctor: .tidykeep 为 symlink 时所有模式拒绝且 --fix 不越界写入', {
  skip: process.platform === 'win32',
}, () => {
  const root = makeTempDir('doctor-link-root-');
  const outside = makeTempDir('doctor-link-outside-');
  mkdirSync(join(outside, 'githooks'), { recursive: true });
  const hook = join(outside, 'githooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\r\nexit 0\r\n');
  symlinkSync(outside, join(root, '.tidykeep'), 'dir');
  const before = readFileSync(hook);
  const r = spawnSync('node', [BIN, 'doctor', root, '--fix'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.ok((r.stdout + r.stderr).includes('符号链接'));
  assert.deepEqual(readFileSync(hook), before, '外部文件不得被 --fix 改写');
});

test('doctor: 单个受管 githook 为 symlink 时 --fix 不改外部内容或权限', {
  skip: process.platform === 'win32',
}, () => {
  const { root, env } = makeInstalledRepo();
  const outside = makeTempDir('doctor-hook-outside-');
  const sentinel = join(outside, 'sentinel');
  writeFileSync(sentinel, '#!/bin/sh\r\nexit 0\r\n');
  chmodSync(sentinel, 0o644);
  const before = readFileSync(sentinel);
  const beforeMode = statSync(sentinel).mode & 0o777;
  const hook = join(root, '.tidykeep', 'githooks', 'pre-commit');
  unlinkSync(hook);
  symlinkSync(sentinel, hook);

  const result = spawnSync('node', [BIN, 'doctor', root, '--fix'], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok((result.stdout + result.stderr).includes('符号链接'));
  assert.deepEqual(readFileSync(sentinel), before);
  assert.equal(statSync(sentinel).mode & 0o777, beforeMode);
});

test('doctor: 漂移的 tidykeep 候选不能被并存的精确条目掩盖', () => {
  const { root, env } = makeInstalledRepo();
  const settingsPath = join(root, '.claude', 'settings.json');
  const data = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const group = data.hooks.PreToolUse.find((item) => item.hooks?.some((hook) => hook.command === 'node'));
  const exact = group.hooks.find((hook) => hook.command === 'node');
  group.hooks.push({ ...exact, timeout: 999 });
  writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n');
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.ok(r.stdout.includes('.claude/settings.json'));
  assert.ok(r.stdout.includes('漂移或重复'), r.stdout + r.stderr);
});

test('doctor: external hooksPath 必须真实链入 pre-commit 与 commit-msg', () => {
  const { root, env } = makeInstalledRepo();
  const manifestPath = join(root, '.tidykeep', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.hookspath = 'external';
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  execFileSync('git', ['-C', root, 'config', 'core.hooksPath', '.husky']);
  mkdirSync(join(root, '.husky'));
  writeFileSync(join(root, '.husky', 'pre-commit'), '#!/bin/sh\n# sh "$root/.tidykeep/githooks/pre-commit"\nexit 0\n');
  writeFileSync(join(root, '.husky', 'commit-msg'), '#!/bin/sh\ntrue # sh "$root/.tidykeep/githooks/commit-msg"\nexit 0\n');
  const r = spawnSync('node', [BIN, 'doctor', root], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.ok(r.stdout.includes('外部 hooksPath'), r.stdout + r.stderr);
});
