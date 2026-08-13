import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendMissingJsoncValues, parseJsonc, replaceJsoncValue,
} from '../../src/lib/jsonc.mjs';

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

test('replaceJsoncValue:只替换最后一个真实根键，忽略注释、字符串与嵌套同名键', () => {
  const text = `{
  // "SCRATCH_DIR": "commented",
  "note": "\\\"SCRATCH_DIR\\\": \\\"inside-string\\\"",
  "nested": { "SCRATCH_DIR": "nested" },
  "SCRATCH_DIR": "first",
  /* "SCRATCH_DIR": "block-comment" */
  "SCRATCH_DIR": ".tmp"
}\n`;
  const out = replaceJsoncValue(text, 'SCRATCH_DIR', '.work');
  assert.equal(parseJsonc(out).SCRATCH_DIR, '.work');
  assert.ok(out.includes('// "SCRATCH_DIR": "commented"'));
  assert.ok(out.includes('"nested": { "SCRATCH_DIR": "nested" }'));
  assert.ok(out.includes('"SCRATCH_DIR": "first"'));
  assert.ok(out.includes('/* "SCRATCH_DIR": "block-comment" */'));
});

test('replaceJsoncValue:支持根键的数组、对象、null 与科学计数旧值', () => {
  for (const old of ['[1, { "x": "]" }]', '{ "x": [1, 2] }', 'null', '1.2e+3']) {
    const text = `{ "A": ${old}, "B": true }`;
    const out = replaceJsoncValue(text, 'A', 'updated');
    assert.deepEqual(parseJsonc(out), { A: 'updated', B: true });
  }
});

test('appendMissingJsoncValues: 仅追加缺失键,保留既有值、行尾注释与排版', () => {
  const text = `{
  // 用户说明必须保留
  "GUARD": false, // 用户选择
  "SCRATCH_DIR": ".work" // 无尾逗号
}
`;
  const out = appendMissingJsoncValues(text, {
    GUARD: true,
    SCRATCH_DIR: '.tmp',
    AUTO_COMMIT: 'off',
    ENFORCE_LEDGER: 'block',
  });
  const parsed = parseJsonc(out);
  assert.equal(parsed.GUARD, false);
  assert.equal(parsed.SCRATCH_DIR, '.work');
  assert.equal(parsed.AUTO_COMMIT, 'off');
  assert.equal(parsed.ENFORCE_LEDGER, 'block');
  assert.ok(out.includes('// 用户说明必须保留'));
  assert.ok(out.includes('"SCRATCH_DIR": ".work", // 无尾逗号'));
});

test('appendMissingJsoncValues: 空对象与尾逗号对象均保持为合法 JSONC', () => {
  assert.deepEqual(parseJsonc(appendMissingJsoncValues('{\n}\n', { A: 1 })), { A: 1 });
  assert.deepEqual(parseJsonc(appendMissingJsoncValues('{\n  "A": 1,\n}\n', { A: 2, B: true })), { A: 1, B: true });
});
