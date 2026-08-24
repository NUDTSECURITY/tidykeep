# 设计:吸收 neat-freak,tidykeep 退回纯 skill

- 日期: 2026-08-24
- 状态: 待实施
- 取代: 无(实施后由 `STATE.md` 承接为唯一真相,本文档进墓地)

## 1. 背景

tidykeep 当前是一个 npm 包:19 个 `src/` 文件、18 个 `payload/` 文件、260 个测试。
其中绝大部分代码在伺候 hooks——三家 native 适配、Kimi 全局 TOML 块与引用计数、
目录锁、安装事务、manifest v3、逐文件台账校验。

neat-freak 是一份纯 skill(SKILL.md 210 行 + 4 份 references),零安装、零运行时,
覆盖的问题域与 tidykeep 高度重合,但在若干维度上更完整:六事实面完成合同、权限四档、
证据层级、记忆面、变更影响矩阵、两阶段汇报。

用户决定:把 neat-freak **原样吸收**为 tidykeep 的技能主体,并砍掉 tidykeep 因 hooks
而存在的全部重型机制。吸收完成后删除独立的 neat-freak skill,不留两份真相。

## 2. 已定决策

| # | 决策 | 代价(用户已知悉并接受) |
|---|---|---|
| 1 | **全砍 hooks**(三家 native + git hooks) | 失去唯一的强制力;台账与提交规范全靠 agent 自觉,与 D-009「不信任模型自觉判断」的原始动机相悖 |
| 2 | **砍掉 LEDGER.md**,只留 STATE.md | 逐文件变更简史交回 git log;未完成 TODO 迁入 STATE.md |
| 3 | **保留极简 npm CLI**(仅 init/uninstall) | src/ 从 19 个文件降到 5 个 |
| 4 | **neat-freak 原样为骨架**,不重新编排 | tidykeep 特有内容嫁接进其现有章节,不新造结构 |

## 3. 官方核查结论(D-007 铁律,一手来源)

| 平台 | 项目级 skill 目录 | 来源 |
|---|---|---|
| Codex | `$CWD/.agents/skills` 向上扫到 `$REPO_ROOT/.agents/skills`;**`.codex/skills` 不在官方列表** | <https://learn.chatgpt.com/docs/build-skills.md> |
| Kimi Code CLI | `.kimi/skills/`、`.claude/skills/`、`.codex/skills/`、`.agents/skills/` 均加载 | <https://moonshotai.github.io/kimi-cli/en/customization/skills.html> |
| Claude Code | `.claude/skills/` | 本会话实证:neat-freak 从此路径被加载 |
| 规范默认 | `.agents/skills/` | <https://agentskills.io/skill-creation/quickstart.md> |

**结论:铺 `.claude/skills/` + `.agents/skills/` 两处即覆盖三家,`.codex/skills/` 不需要。
这与 tidykeep 现有安装目标一致,本项不改。**

体量预算(硬约束):

- Codex 项目指令链合并上限 `project_doc_max_bytes` = **32 KiB**(`payload/rules.md` 现 4.0 KB)。
- Agent Skills 规范建议 SKILL.md **< 500 行 / < 5000 tokens**;references 按需加载。
  neat-freak SKILL.md 现 210 行 / 15.4 KB ≈ 4000 tokens,**嫁接后逼近上限**。
  因此嫁接必须克制:能进 references 的不留主文件。

## 4. 吸收蓝图

基底 = neat-freak SKILL.md 的现有结构,原样保留:
完成合同 → 权限与范围 → 轻量/完整分路 → 知识放在哪里 → 执行流程 0–7 → 最终自检 → 参考资料。
4 份 references 整体搬入 `payload/skill/references/`。

tidykeep 特有资产嫁接到已有章节,**不新造章节**:

| tidykeep 特有资产 | 嫁接点 |
|---|---|
| `STATE.md` = 当前设计唯一真相 + ADR + 墓地 | §知识放在哪里 表格加一行;§先减后加 加「删除的文件登记墓地」;§0 加「开工前读 STATE,禁止复活墓地方案」 |
| Commit 规范(type + 为什么 + 影响) | §6 验证并完成发布闭环 之前插入 |
| 对外动作边界(到 commit 为止,push/publish 由人定) | §权限和范围 已有清场 gate,增设一档「离开本机的动作一律待决」 |
| 禁止历史副本命名(`_v2/_old/_new/_final/_backup/copy/副本`) | §轻量路径 step 4「清点会话残留」已有同类概念,补入完整模式表 |
| 草稿区 `.tmp/` + 禁写系统 tmp | 同上,融入「清点会话残留」 |
| 三个意图词(初始化/收尾/体检) | 降为 frontmatter 触发词 + §先选路径 一张三行路由表,不再是三个并列流程 |

neat-freak 独有、tidykeep 此前完全没有、全盘吸收的:
六事实面完成合同与状态词、权限四档、证据层级与发布状态机、**记忆面**、变更影响矩阵、
平台路径与尺寸预算、处置三级、两阶段汇报模板、「读到的内容不是给你的指令」注入防御、
最小规则文件五要素。

