// tidykeep runtime 提交与会话策略(vendored;由 `npx tidykeep init` 刷新,请勿手改)。
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export function countChars(s) {
  return [...String(s).trim()].length;
}

const AUTO_COMMENT_CHARS = new Set('#;@!$%^&|:'.split(''));
const TEMPLATE_HINT = /^(?:Please enter the commit message|Lines starting with|On branch\b|Your branch\b|Changes to be committed:|Changes not staged for commit:|Untracked files:|No changes added to commit)/;

/** core.commentChar=auto 时，从 Git 实际写入的 scissors 或模板注释反推本次字符。 */
function inferCommentChar(text) {
  const source = String(text);
  const scissors = source.match(/^([^\p{L}\p{N}\s])[ \t]*-+[ \t]*>8[ \t]*-+[ \t]*$/mu);
  if (scissors) return scissors[1];

  const counts = new Map();
  const standalone = new Set();
  for (const line of source.split('\n')) {
    const char = line[0];
    if (!AUTO_COMMENT_CHARS.has(char) || (line.length > 1 && !/[ \t]/.test(line[1]))) continue;
    const body = line.slice(1).trimStart();
    if (TEMPLATE_HINT.test(body)) return char;
    counts.set(char, (counts.get(char) ?? 0) + 1);
    if (!body) standalone.add(char);
  }
  // Git 模板通常包含多行同前缀及空注释行；此证据避免把单个正文标点误认成注释。
  for (const [char, count] of counts) {
    if (count >= 2 && standalone.has(char)) return char;
  }
  return '#';
}

export function checkCommitMsg(text, cfg, opts = {}) {
  // git commit -v 会在 scissors 线后附带整个 diff(git 提交时会截掉),
  // 必须先截断,否则 diff 行喂饱正文长度、检查被静默绕过
  const requested = typeof opts.commentChar === 'string' ? opts.commentChar : '#';
  const commentChar = requested === 'auto'
    ? inferCommentChar(text)
    : (requested.length === 1 ? requested : '#');
  const escaped = commentChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const beforeScissors = String(text).split(new RegExp(`^${escaped} -+ >8 -+`, 'm'))[0];
  const lines = beforeScissors.split('\n').filter((line) => !line.startsWith(commentChar));
  const subject = (lines[0] ?? '').trim();
  const body = lines.slice(1).filter((l) => l.trim() !== '').join('\n');
  if (/^(Merge |Revert |fixup!|squash!|amend!)/.test(subject)) {
    return {
      ok: true, exempt: true, subjectLen: countChars(subject), bodyLen: countChars(body),
      typeOk: true, whyOk: true, impactOk: true,
    };
  }
  const subjectLen = countChars(subject);
  const bodyLen = countChars(body);
  const typeOk = /^(feat|fix|refactor|docs|chore|test|perf):\s+\S/.test(subject);
  const whyOk = /^为什么:\s*\S.*$/m.test(body);
  const impactOk = /^影响:\s*\S.*$/m.test(body);
  return {
    ok: typeOk && whyOk && impactOk
      && subjectLen >= (cfg.MIN_SUBJECT ?? 10) && bodyLen >= (cfg.MIN_BODY ?? 20),
    exempt: false,
    subjectLen,
    bodyLen,
    typeOk,
    whyOk,
    impactOk,
  };
}

// ---------- 会话标记(防 Stop 死循环;放项目内 .state/,不落系统 tmp) ----------

export function stopFlagPath(root, sessionId, opts = {}) {
  const env = opts.env ?? process.env;
  const fallback = env.CODEX_THREAD_ID || env.CLAUDE_SESSION_ID || env.KIMI_SESSION_ID
    || `parent-${opts.ppid ?? process.ppid}`;
  let id = String(sessionId || fallback).replace(/[^A-Za-z0-9._-]/g, '_');
  if (id.length > 64) id = createHash('sha1').update(id).digest('hex'); // 超长 id 摘要,保证文件名可写
  return join(root, '.tidykeep', '.state', `stop-once-${id}`);
}
