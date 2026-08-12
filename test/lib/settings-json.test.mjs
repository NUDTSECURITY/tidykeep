import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOursHook, stripOurHooks, injectHooks, mergeSettingsText,
} from '../../src/lib/settings-json.mjs';

const nodeHandler = (script, flavor) => ({
  type: 'command',
  command: 'node',
  args: ['${CLAUDE_PROJECT_DIR}/.tidykeep/runtime/' + script, flavor],
  timeout: 20,
});

const GROUPS = {
  PreToolUse: [
    { matcher: 'Write|Edit|NotebookEdit', hooks: [nodeHandler('hook.mjs', 'claude-pretooluse')] },
  ],
  Stop: [{ hooks: [nodeHandler('hook.mjs', 'claude-stop')] }],
};

test('isOursHook: 依据 command+args 含 .tidykeep/ 识别', () => {
  assert.equal(isOursHook(nodeHandler('hook.mjs', 'x')), true);
  assert.equal(isOursHook({ type: 'command', command: 'eslint --fix' }), false);
  assert.equal(isOursHook({ type: 'command', command: 'python3', args: ['/p/.tidykeep/hooks/guard_stale_names.py'] }), true);
});

test('injectHooks 到空对象 → 建立结构', () => {
  const s = {};
  injectHooks(s, GROUPS);
  assert.equal(s.hooks.PreToolUse.length, 1);
  assert.equal(s.hooks.Stop.length, 1);
});

test('stripOurHooks: 只剥我们的,保留用户 hooks;剥空的键被移除', () => {
  const s = {
    permissions: { allow: ['Bash(ls *)'] },
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-hook' }] },
        ...GROUPS.PreToolUse,
      ],
      Stop: [...GROUPS.Stop],
    },
  };
  stripOurHooks(s);
  assert.equal(s.hooks.PreToolUse.length, 1);
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, 'my-own-hook');
  assert.equal('Stop' in s.hooks, false);
  assert.deepEqual(s.permissions, { allow: ['Bash(ls *)'] });
});

test('stripOurHooks: 全空后 hooks 键整体移除', () => {
  const s = { hooks: { Stop: [...GROUPS.Stop] } };
  stripOurHooks(s);
  assert.equal('hooks' in s, false);
});

test('混合组:同组内我们的与用户的 handler 并存时只剔除我们的', () => {
  const s = {
    hooks: {
      PreToolUse: [{
        matcher: 'Write',
        hooks: [nodeHandler('hook.mjs', 'claude-pretooluse'), { type: 'command', command: 'user-thing' }],
      }],
    },
  };
  stripOurHooks(s);
  assert.equal(s.hooks.PreToolUse[0].hooks.length, 1);
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, 'user-thing');
});

test('mergeSettingsText: undefined → created;先全剥再注入的幂等性', () => {
  const r1 = mergeSettingsText(undefined, GROUPS);
  assert.equal(r1.status, 'created');
  const r2 = mergeSettingsText(r1.text, GROUPS);
  assert.equal(r2.status, 'modified');
  assert.equal(r1.text, r2.text);
  assert.ok(r1.text.endsWith('\n'));
});

test('mergeSettingsText: 旧 python3 条目被迁移(剥除后注入 node 条目)', () => {
  const legacy = JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'python3', args: ['${CLAUDE_PROJECT_DIR}/.tidykeep/hooks/guard_stale_names.py'] }] }],
    },
  });
  const r = mergeSettingsText(legacy, GROUPS);
  assert.ok(!r.text.includes('python3'));
  assert.ok(r.text.includes('claude-pretooluse'));
});

test('mergeSettingsText: 无法解析 → skipped 且不改文本', () => {
  const r = mergeSettingsText('{ 不是 json', GROUPS);
  assert.equal(r.status, 'skipped');
  assert.equal(r.text, '{ 不是 json');
});
