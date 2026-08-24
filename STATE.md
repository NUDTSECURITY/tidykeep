# 项目状态(当前设计的唯一真相)

> 由 tidykeep 协议维护。任何 Agent 开工前必读本文件。
> 本文件只描述"**现在**"——历史在 git 与下方决策记录里,废弃方案在墓地里。

## 当前架构与设计

本仓库是 **tidykeep** 本身:面向 Claude Code、Codex、Kimi Code 的项目知识保鲜协议。
交付形态是 npm 包,当前 registry 尚未发布,可直接运行源码 CLI;要求 Node ≥ 20.11,
运行时零第三方依赖。

- **本工具是协议分发器,不是执行器。** 它把两个 skill 和一份规则块铺进目标项目,
  之后的一切靠 Agent 遵守约定。**不安装任何 hook,不拦截任何操作,没有强制力。**
- `bin/tidykeep.mjs` 只分发 `init` 与 `uninstall` 两个命令;`src/commands/` 实现,
  `src/lib/` 只剩三件必需品:`markers.mjs`(标记块严格配对)、`fs-safe.mjs`(原子写)、
  `project-paths.mjs`(路径与 Git 边界)。
- `init` 铺设:`.claude/skills/{tidykeep,sdlc}/` 与 `.agents/skills/{tidykeep,sdlc}/`
  两套 skill 副本;向 `AGENTS.md`(规则全文)、`CLAUDE.md`(`@AGENTS.md` 指针)、
  `.gitignore`(`.tmp/`)upsert 标记块;`STATE.md` 仅当不存在时创建,**永不覆盖**。
- 受管资产的所有权只由「内容精确等于当前 payload 发布内容」证明。重跑 `init` 即升级:
  我们发布的文件直接覆盖,用户文件只通过标记块触碰。标记孤立或逆序时**整体拒绝**并非零退出,
  绝不吞掉夹在标记间的用户内容。`uninstall` 对内容被改过的文件保守保留并非零退出。
- 独立非 Git 目录可安装;位于 Git 时目标必须是主 worktree 根。入口先 canonicalize,
  项目内受写路径不得含 symlink。
- `payload/` 是目标项目模板:`rules.md`(AGENTS.md 协议块)、`STATE.md`(知识模板)、
  `skills/tidykeep/`、`skills/sdlc/`。
- **`tidykeep` skill** 是协议的完整执行流程:六事实面完成合同(代码/运行态/文档/规则/
  记忆/工作区,每面标 verified-current | changed-and-verified | pending | out-of-scope |
  not-applicable)、权限四档、轻量/完整双路径、证据层级与发布状态机、记忆写入边界、
  变更影响矩阵、两阶段汇报、最终自检。细节分置于 4 份 references。
- **`sdlc` skill** 覆盖需求澄清→价值评估→方案设计→PRD→开发→质量验证→修复回归→
  文档维护的八阶段流程。它只管技术文档本身;项目级知识收尾归 tidykeep,两者在
  `sdlc/SKILL.md` 中有明确分工声明,不重复实现。
- 知识层只有 `STATE.md` 一个文件。逐文件变更简史交回 `git log`。
- 测试覆盖标记块边界、原子写、路径与 Git 边界、init/uninstall e2e,以及 skill 资产
  格式校验(name 等于目录名、description 长度、SKILL.md 体量预算、references 链接可达)。
- 本仓库已自装 tidykeep(狗粮)。

## 设计决策记录(ADR-lite)

