import { after } from 'node:test';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TESTS_ROOT = join(PROJECT_ROOT, '.tmp', 'tests');
let runRoot = null;

function remove(path) {
  try { rmSync(path, { recursive: true, force: true }); } catch { /* 最终由 tidykeep 残留检查报告 */ }
}

function cleanupStaleRuns() {
  let names = [];
  try { names = readdirSync(TESTS_ROOT); } catch { return; }
  for (const name of names) {
    const match = name.match(/^run-(\d+)-/);
    if (!match || Number(match[1]) === process.pid) continue;
    try {
      process.kill(Number(match[1]), 0);
    } catch (error) {
      if (error?.code === 'ESRCH') remove(join(TESTS_ROOT, name));
    }
  }
}

function ensureRunRoot() {
  if (runRoot) return runRoot;
  mkdirSync(TESTS_ROOT, { recursive: true });
  cleanupStaleRuns();
  runRoot = mkdtempSync(join(TESTS_ROOT, `run-${process.pid}-`));
  return runRoot;
}

export function makeTempDir(prefix = 'fixture-') {
  return mkdtempSync(join(ensureRunRoot(), prefix));
}

export function isolatedEnv(extra = {}) {
  const base = join(ensureRunRoot(), 'env');
  const systemTmp = join(base, 'tmp');
  const npmCache = join(base, 'npm-cache');
  mkdirSync(systemTmp, { recursive: true });
  mkdirSync(npmCache, { recursive: true });
  return {
    ...process.env,
    TMPDIR: systemTmp,
    TMP: systemTmp,
    TEMP: systemTmp,
    npm_config_cache: npmCache,
    ...extra,
  };
}

export function cleanupTestTemps() {
  if (!runRoot || !existsSync(runRoot)) return;
  remove(runRoot);
  runRoot = null;
  try {
    if (readdirSync(TESTS_ROOT).length === 0) remove(TESTS_ROOT);
  } catch { /* 已清理 */ }
}

after(cleanupTestTemps);
process.once('exit', cleanupTestTemps);
