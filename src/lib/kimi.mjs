// Kimi Code 全局层:hooks 只能配置在用户全局 config.toml(项目级 local.toml 仅支持
// [workspace],官方文档核实于 2026-08),因此这里以标记行块注入全局文件,并以
// ~/.tidykeep/projects.d/ 下"每项目一个标记文件"维护引用计数——原子创建/删除,
// 天然并发安全;最后一个项目卸载时才剥离全局块并移除 shim。
// 项目键做 realpath + (win32) 大小写折叠归一,symlink/大小写差异视为同一项目。
// config.toml 不做 TOML 解析,纯行级标记块操作。
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync,
  realpathSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
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
    projectsDir: join(userDir, 'projects.d'),
  };
}

/** 项目引用计数键:realpath 归一 symlink,win32 折叠大小写 */
function canonicalKey(projectRoot) {
  let abs;
  try { abs = realpathSync(projectRoot); } catch { abs = resolve(projectRoot); }
  let key = toPosix(abs);
  if (process.platform === 'win32') key = key.toLowerCase();
  return key;
}

const entryPath = (projectsDir, key) => join(projectsDir, createHash('sha1').update(key).digest('hex'));

/** 现存注册项目数(顺带清理指向已消失目录的陈旧条目) */
function liveProjects(projectsDir) {
  let names;
  try { names = readdirSync(projectsDir); } catch { return 0; }
  let live = 0;
  for (const name of names) {
    const p = join(projectsDir, name);
    let recorded = '';
    try { recorded = readFileSync(p, 'utf8').trim(); } catch { continue; }
    if (recorded && existsSync(recorded)) live++;
    else { try { unlinkSync(p); } catch { /* 竞态忽略 */ } }
  }
  return live;
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
  const { text: next, status } = upsertBlockText(tomlText, HASH_BEGIN, HASH_END, kimiTomlBlock(toPosix(p.shim)));
  if (status === 'unpaired') {
    log(`警告: ${p.configToml} 中 tidykeep 标记不成对(可能被手工改动),拒绝自动注入;请手工修复标记后重跑 init`);
    return { status: 'skipped-unpaired' };
  }

  mkdirSync(p.projectsDir, { recursive: true });
  copyFileSync(join(payloadDir, 'runtime', 'kimi-shim.mjs'), p.shim);
  const key = canonicalKey(projectRoot);
  writeFileSync(entryPath(p.projectsDir, key), key + '\n');

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
  if (!existsSync(p.userDir)) return { status: 'not-installed' };
  const key = canonicalKey(projectRoot);
  try { unlinkSync(entryPath(p.projectsDir, key)); } catch { /* 未注册即视为已清理 */ }

  const remaining = liveProjects(p.projectsDir);
  if (remaining > 0) {
    log(`Kimi 全局 hooks 保留(仍有 ${remaining} 个项目在用)`);
    return { status: 'kept', remaining };
  }
  // 最后一个项目:剥全局块、移除 shim 与注册目录(备份保留)
  if (existsSync(p.configToml)) {
    const text = readFileSync(p.configToml, 'utf8');
    const { text: strippedText, stripped, status } = stripBlockText(text, HASH_BEGIN, HASH_END);
    if (status === 'unpaired') {
      log(`警告: ${p.configToml} 中 tidykeep 标记不成对,未自动剥离;请手工移除该块`);
    } else if (stripped) {
      writeFileSync(p.configToml, strippedText);
    }
  }
  try { unlinkSync(p.shim); } catch { /* 不存在即已清理 */ }
  try { rmdirSync(p.projectsDir); } catch { /* 竞态残留无害 */ }
  try { rmdirSync(p.userDir); } catch { /* 留有 backup/ 时保留目录 */ }
  log('Kimi 全局 hooks 已移除(最后一个使用项目已卸载)');
  return { status: 'removed' };
}
