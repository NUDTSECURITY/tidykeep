import { after } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TESTS_ROOT = join(PROJECT_ROOT, '.tmp', 'tests');
let runRoot = null;

function ensureRunRoot() {
  if (runRoot) return runRoot;
  mkdirSync(TESTS_ROOT, { recursive: true });
  runRoot = mkdtempSync(join(TESTS_ROOT, 'run-'));
  return runRoot;
}

export function makeTempDir(prefix = 'fixture-') {
  return mkdtempSync(join(ensureRunRoot(), prefix));
}

/** npm pack/install 需要离线缓存目录，否则会打到真实 registry。 */
export function isolatedEnv(extra = {}) {
  const npmCache = join(ensureRunRoot(), 'npm-cache');
  mkdirSync(npmCache, { recursive: true });
  return { ...process.env, npm_config_cache: npmCache, ...extra };
}

export function cleanupTestTemps() {
  if (!runRoot || !existsSync(runRoot)) return;
  try { rmSync(runRoot, { recursive: true, force: true }); } catch { /* 下次运行覆盖 */ }
  runRoot = null;
}

after(cleanupTestTemps);
process.once('exit', cleanupTestTemps);
