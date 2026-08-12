// 安装清单 v2(.tidykeep/manifest.json)。语义沿用初稿纯文本 manifest:
// 同一文件只记录首次状态(created|modified),uninstall 仅对 created 且剥空的文件删除。
// 兼容读取旧 bash 版的纯文本清单,init 时自动迁移。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const skeleton = () => ({
  manifestVersion: 2,
  toolVersion: '',
  runtimeVersion: '',
  installedAt: '',
  agents: [],
  files: {},
  hookspath: 'none',
  kimi: null,
  backups: [],
});

export function parseLegacyManifest(text) {
  const m = skeleton();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [word, ...rest] = line.split(' ');
    const arg = rest.join(' ');
    if ((word === 'created' || word === 'modified') && arg) {
      if (!(arg in m.files)) m.files[arg] = word;
    } else if (word === 'hookspath' && arg) {
      m.hookspath = arg;
    }
  }
  return m;
}

export function loadManifest(dir) {
  const jsonPath = join(dir, '.tidykeep', 'manifest.json');
  if (existsSync(jsonPath)) {
    try {
      return { ...skeleton(), ...JSON.parse(readFileSync(jsonPath, 'utf8')) };
    } catch {
      return skeleton();
    }
  }
  const legacyPath = join(dir, '.tidykeep', 'manifest');
  if (existsSync(legacyPath)) {
    return parseLegacyManifest(readFileSync(legacyPath, 'utf8'));
  }
  return skeleton();
}

export function saveManifest(dir, m) {
  writeFileSync(join(dir, '.tidykeep', 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
}

export function recordFile(m, rel, state) {
  // first-wins 保护用户原有文件;唯一例外:再次 init 时文件实际是新建的(用户已删除
  // 原文件),说明当前内容完全属于本工具,过期的 modified 记录应刷新为 created。
  if (!(rel in m.files) || (state === 'created' && m.files[rel] !== 'created')) {
    m.files[rel] = state;
  }
}

export function wasCreated(m, rel) {
  return m.files[rel] === 'created';
}
