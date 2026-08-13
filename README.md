# tidykeep

让项目只保留当前有效的代码、文档和设计。适用于同时使用 Claude Code、Codex、Kimi Code 的团队。

tidykeep 维护五件事：

- `AGENTS.md`：所有 Agent 的统一规则入口；
- `STATE.md`：当前设计、决策和已废弃内容；
- `LEDGER.md`：受管文件的 TODO、DONE 与最后核对日期；
- native hooks / git hooks：在写入、收尾和提交时检查流程；
- 项目内草稿区 `.tmp/`：集中存放一次性脚本，用完删除。

这些 hooks 是开发流程 guardrail，不是操作系统级隔离或安全边界。

## 安装

要求 Node.js >= 20.11，运行时零第三方依赖。

当前尚未发布到 npm registry。克隆本仓库后先从源码调用：

```bash
TK=/absolute/path/to/tidykeep/bin/tidykeep.mjs
node "$TK" init /path/to/project
```

发布后可将 `node "$TK"` 换成 `npx tidykeep`。

```bash
# 安装或升级；默认接入 Claude、Codex、Kimi 和 git hooks
node "$TK" init [dir]

# 常用选项
node "$TK" init --agents claude,codex
node "$TK" init --ledger-mode block   # block | warn | off
node "$TK" init --scratch-dir .tmp
node "$TK" init --no-git-hooks
node "$TK" init --dry-run

# 检查
node "$TK" status [dir] [--json]
node "$TK" doctor [dir] [--fix]

# 卸载
node "$TK" uninstall [dir]
node "$TK" uninstall [dir] --purge
```

默认卸载会保留 `STATE.md`、`LEDGER.md` 和草稿目录。`--purge` 只删除安装清单中记录为 tidykeep 创建的 `STATE.md`、`LEDGER.md`，不会删除接入前已有的同名文件。

## 日常工作流

1. 安装后让 Agent 执行“tidykeep 初始化扫描”，建立当前设计与文件台账。
2. 每次开工前读取 `STATE.md` 和相关 `LEDGER.md` 条目。
3. 收尾时同步台账；设计、架构或接口变化时同步 `STATE.md`。
4. 定期执行“tidykeep 体检审计”，确认后再清理死文件、重复实现和过期文档。

发布或交付前必须先完成体检审计。Agent 的工作边界到本地 commit；push、tag 和 publish 由人决定。

## 配置

配置文件是 `.tidykeep/config.jsonc`，支持注释和尾逗号。

| 配置 | 作用 | 默认值 |
|---|---|---|
| `GUARD` | 检查 `_v2`、`_old`、`copy`、`副本` 等历史副本命名 | `true` |
| `ENFORCE_LEDGER` | 台账检查等级：`block` / `warn` / `off` | `"block"` |
| `CODE_EXTS` / `DOC_EXTS` | 需要同步台账的文件扩展名 | 常用代码与文档类型 |
| `STALE_RE` | 历史副本命名正则 | 内置规则 |
| `SCRATCH_DIR` | 项目内草稿目录 | `".tmp"` |
| `FORBID_SYSTEM_TMP` / `CHECK_TMP_LEFTOVER` | 系统临时目录写入与草稿残留检查 | `true` |
| `MIN_SUBJECT` / `MIN_BODY` | commit 主题与正文最小字符数 | `10` / `20` |
| `AUTO_COMMIT` | `off` / `remind` / `auto` | `"off"` |

推荐使用 `AUTO_COMMIT=off` 或 `remind`。`auto` 会执行 `git add -A` 并提交当前整个工作区，只适合没有无关改动的隔离任务。

误报时，将精确相对路径逐行加入 `.tidykeep/allowlist`。必要时可用 `TIDYKEEP_SKIP=1 git commit ...` 跳过 tidykeep 的提交检查，并向协作者说明原因。

## 团队与 Agent 接入

| Agent | 规则入口 | hooks 位置 |
|---|---|---|
| Claude Code | `CLAUDE.md` 导入 `AGENTS.md` | `.claude/settings.json` |
| Codex | 原生读取 `AGENTS.md` | `.codex/hooks.json` |
| Kimi Code | 原生读取 `AGENTS.md`，技能在 `.agents/skills/` | 用户级 `~/.kimi-code/config.toml`，经 shim 按项目路由 |

将知识文件、`.tidykeep/` 和已启用 Agent 的配置目录提交入库。团队成员克隆后运行一次：

```bash
node .tidykeep/runtime/enable-githooks.mjs
```

Kimi 用户还需各自运行一次 `init`。如果项目已有 husky 或其他 `core.hooksPath`，安装器不会覆盖，而会输出链式接入指引。

## 已知边界

- native hooks 依赖各 Agent 提供的事件与参数；无法识别的工具会放行。
- git hooks 可被 `TIDYKEEP_SKIP` 显式跳过；找不到 Node 或内部检查异常时会告警并放行。
- Codex 的 `apply_patch` 输入、Kimi 的事件字段以及 Windows 命令解析仍需更多实机验证。
- Windows git hooks 依赖 Git for Windows 的 `sh`，并要求 Git 进程的 `PATH` 能找到 Node。
- 标记块不成对时不会自动改写，需要人工修复；接入前也应确认没有同名自定义 tidykeep skill。

## License

MIT
