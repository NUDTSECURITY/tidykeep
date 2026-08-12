// .claude/settings.json 与 .codex/hooks.json 共用的 hooks 合并/剥离。
// "我们的条目"识别:command + args 拼接后含 ".tidykeep/"(兼容旧 bash 版的
// python3 条目,注入前先全剥再注入,天然完成迁移与幂等)。

export function isOursHook(h) {
  const args = Array.isArray(h?.args) ? h.args : [];
  return [h?.command ?? '', ...args].join(' ').includes('.tidykeep/');
}

export function stripOurHooks(settings) {
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== 'object') return settings;
  for (const event of Object.keys(hooks)) {
    const groups = [];
    for (const grp of hooks[event] ?? []) {
      const kept = (grp?.hooks ?? []).filter((h) => !isOursHook(h));
      if (kept.length) groups.push({ ...grp, hooks: kept });
    }
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  if (!Object.keys(hooks).length) delete settings.hooks;
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
  let status;
  if (text === undefined) {
    data = {};
    status = 'created';
  } else {
    try {
      data = JSON.parse(text);
      status = 'modified';
    } catch {
      return { text, status: 'skipped' };
    }
  }
  stripOurHooks(data);
  injectHooks(data, eventGroups);
  return { text: JSON.stringify(data, null, 2) + '\n', status };
}

export function stripSettingsText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { text, status: 'skipped' };
  }
  stripOurHooks(data);
  if (!Object.keys(data).length) return { text: '', status: 'empty' };
  return { text: JSON.stringify(data, null, 2) + '\n', status: 'stripped' };
}
