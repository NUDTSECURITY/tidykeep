import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function hashFile(path) {
  return sha256(readFileSync(path));
}

/** 同目录 write+rename，避免进程中断留下半截 JSON/配置/运行时文件。 */
export function atomicWriteFile(path, data, { mode } = {}) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  let targetMode = mode;
  if (targetMode === undefined && existsSync(path)) {
    // rename 会用临时文件的权限整体替换目标；默认继承既有权限，避免把 0600
    // 的 settings/token 配置悄悄放宽为受 umask 影响的默认模式。
    try { targetMode = statSync(path).mode & 0o7777; } catch { /* 竞态时沿用新文件默认 */ }
  }
  const temp = join(dir, `.${basename(path)}.atomic-${process.pid}-${randomBytes(6).toString('hex')}`);
  try {
    writeFileSync(temp, data);
    if (targetMode !== undefined) {
      try { chmodSync(temp, targetMode); } catch { /* Windows 无 POSIX 执行位 */ }
    }
    renameSync(temp, path);
  } finally {
    try { unlinkSync(temp); } catch { /* rename 成功或写入尚未发生 */ }
  }
}
