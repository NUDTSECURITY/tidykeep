# 项目状态(当前设计的唯一真相)

> 由 tidykeep 协议维护。任何 Agent 开工前必读本文件。
> 本文件只描述"**现在**"——历史在 git 与下方决策记录里,废弃方案在墓地里。

## 当前架构与设计

本仓库是 **tidykeep** 本身:面向 Claude Code、Codex、Kimi Code 的项目知识保鲜工具。
交付形态是 npm 包,当前 registry 尚未发布,可直接运行源码 CLI;要求 Node ≥ 20.11,运行时零第三方依赖。

- `bin/tidykeep.mjs` 分发 `init / uninstall / status / doctor / enable-githooks`;`src/commands/` 实现命令,
  `src/lib/` 负责路径边界、严格标记/设置合并、稳定 manifest v3、安装事务、目录锁、Git/Kimi 接线与原子写入。
- 独立非 Git 目录可安装;位于 Git 时目标必须是主 worktree 根。入口先 canonicalize,项目内受写路径不得含
  symlink。`init/uninstall` 用目录锁串行化;活锁与崩溃锁均 fail-closed,确认 owner 进程退出后才人工删精确锁目录。
- `init` 遇到中断事务时先严格验证布局,再丢弃不可信 staging/journal,依据目标现场生成全新计划;完整 preflight
  与 staging 完成后才逐文件原子替换。重复执行即升级;`--agents` 只增不减,已有接入一并刷新。
- manifest v3 只持久化 5 个稳定顶层字段和确定性 managed 机器资产 SHA-256;不记录时间、用户文件/hash、
  用户路径、Git/Kimi 现场或卸载问题。现场状态实时推导,清单也不是所有权唯一凭据;未知或漂移状态一律停止。
- `payload/` 是目标项目模板及 vendored runtime。`core.mjs` 是稳定 facade,配置、路径、写策略、逐文件台账、
  Git 消息策略分别在独立模块;`hook.mjs` 适配三家 native hooks,`githook.mjs` 是提交硬边界。
- native Stop hook 对每次受管变化汇总有界 Git 事实并显式触发 tidykeep Skill:Hook 决定何时审查,
  Agent 基于实际 diff 判断 STATE、文档与清理候选;候选不会被自动删除。Git `pre-commit` / `commit-msg`
  只验收可机械证明的结果且失败默认拒绝。台账要求每个受管变化都有当天且相对 HEAD 已变化的
  `LEDGER.md` section;旧 `AUTO_COMMIT=auto` 只归一为 `remind`,hook 不提交代码。
- 项目事务提交后才执行用户级 Kimi 与 Git config 接线;这一步失败会保留已安装项目层并返回非零,修复后重跑补接。
  Kimi 由精确 TOML 块、shim hash、canonical-path 注册和用户锁维护;共享块只在最后一个活项目卸载时移除。
- 外部 `core.hooksPath` 必须真实执行并传播两类 hook 失败;卸载无法证明外部接线已断开时保留 runtime/githooks
  并返回非零。安装/卸载不创建永久 settings/config 备份,既有 backup、项目配置与 allowlist 始终保留。
- `uninstall` 外科剥离并保留知识与草稿;`--purge` 只删除内容精确等于当前内置模板的 STATE/LEDGER,否则保留并非零。
- 规则单一入口是 `AGENTS.md`;深度工作流单一真源是 `.tidykeep/docs/workflows.md`;技能文件均为薄指针。
- 测试覆盖单元、CLI/子进程、真实 Git、中断后丢弃并重规划、离线 npm pack 与 Linux/macOS/Windows CI。
- 本仓库已自装 tidykeep(狗粮),提交受自身 Git hooks 约束。

## 设计决策记录(ADR-lite)

