import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOursHook, isOursHookDescriptor, stripOurHooks, injectHooks, mergeSettingsText,
  stripSettingsText, validateSettingsStructure,
} from '../../src/lib/settings-json.mjs';

const nodeHandler = (script, flavor) => ({
  type: 'command',
  command: 'node',
  args: ['${CLAUDE_PROJECT_DIR}/.tidykeep/runtime/' + script, flavor],
  timeout: flavor === 'claude-stop' ? 30 : 20,
  statusMessage: flavor === 'claude-stop' ? 'tidykeep: 收尾检查' : 'tidykeep: 检查文件命名',
});

const GROUPS = {
  PreToolUse: [
    { matcher: 'Write|Edit|NotebookEdit', hooks: [nodeHandler('hook.mjs', 'claude-pretooluse')] },
  ],
  Stop: [{ hooks: [nodeHandler('hook.mjs', 'claude-stop')] }],
};

test('isOursHook: 只认当前 runtime 与已知旧版脚本的精确签名', () => {
  assert.equal(isOursHook(nodeHandler('hook.mjs', 'claude-stop')), true);
  assert.equal(isOursHook({ type: 'command', command: 'eslint --fix' }), false);
  assert.equal(isOursHook({
    type: 'command', command: 'python3',
    args: ['${CLAUDE_PROJECT_DIR}/.tidykeep/hooks/guard_stale_names.py'],
    timeout: 20, statusMessage: 'tidykeep: 检查文件命名',
  }), true);
  assert.equal(isOursHook({ type: 'command', command: 'node', args: ['/p/.tidykeep/custom-hook.mjs'] }), false,
    '用户放在 .tidykeep 下的自定义 hook 不能被误删');
  assert.equal(isOursHook({ type: 'command', command: 'node', args: ['/p/.tidykeep/runtime/hook.mjs', 'user-flavor'] }), false,
    '未知 flavor 不能冒充 tidykeep 条目');
  assert.equal(isOursHook({
    type: 'command', command: 'node "$(git rev-parse --show-toplevel)/.tidykeep/runtime/hook.mjs" codex-stop', timeout: 30,
  }), true);
  assert.equal(isOursHook({
    type: 'command', command: 'node .tidykeep/runtime/hook.mjs codex-stop', timeout: 30,
  }), true, '明确列出的旧 Codex 相对路径描述符应可迁移');
});

test('isOursHook: 同 command/args 但 timeout 或自定义字段漂移时不认领、不误删', () => {
  const changedTimeout = { ...nodeHandler('hook.mjs', 'claude-stop'), timeout: 99 };
  const extended = { ...nodeHandler('hook.mjs', 'claude-stop'), userOwned: true };
  const wrongType = { ...nodeHandler('hook.mjs', 'claude-stop'), type: 'prompt' };
  for (const handler of [changedTimeout, extended, wrongType]) assert.equal(isOursHook(handler), false);
  const settings = { hooks: { Stop: [{ hooks: [changedTimeout, extended, wrongType] }] } };
  stripOurHooks(settings);
  assert.deepEqual(settings.hooks.Stop[0].hooks, [changedTimeout, extended, wrongType]);
});

