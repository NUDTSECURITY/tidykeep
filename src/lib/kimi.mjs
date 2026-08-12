// Kimi Code 全局层:hooks 只能配置在用户全局 config.toml(项目级 local.toml 仅支持
// [workspace],官方文档核实于 2026-08),因此这里以标记行块注入全局文件,并用
// ~/.tidykeep/manifest.json 维护"哪些项目在用"的引用计数——最后一个项目卸载时
// 才剥离全局块并移除 shim。config.toml 不做 TOML 解析,纯行级标记块操作。
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { upsertBlockText, stripBlockText } from './markers.mjs';
import { HASH_BEGIN, HASH_END, kimiTomlBlock } from './blocks.mjs';
import { toPosix } from '../../payload/runtime/core.mjs';

export function kimiPaths(env = process.env) {
  const kimiHome = env.KIMI_CODE_HOME || join(homedir(), '.kimi-code');
  const userDir = env.TIDYKEEP_USER_DIR || join(homedir(), '.tidykeep');
  return {
    kimiHome,
    configToml: join(kimiHome, 'config.toml'),
    userDir,
    shim: join(userDir, 'kimi-shim.mjs'),
    userManifest: join(userDir, 'manifest.json'),
  };
}

function loadUserManifest(path) {
  try {
    return { projects: [], ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { projects: [] };
  }
}

export function installKimiGlobal(projectRoot, { env = process.env, payloadDir, log = () => {} }) {
  const p = kimiPaths(env);
  if (!existsSync(p.kimiHome)) {
    log(`未检测到 Kimi Code(${p.kimiHome} 不存在),跳过 Kimi hooks 层`);
    return { status: 'skipped-no-kimi' };
  }
  const tomlText = existsSync(p.configToml) ? readFileSync(p.configToml, 'utf8') : '';
  if (!tomlText.includes(HASH_BEGIN) && /^\s*hooks\s*=/m.test(tomlText)) {
    log(`检测到 ${p.configToml} 使用内联 hooks 数组,无法自动注入;请手动合并以下两条 hook:`);
    log(kimiTomlBlock(toPosix(p.shim)));
    return { status: 'skipped-inline-hooks' };
  }

  mkdirSync(p.userDir, { recursive: true });
  copyFileSync(join(payloadDir, 'runtime', 'kimi-shim.mjs'), p.shim);

  const um = loadUserManifest(p.userManifest);
  const rootAbs = toPosix(resolve(projectRoot));
  if (!um.projects.includes(rootAbs)) um.projects.push(rootAbs);
  writeFileSync(p.userManifest, JSON.stringify(um, null, 2) + '\n');

  const { text: next } = upsertBlockText(tomlText, HASH_BEGIN, HASH_END, kimiTomlBlock(toPosix(p.shim)));
  if (next !== tomlText) {
    if (tomlText) {
      const backupDir = join(p.userDir, 'backup');
      mkdirSync(backupDir, { recursive: true });
      writeFileSync(join(backupDir, `config.toml.${Date.now()}.bak`), tomlText);
    }
    writeFileSync(p.configToml, next);
  }
  return { status: 'installed', configToml: p.configToml, shim: p.shim };
}

export function uninstallKimiGlobal(projectRoot, { env = process.env, log = () => {} }) {
  const p = kimiPaths(env);
  const um = loadUserManifest(p.userManifest);
  const rootAbs = toPosix(resolve(projectRoot));
  const before = um.projects.length;
  um.projects = um.projects.filter((x) => x !== rootAbs);
  if (!existsSync(p.userDir)) return { status: 'not-installed' };
  if (um.projects.length > 0) {
    writeFileSync(p.userManifest, JSON.stringify(um, null, 2) + '\n');
    if (before !== um.projects.length) log(`Kimi 全局 hooks 保留(仍有 ${um.projects.length} 个项目在用)`);
    return { status: 'kept', remaining: um.projects.length };
  }
  // 最后一个项目:剥全局块、移除 shim 与用户清单(备份保留)
  if (existsSync(p.configToml)) {
    const text = readFileSync(p.configToml, 'utf8');
    const { text: stripped, stripped: did } = stripBlockText(text, HASH_BEGIN, HASH_END);
    if (did) writeFileSync(p.configToml, stripped);
  }
  for (const f of [p.shim, p.userManifest]) {
    try { unlinkSync(f); } catch { /* 不存在即视为已清理 */ }
  }
  try { rmSync(p.userDir, { recursive: false }); } catch { /* 留有 backup/ 时保留目录 */ }
  log('Kimi 全局 hooks 已移除(最后一个使用项目已卸载)');
  return { status: 'removed' };
}
