import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { acquireDirectoryLock, releaseDirectoryLock } from './directory-lock.mjs';

const LOCK_REL = '.tidykeep/.install-lock';
/** 原子 mkdir 提供跨进程互斥；崩溃残留须人工核实后删除，不自动竞态回收。 */
export function acquireProjectLock(target, operation) {
  const tidykeep = join(target, '.tidykeep');
  const lockPath = join(target, LOCK_REL);
  mkdirSync(tidykeep, { recursive: true });
  return acquireDirectoryLock(lockPath, {
    operation, busyMessage: '项目正被另一个 tidykeep 进程占用',
  });
}

export function releaseProjectLock(lock) {
  releaseDirectoryLock(lock);
}
