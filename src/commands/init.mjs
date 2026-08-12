// `tidykeep init` —— 幂等安装/升级。三类区域:
//   机器区(runtime/、githooks/、docs/、skills、hook 注册条目):每次整体刷新;
//   用户区(config.jsonc、allowlist、STATE.md、LEDGER.md):存在则不动;
//   标记块区(AGENTS.md/CLAUDE.md/.gitignore/.gitattributes/settings/hooks.json):upsert。
// 同时自动迁移旧 bash 版痕迹(KEY=VALUE config、文本 manifest、python hooks、python3 条目)。
import {
  chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync,
  rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { upsertBlockFile } from '../lib/markers.mjs';
import { loadManifest, saveManifest, recordFile } from '../lib/manifest.mjs';
import { mergeSettingsText } from '../lib/settings-json.mjs';
import { replaceJsoncValue } from '../lib/jsonc.mjs';
import {
  MD_BEGIN, MD_END, HASH_BEGIN, HASH_END,
  CLAUDE_POINTER, gitignoreBlock, GITATTRIBUTES_BLOCK,
  claudeHookGroups, codexHookGroups,
} from '../lib/blocks.mjs';
import { installKimiGlobal } from '../lib/kimi.mjs';
import { parseLegacyConfig, DEFAULT_CONFIG } from '../../payload/runtime/core.mjs';

const PAYLOAD = new URL('../../payload/', import.meta.url).pathname;

function pkgVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

const git = (root, ...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false });

function chmodAll(dir) {
  try {
    for (const f of readdirSync(dir)) {
      try { chmodSync(join(dir, f), 0o755); } catch { /* Windows 无执行位 */ }
    }
  } catch { /* 目录缺失由后续步骤报错 */ }
}

/** 把旧 KEY=VALUE 配置的值套进 config.jsonc 模板(逐键行级替换,模板注释保留) */
function renderConfigFromLegacy(templateText, legacy) {
  let out = templateText;
  for (const [key, value] of Object.entries(legacy)) {
    if (key in DEFAULT_CONFIG) out = replaceJsoncValue(out, key, value);
  }
  return out;
}

