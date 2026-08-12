// 标记块 upsert/strip:语义对齐初稿 python 实现,并按对抗审查结论加固:
//   1. 写回时跟随原文件主导 EOL(不在 CRLF 文件里混入孤立 LF);
//   2. 严格配对校验——标记孤立/逆序(用户误删、merge 冲突)时拒绝改写并报 'unpaired',
//      绝不静默吞掉夹在标记间的用户内容;merge 产生的重复完整块会被归并/全部剥除。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function detectEol(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  return crlf > lf ? '\r\n' : '\n';
}

/** 从 begin 起向后找同序 end;两者齐备且有序才算一个有效块 */
function findPair(t, begin, end) {
  const iBegin = t.indexOf(begin);
  if (iBegin === -1) return null;
  const iEnd = t.indexOf(end, iBegin + begin.length);
  if (iEnd === -1) return null;
  return { iBegin, iEnd };
}

/** 剥掉所有有效配对后仍残留任一标记 → 存在孤立/逆序标记 */
function hasOrphanMarkers(t, begin, end) {
  let rest = t;
  for (;;) {
    const p = findPair(rest, begin, end);
    if (!p) break;
    rest = rest.slice(0, p.iBegin) + rest.slice(p.iEnd + end.length);
  }
  return rest.includes(begin) || rest.includes(end);
}

/** 剥除一个有效块,前后内容以单换行衔接(无前文时不留头部空行) */
function stripOnePair(t, p, begin, end) {
  const pre = t.slice(0, p.iBegin).replace(/\n+$/, '');
  const post = t.slice(p.iEnd + end.length).replace(/^\n+/, '');
  if (pre && post) return pre + '\n' + post;
  if (pre) return pre + '\n';
  return post;
}

function stripAllPairs(t, begin, end) {
  let out = t;
  for (;;) {
    const p = findPair(out, begin, end);
    if (!p) return out;
    out = stripOnePair(out, p, begin, end);
  }
}

export function upsertBlockText(text, begin, end, content) {
  const eol = detectEol(text);
  const t = text.replaceAll('\r\n', '\n');
  const body = content.replace(/\n+$/, '');
  const block = `${begin}\n${body}\n${end}\n`;
  const anyMarker = t.includes(begin) || t.includes(end);
  let out;
  let existedBlock = false;
  if (anyMarker) {
    if (hasOrphanMarkers(t, begin, end)) {
      return { text, existedBlock: false, status: 'unpaired' };
    }
    existedBlock = true;
    const p = findPair(t, begin, end);
    const pre = t.slice(0, p.iBegin);
    // 吃掉旧块闭合标记后的那一个换行(block 自带结尾换行),否则重复安装会累积空行
    let rest = t.slice(p.iEnd + end.length).replace(/^[^\S\n]*\n/, '');
    rest = stripAllPairs(rest, begin, end); // 归并 merge 冲突残留的重复完整块
    out = pre + block + rest;
  } else if (t) {
    const sep = t.endsWith('\n\n') ? '' : (t.endsWith('\n') ? '\n' : '\n\n');
    out = t + sep + block;
  } else {
    out = block;
  }
  return { text: eol === '\r\n' ? out.replaceAll('\n', '\r\n') : out, existedBlock, status: 'ok' };
}

export function stripBlockText(text, begin, end) {
  const eol = detectEol(text);
  const t = text.replaceAll('\r\n', '\n');
  if (!t.includes(begin) && !t.includes(end)) {
    return { text, stripped: false, status: 'ok' };
  }
  if (hasOrphanMarkers(t, begin, end)) {
    return { text, stripped: false, status: 'unpaired' };
  }
  const out = stripAllPairs(t, begin, end);
  return { text: eol === '\r\n' ? out.replaceAll('\n', '\r\n') : out, stripped: true, status: 'ok' };
}

export function upsertBlockFile(path, begin, end, content) {
  const existed = existsSync(path);
  const before = existed ? readFileSync(path, 'utf8') : '';
  const { text, status } = upsertBlockText(before, begin, end, content);
  if (status === 'unpaired') return 'unpaired';
  writeFileSync(path, text);
  return existed ? 'modified' : 'created';
}

export function stripBlockFile(path, begin, end) {
  if (!existsSync(path)) return 'missing';
  const before = readFileSync(path, 'utf8');
  const { text, stripped, status } = stripBlockText(before, begin, end);
  if (status === 'unpaired') return 'unpaired';
  if (stripped) writeFileSync(path, text);
  return (stripped ? text : before).trim() ? 'kept' : 'empty';
}
