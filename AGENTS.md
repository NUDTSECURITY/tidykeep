<!-- tidykeep:begin -->
# tidykeep 协议(本项目 Agent 规则入口)

> 本项目启用 tidykeep:一套防止旧代码、旧文档、旧设计残留的工作协议。
> **本文件是所有 AI Agent(Claude Code / Codex / Kimi 等)的唯一规则入口。**
> 违规操作会被两层拦截:各 Agent 的 native hooks + 对所有人生效的 git hooks。

## 三个核心文件

| 文件 | 作用 | 谁维护 |
|---|---|---|
| `AGENTS.md`(本文件) | 规则入口,长期稳定 | 人 |
| `STATE.md` | **当前设计的唯一真相** + 决策记录 + 已废弃墓地 | Agent 每次设计变更时 |
| `LEDGER.md` | 每个受管代码/文档文件的 TODO / DONE 台账 | Agent 每次任务收尾时 |

## 任务循环(每次任务必须遵守)

**开工前:** 读 `STATE.md`(以"当前架构与设计"为唯一事实依据)与 `LEDGER.md` 中相关文件条目;**禁止**参考墓地中已废弃的方案,禁止复活已删除的旧实现。

**干活时:** 优先修改现有文件,**禁止**创建 `_v2/_old/_new/_final/_backup/copy/副本` 等历史副本命名(hooks 当场拦截);只是参数不同时用 CLI 参数或配置文件,不复制脚本;一次性/实验/验证脚本统一放**项目内**草稿区 `.tmp/`(已 gitignore),**禁止**写系统 `/tmp`、`~/tmp`、`~/.tmp`、`$TMPDIR`(hooks 拦截),脚本完成使命后**立即删除**;不再使用的文件要**删除**(历史在 git,随时可找回)并在 `STATE.md` 墓地登记;文档必须反映现状——过期段落当场更新或删除,禁止"新版方案""临时做法"这类必然腐烂的措辞。

**收尾时(三件事,缺一不可,Stop hook 与 pre-commit 会检查):**
1. **更新 `LEDGER.md`**:完成项从 TODO 移入 DONE(附日期);新待办登记进 TODO;刷新相关文件的"最后核对"。
2. **同步 `STATE.md`**:设计/架构/接口有变则更新"当前架构与设计",被取代的决策标记 `superseded → 新决策`;删除的文件登记进墓地。
3. **详细提交**:按下方 Commit 规范(commit-msg hook 校验)。

附加自检:`.tmp/` 中已完成使命的脚本删除;确需跨任务保留的,向用户说明原因。

**对外动作边界:** agent 的工作到 **commit 为止**。`git push`、npm publish、打 tag、对外交付等
一切离开本机的动作**由人决定**,未经用户明确指示不得执行。任何"发布 / 交付 / 宣布完成"类
动作之前,必须先执行一次**体检审计**工作流(见深度工作流)并处理其发现——包括 README 等
面向用户文档的漂移核对。

## Commit 规范

```
<type>: <一句话说清做了什么>

为什么: <动机 / 修复的问题 / 对应的 TODO>
影响: <涉及的模块与文件;台账/状态文件相应更新点>
```

- `type` ∈ feat / fix / refactor / docs / chore / test / perf;主题与正文有最小长度校验;Merge / Revert / fixup 自动豁免。
- 确属琐碎改动可 `TIDYKEEP_SKIP=1 git commit ...` 跳过校验,但必须向用户说明原因,不得默默绕过。

## hooks 与误报

- Claude Code / Codex / Kimi 均装有 PreToolUse(拦副本命名、拦系统 tmp、引导到 `.tmp/`)与 Stop(收尾检查)hooks;git `pre-commit` / `commit-msg` 对所有 Agent 与人类兜底。hooks 是 guardrail——即使某家漏拦,本协议依然生效。
- 误报处理:把精确相对路径逐行加入 `.tidykeep/allowlist`。配置见 `.tidykeep/config.jsonc`(改后即时生效)。

## 深度工作流

初始化扫描 / 收尾同步 / 体检审计 的完整流程见 **`.tidykeep/docs/workflows.md`**。
Claude Code 与 Kimi 有同名技能自动触发;Codex 在被要求执行这类任务时,先完整阅读该文件再照做。
<!-- tidykeep:end -->
