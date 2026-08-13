// v2 清单没有记录机器区文件。只能接管本仓库明确发布过的逐文件 hash，不能因
// 路径位于 .tidykeep/ 就推断所有权。新增历史版本时在这里追加 hash，而不是放宽匹配。
import { hashFile } from './fs-safe.mjs';

const hashes = (values) => new Set(values);

const V2_ASSET_HASHES = new Map([
  ['.tidykeep/runtime/core.mjs', hashes([
    '0f976b5cab92907b06bd6b2ee1d414d1080b425a528842bbd1ee11213a5dfda2',
    'f4870d3a38ed2bd32c12b7db7402477b2708ef2e29455a191fdea77d3494e6be',
    '8cdc0f8d79dba5fbc8b41994434ee34046830f0372ea2f16adf5abaccf3cc863',
  ])],
  ['.tidykeep/runtime/enable-githooks.mjs', hashes([
    '579f3fa3f823eb9316540eafbf7be1aa71d1cb2429a971c14e6f204961da7acd',
  ])],
  ['.tidykeep/runtime/githook.mjs', hashes([
    '500f7e3448fa71ac6a879a675e75b92c4a5cd6d7762e901cd6b1f93eaac8bbe5',
    '1999dab04d1b3147df064e3b4064f9161b71006898a0553b1ce90a1dec1e66b8',
  ])],
  ['.tidykeep/runtime/hook.mjs', hashes([
    '22e8c5cdac1356c97ec593de970bf4fe8b11f75ae0bc7a9063e98ca4369f2131',
    '38fcad3d2bddbacaa8fb0efc9527cf0eaa9f9c3f010e3c3939ff36df22181ace',
    'e784f0ff9aeef45772c0f8792c5828ce6dcd74fde1ea979e173e65a5ce474ceb',
    'bb58c2a9524292233660f128e82a758f14fe456904330302f83302eb9552ed9f',
  ])],
  ['.tidykeep/runtime/kimi-shim.mjs', hashes([
    '27640aadc3ce6ccc78584002f19f05830149bb48ba3b7e29f85b1aa438a72f3a',
    '8161954fa387c13cba6e9f19502920dccb55914680c0e50efff2bd04989e06fd',
  ])],
  ['.tidykeep/runtime/messages.mjs', hashes([
    '968647f8eba355c325453e5b158aad1841bdaba80017a3b1a99410e91dbada03',
    'ed31c998bc2ec600875d6dfc760e2ae55d9676a440958e53e465be620fe839e3',
  ])],
  ['.tidykeep/githooks/pre-commit', hashes([
    'b6f1c8d88386550e9dd61acbe49b4d05600c1f29a4c3db6bd02b453a0cc8dd23',
  ])],
  ['.tidykeep/githooks/commit-msg', hashes([
    '6f4c5ed8aec05e4ef3d4c7729dcfe5d709e1651d80e064a89e6afd1a5f903b88',
  ])],
  ['.tidykeep/docs/workflows.md', hashes([
    'fda63b9312ce34eeef0185e66092d99cb128869fe52869132e9156b53a4bb63b',
  ])],
  ['.claude/skills/tidykeep/SKILL.md', hashes([
    '834749ba544875886afd71dfccc95af7139f31bc12d297832115571856e1dbb3',
  ])],
  ['.agents/skills/tidykeep/SKILL.md', hashes([
    '834749ba544875886afd71dfccc95af7139f31bc12d297832115571856e1dbb3',
  ])],
]);

const V2_KIMI_SHIM_HASHES = new Set([
  '27640aadc3ce6ccc78584002f19f05830149bb48ba3b7e29f85b1aa438a72f3a',
  '8161954fa387c13cba6e9f19502920dccb55914680c0e50efff2bd04989e06fd',
]);

// v1(bash + Python)曾发布的两个项目内 hook。迁移时只删除这些精确内容；
// 同名文件即使被旧 settings 引用，也可能已被用户接管或修改，不能按路径猜所有权。
const V1_PYTHON_HOOK_HASHES = new Map([
  ['.tidykeep/hooks/guard_stale_names.py', hashes([
    'f0e8a18df52de6040293b6cadf7ded1e1cc0142a1a78c009729c5fd32226c65c',
  ])],
  ['.tidykeep/hooks/stop_sync_check.py', hashes([
    '67a4e336c06afc443bcca1a9d48abe3337513d463d26bb74d7f19170369e47d4',
  ])],
]);

export function isKnownLegacyV2Asset(manifest, rel, path) {
  try { return isKnownLegacyV2AssetHash(manifest, rel, hashFile(path)); } catch { return false; }
}

export function isKnownLegacyV2AssetHash(manifest, rel, hash) {
  if (manifest?.legacyVersion !== 2) return false;
  const allowed = V2_ASSET_HASHES.get(rel);
  if (!allowed) return false;
  if (rel.startsWith('.claude/') && !manifest.agents?.includes('claude')) return false;
  if (rel.startsWith('.agents/') && !manifest.agents?.includes('kimi')) return false;
  return allowed.has(hash);
}

// v3 manifest 本身位于项目内，hash 字段不能单独构成机器资产所有权证明。
// 所有自动覆盖/删除还必须匹配本工具确实发布过的历史内容。
export function isKnownPublishedManagedAsset(rel, path) {
  try { return isKnownPublishedManagedAssetHash(rel, hashFile(path)); } catch { return false; }
}

export function isKnownPublishedManagedAssetHash(rel, hash) {
  return V2_ASSET_HASHES.get(rel)?.has(hash) ?? false;
}

export function isKnownLegacyV2KimiShim(manifest, path) {
  if (manifest?.legacyVersion !== 2) return false;
  const tracked = manifest.agents?.includes('kimi');
  if (!tracked) return false;
  try { return V2_KIMI_SHIM_HASHES.has(hashFile(path)); } catch { return false; }
}

export function isKnownLegacyV1PythonHookHash(manifest, rel, hash) {
  if (manifest?.legacyVersion !== 1) return false;
  return V1_PYTHON_HOOK_HASHES.get(rel)?.has(hash) ?? false;
}