| 编号 | 日期 | 决策 | 状态 |
|---|---|---|---|
| D-001 | 2026-08-12 | 发布形态:npm 包 + npx,全 Node 重写,零第三方运行时依赖(取代 bash+python3 初稿) | active(D-022 收窄为只铺知识文件与 skill,不再 vendor runtime) |
| D-002 | 2026-08-12 | 覆盖三家 native hooks;git hooks 永远保留为兜底硬边界 | superseded → D-022 |
| D-003 | 2026-08-12 | hook 运行时 vendor 进目标项目 `.tidykeep/runtime/` | superseded → D-022 |
| D-004 | 2026-08-12 | Kimi hooks 写用户全局 `~/.kimi-code/config.toml` 标记块,shim 按项目路由 | superseded → D-022 |
| D-005 | 2026-08-12 | 配置用 JSONC,程序回写走行级替换保注释 | superseded → D-020 → D-022 |
| D-006 | 2026-08-12 | 标记块操作严格配对:孤立/逆序一律拒绝改写(宁可要求手工修复,不静默吞用户内容) | active |
| D-007 | 2026-08-12 | 所有涉及 agent 能力的结论必须现场核实官方文档,不信二手信息 | active |
| D-008 | 2026-08-12 | AUTO_COMMIT 三档,默认 off | superseded → D-010 → D-022 |
| D-009 | 2026-08-12 | 对外动作边界:agent 到 commit 为止,push/publish/tag 由人决定;发布前强制先跑完整路径收尾 | active |
| D-010 | 2026-08-12 | hook 永不暂存或提交工作区 | superseded → D-022 |
| D-011 | 2026-08-12 | 安装采用 manifest v3 + 完整 preflight + staging/journal + 目录锁 | superseded → D-022 |
| D-012 | 2026-08-12 | 台账收紧为逐文件 section 证明;Git hooks fail-closed | superseded → D-022 |
| D-013 | 2026-08-12 | 重复 init 是增量升级 | active(D-022 简化:只刷新 skill 资产与标记块,无 agents 并集与 hook 所有权认定) |
| D-014 | 2026-08-12 | 外部 core.hooksPath 不自动改写 | superseded → D-022 |
| D-015 | 2026-08-12 | init/uninstall/doctor 只能作用于目标 Git 根 | superseded → D-021 |
| D-016 | 2026-08-12 | Stop hook 作为确定性调度器触发 Skill;Agent 承担语义判断 | superseded → D-022 |
| D-017 | 2026-08-12 | manifest v3 只保存版本、agents 与 managed 资产 hash | superseded → D-022 |
| D-018 | 2026-08-12 | 项目内 journal/staging 一律视为不可信,中断后重规划 | superseded → D-022 |
| D-019 | 2026-08-12 | 目录锁不按 PID 自动回收,崩溃残留 fail-closed | superseded → D-022 |
| D-020 | 2026-08-12 | JSONC 回写使用结构感知扫描 | superseded → D-022 |
| D-021 | 2026-08-12 | 支持独立非 Git 目录;属于 Git 则只允许主 worktree 根 | active |
| D-022 | 2026-08-24 | **退回纯 skill 分发**:吸收 neat-freak 为 tidykeep skill 主体,砍掉三家 native hooks、git hooks、LEDGER 台账、manifest/安装事务/目录锁、config.jsonc/allowlist、doctor/status。理由:hooks 占据绝大部分代码与维护成本,而其独有价值(两条写入拦截 + 提交校验)低于其复杂度;协议约束改由 skill 承载。**已知代价:强制力归零,规则全靠 Agent 自觉。** | active |
| D-023 | 2026-08-24 | skill 只铺 `.claude/skills/` 与 `.agents/skills/` 两处即覆盖三家(官方核实:Codex 只扫 `.agents/skills`;Kimi 两处都读;Claude 读 `.claude/skills`)。**不铺 `.codex/skills/`** | active |
| D-024 | 2026-08-24 | 吸收 sdlc 为并列的第二个 skill,由 tidykeep 一并分发;其阶段 8 只管技术文档,知识收尾归 tidykeep,分工写进 sdlc/SKILL.md 防止两份真相 | active |

## 墓地(已废弃/已删除,禁止复活)

Agent 不得参考、不得重新实现下表中的内容。

