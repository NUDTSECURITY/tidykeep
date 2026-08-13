// tidykeep 拦截文案单一来源(vendored;由 `npx tidykeep init` 刷新,请勿手改)。
// 三家 agent 复用同一措辞;每条都给出行动指令:改原文件 / 放草稿区 / 误报加 allowlist。

export const STOP_TAIL = '完成后正常结束即可(本会话此检查只强制一次)。'
  + '若确有理由维持现状(如纯格式化、脚本需跨任务保留),请向用户简要说明。';

export function denyReason(source, v) {
  const { kind, detail = {}, hits = [] } = v;
  const scratch = detail.scratch ?? '.tmp';
  if (source === 'write') {
    if (kind === 'system-tmp') {
      return `tidykeep 拦截:禁止在系统临时目录创建文件(${detail.path})。`
        + `临时/验证脚本请放在项目内的草稿区并在那里执行:${scratch}/${detail.base} 。`
        + `该目录已 gitignore、随收尾检查统一清理,不会像 /tmp 一样留下无人管理的残留。用完请立即删除。`;
    }
    return `tidykeep 拦截:文件名 '${detail.base}' 命中历史副本命名模式(_v2/_old/_final/_backup/copy/副本…)。`
      + `请遵守 AGENTS.md 的 tidykeep 协议:直接修改原文件;参数差异用 CLI 参数或配置文件解决,`
      + `不要复制脚本;确属一次性实验请放入 ${scratch}/ 目录;若该命名确实合理,`
      + `请人工把路径 '${detail.rel}' 加入 .tidykeep/allowlist 后重试。`;
  }
  // source === 'bash'
  if (kind === 'mktemp') {
    return `tidykeep 拦截:mktemp 默认在系统 /tmp 创建文件。`
      + `请改用项目草稿区:mktemp -p ${scratch}(目录已存在且已 gitignore),`
      + `或直接在 ${scratch}/ 下创建具名脚本,用完即删。`;
  }
  if (kind === 'system-tmp') {
    return `tidykeep 拦截:该命令疑似在系统临时目录创建文件:${hits.join('、')}。`
      + `临时/验证脚本请放在项目内草稿区 ${scratch}/ 下创建与执行(已 gitignore,收尾时统一检查清理),用完即删。`;
  }
  return `tidykeep 拦截:该命令疑似在创建历史副本文件:${hits.join('、')}。`
    + `请直接修改原文件(历史由 git 保管);一次性实验放 ${scratch}/;`
    + `误报可将路径加入 .tidykeep/allowlist 后重试。`;
}

export function msgCommitRemind() {
  return 'tidykeep 提醒:任务已按协议收尾(台账已同步),但改动尚未提交——'
    + '请按 AGENTS.md 的 Commit 规范提交(主题 + 为什么 + 影响)。本会话此提醒只出现一次。';
}

export function msgLedgerSync() {
  return '受管文件已改动,但 LEDGER.md 缺少可验证的逐文件收尾证据——请把本次完成项移入'
    + '对应 section 的 DONE(附今天日期)、登记新 TODO、刷新『最后核对』;删除文件须移除对应 section。';
}

function displayFactPath(value, limit = 240) {
  const chars = [...String(value ?? '')];
  const clipped = chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : chars.join('');
  // Git 路径属于仓库输入；JSON 引号可见地转义换行/控制字符，避免路径伪装成 Hook 指令。
  return JSON.stringify(clipped);
}

