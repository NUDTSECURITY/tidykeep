// tidykeep runtime 写入策略(vendored;由 `npx tidykeep init` 刷新,请勿手改)。
// 单路径、shell 命令与 Codex apply_patch 共用同一组路径裁决原语。
import {
  foldCase, inProject, matchesTmpPrefix, normalizePath, relAllowed, relToRoot,
  scratchName, systemTmpPrefixes,
} from './paths.mjs';

// ---------- 单文件写入裁决(Write/Edit 新建/NotebookEdit/apply_patch Add|Move 共用) ----------

export function classifyWritePath(filePath, ctx) {
  const { root, cfg, allow = new Set(), opts = {} } = ctx;
  if (!filePath) return { decision: 'allow' };
  const platform = opts.platform ?? process.platform;
  const tmpOn = cfg.FORBID_SYSTEM_TMP !== false;
  const guardOn = cfg.GUARD !== false;
  if (!tmpOn && !guardOn) return { decision: 'allow' };
  const scratch = scratchName(cfg);
  // 尾随换行/回车是调用方笔误,python 的 $ 会在换行前命中,这里对齐(防绕过)
  const cleaned = String(filePath).replace(/[\r\n]+$/, '');
  const ap = normalizePath(cleaned, root, opts);
  const base = ap.split('/').pop();
  const inside = inProject(ap, root, opts);
  if (tmpOn && !inside && matchesTmpPrefix(ap, systemTmpPrefixes(root, opts), platform)) {
    return { decision: 'deny', kind: 'system-tmp', detail: { base, path: cleaned, scratch } };
  }
  if (!inside) return { decision: 'allow' }; // 项目外其他位置不在守卫职责内
  const rel = relToRoot(ap, root, opts);
  if (relAllowed(rel, scratch, allow, platform)) return { decision: 'allow' };
  if (guardOn && cfg.staleRe.test(base)) {
    return { decision: 'deny', kind: 'stale-name', detail: { base, rel, scratch } };
  }
  return { decision: 'allow' };
}

// ---------- Bash / PowerShell 命令扫描 ----------

