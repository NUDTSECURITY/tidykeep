// JSONC 解析复用 runtime core(单一真源);CLI 侧只做局部替换/追加，避免
// parse→stringify 吞掉用户注释与排版。
import { parseJsonc } from '../../payload/runtime/core.mjs';
export { parseJsonc };

function skipTrivia(text, start) {
  let i = start;
  for (;;) {
    while (/\s/.test(text[i] ?? '')) i++;
    if (text[i] === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      return end === -1 ? text.length : skipTrivia(text, end + 2);
    }
    return i;
  }
}

function stringEnd(text, start) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '"') return i + 1;
  }
  return -1;
}

function compositeEnd(text, start) {
  const stack = [text[start]];
  let state = 'normal';
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (state === 'string') {
      if (c === '\\') i++;
      else if (c === '"') state = 'normal';
      continue;
    }
    if (state === 'line-comment') {
      if (c === '\n') state = 'normal';
      continue;
    }
    if (state === 'block-comment') {
      if (c === '*' && n === '/') { state = 'normal'; i++; }
      continue;
    }
    if (c === '"') { state = 'string'; continue; }
    if (c === '/' && n === '/') { state = 'line-comment'; i++; continue; }
    if (c === '/' && n === '*') { state = 'block-comment'; i++; continue; }
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      const open = stack.pop();
      if ((open === '{' && c !== '}') || (open === '[' && c !== ']')) return -1;
      if (!stack.length) return i + 1;
    }
  }
  return -1;
}

function jsonValueEnd(text, start) {
  if (text[start] === '"') return stringEnd(text, start);
  if (text[start] === '{' || text[start] === '[') return compositeEnd(text, start);
  const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(start));
  return match ? start + match[0].length : -1;
}

export function replaceJsoncValue(text, key, value) {
  let depth = 0;
  let state = 'normal';
  const matches = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (state === 'line-comment') {
      if (c === '\n') state = 'normal';
      continue;
    }
    if (state === 'block-comment') {
      if (c === '*' && n === '/') { state = 'normal'; i++; }
      continue;
    }
    if (c === '/' && n === '/') { state = 'line-comment'; i++; continue; }
    if (c === '/' && n === '*') { state = 'block-comment'; i++; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (c !== '"') continue;
    const end = stringEnd(text, i);
    if (end === -1) return text;
    if (depth === 1) {
      let parsed;
      try { parsed = JSON.parse(text.slice(i, end)); } catch { parsed = null; }
      const colon = skipTrivia(text, end);
      if (parsed === key && text[colon] === ':') {
        const valueStart = skipTrivia(text, colon + 1);
        const valueEnd = jsonValueEnd(text, valueStart);
        if (valueEnd !== -1) matches.push({ start: valueStart, end: valueEnd });
      }
    }
    i = end - 1;
  }
  // JSON 的重复键以最后一个为准；替换最后一个根属性才能保证 CLI 选项真实生效。
  const match = matches.at(-1);
  if (!match) return text;
  const out = text.slice(0, match.start) + JSON.stringify(value) + text.slice(match.end);
  parseJsonc(out);
  return out;
}

/** 找到根对象闭合花括号与其前最后一个非注释 token。 */
function rootObjectBounds(text) {
  let depth = 0;
  let rootStart = -1;
  let rootEnd = -1;
  let lastSignificant = -1;
  let state = 'normal';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (state === 'string') {
      if (c === '\\') { i++; continue; }
      if (c === '"') state = 'normal';
      if (depth > 0) lastSignificant = i;
      continue;
    }
    if (state === 'line-comment') {
      if (c === '\n') state = 'normal';
      continue;
    }
    if (state === 'block-comment') {
      if (c === '*' && n === '/') { state = 'normal'; i++; }
      continue;
    }
    if (c === '/' && n === '/') { state = 'line-comment'; i++; continue; }
    if (c === '/' && n === '*') { state = 'block-comment'; i++; continue; }
    if (c === '"') { state = 'string'; if (depth > 0) lastSignificant = i; continue; }
    if (c === '{') {
      depth++;
      if (rootStart === -1) rootStart = i;
      if (depth > 1) lastSignificant = i;
      continue;
    }
    if (c === '}') {
      if (depth === 1) { rootEnd = i; break; }
      depth--;
      if (depth > 0) lastSignificant = i;
      continue;
    }
    if (depth > 0 && !/\s/.test(c)) lastSignificant = i;
  }
  if (rootStart === -1 || rootEnd === -1 || depth !== 1) throw new Error('config.jsonc 根必须是完整对象');
  return { rootStart, rootEnd, lastSignificant };
}

/** 向根对象末尾追加模板新增键；现有键及全部注释原样保留。 */
export function appendMissingJsoncValues(text, defaults) {
  const current = parseJsonc(text);
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error('config.jsonc 根必须是对象');
  }
  const missing = Object.entries(defaults).filter(([key]) => !(key in current));
  if (!missing.length) return text;
  let { rootEnd, lastSignificant } = rootObjectBounds(text);
  let out = text;
  if (lastSignificant !== -1 && out[lastSignificant] !== '{' && out[lastSignificant] !== ',') {
    out = out.slice(0, lastSignificant + 1) + ',' + out.slice(lastSignificant + 1);
    rootEnd++;
  }
  let prefix = out.slice(0, rootEnd);
  if (!prefix.endsWith('\n') && !prefix.endsWith('\r')) prefix += '\n';
  const lines = missing.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`).join('\n');
  const next = prefix + lines + '\n' + out.slice(rootEnd);
  parseJsonc(next); // 回写前自证仍为合法 JSONC
  return next;
}
