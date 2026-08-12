import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG, parseJsonc, parseLegacyConfig, loadConfig, loadAllowlist,
  toPosix, normalizePath, inProject, systemTmpPrefixes,
  classifyWritePath, visibleShellLines, scanBashCommand,
  ledgerSyncCheck, scratchLeftovers, checkStagedNames, stagedLedgerSync,
  checkCommitMsg, countChars, parseApplyPatch, stopFlagPath, newDoneItemsFromDiff, buildAutoCommitMessage,
} from '../../payload/runtime/core.mjs';

const ROOT = '/proj';
const cfg = () => ({ ...DEFAULT_CONFIG, staleRe: new RegExp(DEFAULT_CONFIG.STALE_RE, 'i') });
const ctx = (over = {}) => ({ root: ROOT, cfg: cfg(), allow: new Set(), ...over });

// ---------- 命名守卫正则(向量取自初稿 config 注释与实测) ----------
const STALE_POSITIVE = ['train_v2.py', 'a_old.ts', 'b-final.go', 'c_backup.sh', 'd copy.py', 'e(1).md', 'f副本.md', 'g备份.sh', 'h.bak.py', 'i_deprecated.rs', 'j_legacy.go', 'k_orig.c', 'l_copy2.js', 'm_finalfinal.md'];
const STALE_NEGATIVE = ['version.py', 'v2ray.conf', 'final.md.txt.gz.notmatch', 'oldman.py', 'newton.js', 'backup', 'copyright.md', 'temperature.py'];

test('stale 正则:正例全部命中', () => {
  const re = new RegExp(DEFAULT_CONFIG.STALE_RE, 'i');
  for (const name of STALE_POSITIVE) assert.ok(re.test(name), `应命中: ${name}`);
});

test('stale 正则:反例全部放行', () => {
  const re = new RegExp(DEFAULT_CONFIG.STALE_RE, 'i');
  for (const name of STALE_NEGATIVE) assert.ok(!re.test(name), `不应命中: ${name}`);
});

// ---------- 路径与系统 tmp ----------
test('normalizePath: 相对路径以 root 为基;~ 展开;反斜杠归一', () => {
  assert.equal(normalizePath('sub/x.py', ROOT, { homedir: '/home/u' }), '/proj/sub/x.py');
  assert.equal(normalizePath('~/tmp/x.py', ROOT, { homedir: '/home/u' }), '/home/u/tmp/x.py');
  assert.equal(toPosix('a\\b\\c.py'), 'a/b/c.py');
});

test('systemTmpPrefixes: 覆盖 unix 常见位置 + TMPDIR + windows temp', () => {
  const p = systemTmpPrefixes(ROOT, {
    homedir: '/home/u',
    tmpdir: 'C:\\Users\\u\\AppData\\Local\\Temp',
    env: { TMPDIR: '/run/user/1000/tmp' },
  });
  for (const want of ['/tmp/', '/var/tmp/', '/dev/shm/', '/home/u/tmp/', '/home/u/.tmp/', '/run/user/1000/tmp/', 'c:/users/u/appdata/local/temp/']) {
    assert.ok(p.some((x) => x.toLowerCase() === want.toLowerCase()), `缺少前缀: ${want}`);
  }
});

test('classifyWritePath: 系统 tmp → deny;项目住 tmp 下时项目内豁免', () => {
  const c = ctx({ opts: { homedir: '/home/u' } });
  assert.equal(classifyWritePath('/tmp/probe.sh', c).decision, 'deny');
  assert.equal(classifyWritePath('/tmp/probe.sh', c).kind, 'system-tmp');
  const inTmpProj = ctx({ root: '/tmp/proj', opts: { homedir: '/home/u' } });
  assert.equal(classifyWritePath('/tmp/proj/ok.py', inTmpProj).decision, 'allow');
});

