// 各注入点的标记串与块内容(单一来源,init 与 uninstall 共用)。
export const MD_BEGIN = '<!-- tidykeep:begin -->';
export const MD_END = '<!-- tidykeep:end -->';
export const HASH_BEGIN = '# >>> tidykeep >>>';
export const HASH_END = '# <<< tidykeep <<<';

export const CLAUDE_POINTER = `# 项目规则入口(tidykeep)

本项目所有 Agent 规则统一维护于 AGENTS.md,请勿在本文件重复添加规则。以下导入其全文:

@AGENTS.md`;

export const gitignoreBlock = (scratch) => `${scratch}/
.tidykeep/backup/
.tidykeep/.state/`;

export const GITATTRIBUTES_BLOCK = `.tidykeep/githooks/* text eol=lf
.tidykeep/runtime/* text eol=lf`;

const claudeHandler = (flavor, statusMessage, timeout = 20) => ({
  type: 'command',
  command: 'node',
  args: ['${CLAUDE_PROJECT_DIR}/.tidykeep/runtime/hook.mjs', flavor],
  timeout,
  statusMessage,
});

export const claudeHookGroups = () => ({
  PreToolUse: [
    { matcher: 'Write|Edit|NotebookEdit', hooks: [claudeHandler('claude-pretooluse', 'tidykeep: 检查文件命名')] },
    { matcher: 'Bash|PowerShell', hooks: [claudeHandler('claude-pretooluse', 'tidykeep: 检查命令')] },
  ],
  Stop: [{ hooks: [claudeHandler('claude-stop', 'tidykeep: 收尾检查', 30)] }],
});

// Codex 项目级 .codex/hooks.json:官方明确 hook 进程 cwd 是"会话目录"而非仓库根,
// 且推荐 "$(git rev-parse --show-toplevel)/..." 形式解析 repo-local hooks——
// 相对路径在子目录会话中会静默失效(Codex 对非 2 退出码 fail-open)。
const codexHandler = (flavor, timeout = 20) => ({
  type: 'command',
  command: `node "$(git rev-parse --show-toplevel)/.tidykeep/runtime/hook.mjs" ${flavor}`,
  timeout,
});

export const codexHookGroups = () => ({
  PreToolUse: [
    { matcher: 'Bash', hooks: [codexHandler('codex-pretooluse')] },
    { matcher: 'apply_patch', hooks: [codexHandler('codex-pretooluse')] },
  ],
  Stop: [{ hooks: [codexHandler('codex-stop', 30)] }],
});

export const kimiTomlBlock = (shimPath) => {
  const p = shimPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `[[hooks]]
event = "PreToolUse"
command = "node \\"${p}\\" kimi-pretooluse"
timeout = 20

[[hooks]]
event = "Stop"
command = "node \\"${p}\\" kimi-stop"
timeout = 30`;
};