| 日期 | 删除/废弃了什么 | 原因 | 取代者 |
|---|---|---|---|
| 2026-08-12 | bash+python3 初稿(install.sh、payload/hooks/*.py、旧 githooks、双份 README) | 官方核查证明关键假设过时;且不满足 npx 跨平台分发 | Node 全量重写(D-001),历史在基线提交 969b038 |
| 2026-08-12 | Kimi 引用计数的 manifest.json 单文件读-改-写方案 | 无锁并发丢注册;路径未归一导致残留 | 后被 D-022 一并删除 |
| 2026-08-12 | Codex hooks 相对路径 command | 官方明确 hook cwd 是会话目录而非仓库根 | 后被 D-022 一并删除 |
| 2026-08-12 | Stop hook 的 `AUTO_COMMIT=auto` 自动提交 | 会吞入并非当前任务的用户改动 | 后被 D-022 一并删除 |
| 2026-08-12 | vendored runtime 全部逻辑堆在 `core.mjs` | 单文件职责过多 | 后被 D-022 一并删除 |
| 2026-08-12 | manifest v2 的路径/状态自报所有权 | 无内容证明,可误覆盖用户文件 | 后被 D-022 一并删除 |
| 2026-08-24 | **三家 native hooks 全套**:`payload/runtime/`(hook、write-policy、kimi-shim、core、config、paths、ledger、git-policy、messages、githook、enable-githooks)、`src/lib/{settings-json,blocks,kimi}.mjs` | 三平台适配 + 全局 TOML 块 + shim 路由 + 用户锁的维护成本远高于其独有价值(仅两条写入拦截) | `tidykeep` skill 的协议条文(D-022) |
| 2026-08-24 | **git hooks**:`payload/githooks/{pre-commit,commit-msg}` 及 `src/lib/git-hooks.mjs` | 随 hooks 整体方案一并移除 | skill 中的 Commit 规范条文(D-022) |
| 2026-08-24 | **LEDGER.md 逐文件台账全套**:根 `LEDGER.md`、`payload/LEDGER.md`、`payload/runtime/ledger.mjs` | DONE 栏本质是逐文件 commit 摘要,`git log --follow` 已有且更准;失去 pre-commit 校验后必然腐化 | `git log` + `STATE.md`(D-022) |
| 2026-08-24 | **安装事务机制**:`src/lib/{manifest,install-transaction,directory-lock,project-lock,legacy-assets}.mjs` | 为「重复安装不损坏」设计的重型机制;纯文件铺设场景下原子写 + 内容比对已足够 | 直接原子写 + 内容精确匹配证明所有权(D-022) |
| 2026-08-24 | `src/lib/jsonc.mjs` | 只为解析 hook 用的 `config.jsonc` 而存在 | 无(配置文件已删) |
| 2026-08-24 | **运行时配置**:`.tidykeep/config.jsonc`(12 个键)与 `.tidykeep/allowlist` | 全部是 hook 参数;没有自动拦截就没有误报,也就不需要豁免名单 | 无 |
| 2026-08-24 | `doctor` 与 `status` 命令 | 26 项检查里绝大多数在验证 hooks 接线与 manifest,对象已不存在 | 测试中的 skill 资产格式校验(D-022) |
| 2026-08-24 | `payload/docs/workflows.md`(三工作流单一真源) | 内容已并入 `tidykeep` skill 的 SKILL.md;留着就是第二份真相 | `payload/skills/tidykeep/SKILL.md` |
| 2026-08-24 | 项目内独立的 `.claude/skills/neat-freak/` | 已被吸收为 `tidykeep` skill 主体 | `payload/skills/tidykeep/`(D-022) |
| 2026-08-24 | `.gitattributes` 的 tidykeep 注入块 | 当初为 runtime/githooks 固定 LF,那些文件已不存在 | 无 |
| 2026-08-24 | `sdlc-skill.zip` | 内容已解包吸收为 `payload/skills/sdlc/` | `payload/skills/sdlc/`(D-024) |

## 待办

- [ ] npm publish 后:README 补安装徽章与 registry 链接,删除"尚未发布"提示行。
