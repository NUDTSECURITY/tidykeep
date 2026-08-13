import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../helpers/temp.mjs';
import { parseGitStatusOutput } from '../../payload/runtime/ledger.mjs';
import * as coreFacade from '../../payload/runtime/core.mjs';
import {
  DEFAULT_CONFIG, parseJsonc, parseLegacyConfig, validateConfig, loadConfig, loadAllowlist,
  toPosix, normalizePath, inProject, systemTmpPrefixes,
  classifyWritePath, visibleShellLines, scanBashCommand,
  gitStatusEntries, managedPathChanges, ledgerSyncCheck, ledgerCoverageCheck,
  scratchLeftovers, semanticReviewFacts, checkStagedNames,
  checkCommitMsg, countChars, parseApplyPatch, stopFlagPath,
} from '../../payload/runtime/core.mjs';

const ROOT = '/proj';
const cfg = () => ({ ...DEFAULT_CONFIG, staleRe: new RegExp(DEFAULT_CONFIG.STALE_RE, 'i') });
const ctx = (over = {}) => ({ root: ROOT, cfg: cfg(), allow: new Set(), ...over });

test('core facade: 公开 API 与拆分前完全一致', () => {
  assert.deepEqual(Object.keys(coreFacade).sort(), [
    'DEFAULT_CONFIG', 'checkCommitMsg', 'checkStagedNames', 'classifyWritePath', 'countChars',
    'gitStatusEntries', 'inProject', 'ledgerCoverageCheck', 'ledgerSyncCheck', 'loadAllowlist',
    'loadConfig', 'managedPathChanges', 'normalizePath', 'parseApplyPatch', 'parseJsonc',
    'parseLegacyConfig', 'relToRoot', 'scanBashCommand', 'scratchLeftovers', 'semanticReviewFacts',
    'stopFlagPath', 'systemTmpPrefixes', 'toPosix', 'validateConfig', 'visibleShellLines',
  ]);
});

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

test('visibleShellLines: 搜索参数中的 heredoc 字面量不吞后续真实命令', () => {
  const cmd = "rg '<<EOF' .\ntouch /tmp/real_target";
  const visible = visibleShellLines(cmd);
  assert.ok(visible.includes('touch /tmp/real_target'));
  assert.equal(scanBashCommand(cmd, ctx()).kind, 'system-tmp');
});

