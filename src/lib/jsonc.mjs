// JSONC 解析复用 runtime core(单一真源);replaceJsoncValue 是 CLI 侧独有的
// 行级回写(不 parse→stringify,注释与排版零损失)。
export { parseJsonc } from '../../payload/runtime/core.mjs';

export function replaceJsoncValue(text, key, value) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`("${esc}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|\\[[^\\]]*\\]|true|false|-?\\d+(?:\\.\\d+)?)`);
  return text.replace(re, (_m, p1) => p1 + JSON.stringify(value));
}
