# tidykeep

让项目只保留当前有效的代码、文档和设计。支持 Claude Code、Codex、Kimi Code，
要求 Node.js >= 20.11，运行时零第三方依赖。

**tidykeep 是协议分发器，不是执行器。** 它把两个 skill 和一份规则块铺进你的项目，
之后靠 Agent 遵守约定。它**不安装任何 hook，不拦截任何操作，没有强制力**——
规则被违反时由人或 code review 发现，不要指望工具兜底。

## 安装

当前尚未发布到 npm registry，请从源码安装：

```bash
git clone https://github.com/NUDTSECURITY/tidykeep.git
node /absolute/path/to/tidykeep/bin/tidykeep.mjs init /path/to/project
```

发布后可改用：

```bash
npx tidykeep init /path/to/project
```

先看会发生什么：

```bash
node /absolute/path/to/tidykeep/bin/tidykeep.mjs init /path/to/project --dry-run
```

独立目录可安装；若目录属于 Git 仓库，目标必须是主 worktree 根。

## 装了什么

| 路径 | 内容 |
|---|---|
| `.claude/skills/{tidykeep,sdlc,blind-test}/` | 三个 skill，供 Claude Code 与 Kimi Code 发现 |
| `.agents/skills/{tidykeep,sdlc,blind-test}/` | 同上，供 Codex 与 Kimi Code 发现 |
| `AGENTS.md` | tidykeep 协议块（标记块内） |
| `CLAUDE.md` | `@AGENTS.md` 指针（标记块内） |
| `.gitignore` | `.tmp/` 草稿区（标记块内） |
| `STATE.md` | 知识文件模板，**仅当不存在时创建，永不覆盖** |

只铺 `.claude/skills/` 和 `.agents/skills/` 两处就覆盖三家：Codex 只扫 `.agents/skills`，
Claude Code 读 `.claude/skills`，Kimi Code 两处都读。

## 三个 skill

**`tidykeep`** —— 知识与规范收尾。六个事实面（代码、运行态、文档、规则、记忆、工作区）
各自标明状态，不允许把未验证写成完成；权限分四档，检查深度可扩大但操作权限不扩大；
轻量路径服务个人项目，完整路径服务有发布流程的项目。触发词：`tidykeep`、`洁癖`、
初始化、收尾、体检审计，或「把文档和记忆整理一下」这类意图。

**`sdlc`** —— 需求澄清 → 价值评估 → 方案设计 → PRD → 开发 → 质量验证 → 修复回归 →
文档维护，八阶段强制按序推进。它只管技术文档本身，项目级知识收尾仍归 tidykeep。

**`blind-test`** —— 让测试真的能证伪。同一个模型先写实现再写测试时，测试会退化成把实现
抄一遍：实现里把 `<=` 写成 `<`，测试的边界值也跟着挑那个不会暴露差异的。这不是态度问题，
是共享上下文的结构问题。它要求契约先行、测试作者与实现者上下文隔离（靠工具权限而非提示词）、
**每条测试绑定一条里程碑验收条款**（没有条款就没有测试，一条条款最多一个测试），
最后用变异检查机械证明测试能挂——存活的变异就是假测试。触发词：`blind-test`、盲测、
测试写得太假、补测试、精简测试用例。

## 重复安装

再次运行 `init` 即升级：

- 我们发布的 skill 文件直接覆盖；`STATE.md` 与标记块外的一切内容原样保留；
- 标记块孤立或逆序（用户误删、merge 冲突）时**整体拒绝**并返回非零，绝不吞掉夹在
  标记之间的内容——请先手工修好标记再重跑；
- 内容未变时不写盘，重跑输出「无变化」。

## 卸载

```bash
node /absolute/path/to/tidykeep/bin/tidykeep.mjs uninstall /path/to/project
```

只删能证明是自己发布的东西：skill 文件内容需精确等于当前版本，标记块需严格配对。
任何一项无法证明所有权就保守保留并返回非零。`STATE.md` **始终保留**——它是你的知识，
不是我们的安装物。

## 工作方式

- `AGENTS.md`：统一规则入口，Claude Code 通过 `CLAUDE.md` 的 `@AGENTS.md` 导入；
- `STATE.md`：当前设计的唯一真相 + 决策记录 + 已废弃墓地；
- `.tmp/`：项目内一次性脚本目录，用完即删，禁止写系统 `/tmp`；
- 变更简史不单独立账——它在 `git log` 里，那里更准也不会腐烂。

Agent 的工作边界到本地 commit；push、tag 和 publish 由人决定。

## 从 0.1.0 之前的版本升级

**存在断层。** 旧版本会在项目里安装 `.tidykeep/`（vendored runtime、githooks、
config.jsonc、allowlist）、三家 native hooks 配置、`~/.kimi-code/config.toml`
全局块，以及 `LEDGER.md`。新版本**不认识这些资产**，直接装新版会留下孤儿文件。

正确顺序：先用**旧版本**的 `uninstall` 卸干净（必要时加 `--purge`），确认
`.tidykeep/` 已消失、`git config core.hooksPath` 已 unset、Kimi 全局块已移除，
再安装新版本。`LEDGER.md` 不会被自动迁移——其中仍有效的待办请手工并入 `STATE.md`。

## License

MIT