export function init(targetArg, opts = {}) {
  const target = resolve(targetArg || process.cwd());
  const agents = new Set(opts.agents ?? ['claude', 'codex', 'kimi']);
  const log = (s) => console.log(`[tidykeep] ${s}`);
  const version = pkgVersion();

  if (opts.dryRun) {
    log(`(dry-run)将安装到: ${target};agents=${[...agents].join(',')};不写任何文件`);
    return 0;
  }
  log(`安装到: ${target}`);

  const tk = join(target, '.tidykeep');
  const manifest = loadManifest(target); // 旧文本 manifest 自动迁移读取
  manifest.toolVersion = version;
  manifest.runtimeVersion = version;
  manifest.installedAt ||= new Date().toISOString();
  manifest.agents = [...new Set([...(manifest.agents ?? []), ...agents])];

  // ---------- 0. 旧 bash 版痕迹迁移 ----------
  let legacyCfg = null;
  const legacyConfigPath = join(tk, 'config');
  if (existsSync(legacyConfigPath)) {
    legacyCfg = parseLegacyConfig(readFileSync(legacyConfigPath, 'utf8'));
  }
  for (const legacyPath of [join(tk, 'hooks'), join(tk, 'manifest')]) {
    if (existsSync(legacyPath)) rmSync(legacyPath, { recursive: true, force: true });
  }

  // ---------- 1. 部署 .tidykeep/(机器区整体刷新) ----------
  for (const d of ['backup', '.state']) mkdirSync(join(tk, d), { recursive: true });
  for (const d of ['runtime', 'githooks', 'docs']) {
    rmSync(join(tk, d), { recursive: true, force: true });
  }
  cpSync(join(PAYLOAD, 'runtime'), join(tk, 'runtime'), { recursive: true });
  cpSync(join(PAYLOAD, 'githooks'), join(tk, 'githooks'), { recursive: true });
  mkdirSync(join(tk, 'docs'), { recursive: true });
  copyFileSync(join(PAYLOAD, 'docs', 'workflows.md'), join(tk, 'docs', 'workflows.md'));
  chmodAll(join(tk, 'githooks'));
  chmodAll(join(tk, 'runtime'));

  // ---------- 2. 用户区(存在不动) ----------
  const cfgPath = join(tk, 'config.jsonc');
  if (!existsSync(cfgPath)) {
    let text = readFileSync(join(PAYLOAD, 'config.jsonc'), 'utf8');
    if (legacyCfg) {
      text = renderConfigFromLegacy(text, legacyCfg);
      log('已迁移旧 KEY=VALUE 配置 → config.jsonc(值保留,旧文件删除)');
    }
    if (opts.scratchDir) text = replaceJsoncValue(text, 'SCRATCH_DIR', opts.scratchDir);
    if (opts.ledgerMode) text = replaceJsoncValue(text, 'ENFORCE_LEDGER', opts.ledgerMode);
    writeFileSync(cfgPath, text);
  } else {
    if (opts.scratchDir) writeFileSync(cfgPath, replaceJsoncValue(readFileSync(cfgPath, 'utf8'), 'SCRATCH_DIR', opts.scratchDir));
    if (opts.ledgerMode) writeFileSync(cfgPath, replaceJsoncValue(readFileSync(cfgPath, 'utf8'), 'ENFORCE_LEDGER', opts.ledgerMode));
  }
  if (legacyCfg) unlinkSync(legacyConfigPath);
  if (!existsSync(join(tk, 'allowlist'))) copyFileSync(join(PAYLOAD, 'allowlist'), join(tk, 'allowlist'));
  const scratch = (opts.scratchDir ?? legacyCfg?.SCRATCH_DIR ?? '.tmp').replace(/^\/+|\/+$/g, '');

  // ---------- 3. AGENTS.md(唯一规则入口) ----------
  const rules = readFileSync(join(PAYLOAD, 'rules.md'), 'utf8');
  recordFile(manifest, 'AGENTS.md', upsertBlockFile(join(target, 'AGENTS.md'), MD_BEGIN, MD_END, rules));
  log('AGENTS.md 协议块已注入');

  // ---------- 4. STATE / LEDGER / 草稿区 / gitignore / gitattributes ----------
  for (const f of ['STATE.md', 'LEDGER.md']) {
    if (!existsSync(join(target, f))) {
      copyFileSync(join(PAYLOAD, f), join(target, f));
      recordFile(manifest, f, 'created');
      log(`${f} 已创建`);
    }
  }
  mkdirSync(join(target, scratch), { recursive: true });
  recordFile(manifest, '.gitignore', upsertBlockFile(join(target, '.gitignore'), HASH_BEGIN, HASH_END, gitignoreBlock(scratch)));
  recordFile(manifest, '.gitattributes', upsertBlockFile(join(target, '.gitattributes'), HASH_BEGIN, HASH_END, GITATTRIBUTES_BLOCK));

  // ---------- 5. Claude Code ----------
  if (agents.has('claude')) {
    recordFile(manifest, 'CLAUDE.md', upsertBlockFile(join(target, 'CLAUDE.md'), MD_BEGIN, MD_END, CLAUDE_POINTER));
    const settingsPath = join(target, '.claude', 'settings.json');
    const before = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : undefined;
    if (before !== undefined && !existsSync(join(tk, 'backup', 'settings.json.bak'))) {
      writeFileSync(join(tk, 'backup', 'settings.json.bak'), before);
    }
    const merged = mergeSettingsText(before, claudeHookGroups());
    if (merged.status === 'skipped') {
      log('警告: .claude/settings.json 无法解析,跳过 hooks 合并');
    } else {
      mkdirSync(join(target, '.claude'), { recursive: true });
      writeFileSync(settingsPath, merged.text);
      recordFile(manifest, '.claude/settings.json', merged.status);
    }
    mkdirSync(join(target, '.claude', 'skills', 'tidykeep'), { recursive: true });
    copyFileSync(join(PAYLOAD, 'skill', 'SKILL.md'), join(target, '.claude', 'skills', 'tidykeep', 'SKILL.md'));
    log('Claude Code 层就绪(hooks + 技能 + CLAUDE.md 指针)');
  }

  // ---------- 6. Codex(项目级 .codex/hooks.json,可入库) ----------
  if (agents.has('codex')) {
    const codexPath = join(target, '.codex', 'hooks.json');
    const before = existsSync(codexPath) ? readFileSync(codexPath, 'utf8') : undefined;
    if (before !== undefined && !existsSync(join(tk, 'backup', 'codex-hooks.json.bak'))) {
      writeFileSync(join(tk, 'backup', 'codex-hooks.json.bak'), before);
    }
    const merged = mergeSettingsText(before, codexHookGroups());
    if (merged.status === 'skipped') {
      log('警告: .codex/hooks.json 无法解析,跳过 hooks 合并');
    } else {
      mkdirSync(join(target, '.codex'), { recursive: true });
      writeFileSync(codexPath, merged.text);
      recordFile(manifest, '.codex/hooks.json', merged.status);
    }
    log('Codex 层就绪(.codex/hooks.json,随仓库分发)');
  }

  // ---------- 7. Kimi(项目技能 + 全局 hooks,引用计数) ----------
  if (agents.has('kimi')) {
    mkdirSync(join(target, '.agents', 'skills', 'tidykeep'), { recursive: true });
    copyFileSync(join(PAYLOAD, 'skill', 'SKILL.md'), join(target, '.agents', 'skills', 'tidykeep', 'SKILL.md'));
    const r = installKimiGlobal(target, { payloadDir: PAYLOAD, log });
    manifest.kimi = { status: r.status, configToml: r.configToml ?? null };
    if (r.status === 'installed') log('Kimi 层就绪(全局 hooks 经 ~/.tidykeep/kimi-shim.mjs 路由,未启用项目零影响)');
  }

  // ---------- 8. git hooks(兜底层) ----------
  if (opts.noGitHooks) {
    manifest.hookspath = 'none';
  } else if (git(target, 'rev-parse', '--git-dir').status !== 0) {
    manifest.hookspath = 'nogit';
    log('非 git 仓库:跳过 git hooks 层(建议 git init 后重跑 init)');
  } else {
    const cur = git(target, 'config', 'core.hooksPath').stdout.trim();
    if (!cur) {
      git(target, 'config', 'core.hooksPath', '.tidykeep/githooks');
      manifest.hookspath = 'set';
      log('git core.hooksPath -> .tidykeep/githooks(原 .git/hooks 同名 hook 会被链式执行)');
    } else if (cur === '.tidykeep/githooks') {
      manifest.hookspath = 'set';
    } else {
      manifest.hookspath = 'external';
      log(`检测到已有 core.hooksPath=${cur}(如 husky),未覆盖。请在其 pre-commit/commit-msg 中各加一行:`);
      log('  sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/pre-commit" "$@" || exit $?');
      log('  sh "$(git rev-parse --show-toplevel)/.tidykeep/githooks/commit-msg" "$@" || exit $?');
    }
  }

  saveManifest(target, manifest);
  log(`安装完成 ✅(v${version})`);
  log('下一步: 1) 在任一 Agent 里说"tidykeep 初始化扫描"建立台账;');
  log('        2) 将 AGENTS.md CLAUDE.md STATE.md LEDGER.md .tidykeep .claude .codex .agents 提交入库;');
  log('        3) 团队成员克隆后执行一次: node .tidykeep/runtime/enable-githooks.mjs');
  return 0;
}