test('scanBashCommand: 未引号 shell 注释不产生误报,引号内 # 不截断命令', () => {
  assert.equal(scanBashCommand('touch okay # mention touch /tmp/not-real', ctx()).decision, 'allow');
  assert.equal(scanBashCommand("rg '# touch /tmp/not-real' payload", ctx()).decision, 'allow');
  assert.equal(scanBashCommand("echo '# literal' > /tmp/real", ctx()).kind, 'system-tmp');
  assert.equal(scanBashCommand('touch foo#bar', ctx()).decision, 'allow');
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

test('scanBashCommand: 裸文件名、无扩展系统 tmp、环境变量与多行写入均被识别', () => {
  const c = ctx({
    opts: {
      homedir: '/home/u',
      tmpdir: '/run/user/1000/temp',
      env: { TMPDIR: '/run/user/1000/temp', TEMP: 'C:\\Users\\u\\Temp' },
    },
  });
  assert.equal(scanBashCommand('touch train_v2.py', c).kind, 'stale-name');
  assert.equal(scanBashCommand('echo x > train_old.py', c).kind, 'stale-name');
  assert.equal(scanBashCommand('touch /tmp/no_extension', c).kind, 'system-tmp');
  assert.equal(scanBashCommand('touch "$TMPDIR/probe"', c).kind, 'system-tmp');
  assert.equal(scanBashCommand('echo read-only\ntouch /tmp/from_second_line', c).kind, 'system-tmp');
  assert.equal(scanBashCommand('Set-Content "$env:TEMP\\probe" x', c, { powershell: true }).kind, 'system-tmp');
  assert.equal(scanBashCommand('cp source /tmp', c).kind, 'system-tmp', '系统 tmp 目录本身也属于禁止目标');
  assert.equal(scanBashCommand('cp source "$TMPDIR"', c).kind, 'system-tmp');
});

test('scanBashCommand: 未设置标准临时变量时保守拦截可展开引用,单引号字面量不误报', () => {
  const c = ctx({ opts: { env: {}, homedir: '/home/u', tmpdir: '/system/temp' } });
  assert.equal(scanBashCommand('touch "$TMPDIR/probe"', c).kind, 'system-tmp');
  assert.equal(scanBashCommand('touch "${TEMP}/probe"', c).kind, 'system-tmp');
  assert.equal(scanBashCommand('Set-Content "$env:TMP/probe" x', c, { powershell: true }).kind, 'system-tmp');
  assert.equal(scanBashCommand("touch '$TMPDIR/probe'", c).decision, 'allow');
});

test('scanBashCommand: sudo/wrapper、dd of= 与 shell -c 的真实写目标被识别', () => {
  assert.equal(scanBashCommand('sudo -- touch /tmp/sudo_target', ctx()).kind, 'system-tmp');
  assert.equal(scanBashCommand('sudo cp a.py src/a_old.py', ctx()).kind, 'stale-name');
  assert.equal(scanBashCommand('env FOO=1 command touch train_old.py', ctx()).kind, 'stale-name');
  assert.equal(scanBashCommand('dd if=/dev/zero of=/tmp/blob', ctx()).kind, 'system-tmp');
  assert.equal(scanBashCommand("bash -c 'touch /tmp/nested'", ctx()).kind, 'system-tmp');
  assert.equal(scanBashCommand("bash -lc 'touch /tmp/login-shell'", ctx()).kind, 'system-tmp');
  assert.equal(scanBashCommand('env -u TMPDIR touch /tmp/env-wrapper', ctx()).kind, 'system-tmp');
  assert.equal(scanBashCommand('timeout --signal KILL 5 touch /tmp/timeout-wrapper', ctx()).kind, 'system-tmp');
  assert.equal(scanBashCommand('timeout -s TERM 5 touch train_old.py', ctx()).kind, 'stale-name');
});

test('scanBashCommand: ln/link 的最后操作数按创建目标检查', () => {
  assert.equal(scanBashCommand('ln -s source train_old.py', ctx()).kind, 'stale-name');
  assert.equal(scanBashCommand('link source /tmp/hardlink', ctx()).kind, 'system-tmp');
  assert.equal(scanBashCommand('ln -s /tmp/source ./safe-link', ctx()).decision, 'allow', '源路径不是写目标');
});

test('scanBashCommand: mktemp 只允许精确落在 scratch 内,只读 rg 的引号字面量不误报', () => {
  assert.equal(scanBashCommand('mktemp -p .tmp', ctx()).decision, 'allow');
  assert.equal(scanBashCommand('mktemp -p .tmp/sub', ctx()).decision, 'allow');
  assert.equal(scanBashCommand('mktemp -p=.tmp', ctx()).decision, 'allow');
  assert.equal(scanBashCommand('mktemp -p .tmp-evil', ctx()).kind, 'mktemp');
  assert.equal(scanBashCommand("rg -n 'mktemp|touch /tmp/x|train_old.py' payload", ctx()).decision, 'allow');
  assert.equal(scanBashCommand('rg -n "/tmp|tmpdir|mktemp|SCRATCH_DIR" payload', ctx()).decision, 'allow');
});

// ---------- 台账同步 ----------
test('ledgerSyncCheck: 改代码未动台账 → needSync;动了 LEDGER → 放行', () => {
  const c = cfg();
  assert.equal(ledgerSyncCheck([[' M', 'src/a.py']], c).needSync, true);
  assert.equal(ledgerSyncCheck([[' M', 'src/a.py'], ['M ', 'LEDGER.md']], c).needSync, false);
  assert.equal(ledgerSyncCheck([['??', 'src/a.py'], ['??', 'LEDGER.md']], c).needSync, false,
    '首次安装的未跟踪台账可进入后续逐文件 coverage 校验');
});

test('ledgerSyncCheck: 忽略草稿区/工具目录/指针文件/非受管扩展名;rename 取新路径', () => {
  const c = cfg();
  const ignored = [[' M', '.tmp/x.py'], [' M', '.tidykeep/config.jsonc'], [' M', '.claude/settings.json'], [' M', '.codex/hooks.json'], [' M', '.agents/skills/t/SKILL.md'], [' M', 'CLAUDE.md'], [' M', 'logo.png']];
  assert.equal(ledgerSyncCheck(ignored, c).needSync, false);
  assert.equal(ledgerSyncCheck([[' M', 'AGENTS.md']], c).needSync, true, '规则真源 AGENTS.md 也是受管文档');
  assert.equal(ledgerSyncCheck([[' M', 'docs/CLAUDE.md']], c).needSync, true,
    '只有项目根薄指针排除,同名普通文档仍受管');
  assert.equal(ledgerSyncCheck([['R ', 'old.py -> new_thing.py']], c).needSync, true);
  assert.deepEqual(
    managedPathChanges([['R ', 'new_thing.py'], ['D ', 'old.py']], c),
    [{ path: 'new_thing.py', deleted: false }, { path: 'old.py', deleted: true }],
  );
});

test('ledgerSyncCheck: 只认根 LEDGER.md 的非删除改动,STATE 与嵌套同名不能顶替', () => {
  const c = cfg();
  for (const ledgerEntry of [
    [' M', 'STATE.md'],
    [' M', 'docs/LEDGER.md'],
    [' D', 'LEDGER.md'],
  ]) {
    const r = ledgerSyncCheck([[' M', 'src/a.py'], ledgerEntry], c);
    assert.equal(r.needSync, true, `${ledgerEntry.join(' ')} 不得算根台账同步`);
    assert.equal(r.ledgerChanged, false);
  }
  assert.equal(ledgerSyncCheck([[' M', 'src/a.py'], [' M', 'LEDGER.md']], c).needSync, false);
});

test('managedPathChanges: 扩展名与 WATCH_FILES 精确路径均受管,并保留删除状态', () => {
  const c = { ...cfg(), WATCH_FILES: [...cfg().WATCH_FILES, '.tidykeep/config.jsonc'] };
  const changes = managedPathChanges([
    [' M', 'src/a.py'],
    [' M', 'package.json'],
    [' M', 'sub/package.json'],
    [' D', 'Dockerfile'],
    [' M', '.tidykeep/config.jsonc'],
    [' M', '.github/workflows/ci.yml'],
    [' M', 'tsconfig.json'],
    [' M', 'image.png'],
  ], c);
  assert.deepEqual(changes, [
    { path: 'src/a.py', deleted: false },
    { path: 'package.json', deleted: false },
    { path: 'sub/package.json', deleted: false },
    { path: 'Dockerfile', deleted: true },
    { path: '.tidykeep/config.jsonc', deleted: false },
    { path: '.github/workflows/ci.yml', deleted: false },
    { path: 'tsconfig.json', deleted: false },
  ]);
});

test('managedPathChanges: rename 同时覆盖旧路径删除与新路径新增,copy 只覆盖新路径', () => {
  const changes = managedPathChanges([
    ['R ', 'src/new.py'],
    ['D ', 'src/old.py'],
    ['C ', 'src/copied.py'],
  ], cfg());
  assert.deepEqual(changes, [
    { path: 'src/new.py', deleted: false },
    { path: 'src/old.py', deleted: true },
    { path: 'src/copied.py', deleted: false },
  ]);
});

test('semanticReviewFacts: 只汇总受管 Git 事实并给出有界分类,不替 Agent 下语义结论', () => {
  const c = { ...cfg(), WATCH_FILES: [...cfg().WATCH_FILES, 'api.schema'] };
  const facts = semanticReviewFacts([
    [' M', 'src/a.py'],
    ['??', 'README.md'],
    ['D ', 'old.py'],
    ['R ', 'src/renamed.py'],
    [' M', 'api.schema'],
    [' M', '.tmp/ignored.py'],
  ], c, 3);
  assert.equal(facts.total, 5);
  assert.equal(facts.omitted, 2);
  assert.deepEqual(facts.changes, [
    { path: 'src/a.py', action: 'modified', kind: 'code' },
    { path: 'README.md', action: 'added', kind: 'doc' },
    { path: 'old.py', action: 'deleted', kind: 'code' },
  ]);
  assert.deepEqual(facts.counts, {
    deleted: 1, renamed: 1, code: 3, doc: 1, watched: 1,
  });
  assert.equal(facts.stateChanged, false);
});

test('gitStatusEntries: index/worktree rename 均消费源路径并记为删除', () => {
  assert.deepEqual(parseGitStatusOutput('R  new.py\0old.py\0'), [
    ['R ', 'new.py'], ['D ', 'old.py'],
  ]);
  assert.deepEqual(parseGitStatusOutput(' R worktree-new.py\0worktree-old.py\0'), [
    [' R', 'worktree-new.py'], ['D ', 'worktree-old.py'],
  ]);
  assert.deepEqual(parseGitStatusOutput(' C copied.py\0source.py\0'), [
    [' C', 'copied.py'],
  ]);
});

test('ledgerCoverageCheck: 修改/新增逐 section 比较 HEAD 且要求今日核对,删除要求移除 section', () => {
  const head = `# 文件台账\n\n## src/a.py\n\n- 最后核对: 2026-08-11\n- TODO:\n\n## old.py\n\n- 最后核对: 2026-08-11\n`;
  const current = `# 文件台账\n\n## src/a.py\n\n- 最后核对: 2026-08-12\n- TODO:\n- DONE:\n  - [x] 2026-08-12 修复实现\n\n## package.json\n\n- 最后核对: 2026-08-12\n`;
  const result = ledgerCoverageCheck([
    { path: 'src/a.py', deleted: false },
    { path: 'package.json', deleted: false },
    { path: 'old.py', deleted: true },
  ], head, current, '2026-08-12');
  assert.equal(result.ok, true);
  assert.deepEqual(result.covered, ['src/a.py', 'package.json', 'old.py']);
  assert.deepEqual(result.missing, []);
});

test('ledgerCoverageCheck: 未变 section、过期核对与仍残留的删除 section 均报告 missing', () => {
  const head = `## same.py\n- 最后核对: 2026-08-12\n\n## stale.py\n- 最后核对: 2026-08-11\n\n## gone.py\n- 最后核对: 2026-08-11\n`;
  const current = head.replace('## stale.py\n- 最后核对: 2026-08-11', '## stale.py\n- 最后核对: 2026-08-11\n- DONE:\n  - [x] changed');
  const result = ledgerCoverageCheck([
    { path: 'same.py', deleted: false },
    { path: 'stale.py', deleted: false },
    { path: 'gone.py', deleted: true },
    { path: 'missing.py', deleted: false },
  ], head, current, '2026-08-12');
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.map((item) => item.path), ['same.py', 'stale.py', 'gone.py', 'missing.py']);
});

// ---------- 草稿区残留 ----------
test('scratchLeftovers: 列出残留,跳过哨兵文件', () => {
  const dir = makeTempDir('tk-scratch-');
  mkdirSync(join(dir, '.tmp', 'sub'), { recursive: true });
  writeFileSync(join(dir, '.tmp', '.gitkeep'), '');
  writeFileSync(join(dir, '.tmp', 'probe.sh'), 'x');
  writeFileSync(join(dir, '.tmp', 'sub', 'deep.py'), 'x');
  const found = scratchLeftovers(dir, cfg());
  assert.deepEqual(found.sort(), ['.tmp/probe.sh', '.tmp/sub/deep.py']);
  const empty = makeTempDir('tk-scratch2-');
  assert.deepEqual(scratchLeftovers(empty, cfg()), []);
});

test('scratchLeftovers: 不跟随 symlink,嵌套哨兵算残留,limit 精确不多报', () => {
  const dir = makeTempDir('tk-scratch-safe-');
  mkdirSync(join(dir, '.tmp', 'sub'), { recursive: true });
  mkdirSync(join(dir, 'outside'), { recursive: true });
  writeFileSync(join(dir, 'outside', 'deep.py'), 'x');
  symlinkSync(
    join(dir, 'outside'),
    join(dir, '.tmp', 'linked-dir'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  writeFileSync(join(dir, '.tmp', 'sub', 'README.md'), '嵌套 README 不是根哨兵');
  writeFileSync(join(dir, '.tmp', 'a.txt'), 'a');
  writeFileSync(join(dir, '.tmp', 'b.txt'), 'b');
  const found = scratchLeftovers(dir, cfg(), 2);
  assert.equal(found.length, 2);
  const all = scratchLeftovers(dir, cfg(), 20);
  assert.ok(all.includes('.tmp/linked-dir'), 'symlink 本身应报告');
  assert.ok(!all.some((p) => p.includes('deep.py')), '不得跟随 symlink 到外部目录');
  assert.ok(all.includes('.tmp/sub/README.md'), '仅 scratch 根的 README 才是哨兵');
});

// ---------- git 层检查 ----------
test('checkStagedNames: 只拦项目区内 stale 命名,草稿区/.tidykeep/allowlist 放行', () => {
  const bad = checkStagedNames(
    ['src/train_v2.py', '.tmp/x_old.py', '.tidykeep/y_old.py', 'ok.py', 'docs/data_v2.json'],
    cfg(), new Set(['docs/data_v2.json']),
  );
  assert.deepEqual(bad, ['src/train_v2.py']);
  assert.deepEqual(
    checkStagedNames(['DOCS/DATA_V2.JSON', '.TMP/X_OLD.PY'], cfg(), new Set(['docs/data_v2.json']), { platform: 'win32' }),
    [],
    'Windows 上 staged allowlist 与 scratch 比较不区分大小写',
  );
});

// ---------- commit-msg ----------
test('checkCommitMsg: 校验 type/必填标签/长度,按码点计数并保留豁免词', () => {
  const c = cfg();
  const good = 'feat: 增加断点续训支持\n\n为什么: 长任务中断后无法恢复\n影响: train.py 与 LEDGER.md';
  assert.equal(checkCommitMsg(good, c).ok, true);
  assert.equal(checkCommitMsg('fix: 小改\n\n短', c).ok, false);
  assert.equal(checkCommitMsg('Merge branch main', c).exempt, true);
  assert.equal(checkCommitMsg('fixup! whatever', c).exempt, true);
  const withComments = 'feat: 增加断点续训支持\n# 注释行\n\n为什么: 中断恢复\n影响: train.py 台账已更新';
  assert.equal(checkCommitMsg(withComments, c).ok, true);
  assert.equal(checkCommitMsg('banana: 主题长度完全足够\n\n为什么: 有原因而且够长\n影响: 有影响而且也够长', c).ok, false);
  assert.equal(checkCommitMsg('fix: 修复一个足够长的问题\n\n正文长度足够但没有两个必填标签', c).ok, false);
  assert.equal(checkCommitMsg('fix: 修复一个足够长的问题\n\n为什么: \n影响: 确实有影响内容', c).ok, false);
  const oneCharLabels = { ...c, MIN_BODY: 0 };
  assert.equal(checkCommitMsg('fix: 修复一个足够长的问题\n\n为什么: x\n影响: y', oneCharLabels).ok, true);
  assert.equal(countChars('修复了一个很重要的问题'), 11);
});

test('checkCommitMsg: 支持自定义 Git commentChar 与对应 scissors', () => {
  const c = cfg();
  const good = '; 模板注释\nfeat: 支持自定义注释字符\n\n为什么: Git 可以配置非井号注释\n影响: commit-msg 解析逻辑与测试\n; 尾部注释';
  assert.equal(checkCommitMsg(good, c, { commentChar: ';' }).ok, true);
  const cut = 'fix: 主题偏短\n\n; ------------------------ >8 ------------------------\n为什么: scissors 后不应计入\n影响: 也不应计入';
  assert.equal(checkCommitMsg(cut, c, { commentChar: ';' }).ok, false);
});

test('checkCommitMsg: commentChar=auto 从 scissors 或 Git 模板推断实际字符', () => {
  const c = cfg();
  const cut = 'fix: 修复一个足够长的问题主题\n\n; ------------------------ >8 ------------------------\n为什么: scissors 后不应计入\n影响: 也不应计入';
  assert.equal(checkCommitMsg(cut, c, { commentChar: 'auto' }).ok, false);

  const template = [
    'fix: 修复一个足够长的问题主题',
    '',
    '为什么: x',
    '影响: y',
    '; Please enter the commit message for your changes.',
    '; 这段很长的模板注释绝对不能用于满足正文长度要求',
    ';',
  ].join('\n');
  assert.equal(checkCommitMsg(template, c, { commentChar: 'auto' }).ok, false);
  assert.equal(checkCommitMsg('feat: 增加足够长的正常主题\n\n为什么: 正常正文原因足够长\n影响: 正常正文影响足够长', c, { commentChar: 'auto' }).ok, true,
    '没有推断证据时回退 #');
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

test('parseJsonc: 未闭合块注释与字符串必须 fail-closed', () => {
  assert.throws(() => parseJsonc('{"ok": true} /* 未闭合'), /未闭合 JSONC 块注释/);
  assert.throws(() => parseJsonc('{"value": "未闭合}'), /未闭合 JSON 字符串/);
});

test('validateConfig: 非法强制级别与危险 scratch 安全回退,列表和精确路径归一', () => {
  const { config, errors } = validateConfig({
    ENFORCE_LEDGER: 'banana',
    SCRATCH_DIR: '../outside',
    AUTO_COMMIT: 'surprise',
    GUARD: 'yes',
    CODE_EXTS: ['.PY', 'js', '../bad'],
    WATCH_FILES: ['./package.json', 'Makefile', '../secret', '/absolute'],
    STALE_RE: '[',
  });
  assert.equal(config.ENFORCE_LEDGER, 'block');
  assert.equal(config.SCRATCH_DIR, '.tmp');
  assert.equal(config.AUTO_COMMIT, 'off');
  assert.equal(config.GUARD, true);
  assert.deepEqual(config.CODE_EXTS, ['py', 'js']);
  assert.deepEqual(config.WATCH_FILES, ['package.json', 'Makefile']);
  assert.equal(config.STALE_RE, DEFAULT_CONFIG.STALE_RE);
  assert.ok(errors.length >= 5);
});

test('validateConfig: 默认 WATCH_FILES 覆盖生成块、常见无扩展与项目根配置', () => {
  const { config, errors } = validateConfig(DEFAULT_CONFIG);
  assert.deepEqual(errors, []);
  assert.deepEqual(config.WATCH_FILES, [
    'package.json', '.gitignore', '.gitattributes',
    'pyproject.toml', 'Cargo.toml', 'go.mod', 'Makefile', 'Dockerfile',
  ]);
  assert.equal(config.SCRATCH_DIR, '.tmp');
});

test('validateConfig: 旧 AUTO_COMMIT=auto 安全归一为 remind', () => {
  const { config, errors } = validateConfig({ AUTO_COMMIT: 'auto' });
  assert.deepEqual(errors, []);
  assert.equal(config.AUTO_COMMIT, 'remind');
});

test('validateConfig: 未知键报告错误但运行时仍忽略并安全归一', () => {
  const { config, errors } = validateConfig({ GUARD: false, TYPO_GUARD: false });
  assert.equal(config.GUARD, false);
  assert.equal(Object.hasOwn(config, 'TYPO_GUARD'), false);
  assert.ok(errors.some(({ key, reason }) => key === 'TYPO_GUARD' && reason === '未知键'));
});

test('loadConfig: 缺文件用默认;config.jsonc 覆盖;旧 KEY=VALUE 兼容读取', () => {
  const d1 = makeTempDir('tk-cfg-');
  assert.equal(loadConfig(d1).ENFORCE_LEDGER, 'block');
  mkdirSync(join(d1, '.tidykeep'), { recursive: true });
  writeFileSync(join(d1, '.tidykeep', 'config.jsonc'), '{ "ENFORCE_LEDGER": "warn" // 注释\n}');
  assert.equal(loadConfig(d1).ENFORCE_LEDGER, 'warn');
  const d2 = makeTempDir('tk-cfg2-');
  mkdirSync(join(d2, '.tidykeep'), { recursive: true });
  writeFileSync(join(d2, '.tidykeep', 'config'), 'GUARD="off"\nENFORCE_LEDGER="warn"\nSCRATCH_DIR=".scratch"\nMIN_SUBJECT="15"\n');
  const legacy = loadConfig(d2);
  assert.equal(legacy.GUARD, false);
  assert.equal(legacy.ENFORCE_LEDGER, 'warn');
  assert.equal(legacy.SCRATCH_DIR, '.scratch');
  assert.equal(legacy.MIN_SUBJECT, 15);
});

test('loadConfig: 损坏 schema 不得把 block 静默降级,危险路径回退默认', () => {
  const dir = makeTempDir('tk-invalid-cfg-');
  mkdirSync(join(dir, '.tidykeep'), { recursive: true });
  writeFileSync(join(dir, '.tidykeep', 'config.jsonc'), '{ "ENFORCE_LEDGER": "banana", "SCRATCH_DIR": "../../outside" }');
  const loaded = loadConfig(dir);
  assert.equal(loaded.ENFORCE_LEDGER, 'block');
  assert.equal(loaded.SCRATCH_DIR, '.tmp');
  assert.ok(loaded.configErrors.length >= 2);
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
  const d = makeTempDir('tk-allow-');
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

test('stopFlagPath: 无 session 时按会话线索/父进程隔离,不再全项目按日期共享', () => {
  const a = stopFlagPath('/proj', null, { env: {}, ppid: 101 });
  const a2 = stopFlagPath('/proj', null, { env: {}, ppid: 101 });
  const b = stopFlagPath('/proj', null, { env: {}, ppid: 202 });
  assert.equal(a, a2);
  assert.notEqual(a, b);
  assert.ok(!/\d{4}-\d{2}-\d{2}-nosession/.test(a));
  const thread = stopFlagPath('/proj', null, { env: { CODEX_THREAD_ID: 'thread-1' }, ppid: 101 });
  assert.notEqual(thread, a);
});
