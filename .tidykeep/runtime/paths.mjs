// tidykeep runtime 路径原语(vendored;由 `npx tidykeep init` 刷新,请勿手改)。
// 所有路径在内部统一使用 POSIX 斜杠；平台差异集中在本模块处理。
import { homedir as osHomedir, tmpdir as osTmpdir } from 'node:os';

export function toPosix(p) {
  return String(p).replaceAll('\\', '/');
}

function isAbs(p) {
  return p.startsWith('/') || /^[A-Za-z]:\//.test(p);
}

function squash(p) {
  const unc = p.startsWith('//') && !p.startsWith('///'); // UNC \\server\share
  const isDrive = /^[A-Za-z]:\//.test(p);
  const parts = p.split('/');
  const out = [];
  for (const seg of parts) {
    if (seg === '' && out.length) continue;
    if (seg === '.') continue;
    if (seg === '..') { if (out.length > 1 || (out.length === 1 && out[0] !== '' && !isDrive)) out.pop(); continue; }
    out.push(seg);
  }
  const s = out.join('/') || '/';
  return unc ? '/' + s : s;
}

export function normalizePath(p, root, opts = {}) {
  const home = toPosix(opts.homedir ?? osHomedir());
  let q = toPosix(p);
  if (q === '~') q = home;
  else if (q.startsWith('~/')) q = home + q.slice(1);
  else if (/^~[^/]+/.test(q)) {
    // ~otheruser/...:按"其他用户家目录"解析到当前家目录的父级(对齐 python
    // expanduser 的放行语义——项目外路径,不做项目内命名裁决)
    const parent = home.includes('/') ? home.slice(0, home.lastIndexOf('/')) : '/home';
    q = parent + '/' + q.slice(1);
  }
  if (!isAbs(q)) q = toPosix(root).replace(/\/+$/, '') + '/' + q;
  return squash(q);
}

function rootPrefix(root, opts = {}) {
  return normalizePath(toPosix(root), '/', opts).replace(/\/+$/, '') + '/';
}

export function inProject(abs, root, opts = {}) {
  const pref = rootPrefix(root, opts);
  if (process.platform === 'win32' || /^[A-Za-z]:\//.test(pref)) {
    return abs.toLowerCase().startsWith(pref.toLowerCase());
  }
  return abs.startsWith(pref);
}

export function relToRoot(abs, root, opts = {}) {
  return abs.slice(rootPrefix(root, opts).length);
}

export function systemTmpPrefixes(root, opts = {}) {
  const home = toPosix(opts.homedir ?? osHomedir()).replace(/\/+$/, '');
  const env = opts.env ?? process.env;
  const list = [
    '/tmp/', '/var/tmp/', '/private/tmp/', '/private/var/tmp/', '/dev/shm/',
    `${home}/tmp/`, `${home}/.tmp/`,
  ];
  for (const key of ['TMPDIR', 'TEMP', 'TMP']) {
    if (env[key]) list.push(normalizePath(env[key], '/', opts).replace(/\/+$/, '') + '/');
  }
  list.push(toPosix(opts.tmpdir ?? osTmpdir()).replace(/\/+$/, '') + '/');
  return [...new Set(list)];
}

export function matchesTmpPrefix(abs, prefixes, platform = process.platform) {
  // 大小写折叠仅用于本身大小写不敏感的路径体系(win32 / 盘符路径),
  // POSIX 上 /TMP 与 /tmp 是不同目录,不得误判
  return prefixes.some((p) => {
    const dir = p.replace(/\/+$/, '');
    if (platform === 'win32' || /^[A-Za-z]:\//.test(p)) {
      const candidate = abs.toLowerCase();
      const foldedDir = dir.toLowerCase();
      return candidate === foldedDir || candidate.startsWith(foldedDir + '/');
    }
    return abs === dir || abs.startsWith(dir + '/');
  });
}

export function scratchName(cfg) {
  return (cfg.SCRATCH_DIR ?? '.tmp').replace(/^\/+|\/+$/g, '') || '.tmp';
}

/** win32 下项目内相对路径比较不区分大小写 */
export function foldCase(s, platform) {
  return platform === 'win32' ? s.toLowerCase() : s;
}

export function relAllowed(rel, scratch, allow, platform) {
  const r = foldCase(rel, platform);
  if (r.startsWith(foldCase(scratch + '/', platform)) || r.startsWith(foldCase('.tidykeep/', platform))) return true;
  if (allow.has(rel)) return true;
  if (platform === 'win32') {
    for (const a of allow) if (a.toLowerCase() === r) return true;
  }
  return false;
}