test('classifyWritePath: 草稿区/.tidykeep/allowlist 放行;stale 命名 deny;项目外放行', () => {
  const c = ctx();
  assert.equal(classifyWritePath('/proj/.tmp/x_old.py', c).decision, 'allow');
  assert.equal(classifyWritePath('/proj/.tidykeep/y_old.py', c).decision, 'allow');
  assert.equal(classifyWritePath('/proj/train_v2.py', c).decision, 'deny');
  assert.equal(classifyWritePath('/proj/train_v2.py', c).kind, 'stale-name');
  assert.equal(classifyWritePath('train_v2.py', c).decision, 'deny'); // 相对路径
  assert.equal(classifyWritePath('/elsewhere/train_v2.py', c).decision, 'allow'); // 项目外非 tmp
  const allowed = ctx({ allow: new Set(['docs/data_v2.json']) });
  assert.equal(classifyWritePath('/proj/docs/data_v2.json', allowed).decision, 'allow');
});

// ---------- Bash 命令扫描 ----------
test('visibleShellLines: heredoc 正文被剥离', () => {
  const cmd = 'cat <<EOF > out.txt\n/tmp/fake.sh 不应被看到\nEOF\necho done';
  const v = visibleShellLines(cmd);
  assert.ok(!v.includes('fake.sh'));
  assert.ok(v.includes('echo done'));
});

test('scanBashCommand: 无创建动词 → allow(ls /tmp 不误伤)', () => {
  assert.equal(scanBashCommand('ls /tmp/whatever.sh', ctx()).decision, 'allow');
});

test('scanBashCommand: 重定向到系统 tmp → deny', () => {
  const r = scanBashCommand('echo hi > /tmp/out.txt', ctx());
  assert.equal(r.decision, 'deny');
  assert.equal(r.kind, 'system-tmp');
});

test('scanBashCommand: cp 到项目内 stale 命名路径 → deny', () => {
  const r = scanBashCommand('cp train.py src/train_v2.py', ctx());
  assert.equal(r.decision, 'deny');
  assert.equal(r.kind, 'stale-name');
  assert.deepEqual(r.hits, ['src/train_v2.py']);
});

test('scanBashCommand: mktemp 默认 → deny;mktemp -p 草稿区 → allow', () => {
  assert.equal(scanBashCommand('f=$(mktemp)', ctx()).kind, 'mktemp');
  assert.equal(scanBashCommand('mktemp -p .tmp', ctx()).decision, 'allow');
});

test('scanBashCommand: heredoc 内的 /tmp 不误伤', () => {
  const cmd = 'tee script.py <<PYEOF\nopen("/tmp/data.txt")\nPYEOF';
  assert.equal(scanBashCommand(cmd, ctx()).decision, 'allow');
});

test('scanBashCommand: 草稿区路径放行;PowerShell 动词也识别', () => {
  assert.equal(scanBashCommand('touch .tmp/probe.sh && bash .tmp/probe.sh', ctx()).decision, 'allow');
  assert.equal(scanBashCommand('Out-File /tmp/x.txt', ctx()).kind, 'system-tmp');
});

// ---------- 台账同步 ----------
test('ledgerSyncCheck: 改代码未动台账 → needSync;动了 LEDGER → 放行', () => {
  const c = cfg();
  assert.equal(ledgerSyncCheck([[' M', 'src/a.py']], c).needSync, true);
  assert.equal(ledgerSyncCheck([[' M', 'src/a.py'], ['M ', 'LEDGER.md']], c).needSync, false);
  assert.equal(ledgerSyncCheck([[' M', 'src/a.py'], ['??', 'LEDGER.md']], c).needSync, true); // 未跟踪台账不算已同步
});

