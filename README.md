# tidykeep — AI 编码的旧知识 / 旧代码 / 旧文档管理工具

解决用 Claude Code、Codex、Kimi 等 Agent 开发时的四个老毛病:

1. 改个参数就复制一个 `xxx_v2.py`,旧版本一直留着干扰后续开发;
2. 每个 Agent 一套规则文件(CLAUDE.md / AGENTS.md / Kimi 全局),互相不同步;
3. 设计早就变了,文档还停留在旧方案,没人负责更新;
4. 验证脚本随手丢进系统 `/tmp` 或 `~/.tmp`,用完不删,散落在项目之外无人管理。

## 设计

```
                ┌───────────────  唯一规则入口  ────────────────┐
Codex ──────────┤                                               │
Kimi Code ──────┤   AGENTS.md(tidykeep 协议,唯一维护点)       │
Claude Code ────┤   CLAUDE.md ──@import──▶ AGENTS.md(纯指针)  │
                └───────────────────────────────────────────────┘
                                │ 协议要求维护
                ┌───────────────▼───────────────┐
                │ STATE.md   当前设计唯一真相     │  决策记录(ADR-lite) + 已废弃墓地
                │ LEDGER.md  每个文件 TODO/DONE  │  每次任务收尾必须更新
                └───────────────┬───────────────┘
                                │ 硬约束(两层)
        ┌───────────────────────┴───────────────────────────────┐
        │ 各家 native hooks(PreToolUse 拦副本命名/拦系统 tmp;  │
        │                    Stop 收尾检查台账与 .tmp/ 残留)    │
        │   Claude Code → .claude/settings.json                  │
        │   Codex       → .codex/hooks.json(随仓库分发)        │
        │   Kimi Code   → ~/.kimi-code/config.toml(全局,经     │
        │                 ~/.tidykeep/kimi-shim.mjs 按项目路由)  │
        │ git hooks(对所有 Agent 与人类兜底)                   │
        │   pre-commit: 垃圾命名拦截 + 台账同步检查              │
        │   commit-msg: 强制"做了什么/为什么/影响"的详细提交     │
        └────────────────────────────────────────────────────────┘
```

