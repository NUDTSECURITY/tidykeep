import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync,
  statSync, unlinkSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile } from './fs-safe.mjs';

const OWNER = 'owner.json';
const LEGACY_OWNER = 'owner';
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

function readOwner(lockPath) {
  try {
    const path = join(lockPath, OWNER);
    if (statSync(path).size > 32_768) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch { /* 兼容旧 Kimi 锁的单行 PID owner 文件 */ }
  try {
    const path = join(lockPath, LEGACY_OWNER);
    if (statSync(path).size > 64) return null;
    const pid = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, hostname: hostname(), operation: 'legacy' };
  } catch { return null; }
}

function ownedLayout(lockPath) {
  try {
    if (!lstatSync(lockPath).isDirectory()) return { safe: false, owner: null };
  } catch { return { safe: false, owner: null }; }
  let names;
  try { names = readdirSync(lockPath); } catch { return { safe: false, owner: null }; }
  if (names.length > 1 || (names.length === 1 && ![OWNER, LEGACY_OWNER].includes(names[0]))) {
    return { safe: false, owner: null };
  }
  if (names.length === 1) {
    try {
      if (!lstatSync(join(lockPath, names[0])).isFile()) return { safe: false, owner: null };
    } catch { return { safe: false, owner: null }; }
  }
  return { safe: true, owner: readOwner(lockPath), names };
}

/**
 * 原子目录锁。崩溃残留也不自动回收：检查与 rename 回收之间无法保证后来者不会
 * 换入新锁，宁可要求人工核实 PID 后删除，也不破坏互斥。
 */
export function acquireDirectoryLock(lockPath, {
  operation = 'operation', attempts = 1, waitMs = 0,
  busyMessage = '目录正被另一进程占用',
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('锁重试次数必须为正整数');
  for (let attempt = 0; attempt < attempts; attempt++) {
    let created = false;
    try {
      mkdirSync(lockPath);
      created = true;
      const owner = {
        version: 1,
        token: randomBytes(16).toString('hex'),
        pid: process.pid,
        hostname: hostname(),
        operation,
        startedAt: new Date().toISOString(),
      };
      atomicWriteFile(join(lockPath, OWNER), JSON.stringify(owner, null, 2) + '\n', { mode: 0o600 });
      return { path: lockPath, token: owner.token };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        if (created) {
          try {
            const layout = ownedLayout(lockPath);
            if (layout.safe && layout.names.length === 0) rmdirSync(lockPath);
          } catch { /* 保留原错误 */ }
        }
        throw error;
      }
      const layout = ownedLayout(lockPath);
      if (!layout.safe) throw new Error(`${busyMessage}(锁目录含未知内容；拒绝自动删除)`);
      const owner = layout.owner;
      if (attempt + 1 < attempts) {
        if (waitMs > 0) Atomics.wait(waitBuffer, 0, 0, waitMs);
        continue;
      }
      const who = owner
        ? `pid=${owner.pid ?? '?'} host=${owner.hostname ?? '?'} operation=${owner.operation ?? '?'}`
        : 'owner 尚未写入或不可解析';
      throw new Error(`${busyMessage}(${who})；如确认进程已退出，请人工删除此锁目录后重试`);
    }
  }
  throw new Error(`${busyMessage}(重试耗尽)`);
}

export function releaseDirectoryLock(lock) {
  if (!lock?.path || !existsSync(lock.path)) return;
  const layout = ownedLayout(lock.path);
  if (!layout.safe || layout.names.length !== 1 || layout.names[0] !== OWNER
      || !layout.owner || layout.owner.token !== lock.token) return;
  // 先删除精确 token 的 owner，再 rmdir；直到 rmdir 成功前其他获取者都无法 mkdir。
  try {
    const current = ownedLayout(lock.path);
    if (!current.safe || current.names.length !== 1 || current.names[0] !== OWNER
        || current.owner?.token !== lock.token) return;
    unlinkSync(join(lock.path, OWNER));
    rmdirSync(lock.path);
  } catch { /* 竞态或未知内容均 fail-closed 保留 */ }
}
