// 极简 JSONC:剥离 // 与 /* */ 注释、容忍尾逗号。字符级扫描,字符串内的
// 注释形态与转义引号不受影响。回写走 replaceJsoncValue 行级替换,注释零损失。

function stripCommentsAndTrailingCommas(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[++i] ?? ''; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      i--;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      // 尾逗号之后也可能跟注释再跟 } / ],交给二次剥离兜底:先只处理紧邻情形
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

export function parseJsonc(text) {
  // 先剥注释,再剥一次尾逗号(处理"逗号 注释 }"的顺序问题)
  return JSON.parse(stripCommentsAndTrailingCommas(stripCommentsAndTrailingCommas(text)));
}

export function replaceJsoncValue(text, key, value) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`("${esc}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|true|false|-?\\d+(?:\\.\\d+)?)`);
  return text.replace(re, (_m, p1) => p1 + JSON.stringify(value));
}
