// `tidykeep doctor` —— 深度体检:环境、配置、vendored 内容、hooks 接线、runtime 探针、
// 版本漂移、Kimi 注册与 AGENTS.md 体积预算。--fix 仅修执行位与 CRLF。
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fileMatchesRecord, getFileRecord, loadManifest } from '../lib/manifest.mjs';
import { isTidykeepHookCandidate, validateSettingsStructure } from '../lib/settings-json.mjs';
import {
  MD_BEGIN, MD_END, HASH_BEGIN, HASH_END, CLAUDE_POINTER, GITATTRIBUTES_BLOCK,
  claudeHookGroups, codexHookGroups, gitignoreBlock, kimiTomlBlock,
} from '../lib/blocks.mjs';
import { hasExactKimiRegistration, kimiPaths } from '../lib/kimi.mjs';
import { upsertBlockText } from '../lib/markers.mjs';
import {
  assertGitProjectRoot, assertNoProjectSymlinks, canonicalProjectRoot, gitProjectContext,
} from '../lib/project-paths.mjs';
import { inspectExternalHooks } from '../lib/git-hooks.mjs';
import {
  DEFAULT_CONFIG, parseJsonc, toPosix, validateConfig,
} from '../../payload/runtime/core.mjs';

const AGENTS_BUDGET = 28 * 1024;
const PROBE_TIMEOUT_MS = 5000;
const PAYLOAD = fileURLToPath(new URL('../../payload/', import.meta.url));
const RUNTIME_FILES = [
  'core.mjs', 'config.mjs', 'paths.mjs', 'write-policy.mjs', 'ledger.mjs', 'git-policy.mjs',
  'messages.mjs', 'hook.mjs', 'githook.mjs', 'enable-githooks.mjs', 'kimi-shim.mjs',
];
const GITHOOK_FILES = ['pre-commit', 'commit-msg'];
const DOCTOR_PROJECT_PATHS = [
  '.tidykeep', '.tidykeep/manifest.json', '.tidykeep/config.jsonc',
  ...RUNTIME_FILES.map((name) => `.tidykeep/runtime/${name}`),
  ...GITHOOK_FILES.map((name) => `.tidykeep/githooks/${name}`),
  '.tidykeep/docs/workflows.md',
  '.claude/settings.json', '.codex/hooks.json',
  '.claude/skills/tidykeep/SKILL.md', '.agents/skills/tidykeep/SKILL.md',
  'AGENTS.md', 'CLAUDE.md', '.gitignore', '.gitattributes',
];

function managedAssets(manifest) {
  const assets = [
    ...RUNTIME_FILES.map((name) => ({
      rel: `.tidykeep/runtime/${name}`, source: join(PAYLOAD, 'runtime', name), kind: 'runtime',
    })),
    ...GITHOOK_FILES.map((name) => ({
      rel: `.tidykeep/githooks/${name}`, source: join(PAYLOAD, 'githooks', name), kind: 'githook',
    })),
    {
      rel: '.tidykeep/docs/workflows.md', source: join(PAYLOAD, 'docs', 'workflows.md'), kind: 'workflow',
    },
  ];
  const agents = new Set(manifest?.agents ?? []);
  if (agents.has('claude')) assets.push({
    rel: '.claude/skills/tidykeep/SKILL.md', source: join(PAYLOAD, 'skill', 'SKILL.md'), kind: 'skill',
  });
  if (agents.has('kimi')) assets.push({
    rel: '.agents/skills/tidykeep/SKILL.md', source: join(PAYLOAD, 'skill', 'SKILL.md'), kind: 'skill',
  });
  return assets;
}

function pkgVersion() {
  return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8', shell: false, timeout: PROBE_TIMEOUT_MS, ...options,
  });
}

function nodeAtLeast(actual, required = [20, 11, 0]) {
  const parts = String(actual).split('.').map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part))) return false;
  for (let i = 0; i < required.length; i++) {
    const a = parts[i] ?? 0;
    if (a !== required[i]) return a > required[i];
  }
  return true;
}

