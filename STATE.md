# 项目状态(当前设计的唯一真相)

> 由 tidykeep 协议维护。任何 Agent 开工前必读本文件。
> 本文件只描述"**现在**"——历史在 git 与下方决策记录里,废弃方案在墓地里。

## 当前架构与设计

本仓库是 **tidykeep** 本身:跨 Agent(Claude Code / Codex / Kimi Code)的项目知识保鲜工具,
以 npm 包发布(`npx tidykeep init` 一键装、`uninstall` 一键卸),零第三方依赖,Node ≥ 20.11。

- `bin/tidykeep.mjs`:CLI 入口(parseArgs 分发到 init / uninstall / status / doctor / enable-githooks)。
- `src/commands/`:各命令实现;`src/lib/`:安装器共用库——markers(标记块严格配对 upsert/strip)、
  settings-json(Claude/Codex hooks JSON 合并剥离)、manifest(安装清单 v2,first-wins+created 刷新)、
  jsonc(注释保留回写)、kimi(全局 TOML 标记块 + `~/.tidykeep/projects.d/` 原子引用计数)、blocks(注入内容单一来源)。
- `payload/`:安装到目标项目的模板与 **vendored runtime**(`.tidykeep/runtime/*.mjs`,离线零依赖):
  `core.mjs` 是全部检查逻辑的唯一真源,`hook.mjs <flavor>` 是三家 agent 的统一入口,
  `githook.mjs` 是 git 兜底层,`kimi-shim.mjs` 是用户级路由。
- 强制层分两级:各家 native hooks(PreToolUse 拦历史副本命名/系统 tmp 落盘,Stop 收尾检查台账与
  `.tmp/` 残留)是 guardrail;git pre-commit / commit-msg 是对所有 Agent 与人类的硬边界。
- 规则入口:AGENTS.md(唯一维护点)← CLAUDE.md 一行 `@AGENTS.md` 指针;深度工作流单一真源在
  `.tidykeep/docs/workflows.md`,Claude(`.claude/skills/`)与 Kimi(`.agents/skills/`)技能均为薄指针。
- 测试:`node --test`,115 项(单测 + 子进程 e2e + 真实 git commit e2e),所有行为变更必须先有失败测试。
- 本仓库已自装 tidykeep(狗粮):本文件与 LEDGER.md 即其产物,提交受自身 git hooks 约束。

## 设计决策记录(ADR-lite)

| 编号 | 日期 | 决策 | 状态 |
|---|---|---|---|
| D-001 | 2026-08-12 | 发布形态:npm 包 + npx,全 Node 重写,零第三方运行时依赖(取代 bash+python3 初稿) | active |
| D-002 | 2026-08-12 | 覆盖 Claude Code + Codex + Kimi Code 三家 native hooks;不做 Gemini;git hooks 永远保留为兜底硬边界 | active |
| D-003 | 2026-08-12 | hook 运行时 vendor 进目标项目 `.tidykeep/runtime/`(可入库、离线、版本随项目),npm 包只做安装/升级 | active |
| D-004 | 2026-08-12 | Kimi hooks 写用户全局 `~/.kimi-code/config.toml` 标记块(官方 local.toml 不支持 hooks),shim 按项目路由,projects.d/ 原子引用计数卸载 | active |
| D-005 | 2026-08-12 | 配置用 JSONC(`.tidykeep/config.jsonc`),程序回写走行级替换保注释;STALE_RE 统一 JS RegExp 单一方言 | active |
| D-006 | 2026-08-12 | 标记块操作严格配对:孤立/逆序标记一律拒绝改写(宁可要求手工修复,不静默吞用户内容) | active |
| D-007 | 2026-08-12 | 所有涉及三家 agent 能力的结论必须现场核实官方文档(研究员+逐字引用审计双层),不信二手信息 | active |
| D-008 | 2026-08-12 | AUTO_COMMIT 三档(off/remind/auto),默认 off;"功能完成"的判定不交给大模型,用确定性信号"有改动且台账已同步";推荐 remind(提交信息由 agent/人写) | active |
| D-009 | 2026-08-12 | 对外动作边界写入协议:agent 到 commit 为止,push/publish/tag 由人决定;发布/交付前强制先跑体检审计;硬拦截 pre-push hook 暂不做(git 分不清人与 agent,摩擦大),协议层不够时再加 | active |

## 墓地(已废弃/已删除,禁止复活)

Agent 不得参考、不得重新实现下表中的内容。

| 日期 | 删除/废弃了什么 | 原因 | 取代者 |
|---|---|---|---|
| 2026-08-12 | bash+python3 初稿(install.sh、uninstall.sh、payload/hooks/*.py、payload/githooks 旧版、双份 README) | 官方核查证明其关键假设过时(Codex/Kimi 已有官方 hooks、Kimi 换代且全局文件路径与覆盖语义两处断言错误);且 bash+python3 不满足 npx 跨平台分发 | Node 全量重写(D-001),历史在基线提交 969b038 |
| 2026-08-12 | Kimi 引用计数的 manifest.json 单文件读-改-写方案 | 无锁并发丢注册;路径未 realpath 归一导致 symlink/大小写残留 | `~/.tidykeep/projects.d/` 每项目一个原子标记文件 + realpath 键(D-004) |
| 2026-08-12 | Codex hooks 相对路径 command(`node .tidykeep/...`) | 官方明确 hook cwd 是会话目录而非仓库根,子目录会话中守卫静默失效 | `node "$(git rev-parse --show-toplevel)/..."`(官方推荐形式) |
