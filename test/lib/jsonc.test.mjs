import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonc, replaceJsoncValue } from '../../src/lib/jsonc.mjs';

test('parseJsonc: 行注释与块注释被剥离', () => {
  const text = `{
  // 行注释
  "A": 1, /* 块注释 */
  "B": "x" // 尾注释
}`;
  assert.deepEqual(parseJsonc(text), { A: 1, B: 'x' });
});

test('parseJsonc: 字符串内的 // 与 /* 不被误删', () => {
  const text = `{ "URL": "https://example.com/a", "GLOB": "/* 保留 */" }`;
  assert.deepEqual(parseJsonc(text), { URL: 'https://example.com/a', GLOB: '/* 保留 */' });
});

test('parseJsonc: 字符串内转义引号不破坏解析', () => {
  const text = `{ "RE": "he said \\"hi\\" // not a comment" }`;
  assert.deepEqual(parseJsonc(text), { RE: 'he said "hi" // not a comment' });
});

test('parseJsonc: 容忍尾逗号', () => {
  const text = `{ "A": [1, 2,], "B": { "C": 3, }, }`;
  assert.deepEqual(parseJsonc(text), { A: [1, 2], B: { C: 3 } });
});

test('replaceJsoncValue: 行级替换字符串值,注释与排版零损失', () => {
  const text = `{
  // 台账强制等级
  "ENFORCE_LEDGER": "block", // block|warn|off
  "SCRATCH_DIR": ".tmp"
}`;
  const out = replaceJsoncValue(text, 'ENFORCE_LEDGER', 'warn');
  assert.ok(out.includes('"ENFORCE_LEDGER": "warn", // block|warn|off'));
  assert.ok(out.includes('// 台账强制等级'));
  assert.deepEqual(parseJsonc(out).ENFORCE_LEDGER, 'warn');
});