test('ledgerSyncCheck: 忽略草稿区/工具目录/指针文件/非受管扩展名;rename 取新路径', () => {
  const c = cfg();
  const ignored = [[' M', '.tmp/x.py'], [' M', '.tidykeep/config.jsonc'], [' M', '.claude/settings.json'], [' M', '.codex/hooks.json'], [' M', '.agents/skills/t/SKILL.md'], [' M', 'AGENTS.md'], [' M', 'logo.png']];
  assert.equal(ledgerSyncCheck(ignored, c).needSync, false);
  assert.equal(ledgerSyncCheck([['R ', 'old.py -> new_thing.py']], c).needSync, true);
});

// ---------- 草稿区残留 ----------
test('scratchLeftovers: 列出残留,跳过哨兵文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-scratch-'));
  mkdirSync(join(dir, '.tmp', 'sub'), { recursive: true });
  writeFileSync(join(dir, '.tmp', '.gitkeep'), '');
  writeFileSync(join(dir, '.tmp', 'probe.sh'), 'x');
  writeFileSync(join(dir, '.tmp', 'sub', 'deep.py'), 'x');
  const found = scratchLeftovers(dir, cfg());
  assert.deepEqual(found.sort(), ['.tmp/probe.sh', '.tmp/sub/deep.py']);
  const empty = mkdtempSync(join(tmpdir(), 'tk-scratch2-'));
  assert.deepEqual(scratchLeftovers(empty, cfg()), []);
});

// ---------- git 层检查 ----------
test('checkStagedNames: 只拦项目区内 stale 命名,草稿区/.tidykeep/allowlist 放行', () => {
  const bad = checkStagedNames(
    ['src/train_v2.py', '.tmp/x_old.py', '.tidykeep/y_old.py', 'ok.py', 'docs/data_v2.json'],
    cfg(), new Set(['docs/data_v2.json']),
  );
  assert.deepEqual(bad, ['src/train_v2.py']);
});

test('stagedLedgerSync: 代码动了台账没动 → workHit 且非 ledgerHit', () => {
  const r = stagedLedgerSync(['src/a.py', 'README.md'], cfg());
  assert.equal(r.workHit, true);
  assert.equal(r.ledgerHit, false);
  const r2 = stagedLedgerSync(['src/a.py', 'LEDGER.md'], cfg());
  assert.equal(r2.ledgerHit, true);
});

// ---------- commit-msg ----------
test('checkCommitMsg: 长度校验按码点(中英同权),注释行剥离,豁免词', () => {
  const c = cfg();
  const good = 'feat: 增加断点续训支持\n\n为什么: 长任务中断后无法恢复\n影响: train.py 与 LEDGER.md';
  assert.equal(checkCommitMsg(good, c).ok, true);
  assert.equal(checkCommitMsg('fix: 小改\n\n短', c).ok, false);
  assert.equal(checkCommitMsg('Merge branch main', c).exempt, true);
  assert.equal(checkCommitMsg('fixup! whatever', c).exempt, true);
  const withComments = 'feat: 增加断点续训支持\n# 注释行\n\n为什么: 中断恢复;影响: train.py 台账已更新';
  assert.equal(checkCommitMsg(withComments, c).ok, true);
  assert.equal(countChars('修复了一个很重要的问题'), 11);
});

// ---------- apply_patch(Codex V4A) ----------
test('parseApplyPatch: Add/Move 提取为检查目标,Update/Delete 放行', () => {
  const patch = `*** Begin Patch
*** Add File: src/train_v2.py
+print("x")
*** Update File: src/train.py
@@
-a
+b
*** Delete File: src/dead.py
*** Move to: src/renamed_old.py
*** End Patch`;
  const r = parseApplyPatch(patch);
  assert.deepEqual(r.checkTargets.sort(), ['src/renamed_old.py', 'src/train_v2.py']);
});

test('parseApplyPatch: 解析失败/非 patch → 空目标(放行)', () => {
  assert.deepEqual(parseApplyPatch('not a patch').checkTargets, []);
});

