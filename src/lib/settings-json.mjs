// .claude/settings.json 与 .codex/hooks.json 共用的 hooks 合并/剥离。
// 只识别 tidykeep 当前 runtime handler 与两个已知 python 旧脚本的精确签名，
// 不能因用户命令恰好位于 .tidykeep/ 就把它当成我们的条目删除。

const CLAUDE_RUNTIME = '${CLAUDE_PROJECT_DIR}/.tidykeep/runtime/hook.mjs';
const LEGACY_RUNTIME = '${CLAUDE_PROJECT_DIR}/.tidykeep/hooks/';
const CODEX_CURRENT = {
  'codex-pretooluse': 'node "$(git rev-parse --show-toplevel)/.tidykeep/runtime/hook.mjs" codex-pretooluse',
  'codex-stop': 'node "$(git rev-parse --show-toplevel)/.tidykeep/runtime/hook.mjs" codex-stop',
};
const CODEX_LEGACY = {
  'codex-pretooluse': 'node .tidykeep/runtime/hook.mjs codex-pretooluse',
  'codex-stop': 'node .tidykeep/runtime/hook.mjs codex-stop',
};

const plainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function validateSettingsStructure(settings) {
  if (!plainObject(settings)) return { ok: false, reason: 'root-not-object' };
  if (!('hooks' in settings)) return { ok: true };
  if (!plainObject(settings.hooks)) return { ok: false, reason: 'hooks-not-object' };
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) return { ok: false, reason: `${event}-not-array` };
    for (const group of groups) {
      if (!plainObject(group) || !Array.isArray(group.hooks)) return { ok: false, reason: `${event}-invalid-group` };
      if ('matcher' in group && typeof group.matcher !== 'string') return { ok: false, reason: `${event}-invalid-matcher` };
      for (const handler of group.hooks) {
        if (!plainObject(handler)) return { ok: false, reason: `${event}-invalid-handler` };
        if ('type' in handler && typeof handler.type !== 'string') return { ok: false, reason: `${event}-invalid-type` };
        if ('command' in handler && typeof handler.command !== 'string') return { ok: false, reason: `${event}-invalid-command` };
        if ('args' in handler && (!Array.isArray(handler.args) || handler.args.some((v) => typeof v !== 'string'))) {
          return { ok: false, reason: `${event}-invalid-args` };
        }
        if ('timeout' in handler && (!Number.isFinite(handler.timeout) || handler.timeout < 0)) {
          return { ok: false, reason: `${event}-invalid-timeout` };
        }
        if ('statusMessage' in handler && typeof handler.statusMessage !== 'string') {
          return { ok: false, reason: `${event}-invalid-status-message` };
        }
      }
    }
  }
  return { ok: true };
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

/**
 * 宽识别“仍可能执行 tidykeep runtime”的活引用。这里只用于 fail-closed 检测，
 * 真正剥离仍严格依赖 isOursHookDescriptor，绝不删除字段漂移的用户条目。
 */
export function isTidykeepHookCandidate(handler) {
  if (!plainObject(handler) || typeof handler.command !== 'string') return false;
  const executableText = [handler.command, ...(Array.isArray(handler.args) ? handler.args : [])];
  if (executableText.some((part) => part.includes('.tidykeep/runtime/hook.mjs'))) return true;
  if (handler.command === 'python3' && Array.isArray(handler.args) && handler.args.length === 1) {
    return new Set([
      `${LEGACY_RUNTIME}guard_stale_names.py`, `${LEGACY_RUNTIME}stop_sync_check.py`,
    ]).has(handler.args[0]);
  }
  return false;
}

export function isOursHook(handler) {
  if (!isTidykeepHookCandidate(handler) || handler.type !== 'command') return false;

  if (handler.command === 'node') {
    if (!exactKeys(handler, ['type', 'command', 'args', 'timeout', 'statusMessage'])) return false;
    if (!Array.isArray(handler.args) || handler.args.length !== 2) return false;
    const [script, flavor] = handler.args;
    if (script !== CLAUDE_RUNTIME) return false;
    if (flavor === 'claude-stop') {
      return handler.timeout === 30 && handler.statusMessage === 'tidykeep: 收尾检查';
    }
    return flavor === 'claude-pretooluse' && handler.timeout === 20
      && new Set(['tidykeep: 检查文件命名', 'tidykeep: 检查命令']).has(handler.statusMessage);
  }

  if (handler.command === 'python3') {
    if (!exactKeys(handler, ['type', 'command', 'args', 'timeout', 'statusMessage']) || handler.timeout !== 20) return false;
    const script = handler.args[0];
    if (script === `${LEGACY_RUNTIME}stop_sync_check.py`) return handler.statusMessage === 'tidykeep: 收尾检查';
    return script === `${LEGACY_RUNTIME}guard_stale_names.py`
      && new Set(['tidykeep: 检查文件命名', 'tidykeep: 检查命令']).has(handler.statusMessage);
  }

  if (!exactKeys(handler, ['type', 'command', 'timeout'])) return false;
  const flavor = handler.command.endsWith(' codex-stop') ? 'codex-stop' : 'codex-pretooluse';
  const known = handler.command === CODEX_CURRENT[flavor] || handler.command === CODEX_LEGACY[flavor];
  return known && handler.timeout === (flavor === 'codex-stop' ? 30 : 20);
}