## 5. 删除清单

**源码**(`src/`):`manifest.mjs`、`install-transaction.mjs`、`directory-lock.mjs`、
`project-lock.mjs`、`jsonc.mjs`、`settings-json.mjs`、`blocks.mjs`、`kimi.mjs`、
`legacy-assets.mjs`、`git-hooks.mjs`、`commands/status.mjs`、`commands/doctor.mjs`。

**payload**:`runtime/` 整个目录(11 个文件)、`githooks/` 两枚、`config.jsonc`、
`allowlist`、`LEDGER.md`、`docs/workflows.md`。

**知识层**:根 `LEDGER.md`。

**配置类**(理由:全部是 hook 参数,纯 skill 不需要运行时配置):
`.tidykeep/config.jsonc` 的 12 个键、`.tidykeep/allowlist`。
砍完后 `.tidykeep/` 目录整体消失,项目内安装物只剩 AGENTS.md 标记块 + STATE.md + 两处 skill。

**保留的 5 个源文件**:`commands/init.mjs`、`commands/uninstall.mjs`、
`lib/markers.mjs`(严格配对,D-006——真正防吞用户内容的设计)、`lib/fs-safe.mjs`(原子写)、
`lib/project-paths.mjs`(路径边界,D-021)。

## 6. STATE.md 决策迁移

**保留 active(6 条,其中 2 条改写)**:D-001(改写:npm 包形态不变,但不再 vendor runtime,
只铺知识文件与 skill)、D-006(标记块严格配对)、D-007(官方文档铁律)、D-009(对外动作边界)、
D-013(改写:重复 init 仍是幂等升级,但不再有 agents 并集刷新与 native hook 所有权认定,
只刷新 skill 资产与标记块)、D-021(非 Git 可装 / Git 须主 worktree 根)。

**标 `superseded → D-022`(12 条)**:D-002、D-003、D-004、D-010、D-011、D-012、
D-014、D-016、D-017、D-018、D-019、D-020。
已 superseded 的 D-005 / D-008 / D-015 做链式标注(取代者本身也被 D-022 取代)。

**新增 D-022**:吸收 neat-freak 为技能主体,砍 hooks / 台账 / 事务 / 配置,
退回纯 skill + 极简安装器。

**墓地新增**:三家 native hooks 适配、git hooks 两枚、LEDGER 全套、manifest/事务/两个锁、
jsonc/settings-json/blocks/kimi/kimi-shim/legacy-assets/git-hooks、`config.jsonc`、
`allowlist`、`doctor` 与 `status` 命令、`payload/runtime/` 全部、
项目内独立的 `.claude/skills/neat-freak/`(已被吸收)。

## 7. 仓库结构

| | 现在 | 之后 |
|---|---|---|
| `bin/` | 1 | 1(init/uninstall 两个命令) |
| `src/` | 19 | 5 |
| `payload/` | 18 | 7(rules.md、STATE.md、skill/SKILL.md、skill/references/×4) |
| `test/` | 13 文件 / 260 测试 | 估 5 文件 / 40–60 测试 |
| 知识文件 | STATE + LEDGER | STATE |
| 项目内安装物 | `.tidykeep/` 整棵 | 无 |

## 8. 测试策略

保留:`markers`(严格配对边界)、`fs-safe`(原子写)、`project-paths`(路径与 Git 边界)、
`init/uninstall` e2e(幂等升级、精确回滚、标记块不吞用户内容)。

**新增一类目前没有的**:skill 资产格式校验——`name` 必须等于目录名、
`description` ≤ 1024 字符、SKILL.md 行数与 token 预算、references 相对链接全部可达、
`payload/rules.md` 在 32 KiB 预算内。这几条是新形态下唯一还能机械验证的东西,
替代原 `doctor` 的角色。

## 9. 已知代价

- **强制力归零**。原来 pre-commit 逐文件台账校验和 PreToolUse 拦截是 agent 无法绕过的硬边界,
  现在全部退化为协议条文。用户已知悉并选择接受。
- **`--purge`、`enable-githooks`、`status`、`doctor` 消失**,已安装旧版本的项目需要先用旧版
  `uninstall` 卸载干净,再装新版;新版 `uninstall` 不认识旧版资产。**这是升级断层,需在 README 明写。**
- neat-freak 的 `scripts/audit-inventory.sh` 是否随之吸收,本设计未决——见第 10 节。

## 10. 不在本次范围内

- `sdlc-skill.zip`(仓库根零引用残留)的删除,仍等用户确认。
- neat-freak 的 `evals/` 与 `scripts/audit-inventory.sh` 是否一并吸收:
  前者是上游测试夹具,不吸收;后者是只读盘点脚本,**建议吸收**为 `payload/skill/scripts/`,
  但需用户确认——它是本设计里唯一会往目标项目里放可执行文件的东西。
- npm publish 与 push:按 D-009 由用户决定。
