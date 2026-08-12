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
  return '源码/文档已改动,但 LEDGER.md / STATE.md 未同步——请把本次完成项移入'
    + ' LEDGER.md 的 DONE(附今天日期)、登记新 TODO、刷新『最后核对』;'
    + '设计有变化则更新 STATE.md 并把被取代的决策标记 superseded,删除的文件登记进墓地。';
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
    ? '\n[tidykeep] 提交被拒绝:本次提交改动了代码/文档,但 LEDGER.md / STATE.md 未同步。\n'
      + '请先完成收尾:LEDGER.md 完成项移入 DONE(附日期)、登记新 TODO;\n'
      + '设计有变则更新 STATE.md 并把旧决策标 superseded。\n'
      + '纯琐碎改动可 TIDYKEEP_SKIP=1 git commit ... 跳过(须说明原因)。\n'
    : '[tidykeep] 提醒:LEDGER.md / STATE.md 未随本次改动更新,请确认是否遗漏。';
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
