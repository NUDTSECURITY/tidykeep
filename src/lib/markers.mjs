// 标记块 upsert/strip:语义逐行对齐初稿 install.sh/uninstall.sh 内嵌的 python 实现,
// 增强点仅一个——写回时跟随原文件主导 EOL,避免在 CRLF 文件里混入孤立 LF。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function detectEol(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  return crlf > lf ? '\r\n' : '\n';
}

export function upsertBlockText(text, begin, end, content) {
  const eol = detectEol(text);
  const t = text.replaceAll('\r\n', '\n');
  const body = content.replace(/\n+$/, '');
  const block = `${begin}\n${body}\n${end}\n`;
  const existedBlock = t.includes(begin) && t.includes(end);
  let out;
  if (existedBlock) {
    const pre = t.slice(0, t.indexOf(begin));
    // 吃掉旧块闭合标记后的那一个换行(block 自带结尾换行),否则重复安装会累积空行
    const post = t.slice(t.indexOf(end) + end.length).replace(/^[^\S\n]*\n/, '');
    out = pre + block + post;
  } else if (t) {
    const sep = t.endsWith('\n\n') ? '' : (t.endsWith('\n') ? '\n' : '\n\n');
    out = t + sep + block;
  } else {
    out = block;
  }
  return { text: eol === '\r\n' ? out.replaceAll('\n', '\r\n') : out, existedBlock };
}

export function stripBlockText(text, begin, end) {
  const eol = detectEol(text);
  const t = text.replaceAll('\r\n', '\n');
  if (!(t.includes(begin) && t.includes(end))) {
    return { text, stripped: false };
  }
  const pre = t.slice(0, t.indexOf(begin));
  const post = t.slice(t.indexOf(end) + end.length);
  const out = (pre.trim() || post.trim())
    ? pre.replace(/\n+$/, '') + '\n' + post.replace(/^\n+/, '')
    : '';
  return { text: eol === '\r\n' ? out.replaceAll('\n', '\r\n') : out, stripped: true };
}

export function upsertBlockFile(path, begin, end, content) {
  const existed = existsSync(path);
  const before = existed ? readFileSync(path, 'utf8') : '';
  const { text } = upsertBlockText(before, begin, end, content);
  writeFileSync(path, text);
  return existed ? 'modified' : 'created';
}

export function stripBlockFile(path, begin, end) {
  if (!existsSync(path)) return 'missing';
  const before = readFileSync(path, 'utf8');
  const { text, stripped } = stripBlockText(before, begin, end);
  if (stripped) writeFileSync(path, text);
  return (stripped ? text : before).trim() ? 'kept' : 'empty';
}
