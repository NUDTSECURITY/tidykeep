// `tidykeep doctor` —— 深度体检:环境、执行位、EOL、hooks 条目、runtime 探针、
// 版本漂移、AGENTS.md 体积预算。--fix 修复安全项(chmod、CRLF→LF)。
import {
  chmodSync, existsSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadManifest } from '../lib/manifest.mjs';
import { isOursHook } from '../lib/settings-json.mjs';

const AGENTS_BUDGET = 28 * 1024; // Codex/Kimi 对指令文件有 32 KiB 预算,留余量预警

function pkgVersion() {
  return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
}

export function doctor(targetArg, opts = {}) {
  const target = resolve(targetArg || process.cwd());
  const results = [];
  const check = (name, ok, note = '', fixable = false) => results.push({ name, ok, note, fixable });

  if (!existsSync(join(target, '.tidykeep'))) {
    console.log(`[tidykeep] 未安装: ${target}(先运行 npx tidykeep init)`);
    return 1;
  }
  const manifest = loadManifest(target);

  // 1. 环境
  const gitOk = spawnSync('git', ['--version'], { encoding: 'utf8', shell: false }).status === 0;
  check('git 可用', gitOk);
  check('node 版本 >= 20.11', Number(process.versions.node.split('.')[0]) >= 20, `当前 ${process.versions.node}`);

  // 2. runtime 完整性 + 版本漂移
  const runtimeOk = ['core.mjs', 'messages.mjs', 'hook.mjs', 'githook.mjs', 'enable-githooks.mjs', 'kimi-shim.mjs']
    .every((f) => existsSync(join(target, '.tidykeep', 'runtime', f)));
  check('runtime 文件完整', runtimeOk, runtimeOk ? '' : '重跑 npx tidykeep init 可修复');
  check('runtime 版本与 CLI 一致', manifest.runtimeVersion === pkgVersion(),
    `已装 ${manifest.runtimeVersion || '?'} / CLI ${pkgVersion()}(不一致时重跑 init)`);

  // 3. git hooks:执行位 + EOL
  for (const name of ['pre-commit', 'commit-msg']) {
    const p = join(target, '.tidykeep', 'githooks', name);
    if (!existsSync(p)) { check(`githooks/${name} 存在`, false, '重跑 init 可修复'); continue; }
    const text = readFileSync(p, 'utf8');
    const crlf = text.includes('\r');
    let crlfFixed = false;
    if (crlf && opts.fix) {
      try { writeFileSync(p, text.replaceAll('\r\n', '\n')); crlfFixed = true; } catch { /* 权限不足等,下方如实报告 */ }
    }
    check(`githooks/${name} 为 LF`, !crlf || crlfFixed, crlf ? (crlfFixed ? '已修复' : '被 CRLF 污染(--fix 修复)') : '', true);
    const exec = process.platform === 'win32' || Boolean(statSync(p).mode & 0o100);
    let execFixed = false;
    if (!exec && opts.fix) {
      try { chmodSync(p, 0o755); execFixed = true; } catch { /* 同上 */ }
    }
    check(`githooks/${name} 可执行`, exec || execFixed, exec ? '' : (execFixed ? '已修复' : '缺执行位(--fix 修复)'), true);
  }

  // 4. hooks JSON 条目健康(每个文件恰好一组我们的条目集,无重复)
  for (const rel of ['.claude/settings.json', '.codex/hooks.json']) {
    const p = join(target, rel);
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'));
      let ours = 0;
      for (const groups of Object.values(data.hooks ?? {})) {
        for (const grp of groups) ours += (grp.hooks ?? []).filter(isOursHook).length;
      }
      check(`${rel} 含 tidykeep 条目且无重复`, ours >= 1 && ours <= 4, `条目数 ${ours}(异常时重跑 init 去重)`);
    } catch {
      check(`${rel} 可解析`, false, 'JSON 损坏,请手工修复(备份见 .tidykeep/backup/)');
    }
  }

  // 5. runtime 探针:伪造 Write /tmp 事件,期望 deny
  const probe = spawnSync('node', [join(target, '.tidykeep', 'runtime', 'hook.mjs'), 'claude-pretooluse'], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/tidykeep-doctor-probe.sh' }, cwd: target }),
    encoding: 'utf8',
    cwd: target,
    env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
  });
  let probeOk = false;
  try { probeOk = JSON.parse(probe.stdout).hookSpecificOutput.permissionDecision === 'deny'; } catch { /* 保持 false */ }
  check('runtime 探针(拦截 /tmp 写入)', probeOk, probeOk ? '' : 'hook 未按预期拦截,检查 config.jsonc 与 runtime');

  // 6. AGENTS.md 体积预算
  const agentsPath = join(target, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    const size = statSync(agentsPath).size;
    check('AGENTS.md 体积在 Codex/Kimi 32KiB 预算内', size < AGENTS_BUDGET, `${(size / 1024).toFixed(1)} KiB`);
  }

  // 7. hooksPath
  const hp = spawnSync('git', ['-C', target, 'config', 'core.hooksPath'], { encoding: 'utf8', shell: false });
  const hpVal = hp.status === 0 ? hp.stdout.trim() : '';
  check('git hooks 已接管或有替代方案', manifest.hookspath !== 'set' || hpVal === '.tidykeep/githooks',
    hpVal ? `core.hooksPath=${hpVal}` : '未接管(node .tidykeep/runtime/enable-githooks.mjs 可启用)');

  let bad = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? '✔' : '✖'} ${r.name}${r.note ? `  — ${r.note}` : ''}`);
    if (!r.ok) bad++;
  }
  console.log(bad === 0 ? '[tidykeep] 体检通过 ✅' : `[tidykeep] ${bad} 项异常${opts.fix ? '' : '(部分可 --fix 修复)'}`);
  return bad === 0 ? 0 : 1;
}
