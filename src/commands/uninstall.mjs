// `tidykeep uninstall` —— 按 manifest 精确回滚:只剥标记块与我们的 hook 条目,
// 文件仅当"本工具创建且剥空"才删除;STATE/LEDGER 默认保留(--purge 才删)。
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stripBlockFile } from '../lib/markers.mjs';
import { loadManifest, wasCreated } from '../lib/manifest.mjs';
import { stripSettingsText } from '../lib/settings-json.mjs';
import { MD_BEGIN, MD_END, HASH_BEGIN, HASH_END } from '../lib/blocks.mjs';
import { uninstallKimiGlobal } from '../lib/kimi.mjs';
import { loadConfig } from '../../payload/runtime/core.mjs';

const git = (root, ...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false });

export function uninstall(targetArg, opts = {}) {
  const target = resolve(targetArg || process.cwd());
  const log = (s) => console.log(`[tidykeep] ${s}`);
  if (opts.dryRun) {
    log(`(dry-run)将从 ${target} 卸载;不写任何文件`);
    return 0;
  }
  const manifest = loadManifest(target);
  const cfg = loadConfig(target);
  const scratch = cfg.SCRATCH_DIR ?? '.tmp';
  log(`从 ${target} 卸载`);

  // 1. 标记块(GEMINI.md 是旧 bash 版可能留下的,顺带收拾)
  const mdTargets = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];
  const hashTargets = ['.gitignore', '.gitattributes'];
  for (const rel of mdTargets) {
    const st = stripBlockFile(join(target, rel), MD_BEGIN, MD_END);
    if (st === 'empty' && wasCreated(manifest, rel)) {
      unlinkSync(join(target, rel));
      log(`已删除 ${rel}(本工具创建且已无其他内容)`);
    } else if (st !== 'missing') {
      log(`已移除 ${rel} 中的 tidykeep 块`);
    }
  }
  for (const rel of hashTargets) {
    const st = stripBlockFile(join(target, rel), HASH_BEGIN, HASH_END);
    if (st === 'empty' && wasCreated(manifest, rel)) unlinkSync(join(target, rel));
  }

  // 2. hooks JSON(Claude / Codex 同一套剥离)
  for (const rel of ['.claude/settings.json', '.codex/hooks.json']) {
    const path = join(target, rel);
    if (!existsSync(path)) continue;
    const r = stripSettingsText(readFileSync(path, 'utf8'));
    if (r.status === 'skipped') {
      log(`警告: ${rel} 无法解析,未改动(原始备份见 .tidykeep/backup/)`);
    } else if (r.status === 'empty' && wasCreated(manifest, rel)) {
      unlinkSync(path);
      log(`已删除 ${rel}(本工具创建且已无其他内容)`);
    } else {
      writeFileSync(path, r.text || '{}\n');
      log(`已移除 ${rel} 中的 tidykeep hooks`);
    }
  }

  // 3. 技能
  for (const dir of [join(target, '.claude', 'skills', 'tidykeep'), join(target, '.agents', 'skills', 'tidykeep')]) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of [
    join(target, '.claude', 'skills'), join(target, '.claude'),
    join(target, '.agents', 'skills'), join(target, '.agents'),
    join(target, '.codex'),
  ]) {
    try { rmdirSync(dir); } catch { /* 非空即保留 */ }
  }

  // 4. git hooksPath(仅当是本工具设置时还原)
  if (manifest.hookspath === 'set') {
    const cur = git(target, 'config', 'core.hooksPath').stdout.trim();
    if (cur === '.tidykeep/githooks') {
      git(target, 'config', '--unset', 'core.hooksPath');
      log('已还原 git core.hooksPath');
    }
  }

  // 5. Kimi 全局(引用计数,最后一个项目才移除)
  uninstallKimiGlobal(target, { log });

  // 6. 知识文件
  if (opts.purge) {
    for (const f of ['STATE.md', 'LEDGER.md']) {
      if (wasCreated(manifest, f) && existsSync(join(target, f))) {
        unlinkSync(join(target, f));
        log(`--purge 已删除 ${f}`);
      }
    }
    for (const d of [scratch, 'scratch']) {
      try { rmdirSync(join(target, d)); } catch { /* 非空/不存在即保留 */ }
    }
  } else {
    log(`已保留 STATE.md / LEDGER.md / ${scratch}/(项目知识;--purge 可移除)`);
  }

  rmSync(join(target, '.tidykeep'), { recursive: true, force: true });
  log('卸载完成 ✅');
  return 0;
}