**为什么选 AGENTS.md 做唯一入口**(以下均经官方文档核实,2026-08):
[AGENTS.md](https://agents.md/) 是 Linux Foundation 旗下 Agentic AI Foundation 托管的公开标准;
Codex 与 Kimi Code 原生读取项目根的 AGENTS.md;Claude Code 只读 CLAUDE.md,
但官方推荐用一行 `@AGENTS.md` 导入,正是本工具的做法。
**hooks 是 guardrail 而非安全边界**(Codex 官方原话),所以 git hooks 兜底层永远保留。

## 安装 / 卸载(需要 Node.js ≥ 20.11)

```bash
npx tidykeep init                    # 安装到当前项目(幂等,重跑即升级)
npx tidykeep init /path/to/project   # 指定目标项目
npx tidykeep init --agents claude,codex   # 只装部分 agent(默认三家全装)
npx tidykeep init --ledger-mode warn      # 台账检查降级为仅提醒(block|warn|off)
npx tidykeep init --no-git-hooks          # 不接管 git hooks

npx tidykeep status                  # 安装状态速览(--json 机器可读)
npx tidykeep doctor --fix            # 深度体检并修复执行位/EOL 等安全项

npx tidykeep uninstall               # 卸载:标记块精确回滚,保留 STATE/LEDGER
npx tidykeep uninstall --purge       # 连 STATE.md / LEDGER.md 一并移除
```

所有注入内容都包在 `<!-- tidykeep:begin/end -->`(或 `# >>> tidykeep >>>`)标记块里,
卸载只移除标记块,不碰你自己的内容;已有的 `.claude/settings.json`、`.codex/hooks.json`、
Kimi `config.toml` 修改前都会先备份(`.tidykeep/backup/`、`~/.tidykeep/backup/`)。

## 安装后的项目结构

```
project/
├── AGENTS.md            # 唯一规则入口(注入 tidykeep 协议块,≤3KiB)
├── CLAUDE.md            # 指针: @AGENTS.md
├── STATE.md             # 当前设计唯一真相 + 决策记录 + 墓地
├── LEDGER.md            # 每个文件的 TODO/DONE 台账
├── .tmp/                # 临时/验证脚本专用(已 gitignore;收尾检查残留)
├── .claude/             # settings.json(hooks)+ skills/tidykeep/
├── .codex/hooks.json    # Codex hooks(随仓库分发)
├── .agents/skills/      # Kimi 读取的项目级技能
└── .tidykeep/
    ├── config.jsonc     # 配置(JSONC,改后即时生效)
    ├── allowlist        # 误报免检清单
    ├── runtime/         # vendored Node 运行时(离线、零依赖、可入库、可审计)
    ├── githooks/        # pre-commit / commit-msg 薄壳(sh → node)
    └── docs/workflows.md# 初始化扫描/收尾同步/体检审计 的完整工作流(单一真源)
```

## 日常使用

**第一次(必做)**:让 Agent 执行初始化扫描——Claude Code / Kimi 直接说"tidykeep 初始化扫描";
Codex 说"按照 AGENTS.md 的 tidykeep 协议执行初始化扫描"。它会填充 STATE.md、为存量文件建台账,
并清点出历史副本/死文件/过期文档的待处理清单,等你确认后清理。

**每次任务**:正常干活即可。协议 + hooks 会保证 Agent 开工前读 STATE/LEDGER、收尾时更新台账并写
详细 commit;想复制 `xxx_v2.py` 会被当场拦下;想把验证脚本写进系统 `/tmp`、`~/.tmp` 也会被拦下
并引导到项目内 `.tmp/`(收尾时检查残留,要求删除或说明)。

**定期**:说"tidykeep 体检审计",产出死文件/重复实现/文档漂移/台账过期的证据清单,
逐项确认后执行清理,删除项自动登记进 STATE.md 墓地。

**团队协作**:把 AGENTS.md、CLAUDE.md、STATE.md、LEDGER.md、`.tidykeep/`、`.claude/`、`.codex/`、
`.agents/` 提交入库;成员克隆后执行一次 `node .tidykeep/runtime/enable-githooks.mjs`
(`core.hooksPath` 是本地 git 配置,不随仓库同步;此命令离线可用)。
Kimi 用户各自跑一次 `npx tidykeep init`(Kimi hooks 在用户全局配置)。

## 配置(.tidykeep/config.jsonc,改后即时生效)

| 键 | 说明 | 默认 |
|---|---|---|
| `GUARD` | 命名拦截开关 | true |
| `ENFORCE_LEDGER` | 台账同步强制等级 block/warn/off | "block" |
| `CODE_EXTS` / `DOC_EXTS` | 视为"需同步台账"的扩展名数组 | 常见语言 / md 等 |
| `STALE_RE` | 历史副本命名正则(JS RegExp) | `_v2/_old/_final/copy/副本…` |
| `SCRATCH_DIR` | 项目内草稿区目录名 | ".tmp" |
| `FORBID_SYSTEM_TMP` | 禁止在系统 /tmp、~/tmp、~/.tmp、$TMPDIR、%TEMP% 落盘 | true |
| `CHECK_TMP_LEFTOVER` | 收尾时检查草稿区残留文件 | true |
| `MIN_SUBJECT` / `MIN_BODY` | commit 主题/正文最小字符数 | 10 / 20 |

误报处理:把精确相对路径逐行加入 `.tidykeep/allowlist`。
临时绕过提交检查:`TIDYKEEP_SKIP=1 git commit ...`(协议要求向协作者说明原因)。

## 三家 Agent 的接入方式(官方文档依据)

| Agent | 规则入口 | hooks 配置 | 依据 |
|---|---|---|---|
| Claude Code | CLAUDE.md `@AGENTS.md` 导入 | `.claude/settings.json`(PreToolUse: `Write\|Edit\|NotebookEdit` + `Bash\|PowerShell`;Stop) | [memory](https://code.claude.com/docs/en/memory)、[hooks](https://code.claude.com/docs/en/hooks) |
| Codex | 原生读 AGENTS.md(全局→根→cwd 拼接,32KiB 预算) | 项目级 `.codex/hooks.json`(PreToolUse 拦 `apply_patch`/`Bash`;Stop) | [agents-md](https://developers.openai.com/codex/guides/agents-md)、[hooks](https://developers.openai.com/codex/hooks) |
| Kimi Code | 原生读 AGENTS.md;技能在 `.agents/skills/` | 用户全局 `~/.kimi-code/config.toml` `[[hooks]]`(经 shim 按项目路由;未启用项目零影响) | [hooks](https://moonshotai.github.io/kimi-code/en/customization/hooks.html)、[data-locations](https://moonshotai.github.io/kimi-code/en/configuration/data-locations.html) |

## FAQ

**为什么临时脚本放项目内 `.tmp/` 而不是系统 `/tmp`?** 系统 /tmp 里的残留脚本不可见、无人清理、
也进不了任何审计流程;项目内 `.tmp/` 已 gitignore(不污染仓库),但对 Stop hook、体检审计和你
自己都可见——残留会被点名要求删除或说明。

**hooks 拦不住怎么办?** 三家官方都把 hooks 定位为 guardrail(Kimi 明确 fail-open、Codex 明确
"模型可写脚本绕过")。所以真正的硬边界是 git hooks:垃圾命名和未同步台账在 commit 时被二次拦截,
对人类同样生效。

**Kimi 为什么要动全局配置?** 官方仅支持在 `~/.kimi-code/config.toml` 配 hooks(项目级 local.toml
只支持 `[workspace]`,核实于 2026-08)。tidykeep 用标记块注入、shim 路由:事件来自未启用项目时
立即放行,卸载按引用计数,最后一个项目卸载时全局块自动移除。

**已用 husky / 已设 core.hooksPath?** 安装器不会覆盖,会打印两行接入代码,把 tidykeep 的检查
链进你现有 hooks。接管前 `.git/hooks/` 里已有的同名 hook 会被链式执行。

**Stop hook 会不会死循环?** 不会:识别官方 `stop_hook_active` 标志,且同一会话最多强制一次
(标记存放于项目内 `.tidykeep/.state/`,不落系统 tmp;Claude 另有连续 block 上限 8 次的官方硬顶)。

**Windows?** 安装器与 hooks 全部为 Node 实现;git hooks 薄壳由 Git for Windows 自带的 sh 执行
(husky 同款机制),`.gitattributes` 已注入 `eol=lf` 护栏防止 CRLF 污染。异常时 `npx tidykeep doctor --fix`。

**旧 bash 版(install.sh)装过的项目?** 直接 `npx tidykeep init`:自动迁移配置值、替换 python
hooks 与 settings.json 里的 python3 条目、转换安装清单,旧文件删除(历史在 git)。

## 实机验证清单(发布前逐项打钩)

以下行为已按官方文档实现并通过自动化测试,但部分细节官方未记载,需在真实 agent 里验证:

- [ ] Codex:`.codex/hooks.json` 相对路径 command 的进程 cwd;`apply_patch` 的 `tool_input` 实际形状;deny reason 回传完整度;项目级 hooks 首次生效有无信任确认。
- [ ] Kimi:PreToolUse 附加字段确切名称(现为防御式解析);deny 经 exit 2 与 stdout JSON 哪个通道回传更完整;Stop 的输入字段;无 matcher 全量触发的性能观感。
- [ ] Windows:Claude Code `PowerShell` 工具的 `tool_input` 字段名;GUI git 客户端 PATH 中 node 可见性。

## License

MIT
