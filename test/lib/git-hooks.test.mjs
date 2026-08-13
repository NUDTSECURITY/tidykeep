import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hasExecutableTidykeepChain, hasExecutableTidykeepReference, inspectExternalHooks,
} from '../../src/lib/git-hooks.mjs';
import { makeTempDir } from '../helpers/temp.mjs';

const target = (name) => `$(git rev-parse --show-toplevel)/.tidykeep/githooks/${name}`;

test('外部 hook 只接受 sh/exec 的真实调用且必须传播失败', () => {
  const name = 'pre-commit';
  assert.equal(hasExecutableTidykeepChain(
    `sh "${target(name)}" "$@" || exit $?\n`, name,
  ), true);
  assert.equal(hasExecutableTidykeepChain(
    `exec sh "${target(name)}" "$@"\n`, name,
  ), true);
  assert.equal(hasExecutableTidykeepChain(
    `exec "${target(name)}" "$@"\n`, name,
  ), true);

  for (const text of [
    `# sh "${target(name)}" "$@" || exit $?\n`,
    `echo 'sh ${target(name)} "$@" || exit $?'\n`,
    `exec echo '${target(name)}'\n`,
    `exec "echo ${target(name)}"\n`,
    `exec true "${target(name)}"\n`,
    `sh "${target(name)}" "$@"\n`,
    `true # sh "${target(name)}" "$@" || exit $?\n`,
    `if false; then\n  sh "${target(name)}" "$@" || exit $?\nfi\n`,
    `exit 0\nsh "${target(name)}" "$@" || exit $?\n`,
  ]) assert.equal(hasExecutableTidykeepChain(text, name), false, text);
});

test('卸载保守识别直接执行引用，但不把注释、echo 和死分支当接线', () => {
  const name = 'pre-commit';
  assert.equal(hasExecutableTidykeepReference(`"${target(name)}" "$@"\n`, name), true);
  assert.equal(hasExecutableTidykeepReference(`source "${target(name)}"\n`, name), true);
  assert.equal(hasExecutableTidykeepReference(`# "${target(name)}"\n`, name), false);
  assert.equal(hasExecutableTidykeepReference(`echo "${target(name)}"\n`, name), false);
  assert.equal(hasExecutableTidykeepReference(
    `if false; then\n  "${target(name)}" "$@"\nfi\n`, name,
  ), false);
});

test('外部 hooksPath 分别报告全链入、部分链入与缺失', () => {
  const root = makeTempDir('external-hooks-lib-');
  const dir = join(root, '.husky');
  mkdirSync(dir);
  writeFileSync(join(dir, 'pre-commit'), `exec sh "${target('pre-commit')}" "$@"\n`);
  writeFileSync(join(dir, 'commit-msg'), '# 仅有示例: tidykeep/githooks/commit-msg\n');

  let result = inspectExternalHooks(root, '.husky');
  assert.equal(result.ok, false);
  assert.equal(result.anyChained, true);
  assert.match(result.note, /commit-msg/);

  writeFileSync(join(dir, 'commit-msg'), `sh "${target('commit-msg')}" "$@" || exit $?\n`);
  result = inspectExternalHooks(root, '.husky');
  assert.equal(result.ok, true);
  assert.equal(result.anyChained, true);
});