export function visibleShellLines(cmd, opts = {}) {
  const out = [];
  let term = null;      // heredoc 终止词
  let psQuote = null;   // PowerShell here-string 终止引号
  for (const line of cmd.split('\n')) {
    if (term !== null) {
      const t = line.trim();
      if (t === term || t === term + ';') term = null;
      continue;
    }
    if (psQuote !== null) {
      if (line.trimStart().startsWith(psQuote + '@')) psQuote = null;
      continue;
    }
    const codeLine = stripShellComment(line);
    out.push(codeLine);
    const tokens = lexShell(codeLine);
    const heredoc = tokens.findIndex((token, index) => token.op === '<<' && tokens[index + 1]?.value);
    if (heredoc !== -1) {
      // lexer 把 <<-EOF 解析为 << + -EOF；带引号 delimiter 也已安全去引号。
      term = tokens[heredoc + 1].value.replace(/^-/, '');
      if (term) continue;
      term = null;
    }
    // here-string 是 PowerShell 独有语法;bash 命令里行尾的 @" 只是普通字符串
    // (如 email),误入会吞掉后续所有行、绕过整段扫描——因此按 shell 类型门控
    if (opts.powershell) {
      const ps = line.match(/@(['"])\s*$/);
      if (ps) psQuote = ps[1];
    }
  }
  return out.join('\n');
}

/** 去掉引号外、位于 token 起点的 shell 注释；引号内和 foo#bar 中的 # 保留。 */
function stripShellComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '#' && (i === 0 || /[\s;|&()]/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line;
}

function cleanToken(raw) {
  return raw.replace(/^[\'"`]+|[\'"`]+$/g, '').replace(/[),;]+$/, '');
}

const COPY_VERBS = new Set(['cp', 'mv', 'ln', 'link', 'rsync', 'install', 'copy-item', 'move-item']);
const DIRECT_WRITE_VERBS = new Set([
  'touch', 'tee', 'truncate', 'mkdir', 'new-item', 'out-file', 'set-content', 'add-content',
]);
const SIMPLE_WRAPPERS = new Set(['command', 'builtin', 'exec', 'nohup']);
const SHELL_WRAPPERS = new Set(['sh', 'bash', 'dash', 'zsh', 'pwsh', 'powershell']);

/** 足以识别写入目标的轻量 shell lexer；引号内容保持为单 token，不把搜索字面量当命令。 */
function lexShell(text) {
  const tokens = [];
  let value = '';
  let quote = null;
  let noExpand = false;
  const push = () => {
    if (value) tokens.push({ value, noExpand });
    value = '';
    noExpand = false;
  };
  const op = (value0) => { push(); tokens.push({ op: value0 }); };
  const input = String(text);
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      if (c === '\\' && quote === '"' && i + 1 < input.length && /["\\$`]/.test(input[i + 1])) {
        value += input[++i];
      } else {
        value += c;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      if (c === "'" && !value) noExpand = true;
      continue;
    }
    if (c === '\\' && i + 1 < input.length && /[\s;|&()<>\'"\\]/.test(input[i + 1])) {
      value += input[++i];
      continue;
    }
    if (/[^\S\r\n]/.test(c)) { push(); continue; }
    if (c === '\r' || c === '\n') {
      push();
      if (!tokens.length || tokens.at(-1).op !== ';') tokens.push({ op: ';' });
      if (c === '\r' && input[i + 1] === '\n') i++;
      continue;
    }
    if (c === '>' || c === '<') {
      const next = input[i + 1] === c ? c + c : c;
      if (next.length === 2) i++;
      op(next);
      continue;
    }
    if (';|&()'.includes(c)) {
      const next = (c === '|' || c === '&') && input[i + 1] === c ? c + c : c;
      if (next.length === 2) i++;
      op(next);
      continue;
    }
    value += c;
  }
  push();
  return tokens;
}

function shellSegments(tokens) {
  const segments = [];
  let current = [];
  for (const token of tokens) {
    if (token.op && [';', '|', '||', '&', '&&', '(', ')'].includes(token.op)) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length) segments.push(current);
  return segments;
}

function commandName(token) {
  return String(token ?? '').replaceAll('\\', '/').split('/').pop().toLowerCase();
}

const isAssignment = (value) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);

/** 去掉重定向与常见 wrapper，返回真正命令及其参数。 */
function unwrapCommand(segment) {
  const plain = [];
  for (let i = 0; i < segment.length; i++) {
    if (segment[i].op === '>' || segment[i].op === '>>' || segment[i].op === '<' || segment[i].op === '<<') {
      i++;
      continue;
    }
    if (!segment[i].op) plain.push(segment[i]);
  }
  let i = 0;
  while (i < plain.length && isAssignment(plain[i].value)) i++;
  for (;;) {
    const verb = commandName(plain[i]?.value);
    if (verb === 'sudo') {
      i++;
      while (i < plain.length && plain[i].value.startsWith('-')) {
        const flag = plain[i++].value;
        if (flag === '--') break;
        if (['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from'].includes(flag)) i++;
      }
    } else if (verb === 'env') {
      i++;
      const argOptions = new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string', '--argv0']);
      while (i < plain.length) {
        const value0 = plain[i].value;
        if (isAssignment(value0)) { i++; continue; }
        if (value0 === '--') { i++; break; }
        if (argOptions.has(value0)) { i += 2; continue; }
        if (value0.startsWith('-')) { i++; continue; }
        break;
      }
    } else if (SIMPLE_WRAPPERS.has(verb)) {
      i++;
      while (i < plain.length && plain[i].value.startsWith('-')) i++;
    } else if (verb === 'timeout') {
      i++;
      const argOptions = new Set(['-s', '--signal', '-k', '--kill-after']);
      while (i < plain.length) {
        const value0 = plain[i].value;
        if (value0 === '--') { i++; break; }
        if (argOptions.has(value0)) { i += 2; continue; }
        if (value0.startsWith('-')) { i++; continue; }
        break;
      }
      if (i < plain.length) i++; // duration
    } else if (verb === 'nice' || verb === 'time') {
      i++;
      while (i < plain.length && plain[i].value.startsWith('-')) i++;
    } else {
      break;
    }
    while (i < plain.length && isAssignment(plain[i].value)) i++;
  }
  return plain.slice(i);
}

function expandTempVars(token, env) {
  if (token.noExpand) return token.value;
  let value = token.value;
  for (const key of ['TMPDIR', 'TEMP', 'TMP']) {
    if (!env[key]) continue;
    const replacement = String(env[key]);
    value = value.replace(new RegExp(`\\$\\{${key}\\}`, 'gi'), replacement);
    value = value.replace(new RegExp(`\\$env:${key}(?=$|[\\\\/])`, 'gi'), replacement);
    value = value.replace(new RegExp(`\\$${key}(?=$|[\\\\/])`, 'gi'), replacement);
    value = value.replace(new RegExp(`%${key}%`, 'gi'), replacement);
  }
  return value;
}

function referencesTempVariable(token) {
  if (token.noExpand) return false;
  return /^(?:\$\{?(?:TMPDIR|TEMP|TMP)\}?|\$env:(?:TMPDIR|TEMP|TMP)|%(?:TMPDIR|TEMP|TMP)%)(?:$|[\\/])/i
    .test(token.value);
}

function isWithin(path, dir, platform) {
  const lhs = foldCase(path.replace(/\/+$/, ''), platform);
  const rhs = foldCase(dir.replace(/\/+$/, ''), platform);
  return lhs === rhs || lhs.startsWith(rhs + '/');
}

function targetTokens(segment, command, ctx) {
  const targets = [];
  const env = ctx.opts?.env ?? process.env;
  for (let i = 0; i < segment.length; i++) {
    if (segment[i].op === '>' || segment[i].op === '>>') {
      const target = segment[i + 1];
      if (target?.value) targets.push({ ...target, value: expandTempVars(target, env) });
      i++;
    }
  }
  if (!command.length) return targets;
  const verb = commandName(command[0].value);
  const args = command.slice(1);

  if (verb === 'dd') {
    for (const token of args) {
      if (token.value.startsWith('of=') && token.value.length > 3) {
        targets.push({ ...token, value: expandTempVars({ ...token, value: token.value.slice(3) }, env) });
      }
    }
    return targets;
  }

  const operands = args.filter((token) => token.value !== '--' && !token.value.startsWith('-') && !isAssignment(token.value));
  if (COPY_VERBS.has(verb)) {
    const targetFlag = args.findIndex((token) => token.value === '-t' || token.value === '--target-directory');
    const inlineTarget = args.find((token) => token.value.startsWith('--target-directory='));
    if (targetFlag !== -1 && args[targetFlag + 1]) targets.push(args[targetFlag + 1]);
    else if (inlineTarget) targets.push({ ...inlineTarget, value: inlineTarget.value.slice(inlineTarget.value.indexOf('=') + 1) });
    else if (operands.length) targets.push(operands.at(-1));
  } else if (DIRECT_WRITE_VERBS.has(verb)) {
    targets.push(...operands);
  }
  return targets.map((token) => ({ ...token, value: expandTempVars(token, env) }));
}

function mktempAllowed(command, ctx, platform) {
  const args = command.slice(1);
  const env = ctx.opts?.env ?? process.env;
  let dirToken = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i].value === '-p' || args[i].value === '--tmpdir') dirToken = args[i + 1] ?? null;
    else if (args[i].value.startsWith('-p=') && args[i].value.length > 3) {
      dirToken = { ...args[i], value: args[i].value.slice(3) };
    }
    else if (args[i].value.startsWith('--tmpdir=')) {
      dirToken = { ...args[i], value: args[i].value.slice('--tmpdir='.length) };
    }
  }
  // `mktemp scratch/template.XXXX` 也明确指定了项目内模板。
  if (!dirToken) dirToken = args.find((token) => !token.value.startsWith('-')) ?? null;
  if (!dirToken) return false;
  const candidate = normalizePath(expandTempVars(dirToken, env), ctx.root, ctx.opts);
  const scratch = normalizePath(scratchName(ctx.cfg), ctx.root, ctx.opts);
  return isWithin(candidate, scratch, platform);
}

export function scanBashCommand(cmd, ctx, scanOpts = {}) {
  const { root, cfg, allow = new Set(), opts = {} } = ctx;
  if (!cmd) return { decision: 'allow' };
  const platform = opts.platform ?? process.platform;
  const tmpOn = cfg.FORBID_SYSTEM_TMP !== false;
  const guardOn = cfg.GUARD !== false;
  if (!tmpOn && !guardOn) return { decision: 'allow' };
  const scratch = scratchName(cfg);
  const visible = visibleShellLines(cmd, { powershell: scanOpts.powershell === true });
  const prefixes = tmpOn ? systemTmpPrefixes(root, opts) : [];
  const tmpHits = [];
  const staleHits = [];
  for (const segment of shellSegments(lexShell(visible))) {
    const command = unwrapCommand(segment);
    const verb = commandName(command[0]?.value);
    if (SHELL_WRAPPERS.has(verb)) {
      const flag = command.findIndex((token) => /^-[^-]*c[^-]*$/.test(token.value) || /^--command$/i.test(token.value));
      if (flag !== -1 && command[flag + 1] && (scanOpts.depth ?? 0) < 3) {
        const nested = scanBashCommand(command[flag + 1].value, ctx, { ...scanOpts, depth: (scanOpts.depth ?? 0) + 1 });
        if (nested.decision === 'deny') return nested;
      }
    }
    if (verb === 'mktemp' && tmpOn && !mktempAllowed(command, ctx, platform)) {
      return { decision: 'deny', kind: 'mktemp', hits: ['mktemp'], detail: { scratch } };
    }
    for (const token of targetTokens(segment, command, ctx)) {
      const raw = cleanToken(token.value);
      if (!raw || raw === '-') continue;
      if (tmpOn && referencesTempVariable(token)) {
        tmpHits.push(raw);
        continue;
      }
      const ap = normalizePath(raw, root, opts);
      const base = ap.split('/').pop();
      const inside = inProject(ap, root, opts);
      if (tmpOn && !inside && matchesTmpPrefix(ap, prefixes, platform)) {
        tmpHits.push(raw);
        continue;
      }
      if (guardOn && inside) {
        const rel = relToRoot(ap, root, opts);
        if (relAllowed(rel, scratch, allow, platform)) continue;
        if (cfg.staleRe.test(base)) staleHits.push(rel);
      }
    }
  }
  if (tmpHits.length) {
    return { decision: 'deny', kind: 'system-tmp', hits: [...new Set(tmpHits)].sort(), detail: { scratch } };
  }
  if (staleHits.length) {
    return { decision: 'deny', kind: 'stale-name', hits: [...new Set(staleHits)].sort(), detail: { scratch } };
  }
  return { decision: 'allow' };
}

// ---------- Codex apply_patch(V4A envelope) ----------

export function parseApplyPatch(text) {
  const checkTargets = [];
  const updates = [];
  const deletes = [];
  if (typeof text === 'string') {
    for (const m of text.matchAll(/^\*{3} (Add File|Update File|Delete File|Move to): (.+)$/gm)) {
      const path = m[2].trim();
      if (m[1] === 'Add File' || m[1] === 'Move to') checkTargets.push(path);
      else if (m[1] === 'Update File') updates.push(path);
      else deletes.push(path);
    }
  }
  return { checkTargets, updates, deletes };
}