test('完整 descriptor 所有权同时要求 event 与 matcher 精确', () => {
  const handler = nodeHandler('hook.mjs', 'claude-pretooluse');
  assert.equal(isOursHookDescriptor('PreToolUse', 'Write|Edit|NotebookEdit', handler), true);
  assert.equal(isOursHookDescriptor('PreToolUse', 'Write', handler), false);
  assert.equal(isOursHookDescriptor('Stop', 'Write|Edit|NotebookEdit', handler), false);
  const settings = { hooks: { PreToolUse: [{ matcher: 'Write', hooks: [handler] }] } };
  stripOurHooks(settings);
  assert.deepEqual(settings.hooks.PreToolUse[0].hooks, [handler], '错误 matcher 的候选必须保守保留');
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
        matcher: 'Write|Edit|NotebookEdit',
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
      PreToolUse: [{ matcher: 'Write', hooks: [{
        type: 'command', command: 'python3',
        args: ['${CLAUDE_PROJECT_DIR}/.tidykeep/hooks/guard_stale_names.py'],
        timeout: 20, statusMessage: 'tidykeep: 检查文件命名',
      }] }],
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

test('validateSettingsStructure: hooks/event/group/handler 必须是预期结构', () => {
  assert.deepEqual(validateSettingsStructure({ permissions: {} }), { ok: true });
  for (const value of [
    [],
    { hooks: [] },
    { hooks: { Stop: {} } },
    { hooks: { Stop: [null] } },
    { hooks: { Stop: [{ hooks: {} }] } },
    { hooks: { Stop: [{ hooks: [null] }] } },
    { hooks: { Stop: [{ hooks: [{ type: 'command', command: 42 }] }] } },
  ]) {
    assert.equal(validateSettingsStructure(value).ok, false, JSON.stringify(value));
  }
});

test('mergeSettingsText: 结构错误时拒绝改写,不会用扩展运算静默扭曲用户配置', () => {
  const text = JSON.stringify({ hooks: { Stop: { hooks: [] } } });
  const r = mergeSettingsText(text, GROUPS);
  assert.equal(r.status, 'skipped');
  assert.equal(r.reason, 'invalid-structure');
  assert.equal(r.text, text);
});

test('mergeSettingsText: tidykeep 候选描述符发生字段漂移时拒绝制造重复 hook', () => {
  const changed = { ...nodeHandler('hook.mjs', 'claude-stop'), timeout: 99 };
  const text = JSON.stringify({ hooks: { Stop: [{ hooks: [changed] }] } }, null, 2) + '\n';
  const result = mergeSettingsText(text, GROUPS);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'descriptor-drift');
  assert.equal(result.text, text);
});

test('宽活引用检测：额外/未知/缺失 flavor 也会 fail-closed，卸载不删 runtime 引用', () => {
  const claudeExtra = { ...nodeHandler('hook.mjs', 'claude-stop'), args: [
    '${CLAUDE_PROJECT_DIR}/.tidykeep/runtime/hook.mjs', 'claude-stop', '--user-extra',
  ] };
  const codexSuffix = {
    type: 'command',
    command: 'node "$(git rev-parse --show-toplevel)/.tidykeep/runtime/hook.mjs" codex-stop --user-extra',
    timeout: 30,
  };
  const unknownFlavor = { ...nodeHandler('hook.mjs', 'claude-stop'), args: [
    '${CLAUDE_PROJECT_DIR}/.tidykeep/runtime/hook.mjs', 'codex-foo',
  ] };
  const missingFlavor = { ...nodeHandler('hook.mjs', 'claude-stop'), args: [
    '${CLAUDE_PROJECT_DIR}/.tidykeep/runtime/hook.mjs',
  ] };
  const bashWrapper = {
    type: 'command', command: 'bash',
    args: ['-c', 'node "$ROOT/.tidykeep/runtime/hook.mjs" custom-flavor'], timeout: 30,
  };
  for (const [event, handler] of [
    ['Stop', claudeExtra], ['Stop', codexSuffix], ['Stop', unknownFlavor], ['Stop', missingFlavor],
    ['Stop', bashWrapper],
  ]) {
    const text = JSON.stringify({ hooks: { [event]: [{ hooks: [handler] }] } }, null, 2) + '\n';
    const merged = mergeSettingsText(text, GROUPS);
    assert.equal(merged.reason, 'descriptor-drift');
    const stripped = stripSettingsText(text);
    assert.equal(stripped.candidatesRemaining, 1);
    assert.equal(stripped.text, text);
  }
});

test('mergeSettingsText: exact handler 位于错误 matcher/event 也属于 descriptor drift', () => {
  const handler = nodeHandler('hook.mjs', 'claude-pretooluse');
  for (const hooks of [
    { PreToolUse: [{ matcher: 'Write', hooks: [handler] }] },
    { Stop: [{ matcher: 'Write|Edit|NotebookEdit', hooks: [handler] }] },
  ]) {
    const text = JSON.stringify({ hooks }, null, 2) + '\n';
    const result = mergeSettingsText(text, GROUPS);
    assert.equal(result.reason, 'descriptor-drift');
    assert.equal(result.text, text);
  }
});

test('stripOurHooks: 用户自定义 .tidykeep hook 保留,仅剥精确 tidykeep handler', () => {
  const custom = { type: 'command', command: 'node', args: ['/p/.tidykeep/custom-hook.mjs'] };
  const s = { hooks: { Stop: [{ hooks: [nodeHandler('hook.mjs', 'claude-stop'), custom] }] } };
  stripOurHooks(s);
  assert.deepEqual(s.hooks.Stop[0].hooks, [custom]);
});