// ---------- 配置加载 ----------
test('DEFAULT_CONFIG 与 payload/config.jsonc 一致(单一真源锁)', () => {
  const text = readFileSync(new URL('../../payload/config.jsonc', import.meta.url), 'utf8');
  const fileCfg = parseJsonc(text);
  assert.deepEqual(fileCfg, DEFAULT_CONFIG);
});

test('loadConfig: 缺文件用默认;config.jsonc 覆盖;旧 KEY=VALUE 兼容读取', () => {
  const d1 = mkdtempSync(join(tmpdir(), 'tk-cfg-'));
  assert.equal(loadConfig(d1).ENFORCE_LEDGER, 'block');
  mkdirSync(join(d1, '.tidykeep'), { recursive: true });
  writeFileSync(join(d1, '.tidykeep', 'config.jsonc'), '{ "ENFORCE_LEDGER": "warn" // 注释\n}');
  assert.equal(loadConfig(d1).ENFORCE_LEDGER, 'warn');
  const d2 = mkdtempSync(join(tmpdir(), 'tk-cfg2-'));
  mkdirSync(join(d2, '.tidykeep'), { recursive: true });
  writeFileSync(join(d2, '.tidykeep', 'config'), 'GUARD="off"\nENFORCE_LEDGER="warn"\nSCRATCH_DIR=".scratch"\nMIN_SUBJECT="15"\n');
  const legacy = loadConfig(d2);
  assert.equal(legacy.GUARD, false);
  assert.equal(legacy.ENFORCE_LEDGER, 'warn');
  assert.equal(legacy.SCRATCH_DIR, '.scratch');
  assert.equal(legacy.MIN_SUBJECT, 15);
});

test('parseLegacyConfig: on/off → 布尔,数字串 → 数字,扩展名串 → 数组,STALE_ERE → STALE_RE', () => {
  const m = parseLegacyConfig('GUARD="on"\nFORBID_SYSTEM_TMP="off"\nCODE_EXTS="py js"\nSTALE_ERE="xx\\.py$"\nMIN_BODY="30"\n# 注释\n');
  assert.equal(m.GUARD, true);
  assert.equal(m.FORBID_SYSTEM_TMP, false);
  assert.deepEqual(m.CODE_EXTS, ['py', 'js']);
  assert.equal(m.STALE_RE, 'xx\\.py$');
  assert.equal(m.MIN_BODY, 30);
});

test('loadAllowlist: 跳过注释与空行', () => {
  const d = mkdtempSync(join(tmpdir(), 'tk-allow-'));
  mkdirSync(join(d, '.tidykeep'), { recursive: true });
  writeFileSync(join(d, '.tidykeep', 'allowlist'), '# 注释\n\ndocs/data_v2.json\n');
  assert.deepEqual([...loadAllowlist(d)], ['docs/data_v2.json']);
});

// ---------- 第二轮对抗审查确认缺陷的回归测试 ----------

test('bash 模式下行尾 @" 不触发 here-string 剥离(否则整段扫描被绕过)', () => {
  const cmd = 'echo "ping admin@"\necho secret > /tmp/leak.txt';
  const r = scanBashCommand(cmd, ctx());
  assert.equal(r.decision, 'deny');
  assert.equal(r.kind, 'system-tmp');
});

test('powershell 模式下 here-string 正文被剥离', () => {
  const cmd = '$x = @"\n/tmp/fake.txt inside herestring\n"@\nWrite-Host done';
  const v = visibleShellLines(cmd, { powershell: true });
  assert.ok(!v.includes('fake.txt'));
  const r = scanBashCommand('$x = @"\ncp a /tmp/fake.txt\n"@\nNew-Item real.txt', ctx(), { powershell: true });
  assert.equal(r.decision, 'allow');
});

test('file_path 带尾随换行不再绕过命名守卫(python $ 语义对齐)', () => {
  assert.equal(classifyWritePath('/proj/train_v2.py\n', ctx()).decision, 'deny');
});

