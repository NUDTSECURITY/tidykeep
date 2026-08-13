#!/usr/bin/env node
// tidykeep agent hook 统一入口(vendored;由 `npx tidykeep init` 刷新,请勿手改)。
// 用法: node hook.mjs <flavor>   flavor ∈ {claude,codex,kimi}-{pretooluse,stop}
// 契约:任何内部异常一律静默放行(exit 0)——hook 是 guardrail,不是安全边界,
//       自身故障不得瘫痪 agent;硬边界由 git hooks 兜底。
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import * as core from './core.mjs';
import * as msg from './messages.mjs';

const FLAG_TTL_MS = 48 * 3600 * 1000;

function findRoot(start) {
  let dir = resolve(start || process.cwd());
  for (;;) {
    if (existsSync(join(dir, '.tidykeep'))) return dir;
    // 最近的嵌套 Git 工作区没有启用 tidykeep 时,不得继续向上继承外层项目配置。
    // `.git` 在普通仓库中是目录,在 linked worktree/submodule 中是文件。
    if (existsSync(join(dir, '.git'))) return null;
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
    // 正向门控:只有名字表明"会写文件"的工具才做写入裁决。Kimi 层无 matcher、
    // 事件全量进入,只读工具(ReadFile/Grep/Glob…)带 path 字段是常态,
    // 不得按写入拒绝(对齐基线"仅 Write 检查"的语义)。
    const WRITE_TOOL_RE = /write|edit|create|save|notebook|patch|append|new/i;
    if (!WRITE_TOOL_RE.test(toolName)) return;
    // Edit 类工具改的是已存在的文件 → 放行,避免"合法历史遗留文件无法编辑"的自锁;
    // 目标不存在(即新建)才做命名/路径检查。Write 是整文件覆写,始终检查。
    const editLike = /edit/i.test(toolName) && !/^write/i.test(toolName);
    if (editLike && existsSync(core.normalizePath(filePath, ctx.root))) return;
    const v = core.classifyWritePath(filePath, ctx);
    if (v.decision === 'deny') emitDeny(agent, msg.denyReason('write', v));
    return;
  }

  if (command) {
    const v = core.scanBashCommand(command, ctx, { powershell: /powershell|pwsh/i.test(toolName) });
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

function fallbackSessionId(agent, payload) {
  const parent = process.env.TIDYKEEP_PARENT_PID || process.ppid;
  return `${agent}-${payload.session_id || `parent-${parent}`}`;
}

function gitText(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 10000, shell: false,
  });
  return !result.error && result.status === 0 ? result.stdout : null;
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ledgerState(root, entries, cfg) {
  const basic = core.ledgerSyncCheck(entries, cfg);
  if (!basic.workChanged || basic.needSync) return { ...basic, coverageOk: !basic.needSync, missing: [] };
  const headExists = gitText(root, ['rev-parse', '--verify', 'HEAD']) !== null;
  let headLedger = '';
  if (headExists) {
    const existsAtHead = gitText(root, ['cat-file', '-e', 'HEAD:LEDGER.md']) !== null;
    if (existsAtHead) {
      headLedger = gitText(root, ['show', 'HEAD:LEDGER.md']);
      if (headLedger === null) return { ...basic, coverageOk: false, missing: basic.changes };
    }
  }
  let currentLedger;
  try { currentLedger = readFileSync(join(root, 'LEDGER.md'), 'utf8'); } catch {
    return { ...basic, coverageOk: false, missing: basic.changes };
  }
  const coverage = core.ledgerCoverageCheck(
    basic.changes,
    headLedger,
    currentLedger,
    localDate(),
  );
  return { ...basic, coverageOk: coverage.ok, missing: coverage.missing };
}

/** 收尾完成态(有改动且台账已同步)下提醒提交;旧 auto 配置安全降级为 remind。 */
function maybeCommitReminder(agent, payload, ctx, entries, sync) {
  const { cfg, root } = ctx;
  const autoMode = String(cfg.AUTO_COMMIT ?? 'off').toLowerCase();
  if (autoMode !== 'remind') return;
  if (!entries || !entries.length) return; // 无改动(纯对话回合)不触发
  const { needSync, ledgerChanged, coverageOk } = sync;
  // "功能完成"的确定性信号:台账被更新过且不再欠账——半成品(未收尾)不提交
  if (needSync || !ledgerChanged || !coverageOk) return;

  const flag = core.stopFlagPath(root, fallbackSessionId(agent, payload)) + '-commit';
  if (existsSync(flag)) return;
  try {
    mkdirSync(dirname(flag), { recursive: true });
    writeFileSync(flag, '1');
  } catch {
    emitStopWarn(agent, msg.msgCommitRemind());
    return;
  }
  emitStopBlock(agent, msg.msgCommitRemind());
}

function handleStop(agent, payload, ctx) {
  if (payload.stop_hook_active) return; // 官方防死循环信号(Claude/Codex 已确认,Kimi 防御式尊重)
  const { cfg, root } = ctx;
  const mode = String(cfg.ENFORCE_LEDGER ?? 'block').toLowerCase();
  const checkTmp = cfg.CHECK_TMP_LEFTOVER !== false;
  const autoMode = String(cfg.AUTO_COMMIT ?? 'off').toLowerCase();
  if (mode === 'off' && !checkTmp && autoMode === 'off') return;

  const flag = core.stopFlagPath(root, fallbackSessionId(agent, payload));
  const flagUsed = existsSync(flag); // 本会话已强制过一次 → 不再打回；提交提醒另用独立标记
  gcFlags(dirname(flag));
  const entries = core.gitStatusEntries(root);
  const sync = entries ? ledgerState(root, entries, cfg) : null;
  const review = entries ? core.semanticReviewFacts(entries, cfg) : null;

  if (!flagUsed) {
    const issues = [];
    // 确定性 hook 只负责在正确时机把有界变更事实交给 Agent；语义判断由 tidykeep skill 完成。
    // 即使 LEDGER 已机械同步也触发一次，避免“台账改了但未审查 STATE/文档/清理候选”的空心收尾。
    if (mode !== 'off' && review?.total) {
      issues.push(msg.msgSemanticReview(review));
    }
    if (mode !== 'off' && sync && (sync.needSync || !sync.coverageOk)) {
      const missing = (sync.missing ?? []).map((item) => item.path).filter(Boolean);
      issues.push(msg.msgLedgerSync() + (missing.length ? ` 尚未逐文件覆盖:${missing.join('、')}。` : ''));
    }
    if (checkTmp) {
      const leftovers = core.scratchLeftovers(root, cfg);
      if (leftovers.length) {
        issues.push(msg.msgScratchLeftover(cfg.SCRATCH_DIR ?? '.tmp', leftovers));
      }
    }
    if (issues.length) {
      const reason = 'tidykeep 收尾检查:'
        + issues.map((s, i) => `(${i + 1}) ${s}`).join(' ')
        + ' ' + msg.STOP_TAIL;
      if (mode === 'block') {
        try {
          mkdirSync(dirname(flag), { recursive: true });
          writeFileSync(flag, '1');
        } catch {
          // 标记写不进去就无法保证"每会话只强制一次",block 会变成反复骚扰
          // (Kimi 无官方防死循环信号时甚至收不了工)——降级为 warn
          emitStopWarn(agent, reason);
          return;
        }
        emitStopBlock(agent, reason);
      } else {
        emitStopWarn(agent, reason);
      }
      return;
    }
  }

  maybeCommitReminder(agent, payload, ctx, entries, sync ?? { coverageOk: false });
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

  // 事件 cwd 比 Claude 的外层项目环境变量更接近实际操作位置。若 cwd 位于一个
  // 未接入 tidykeep 的嵌套 Git 仓库，findRoot 会在该边界停止，不能继承外层守卫。
  const root = findRoot(payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root) return; // 未启用 tidykeep 的项目:放行(也是 Kimi 全局 hook 的项目守卫)

  const ctx = { root, cfg: core.loadConfig(root), allow: core.loadAllowlist(root) };
  if (event === 'pretooluse') handlePreToolUse(agent, payload, ctx);
  else if (event === 'stop') handleStop(agent, payload, ctx);
}

try {
  main();
} catch { /* guardrail:自身异常一律放行 */ }
process.exit(0);
