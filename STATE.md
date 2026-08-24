# 项目状态(当前设计的唯一真相)

> 由 tidykeep 协议维护。任何 Agent 开工前必读本文件。
> 本文件只描述"**现在**"——历史在 git 与下方决策记录里,废弃方案在墓地里。

## 当前架构与设计

本仓库是**个人 Agent Skill 库 + 安装器**。目标:换机器、换环境时 clone 一次、跑一条命令,
全部自维护 skill 就位,不必逐个下载。交付形态是 npm 包,registry 尚未发布,可直接跑源码 CLI;
要求 Node ≥ 20.11,运行时零第三方依赖。

- **本工具是 skill 分发器,不是执行器。** 它把 `payload/skills/` 下的全部 skill 铺到三家
  Agent 都能发现的位置。**不安装任何 hook,不拦截任何操作,没有强制力。**
- `bin/tidykeep.mjs` 分发 `list` / `doctor` / `init` / `uninstall`;`src/commands/` 实现,
  `src/lib/` 四件:`markers.mjs`(标记块严格配对)、`fs-safe.mjs`(原子写)、
  `project-paths.mjs`(路径与 Git 边界)、`skill-validate.mjs`(格式校验)。
- **skill 目录自动发现**:新增 skill 只需放进 `payload/skills/<name>/`,不改任何代码。
- **两种作用域。默认用户级**(`~/.claude/skills/` 与 `~/.agents/skills/`),对所有项目生效——
  这是个人库的主用法。`--project <dir>` 装到项目并额外注入 tidykeep 协议:`AGENTS.md`
  规则块、`CLAUDE.md` 的 `@AGENTS.md` 指针、`.gitignore` 的 `.tmp/`,以及 `STATE.md`
  (仅当不存在时创建,**永不覆盖**)。`--skills a,b` 可选装子集。
- **安装前 fail-closed 校验 skill 格式**(name 等于目录名、description ≤1024、
  SKILL.md <500 行/<24KB、相对链接可达、references 无孤儿)。格式错的 skill 会被 Agent
  **静默忽略**——不报错只是不生效,所以必须在安装前挡住。`doctor` 是该校验的只读入口。
- 受管资产的所有权只由「内容精确等于当前 payload 发布内容」证明。重跑 `init` 即升级:
  我们发布的文件直接覆盖,用户文件只通过标记块触碰。标记孤立或逆序时**整体拒绝**并非零退出,
  绝不吞掉夹在标记间的用户内容。`uninstall` 对内容被改过的文件保守保留并非零退出。
- 独立非 Git 目录可安装;位于 Git 时只拒绝**仓库子目录**(会装出脱离仓库根的孤岛),
  linked worktree 允许(D-031)。入口先 canonicalize,项目内受写路径不得含 symlink。
- `payload/` 是分发源:`rules.md`(AGENTS.md 协议块与路由表)、`STATE.md`(知识模板)、
  `skills/` 下四个 skill——`tidykeep`、`sdlc`、`blind-test`、`rigor3`。
- **`tidykeep` skill** 是协议的完整执行流程:六事实面完成合同(代码/运行态/文档/规则/
  记忆/工作区,每面标 verified-current | changed-and-verified | pending | out-of-scope |
  not-applicable)、权限四档、轻量/完整双路径、证据层级与发布状态机、记忆写入边界、
  变更影响矩阵、两阶段汇报、最终自检。细节分置于 4 份 references。
- **`sdlc` skill** 覆盖需求澄清→价值评估→方案设计→PRD→开发→质量验证→修复回归→
  文档维护的八阶段流程。它只管技术文档本身;项目级知识收尾归 tidykeep,测试真实性归
  blind-test,三者在 `sdlc/SKILL.md` 中有明确分工声明,不重复实现。
- **`blind-test` skill** 解决 agent 自写测试的失效问题:同一上下文先写实现再写测试时,
  测试会退化为实现的镜像。四项完成合同——契约(里程碑验收条款)、隔离(工具权限而非提示词)、
  经济(一条条款最多一个测试)、证伪力(变异检查)。变异检查是其中唯一能机械证明测试有效的手段。
- 知识层只有 `STATE.md` 一个文件。逐文件变更简史交回 `git log`。
- **没有测试套件**(D-026)。原 35 个测试已删除,其中唯一不可替代的 skill 格式校验已移植进
  `skill-validate.mjs`,由 `doctor` 与每次 `init` 强制执行,CI 也只跑它。