function normalizedMatcher(value) {
  return value === undefined ? null : value;
}

/** 完整所有权签名:event + group.matcher + handler，三者任一漂移都不认领。 */
export function isOursHookDescriptor(event, matcher, handler) {
  if (!isOursHook(handler)) return false;
  const groupMatcher = normalizedMatcher(matcher);

  if (handler.command === 'node') {
    const flavor = handler.args[1];
    if (flavor === 'claude-stop') return event === 'Stop' && groupMatcher === null;
    if (event !== 'PreToolUse' || flavor !== 'claude-pretooluse') return false;
    if (handler.statusMessage === 'tidykeep: 检查文件命名') {
      return groupMatcher === 'Write|Edit|NotebookEdit';
    }
    return handler.statusMessage === 'tidykeep: 检查命令' && groupMatcher === 'Bash|PowerShell';
  }

  if (handler.command === 'python3') {
    const script = handler.args[0];
    if (script.endsWith('/stop_sync_check.py')) return event === 'Stop' && groupMatcher === null;
    if (event !== 'PreToolUse' || !script.endsWith('/guard_stale_names.py')) return false;
    if (handler.statusMessage === 'tidykeep: 检查文件命名') return groupMatcher === 'Write';
    return handler.statusMessage === 'tidykeep: 检查命令' && groupMatcher === 'Bash';
  }

  if (handler.command.endsWith(' codex-stop')) return event === 'Stop' && groupMatcher === null;
  return event === 'PreToolUse' && (groupMatcher === 'Bash' || groupMatcher === 'apply_patch');
}

export function stripOurHooks(settings) {
  const validation = validateSettingsStructure(settings);
  if (!validation.ok || !settings.hooks) return settings;
  for (const event of Object.keys(settings.hooks)) {
    const groups = [];
    for (const group of settings.hooks[event]) {
      const kept = group.hooks.filter((handler) => !isOursHookDescriptor(event, group.matcher, handler));
      if (kept.length) groups.push({ ...group, hooks: kept });
    }
    if (groups.length) settings.hooks[event] = groups;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return settings;
}

export function injectHooks(settings, eventGroups) {
  settings.hooks ??= {};
  for (const [event, groups] of Object.entries(eventGroups)) {
    settings.hooks[event] ??= [];
    settings.hooks[event].push(...structuredClone(groups));
  }
  return settings;
}

export function mergeSettingsText(text, eventGroups) {
  let data;
  const status = text === undefined ? 'created' : 'modified';
  if (text === undefined) data = {};
  else {
    try { data = JSON.parse(text); } catch { return { text, status: 'skipped', reason: 'invalid-json' }; }
  }
  const validation = validateSettingsStructure(data);
  if (!validation.ok) return { text, status: 'skipped', reason: 'invalid-structure', detail: validation.reason };
  let descriptorDrift = 0;
  for (const [event, groups] of Object.entries(data.hooks ?? {})) {
    for (const group of groups) {
      descriptorDrift += group.hooks.filter((handler) => (
        isTidykeepHookCandidate(handler)
        && !isOursHookDescriptor(event, group.matcher, handler)
      )).length;
    }
  }
  if (descriptorDrift) {
    return { text, status: 'skipped', reason: 'descriptor-drift', detail: `${descriptorDrift} 个条目` };
  }
  stripOurHooks(data);
  injectHooks(data, eventGroups);
  return { text: JSON.stringify(data, null, 2) + '\n', status };
}

export function stripSettingsText(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { text, status: 'skipped', reason: 'invalid-json' }; }
  const validation = validateSettingsStructure(data);
  if (!validation.ok) return { text, status: 'skipped', reason: 'invalid-structure', detail: validation.reason };
  stripOurHooks(data);
  let candidatesRemaining = 0;
  for (const [event, groups] of Object.entries(data.hooks ?? {})) {
    for (const group of groups) {
      candidatesRemaining += group.hooks.filter(isTidykeepHookCandidate).length;
    }
  }
  if (!Object.keys(data).length) return { text: '', status: 'empty', candidatesRemaining };
  return { text: JSON.stringify(data, null, 2) + '\n', status: 'stripped', candidatesRemaining };
}