export function msgSemanticReview(facts) {
  const action = {
    added: '新增', modified: '修改', deleted: '删除', renamed: '重命名', copied: '复制',
  };
  const kind = { code: '代码', doc: '文档', watched: '关键文件' };
  const shown = (facts.changes ?? [])
    .map((item) => `${action[item.action] ?? item.action}/${kind[item.kind] ?? item.kind}:${displayFactPath(item.path)}`)
    .join('、');
  const omitted = facts.omitted ? `、另有 ${facts.omitted} 项未展开` : '';
  const hints = [];
  if ((facts.counts?.deleted ?? 0) > 0 || (facts.counts?.renamed ?? 0) > 0) {
    hints.push('存在删除/重命名:核对替代关系、LEDGER 旧 section 与 STATE 墓地');
  }
  if ((facts.counts?.code ?? 0) > 0 && (facts.counts?.doc ?? 0) === 0) {
    hints.push('代码变化但无普通文档变化:必须核对 README/docs 是否漂移,不等于强制改文档');
  }
  if ((facts.counts?.watched ?? 0) > 0) {
    hints.push('关键文件变化:核对接口、配置、构建或交付约定是否改变');
  }
  if (!facts.stateChanged) hints.push('STATE.md 未变化:请判断这是正确结论还是遗漏');

  return `检测到 ${facts.total} 个受管变化。必须调用 tidykeep Skill($tidykeep),执行工作流 2「收尾同步」并基于实际 diff 做语义判断,不要只机械修改台账。`
    + `变更事实:${shown || '(无可展示路径)'}${omitted}。`
    + `请逐项判断并处理:LEDGER TODO/DONE/最后核对、STATE 当前设计/决策/墓地、README/docs 漂移、被取代或零引用实现。`
    + `${hints.length ? `核对信号:${hints.join(';')}。` : ''}`
    + 'Hook 只提供事实,不替你下语义结论;不得因候选信号自动删除文件,需要清理时先给证据并遵守用户确认边界。';
}

export function msgScratchLeftover(scratch, files, limit = 8) {
  const shown = files.slice(0, limit).join('、') + (files.length > limit ? '…' : '');
  return `草稿区 ${scratch}/ 仍有 ${files.length} 个残留文件(${shown})`
    + '——已完成使命的临时/验证脚本请删除;确需保留请说明原因。';
}

export function msgPreCommitStale(files, scratch) {
  return '\n[tidykeep] 提交被拒绝:以下文件命中历史副本命名模式:\n'
    + files.map((f) => `  ${f}`).join('\n') + '\n'
    + '按协议处理:直接修改原文件(历史由 git 保管);参数差异用 CLI/配置解决;\n'
    + `一次性实验放 ${scratch}/;误报请把精确路径加入 .tidykeep/allowlist。\n`
    + '确需强行提交:TIDYKEEP_SKIP=1 git commit ...\n';
}

export function msgPreCommitLedger(block) {
  return block
    ? '\n[tidykeep] 提交被拒绝:本次提交改动了受管文件,但 LEDGER.md 缺少逐文件收尾证据。\n'
      + '请先执行 tidykeep 收尾同步:对应 section 的完成项移入 DONE(附日期)、登记新 TODO并刷新最后核对;\n'
      + 'STATE 与文档是否更新由 Agent 根据语义判断,Git hook 不伪装成语义分析器。\n'
      + '纯琐碎改动可 TIDYKEEP_SKIP=1 git commit ... 跳过(须说明原因)。\n'
    : '[tidykeep] 提醒:LEDGER.md 缺少本次受管变化的逐文件收尾证据,请执行 tidykeep 收尾同步。';
}

export function msgCommitMsgRejected(r, cfg) {
  return `
[tidykeep] 提交信息不符合规范(主题 ${r.subjectLen}/${cfg.MIN_SUBJECT} 字符,正文 ${r.bodyLen}/${cfg.MIN_BODY} 字符)。
请按模板补全后重试:

  <type>: <一句话说清做了什么>

  为什么: <动机 / 修复的问题 / 对应的 TODO>
  影响: <涉及的模块与文件;LEDGER/STATE 相应更新点>

type ∈ feat / fix / refactor / docs / chore / test / perf。
确属琐碎改动可 TIDYKEEP_SKIP=1 git commit ...(须说明原因)。
`;
}