function strictConfig(path) {
  let raw;
  try {
    raw = parseJsonc(readFileSync(path, 'utf8'));
  } catch (error) {
    return [`无法解析: ${error?.message ?? error}`];
  }
  const errors = validateConfig(raw).errors.map(({ key, reason }) => `${key}: ${reason}`);
  const shape = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const expected = new Set(Object.keys(DEFAULT_CONFIG));
  for (const key of expected) {
    if (!Object.hasOwn(shape, key)) errors.push(`${key}: 缺少键,重跑 init 可补齐`);
  }
  return errors;
}

function manifestV3Health(target, manifest) {
  const path = join(target, '.tidykeep', 'manifest.json');
  if (!existsSync(path)) return { ok: false, note: 'manifest.json 缺失' };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, note: 'manifest.json 根必须是对象' };
    }
    if (raw.manifestVersion !== 3) {
      return { ok: false, note: `manifestVersion=${String(raw.manifestVersion ?? '(缺失)')},应为 3` };
    }
    if (manifest.loadError) return { ok: false, note: `无法解析或 schema 非法: ${manifest.loadError.message}` };
    return { ok: true, note: '' };
  } catch (error) {
    return { ok: false, note: `无法解析: ${error?.message ?? error}` };
  }
}

function sameFile(a, b) {
  try { return readFileSync(a).equals(readFileSync(b)); } catch { return false; }
}

function sameManagedText(a, b) {
  try {
    return readFileSync(a, 'utf8').replace(/\r\n?/g, '\n')
      === readFileSync(b, 'utf8').replace(/\r\n?/g, '\n');
  } catch { return false; }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function tidykeepHookCandidateDescriptors(settings) {
  const out = [];
  for (const [event, groups] of Object.entries(settings?.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        if (isTidykeepHookCandidate(hook)) out.push(canonical({ event, matcher: group.matcher ?? null, hook }));
      }
    }
  }
  return out.map((item) => JSON.stringify(item)).sort();
}