- 本仓库已自装(狗粮),项目级安装。

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
| D-021 | 2026-08-12 | 支持独立非 Git 目录;属于 Git 则只允许主 worktree 根 | superseded → D-031 |
| D-022 | 2026-08-24 | **退回纯 skill 分发**:吸收 neat-freak 为 tidykeep skill 主体,砍掉三家 native hooks、git hooks、LEDGER 台账、manifest/安装事务/目录锁、config.jsonc/allowlist、doctor/status。理由:hooks 占据绝大部分代码与维护成本,而其独有价值(两条写入拦截 + 提交校验)低于其复杂度;协议约束改由 skill 承载。**已知代价:强制力归零,规则全靠 Agent 自觉。** | active |
| D-023 | 2026-08-24 | skill 只铺 `.claude/skills/` 与 `.agents/skills/` 两处即覆盖三家(官方核实:Codex 只扫 `.agents/skills`;Kimi 两处都读;Claude 读 `.claude/skills`)。**不铺 `.codex/skills/`** | active |
| D-024 | 2026-08-24 | 吸收 sdlc 为并列的第二个 skill,由 tidykeep 一并分发;其阶段 8 只管技术文档,知识收尾归 tidykeep,分工写进 sdlc/SKILL.md 防止两份真相 | active |
| D-025 | 2026-08-24 | 新增第三个 skill `blind-test`,解决 agent 自写测试的结构性失效(测试与实现共享上下文 → 测试沦为实现镜像)。两条硬约束:**上下文隔离靠工具权限而非提示词**;**每条测试绑定一条里程碑验收条款**,没有条款就没有测试。变异检查为唯一机械证明。同时修正 sdlc 的时序矛盾——其 6.8 测试设计原排在阶段 5 开发之后,改为必须前置 | active |
| D-026 | 2026-08-24 | **重定位为个人 Agent Skill 库**:安装器从「装 tidykeep 协议」改为「装库里全部 skill」,skill 目录自动发现,**默认用户级安装**(换项目不必重装),`--project` 保留原协议注入。同时按用户要求删除测试套件——把其中唯一不可替代的 skill 格式校验移植进 CLI 并 fail-closed,使该保证不依赖测试而存在 | active |
| D-027 | 2026-08-24 | 三个 skill 的边界改为**三向声明**:每个 SKILL.md 都写明另外两个管什么,任一被触发都能自行裁决;并给 sdlc 补上此前缺失的「不要用于」排除条款(它原本范围写得极宽,会抢走改几行代码这类请求) | active |
| D-028 | 2026-08-24 | 吸收 [MaySudo/rigor3](https://github.com/MaySudo/rigor3) v0.2.0(MIT)为第 4 个 skill,补上库中缺失的**代码层**质量审计。全量吸收不裁剪:SKILL.md 引用全部 11 份 references,删任一份即成死链;尤其不能砍 engine-generation/conformance-cases/scoring-contract——那是它防止模型编造分数的机制(生成临时引擎 → 一致性校验 → 不合格不发布),与 blind-test 的变异检查同源。**本地补丁两处**:description 补中文触发词(上游全英文,中文提问不会命中)、新增四向分工小节;协议正文与 11 份 references 与上游逐字一致,升级时重放这两处即可 | active |
| D-029 | 2026-08-24 | 因 rigor3 加入而重切重复面:`sdlc` 6.1–6.7 降为流程内轻量把关并声明仓库级审计转 rigor3;`tidykeep` description 删去「清理冗余代码、删除旧版本脚本、体检审计」——**它此前承诺了代码层能力却已不再交付**(方法随旧工作流 3 简化掉了),改为明确指向 rigor3;`blind-test` 与 rigor3 建立衔接:后者评估测试充分性,结论为缺失/无效时转前者去写 | active |
| D-030 | 2026-08-24 | **skill 改为任务驱动自动触发**:四个 description 原本全写成「当用户**提到** X、Y、Z 时」——把触发绑在用户说出 skill 自己的黑话上,等于必须先知道咒语。全部重写为描述**任务情形**(准备提交时、要写测试时、接手陌生项目时、需求还很模糊时)。并加第二层保险:skill description 是语义匹配可能不命中,而规则文件每次会话必然全量加载,故把路由表写进规则文件——项目级进 AGENTS.md,**用户级进 ~/.claude/CLAUDE.md 与 Codex 全局指令**(存在 AGENTS.override.md 时写它,否则写 AGENTS.md;写错会被无声忽略)。Kimi 用户级指令路径未经现场核实,暂不写 | active |
| D-031 | 2026-08-24 | **拆掉 linked worktree 安装限制**(取代 D-021 的该条款)。原限制的唯一依据是 `core.hooksPath` 由主仓库 common dir 共享、在 worktree 改写会污染主仓库;hooks 已随 D-022 全部移除,现在写入的只有 AGENTS.md/CLAUDE.md/.gitignore/STATE.md 与 skill 文件,都是该 worktree 自己的工作区文件,跟着其分支走。依据消失就不该留限制。**仍拒绝仓库子目录**——那会装出脱离仓库根的孤岛。已用真实 linked worktree 验证:安装成功,主仓库 hooksPath 与工作区均未被触碰 | active |

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
| 2026-08-24 | `docs/specs/2026-08-24-absorb-neat-freak-design.md` | 该设计已实施完毕,STATE.md 已接管为唯一真相;留着就是第二份设计说明 | 本文件「当前架构与设计」+ D-022/023/024 |
| 2026-08-24 | `.deepeval/` 空目录与 `.gitignore` 中指向它的规则 | 目录为空、全仓库零引用,规则与目录互为对方存在的唯一理由 | 无 |
| 2026-08-24 | 仓库内 `.claude/skills/`、`.agents/skills/` 的入库副本 | 与 `payload/skills/` 逐字节相同,34 个副本比源码还多,构成三份真相 | `payload/skills/` 为唯一源;两目录改为 gitignore,用 `init --project .` 重建 |
| 2026-08-24 | **整个 `test/` 目录**(35 个测试:markers、init/uninstall e2e、npm pack、skill-assets)与 `package.json` 的 test/test:coverage 脚本、CI 的 coverage job | 用户判定测试对个人 skill 库不必要。**代价已知**:markers 的 15 个用例守着「绝不吞掉标记块之间用户内容」这条承诺,现在无人守;init/uninstall 的行为回归也无人守 | skill 格式校验移植进 `src/lib/skill-validate.mjs`,由 `doctor` 与每次 `init` fail-closed 执行;其余保证转为无自动验证 |
| 2026-08-24 | `SKILL_NAMES` 硬编码列表 | 个人库应当放进目录即生效,不该改代码 | `discoverSkills()` 自动扫描 `payload/skills/` |

## 待办