test('POSIX 上 /TMP 大小写不同不误判为系统 tmp;win32 平台仍不区分大小写', () => {
  assert.equal(classifyWritePath('/TMP/x.sh', ctx()).decision, 'allow');
  const winCtx = ctx({ root: 'C:/proj', opts: { platform: 'win32', homedir: 'C:/Users/u', tmpdir: 'C:\\Users\\u\\AppData\\Local\\Temp' } });
  assert.equal(classifyWritePath('C:\\USERS\\U\\APPDATA\\LOCAL\\TEMP\\x.py', winCtx).decision, 'deny');
});

test('win32 下项目内前缀与 allowlist 比较不区分大小写', () => {
  const winCtx = ctx({ root: 'C:/proj', allow: new Set(['docs/data_v2.json']), opts: { platform: 'win32', homedir: 'C:/Users/u' } });
  assert.equal(classifyWritePath('C:/proj/.TMP/x_old.py', winCtx).decision, 'allow');
  assert.equal(classifyWritePath('C:/proj/DOCS/DATA_V2.JSON', winCtx).decision, 'allow');
});

test('UNC 路径保留 // 前缀,项目内判断正确', () => {
  assert.equal(normalizePath('\\\\server\\share\\proj\\a.py', '/x'), '//server/share/proj/a.py');
  const c = ctx({ root: '\\\\server\\share\\proj' });
  assert.equal(classifyWritePath('\\\\server\\share\\proj\\.tmp\\x_old.py', c).decision, 'allow');
});

test('~otheruser 路径按项目外处理(对齐基线 expanduser 放行语义)', () => {
  assert.equal(classifyWritePath('~bob/x_old.py', ctx({ opts: { homedir: '/home/u' } })).decision, 'allow');
});

test('checkCommitMsg: scissors(git commit -v)之后的 diff 不计入正文长度', () => {
  const c = cfg();
  const msg = 'fix: 短\n\n# ------------------------ >8 ------------------------\ndiff --git a/x b/x\n+'.padEnd(400, 'x');
  assert.equal(checkCommitMsg(msg, c).ok, false);
});

test('scanBashCommand 方向敏感:cp 以 /tmp 为源、项目为目标 → 放行;反向 → 拦截', () => {
  assert.equal(scanBashCommand('cp /tmp/data.csv ./data.csv', ctx()).decision, 'allow');
  const r = scanBashCommand('cp a.py /tmp/b.py', ctx());
  assert.equal(r.kind, 'system-tmp');
});

test('stopFlagPath: 超长 session id 被摘要,文件名可写', () => {
  const p = stopFlagPath('/proj', 'x'.repeat(500));
  assert.ok(p.split('/').pop().length < 120);
});

// ---------- AUTO_COMMIT ----------

test('newDoneItemsFromDiff: 从 LEDGER diff 提取本次新增的 DONE 条目', () => {
  const diff = [
    '+++ b/LEDGER.md',
    '+  - [x] 2026-08-12 支持断点续训,合并删除 train_v2.py',
    ' - [x] 2026-08-11 旧条目不算',
    '+  - [ ] 新 TODO 不算',
    '+  - [x] 2026-08-12 修复数据加载竞态',
  ].join('\n');
  assert.deepEqual(newDoneItemsFromDiff(diff), ['支持断点续训,合并删除 train_v2.py', '修复数据加载竞态']);
});

test('buildAutoCommitMessage: 满足自身 commit-msg 规范(主题/正文长度)', () => {
  const c = cfg();
  const withItems = buildAutoCommitMessage(['支持断点续训'], ['train.py', 'LEDGER.md']);
  assert.equal(checkCommitMsg(withItems, c).ok, true);
  const noItems = buildAutoCommitMessage([], ['a.py', 'b.py', 'LEDGER.md']);
  assert.equal(checkCommitMsg(noItems, c).ok, true);
});