function hooksExactlyMatch(actual, expected) {
  if (!validateSettingsStructure(actual).ok) return false;
  const a = tidykeepHookCandidateDescriptors(actual);
  const b = tidykeepHookCandidateDescriptors({ hooks: expected });
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function kimiRegistrationHealthy(target) {
  const paths = kimiPaths();
  const expectedShim = join(PAYLOAD, 'runtime', 'kimi-shim.mjs');
  if (!sameFile(paths.shim, expectedShim)) return { ok: false, note: 'Kimi shim 缺失或内容漂移' };
  try {
    const config = readFileSync(paths.configToml, 'utf8');
    const expected = upsertBlockText(
      config, HASH_BEGIN, HASH_END, kimiTomlBlock(toPosix(paths.shim)),
    );
    if (expected.status !== 'ok' || !expected.existedBlock || expected.text !== config) {
      return { ok: false, note: 'Kimi 全局配置块缺失、重复或事件/命令/timeout 漂移' };
    }
  } catch {
    return { ok: false, note: 'Kimi 全局 config.toml 缺失或不可读' };
  }
  return hasExactKimiRegistration(target)
    ? { ok: true, note: '' }
    : { ok: false, note: 'Kimi 项目注册缺失、文件名/内容不匹配或不是普通文件' };
}

export function doctor(targetArg, opts = {}) {
  let target;
  const results = [];
  const check = (name, ok, note = '', fixable = false) => results.push({ name, ok, note, fixable });

  try {
    target = canonicalProjectRoot(targetArg || process.cwd());
    // doctor --fix 会改写 githook；读 manifest/config/settings 也不应沿链接
    // 越出项目。在任何项目内读/修前一次性校验完整受管路径集。
    assertNoProjectSymlinks(target, DOCTOR_PROJECT_PATHS);
  } catch (error) {
    console.log(`[tidykeep] 体检拒绝: ${error?.message ?? error}`);
    return 1;
  }

  // 即使子目录尚未安装，也要先阻止 --fix 误作用于父仓库；普通非 Git 目录则
  // 优先给出更直接的“未安装”诊断。
  const controlDirExists = existsSync(join(target, '.tidykeep'));
  const boundary = gitProjectContext(target);
  if (controlDirExists && ['parent', 'linked', 'error'].includes(boundary.status)) {
    try { assertGitProjectRoot(target, 'doctor'); }
    catch (error) {
      console.log(`[tidykeep] 体检拒绝: ${error?.message ?? error}`);
      return 1;
    }
  }
  if (!existsSync(join(target, '.tidykeep', 'manifest.json'))
      || !existsSync(join(target, '.tidykeep', 'runtime', 'hook.mjs'))) {
    console.log(`[tidykeep] 未安装: ${target}(先运行 npx tidykeep init)`);
    return 1;
  }
  try { assertGitProjectRoot(target, 'doctor'); }
  catch (error) {
    console.log(`[tidykeep] 体检拒绝: ${error?.message ?? error}`);
    return 1;
  }
  const manifest = loadManifest(target);
  const manifestHealth = manifestV3Health(target, manifest);
  check('manifest.json 可解析且版本为 v3', manifestHealth.ok,
    manifestHealth.ok ? '' : `${manifestHealth.note}${manifest.legacyVersion ? `;manifestVersion=${manifest.legacyVersion}` : ''}`);
  const assets = managedAssets(manifest);
  const supplementalDrift = assets.filter(({ kind, rel, source }) =>
    (kind === 'workflow' || kind === 'skill') && !sameManagedText(join(target, rel), source));
  check('workflow/skill 内容与当前 CLI payload 一致', supplementalDrift.length === 0,
    supplementalDrift.length
      ? `漂移: ${supplementalDrift.map(({ rel }) => rel).join('、')};重跑 init 可修复`
      : '');

  const gitVersion = run('git', ['--version']);
  check('git 可用', !gitVersion.error && gitVersion.status === 0,
    gitVersion.error?.message ?? (gitVersion.signal ? `超时或被信号终止:${gitVersion.signal}` : ''));
  check('node 版本 >= 20.11', nodeAtLeast(process.versions.node), `当前 ${process.versions.node}`);

  const configPath = join(target, '.tidykeep', 'config.jsonc');
  const configErrors = existsSync(configPath) ? strictConfig(configPath) : ['文件缺失'];
  check('config.jsonc 严格合法', configErrors.length === 0, configErrors.join('; '));

  let scratch = '.tmp';
  if (configErrors.length === 0) scratch = parseJsonc(readFileSync(configPath, 'utf8')).SCRATCH_DIR;
  const markerSpecs = [
    ['AGENTS.md', MD_BEGIN, MD_END, readFileSync(join(PAYLOAD, 'rules.md'), 'utf8')],
    ['.gitignore', HASH_BEGIN, HASH_END, gitignoreBlock(scratch)],
    ['.gitattributes', HASH_BEGIN, HASH_END, GITATTRIBUTES_BLOCK],
  ];
  if ((manifest.agents ?? []).includes('claude')) {
    markerSpecs.push(['CLAUDE.md', MD_BEGIN, MD_END, CLAUDE_POINTER]);
  }
  for (const [rel, begin, end, body] of markerSpecs) {
    const path = join(target, rel);
    if (!existsSync(path)) { check(`${rel} tidykeep 块完整精确`, false, '文件缺失'); continue; }
    const before = readFileSync(path, 'utf8');
    const result = upsertBlockText(before, begin, end, body);
    const ok = result.status === 'ok' && result.existedBlock && result.text === before;
    check(`${rel} tidykeep 块完整精确`, ok,
      ok ? '' : '标记不成对、重复或块内容漂移；重跑 init 可修复（不成对时需先人工处理）');
  }

  const missingRuntime = RUNTIME_FILES.filter((name) => !existsSync(join(target, '.tidykeep', 'runtime', name)));
  check('runtime 文件完整', missingRuntime.length === 0,
    missingRuntime.length ? `缺少 ${missingRuntime.join('、')};重跑 init 可修复` : '');
  const driftRuntime = RUNTIME_FILES.filter((name) => !sameManagedText(
    join(target, '.tidykeep', 'runtime', name), join(PAYLOAD, 'runtime', name),
  ));
  check('runtime 内容与当前 CLI payload 一致', driftRuntime.length === 0,
    driftRuntime.length ? `漂移: ${driftRuntime.join('、')};重跑 init 可修复` : '');
  check('runtime 版本与 CLI 一致', manifest.runtimeVersion === pkgVersion(),
    `已装 ${manifest.runtimeVersion || '?'} / CLI ${pkgVersion()}(不一致时重跑 init)`);

  for (const name of GITHOOK_FILES) {
    const path = join(target, '.tidykeep', 'githooks', name);
    if (!existsSync(path)) { check(`githooks/${name} 存在`, false, '重跑 init 可修复'); continue; }
    let text = readFileSync(path, 'utf8');
    const trustedSource = readFileSync(join(PAYLOAD, 'githooks', name), 'utf8').replaceAll('\r\n', '\n');
    const trustedNormalized = text.replaceAll('\r\n', '\n') === trustedSource;
    const crlf = text.includes('\r');
    let crlfFixed = false;
    if (crlf && opts.fix && trustedNormalized) {
      try {
        writeFileSync(path, text.replaceAll('\r\n', '\n'));
        text = readFileSync(path, 'utf8');
        crlfFixed = !text.includes('\r');
      } catch { /* 下方如实报告 */ }
    }
    check(`githooks/${name} 为 LF`, !crlf || crlfFixed,
      crlf ? (crlfFixed ? '已修复' : '被 CRLF 污染') : '', crlf && !crlfFixed);
    const executable = process.platform === 'win32' || Boolean(statSync(path).mode & 0o100);
    let execFixed = false;
    if (!executable && opts.fix && trustedNormalized) {
      try { chmodSync(path, 0o755); execFixed = Boolean(statSync(path).mode & 0o100); } catch { /* 下方报告 */ }
    }
    check(`githooks/${name} 可执行`, executable || execFixed,
      executable ? '' : (execFixed ? '已修复' : '缺执行位'), !executable && !execFixed);
    const exactContent = sameManagedText(path, join(PAYLOAD, 'githooks', name)) && !text.includes('\r');
    check(`githooks/${name} 内容与当前 CLI payload 一致`, exactContent,
      exactContent ? '' : (trustedNormalized && crlf ? '仅 EOL 漂移;可 --fix' : '内容漂移;拒绝 --fix 执行位或内容'));
  }

  // 放在可逆的 CRLF/执行位修复之后；--fix 若已把内容恢复为原 managed hash，
  // 不应保留一个基于修复前快照的伪失败。
  const invalidOwnership = assets.filter(({ rel }) => {
    const record = getFileRecord(manifest, rel);
    return !record?.managed || !/^[a-f0-9]{64}$/.test(record.hash ?? '')
      || !fileMatchesRecord(manifest, rel, join(target, rel));
  });
  check('managed 机器区所有权记录与实际 SHA-256 一致', invalidOwnership.length === 0,
    invalidOwnership.length
      ? `缺失、无有效 SHA-256 或与实际文件不符: ${invalidOwnership.map(({ rel }) => rel).join('、')};重跑 init 可修复`
      : '');

  const expectedHooks = new Map([
    ['claude', ['.claude/settings.json', claudeHookGroups()]],
    ['codex', ['.codex/hooks.json', codexHookGroups()]],
  ]);
  for (const agent of manifest.agents ?? []) {
    if (!expectedHooks.has(agent)) continue;
    const [rel, expected] = expectedHooks.get(agent);
    const path = join(target, rel);
    if (!existsSync(path)) { check(`${rel} 完整精确`, false, '文件缺失;重跑 init 可修复'); continue; }
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      const ok = hooksExactlyMatch(data, expected);
      check(`${rel} tidykeep hooks 完整精确`, ok, ok ? '' : '事件/matcher/command/args/timeout 缺失、漂移或重复');
    } catch (error) {
      check(`${rel} 可解析`, false, `JSON 损坏: ${error?.message ?? error}`);
    }
  }

  if ((manifest.agents ?? []).includes('kimi')) {
    const paths = kimiPaths();
    if (existsSync(paths.kimiHome)) {
      const kimi = kimiRegistrationHealthy(target);
      check('Kimi shim、精确配置块与项目注册完整', kimi.ok, kimi.note);
    } else {
      check('Kimi 当前无需全局接线', true, '未检测到 Kimi Code 用户目录');
    }
  }

  const hookPath = join(target, '.tidykeep', 'runtime', 'hook.mjs');
  const runtimeTrusted = missingRuntime.length === 0 && driftRuntime.length === 0
    && invalidOwnership.filter(({ rel }) => rel.startsWith('.tidykeep/runtime/')).length === 0;
  const probe = runtimeTrusted ? run(process.execPath, [hookPath, 'claude-pretooluse'], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/tidykeep-doctor-probe.sh' }, cwd: target }),
    cwd: target,
    env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
  }) : { status: null, stdout: '', error: null };
  let probeOk = false;
  try {
    probeOk = !probe.error && probe.status === 0
      && JSON.parse(probe.stdout).hookSpecificOutput.permissionDecision === 'deny';
  } catch { /* 保持 false */ }
  check('runtime 探针(拦截 /tmp 写入)', probeOk,
    !runtimeTrusted ? 'runtime 不可信，未执行项目内代码'
      : (probe.error?.code === 'ETIMEDOUT' ? 'hook 探针超时' : (probeOk ? '' : 'hook 未按预期拦截')));

  const agentsPath = join(target, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    const size = statSync(agentsPath).size;
    check('AGENTS.md 体积在 Codex/Kimi 32KiB 预算内', size < AGENTS_BUDGET, `${(size / 1024).toFixed(1)} KiB`);
  }

  const hp = run('git', ['-C', target, 'config', 'core.hooksPath']);
  const hpReadable = !hp.error && (hp.status === 0 || hp.status === 1);
  const hpVal = hp.status === 0 ? hp.stdout.trim() : '';
  check('core.hooksPath 可读取', hpReadable,
    hp.error?.message ?? (hpReadable ? '' : (hp.stderr ?? '').trim()));
  const repo = run('git', ['-C', target, 'rev-parse', '--show-toplevel']);
  let actualHookState = 'problem';
  if (hpReadable) {
    if (hpVal === '.tidykeep/githooks') actualHookState = 'set';
    else if (hpVal) actualHookState = 'external';
    else if (!repo.error && repo.status === 0) actualHookState = 'none';
    else if (!repo.error && repo.status !== 0
        && /not a git repository/i.test(`${repo.stdout ?? ''}\n${repo.stderr ?? ''}`)) actualHookState = 'nogit';
  }
  if (actualHookState === 'set') {
    check('git hooks 实际已由 tidykeep 接管', true);
  } else if (actualHookState === 'external') {
    const inspection = inspectExternalHooks(target, hpVal);
    check('外部 hooksPath 已真实链入 tidykeep', inspection.ok,
      inspection.ok ? '' : `core.hooksPath=${hpVal};${inspection.note};两种 hook 均须用 sh/exec 调用并传播失败`);
  } else if (actualHookState === 'none') {
    check('git hooks 当前明确未接管', true, '当前 Git 仓库未设置 core.hooksPath');
  } else if (actualHookState === 'nogit') {
    check('git hooks 当前无需接管', true, '目标当前不是 Git 仓库');
  } else {
    check('git hooks 实际接线可判定', false, '无法可靠确认 Git 仓库或 hooksPath 状态');
  }
  let bad = 0;
  let fixableBad = 0;
  for (const result of results) {
    const fix = !result.ok && result.fixable ? ' [可 --fix]' : '';
    console.log(`  ${result.ok ? '✔' : '✖'} ${result.name}${fix}${result.note ? `  — ${result.note}` : ''}`);
    if (!result.ok) {
      bad++;
      if (result.fixable) fixableBad++;
    }
  }
  if (bad === 0) console.log('[tidykeep] 体检通过 ✅');
  else console.log(`[tidykeep] ${bad} 项异常${fixableBad ? `,其中 ${fixableBad} 项可 --fix 修复` : ''}`);
  return bad === 0 ? 0 : 1;
}