| 编号 | 日期 | 决策 | 状态 |
|---|---|---|---|
| D-001 | 2026-08-12 | 发布形态:npm 包 + npx,全 Node 重写,零第三方运行时依赖(取代 bash+python3 初稿) | active |
| D-002 | 2026-08-12 | 覆盖 Claude Code + Codex + Kimi Code 三家 native hooks;不做 Gemini;git hooks 永远保留为兜底硬边界 | active |
| D-003 | 2026-08-12 | hook 运行时 vendor 进目标项目 `.tidykeep/runtime/`(可入库、离线、版本随项目),npm 包只做安装/升级 | active |
| D-004 | 2026-08-12 | Kimi hooks 写用户全局 `~/.kimi-code/config.toml` 标记块(官方 local.toml 不支持 hooks),shim 按项目路由,projects.d/ 原子引用计数卸载 | active |
| D-005 | 2026-08-12 | 配置用 JSONC,程序回写走行级替换保注释;STALE_RE 统一 JS RegExp 单一方言 | superseded → D-020 |
| D-006 | 2026-08-12 | 标记块操作严格配对:孤立/逆序标记一律拒绝改写(宁可要求手工修复,不静默吞用户内容) | active |
| D-007 | 2026-08-12 | 所有涉及三家 agent 能力的结论必须现场核实官方文档(研究员+逐字引用审计双层),不信二手信息 | active |
| D-008 | 2026-08-12 | AUTO_COMMIT 三档(off/remind/auto),默认 off;完成态由确定性信号判断 | superseded → D-010 |
| D-009 | 2026-08-12 | 对外动作边界写入协议:agent 到 commit 为止,push/publish/tag 由人决定;发布/交付前强制先跑体检审计;硬拦截 pre-push hook 暂不做(git 分不清人与 agent,摩擦大),协议层不够时再加 | active |
| D-010 | 2026-08-12 | hook 永不暂存或提交工作区;AUTO_COMMIT 仅支持 off/remind,旧 auto 安全归一为 remind | active |
| D-011 | 2026-08-12 | 安装采用 manifest v3 + 完整 preflight + 项目内 staging/journal + 项目/用户目录锁;所有权须由精确路径和已知内容共同证明,不能信任清单自报 | active |
| D-012 | 2026-08-12 | 台账从“改过 LEDGER 即可”收紧为逐文件 section 证明;Git hooks 内部或 Git 查询失败时 fail-closed,TIDYKEEP_SKIP 是显式逃生门 | active |
| D-013 | 2026-08-12 | 重复 init 是增量升级:agents 取历史与本次并集并全部刷新;native hook 所有权按 event+matcher+完整 handler 描述符认定 | active |
| D-014 | 2026-08-12 | 外部 core.hooksPath 不自动改写;两类 hook 未精确链入时安装非零,仍为 external 时卸载保留 runtime/githooks,由用户先解除接线 | active |
| D-015 | 2026-08-12 | init/uninstall/doctor 只能作用于目标 Git 根,并拒绝项目内 symlink 写入路径 | superseded → D-021 |
| D-016 | 2026-08-12 | Stop hook 作为确定性调度器,对受管变化提供有界事实并触发 tidykeep Skill;Agent 承担 STATE/文档/清理语义判断,Git hook 只验收机械证据,任何候选不得由 Hook 自动删除 | active |
| D-017 | 2026-08-12 | manifest v3 只保存版本、agents 与确定性 managed 资产 hash;用户/本机状态全部从现场推导,保证跨用户与重复安装字节稳定 | active |
| D-018 | 2026-08-12 | 项目内 journal/staging 一律视为不可信;中断后只验证并精确清理,绝不回放,随后按现场重规划 | active |
| D-019 | 2026-08-12 | 项目/Kimi 目录锁不按 PID 自动回收;活锁、未知锁与崩溃残留均 fail-closed,人工确认进程退出后删精确目录 | active |
| D-020 | 2026-08-12 | JSONC 回写使用结构感知扫描,忽略注释/字符串/嵌套同名键并只替换最后一个真实根键;新增键保留原排版 | active |
| D-021 | 2026-08-12 | 支持独立非 Git 目录;若属于 Git 则只允许主 worktree 根。入口 symlink canonicalize,项目内受写 symlink 拒绝 | active |

## 墓地(已废弃/已删除,禁止复活)

Agent 不得参考、不得重新实现下表中的内容。

| 日期 | 删除/废弃了什么 | 原因 | 取代者 |
|---|---|---|---|
| 2026-08-12 | bash+python3 初稿(install.sh、uninstall.sh、payload/hooks/*.py、payload/githooks 旧版、双份 README) | 官方核查证明其关键假设过时(Codex/Kimi 已有官方 hooks、Kimi 换代且全局文件路径与覆盖语义两处断言错误);且 bash+python3 不满足 npx 跨平台分发 | Node 全量重写(D-001),历史在基线提交 969b038 |
| 2026-08-12 | Kimi 引用计数的 manifest.json 单文件读-改-写方案 | 无锁并发丢注册;路径未 realpath 归一导致 symlink/大小写残留 | `~/.tidykeep/projects.d/` 每项目一个原子标记文件 + realpath 键(D-004) |
| 2026-08-12 | Codex hooks 相对路径 command(`node .tidykeep/...`) | 官方明确 hook cwd 是会话目录而非仓库根,子目录会话中守卫静默失效 | `node "$(git rev-parse --show-toplevel)/..."`(官方推荐形式) |
| 2026-08-12 | Stop hook 的 `AUTO_COMMIT=auto` 自动 `git add -A` / commit | 会吞入并非当前任务的用户改动,也绕过明确审阅 | 仅提醒提交(D-010) |
| 2026-08-12 | vendored runtime 全部逻辑堆在 `core.mjs` | 单文件职责过多,变更影响面和测试定位不清 | 稳定 facade + config/paths/write-policy/ledger/git-policy 模块 |
| 2026-08-12 | manifest v2 的路径/状态自报所有权 | 无内容证明且中断恢复能力不足,可误覆盖或误删用户文件 | manifest v3 + 已发布内容证明 + 安装 journal(D-011) |
| 2026-08-12 | Kimi 全局配置滚动时间戳备份 | 无消费方且重复安装积累冗余 | 原子写入 + 精确块所有权 + fail-closed |
| 2026-08-12 | 早期 manifest v3 持久化 installedAt、hooksPath、Kimi/用户路径、用户文件 hash 与卸载问题 | 清单入库后跨用户漂移,还会把本机状态误当所有权 | 稳定 5 字段清单 + 现场推导(D-017) |
| 2026-08-12 | 认证 journal 后回放 staging 的中断恢复函数 | journal/stage 位于项目内,可被不可信输入篡改;旧实现还留下零引用分支 | 验证布局后丢弃,按现场重规划(D-018) |
| 2026-08-12 | 按 PID/存活探测自动回收 stale lock | 检查与回收间存在后来者换锁竞态,会破坏互斥 | 崩溃锁人工确认与精确删除(D-019) |
| 2026-08-12 | JSONC 正则/行级首命中替换 | 会命中注释、字符串、嵌套或非最终重复键,导致选项未真实生效 | 结构感知根键扫描(D-020) |
| 2026-08-12 | 所有目标都必须是 Git 根、非 Git 目录不可用的边界 | 工具本身不依赖 Git 才能提供 native hooks;真正风险是误继承父仓库或改共享 worktree 配置 | 独立目录可用,Git 仅主 worktree 根(D-021) |
| 2026-08-12 | 安装/卸载自动生成永久 settings/config 备份 | 配置可能含隐私且无人消费,重复运行会积累 | 原子精确合并;既有用户 backup 只保留不创建 |
