import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  upsertBlockText, stripBlockText, detectEol,
  upsertBlockFile, stripBlockFile,
} from '../../src/lib/markers.mjs';

const B = '<!-- tidykeep:begin -->';
const E = '<!-- tidykeep:end -->';
const BLOCK = (body) => `${B}\n${body}\n${E}\n`;

test('upsertBlockText: 空文本 → 纯块', () => {
  const r = upsertBlockText('', B, E, '规则内容');
  assert.equal(r.text, BLOCK('规则内容'));
  assert.equal(r.existedBlock, false);
});

test('upsertBlockText: 无结尾换行的已有文本 → 用空行分隔追加(对齐初稿 python)', () => {
  const r = upsertBlockText('# 已有内容', B, E, 'X');
  assert.equal(r.text, '# 已有内容\n\n' + BLOCK('X'));
});

test('upsertBlockText: 单个结尾换行 → 单个换行分隔', () => {
  const r = upsertBlockText('# 已有内容\n', B, E, 'X');
  assert.equal(r.text, '# 已有内容\n\n' + BLOCK('X'));
});

test('upsertBlockText: 双结尾换行 → 不再加分隔', () => {
  const r = upsertBlockText('# 已有内容\n\n', B, E, 'X');
  assert.equal(r.text, '# 已有内容\n\n' + BLOCK('X'));
});

test('upsertBlockText: 已有块原位替换,前后内容保留', () => {
  const before = `头部\n${B}\n旧内容\n${E}\n尾部\n`;
  const r = upsertBlockText(before, B, E, '新内容');
  assert.equal(r.text, `头部\n${B}\n新内容\n${E}\n尾部\n`);
  assert.equal(r.existedBlock, true);
});

test('upsertBlockText: 幂等——重复应用结果不变', () => {
  const once = upsertBlockText('base\n', B, E, 'X').text;
  const twice = upsertBlockText(once, B, E, 'X').text;
  assert.equal(once, twice);
});

test('upsertBlockText: 内容尾部多余换行被规整(对齐 python rstrip)', () => {
  const r = upsertBlockText('', B, E, 'X\n\n\n');
  assert.equal(r.text, BLOCK('X'));
});

test('stripBlockText: 移除块,前后以单换行衔接', () => {
  const text = `头部\n${B}\n内容\n${E}\n尾部\n`;
  const r = stripBlockText(text, B, E);
  assert.equal(r.text, '头部\n尾部\n');
  assert.equal(r.stripped, true);
});

test('stripBlockText: 剥离后无实质内容 → 空串', () => {
  const r = stripBlockText(BLOCK('内容'), B, E);
  assert.equal(r.text, '');
});

test('stripBlockText: 无块 → 原样返回', () => {
  const r = stripBlockText('无关内容\n', B, E);
  assert.equal(r.text, '无关内容\n');
  assert.equal(r.stripped, false);
});

test('detectEol: CRLF 占主导时返回 \\r\\n', () => {
  assert.equal(detectEol('a\r\nb\r\nc\r\n'), '\r\n');
  assert.equal(detectEol('a\nb\nc\n'), '\n');
  assert.equal(detectEol(''), '\n');
});

test('upsertBlockText: CRLF 文件保持 CRLF,不混入孤立 LF', () => {
  const r = upsertBlockText('line1\r\nline2\r\n', B, E, 'X\nY');
  assert.ok(!/[^\r]\n/.test('\r' + r.text), '不应有孤立 LF');
  assert.ok(r.text.includes(`${B}\r\nX\r\nY\r\n${E}`));
});

test('file 包装: 新建 → created;再写 → modified;剥空且为本工具创建语义交由调用方', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-markers-'));
  const f = join(dir, 'AGENTS.md');
  assert.equal(upsertBlockFile(f, B, E, 'X'), 'created');
  assert.equal(upsertBlockFile(f, B, E, 'Y'), 'modified');
  assert.equal(readFileSync(f, 'utf8'), BLOCK('Y'));
  assert.equal(stripBlockFile(f, B, E), 'empty');
  assert.equal(readFileSync(f, 'utf8'), '');
  writeFileSync(f, '自有内容\n' + BLOCK('Z'));
  assert.equal(stripBlockFile(f, B, E), 'kept');
  assert.equal(stripBlockFile(join(dir, 'nope.md'), B, E), 'missing');
  assert.ok(existsSync(f));
});

// ---------- 审查确认缺陷:标记不成对/逆序的安全语义 ----------

test('孤立 begin(end 被误删):upsert 拒绝改写,原文不动', () => {
  const orphan = `head\n${B}\n内容\n尾部用户内容\n`;
  const r = upsertBlockText(orphan, B, E, 'X');
  assert.equal(r.status, 'unpaired');
  assert.equal(r.text, orphan);
});

test('逆序标记(end 在 begin 前):upsert 与 strip 都拒绝,用户内容不丢不重复', () => {
  const t = `head\n${E}\nUSER-MIDDLE\n${B}\ntail\n`;
  const u = upsertBlockText(t, B, E, 'X');
  assert.equal(u.status, 'unpaired');
  assert.equal(u.text, t);
  const s = stripBlockText(t, B, E);
  assert.equal(s.status, 'unpaired');
  assert.equal(s.text, t);
});

test('merge 产生的重复完整块:strip 全部剥除,upsert 归并为一个', () => {
  const dup = `${B}\nA\n${E}\nuser\n${B}\nA\n${E}\n`;
  const s = stripBlockText(dup, B, E);
  assert.equal(s.status, 'ok');
  assert.equal(s.text, 'user\n');
  const u = upsertBlockText(dup, B, E, 'NEW');
  assert.equal(u.status, 'ok');
  assert.equal((u.text.match(new RegExp('tidykeep:begin', 'g')) ?? []).length, 1);
  assert.ok(u.text.includes('NEW') && u.text.includes('user'));
});

test('file 包装: 不成对标记返回 unpaired 且文件保持原样', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-markers-unpaired-'));
  const f = join(dir, 'AGENTS.md');
  const orphan = `head\n${B}\n内容\n## 用户附录\n`;
  writeFileSync(f, orphan);
  assert.equal(upsertBlockFile(f, B, E, 'X'), 'unpaired');
  assert.equal(stripBlockFile(f, B, E), 'unpaired');
  assert.equal(readFileSync(f, 'utf8'), orphan);
});
