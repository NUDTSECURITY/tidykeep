#!/usr/bin/env node
// tidykeep agent hook 统一入口(vendored;由 `npx tidykeep init` 刷新,请勿手改)。
// 用法: node hook.mjs <flavor>   flavor ∈ {claude,codex,kimi}-{pretooluse,stop}
// 契约:任何内部异常一律静默放行(exit 0)——hook 是 guardrail,不是安全边界,
//       自身故障不得瘫痪 agent;硬边界由 git hooks 兜底。
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as core from './core.mjs';
import * as msg from './messages.mjs';

const FLAG_TTL_MS = 48 * 3600 * 1000;

function findRoot(start) {
  let dir = resolve(start || process.cwd());
  for (;;) {
    if (existsSync(join(dir, '.tidykeep'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function emitDeny(agent, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }) + '\n');
  if (agent === 'kimi') {
    // Kimi 文档中最明确的阻断契约是 exit 2 + stderr;stdout JSON 作为冗余通道
    process.stderr.write(reason + '\n');
    process.exit(2);
  }
  process.exit(0);
}

function emitStopBlock(agent, reason) {
  if (agent === 'kimi') {
    process.stderr.write(reason + '\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
  process.exit(0);
}

function emitStopWarn(agent, reason) {
  if (agent === 'kimi') {
    process.stdout.write(reason + '\n'); // Kimi:stdout 会被注入上下文
    process.exit(0);
  }
  if (agent === 'codex') {
    // Codex 的 Stop 事件不支持 hookSpecificOutput.additionalContext,
    // warn 走 Common output fields 的 systemMessage(展示给用户)
    process.stdout.write(JSON.stringify({ systemMessage: reason }) + '\n');
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: reason },
  }) + '\n');
  process.exit(0);
}

function handlePreToolUse(agent, payload, ctx) {
  const toolName = String(payload.tool_name ?? payload.tool ?? payload.tool_call?.name ?? '');
  const input = payload.tool_input ?? payload.arguments ?? payload.input ?? {};

  if (toolName === 'apply_patch') {
    const patchText = typeof input.command === 'string' ? input.command
      : Array.isArray(input.command) ? String(input.command[1] ?? '')
        : String(input.patch ?? input.input ?? '');
    for (const target of core.parseApplyPatch(patchText).checkTargets) {
      const v = core.classifyWritePath(target, ctx);
      if (v.decision === 'deny') emitDeny(agent, msg.denyReason('write', v));
    }
    return;
  }

  const filePath = input.file_path ?? input.notebook_path ?? input.path ?? input.filename ?? null;
  const command = typeof input.command === 'string' ? input.command : null;

  if (filePath) {
    // Edit 类工具改的是已存在的文件 → 放行,避免"合法历史遗留文件无法编辑"的自锁;
    // 目标不存在(即新建)才做命名/路径检查。Write 是整文件覆写,始终检查。
    const editLike = /edit/i.test(toolName) && !/^write/i.test(toolName);
    if (editLike && existsSync(core.normalizePath(filePath, ctx.root))) return;
    const v = core.classifyWritePath(filePath, ctx);
    if (v.decision === 'deny') emitDeny(agent, msg.denyReason('write', v));
    return;
  }

  if (command) {
    const v = core.scanBashCommand(command, ctx);
    if (v.decision === 'deny') emitDeny(agent, msg.denyReason('bash', v));
  }
}

function gcFlags(stateDir) {
  let names;
  try { names = readdirSync(stateDir); } catch { return; }
  const now = Date.now();
  for (const name of names) {
    if (!name.startsWith('stop-once-')) continue;
    try {
      if (now - statSync(join(stateDir, name)).mtimeMs > FLAG_TTL_MS) unlinkSync(join(stateDir, name));
    } catch { /* 并发删除等竞态,忽略 */ }
  }
}

function handleStop(agent, payload, ctx) {
  if (payload.stop_hook_active) return; // 官方防死循环信号(Claude/Codex 已确认,Kimi 防御式尊重)
  const { cfg, root } = ctx;
  const mode = String(cfg.ENFORCE_LEDGER ?? 'block').toLowerCase();
  const checkTmp = cfg.CHECK_TMP_LEFTOVER !== false;
  if (mode === 'off' && !checkTmp) return;

  const flag = core.stopFlagPath(root, payload.session_id);
  if (existsSync(flag)) return; // 本会话已强制过一次
  gcFlags(dirname(flag));

  const issues = [];
  if (mode !== 'off') {
    const entries = core.gitStatusEntries(root);
    if (entries && core.ledgerSyncCheck(entries, cfg).needSync) issues.push(msg.msgLedgerSync());
  }
  if (checkTmp) {
    const leftovers = core.scratchLeftovers(root, cfg);
    if (leftovers.length) {
      issues.push(msg.msgScratchLeftover(cfg.SCRATCH_DIR ?? '.tmp', leftovers));
    }
  }
  if (!issues.length) return;

  const reason = 'tidykeep 收尾检查:'
    + issues.map((s, i) => `(${i + 1}) ${s}`).join(' ')
    + ' ' + msg.STOP_TAIL;

  if (mode === 'block') {
    try {
      mkdirSync(dirname(flag), { recursive: true });
      writeFileSync(flag, '1');
    } catch { /* 标记写失败时宁可少拦一次,不重复骚扰 */ }
    emitStopBlock(agent, reason);
  } else {
    emitStopWarn(agent, reason);
  }
}

function main() {
  const flavor = process.argv[2] ?? '';
  const [agent, event] = flavor.split('-');
  if (!agent || !event) return;

  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  if (!payload || typeof payload !== 'object') return;

  const root = findRoot(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());
  if (!root) return; // 未启用 tidykeep 的项目:放行(也是 Kimi 全局 hook 的项目守卫)

  const ctx = { root, cfg: core.loadConfig(root), allow: core.loadAllowlist(root) };
  if (event === 'pretooluse') handlePreToolUse(agent, payload, ctx);
  else if (event === 'stop') handleStop(agent, payload, ctx);
}

try {
  main();
} catch { /* guardrail:自身异常一律放行 */ }
process.exit(0);
