# tidykeep — AI 编码的旧知识 / 旧代码 / 旧文档管理插件

解决用 Claude Code、Codex、Kimi 等 Agent 开发时的四个老毛病：

1. 改个参数就复制一个 `xxx_v2.py`，旧版本一直留着干扰后续开发；
2. 每个 Agent 一套规则文件（CLAUDE.md / AGENTS.md / Kimi 全局），互相不同步；
3. 设计早就变了，文档还停留在旧方案，没人负责更新；
4. 验证脚本随手丢进系统 `/tmp` 或 `~/.tmp`，用完不删，散落在项目之外无人管理。

## 设计

```
                ┌───────────────  唯一规则入口  ───────────────┐
Codex ──────────┤                                              │
Kimi CLI ───────┤   AGENTS.md（tidykeep 协议，唯一维护点）      │
Claude Code ────┤   CLAUDE.md ──@import──▶ AGENTS.md（纯指针） │
Gemini(可选) ───┤   GEMINI.md ────指针───▶ AGENTS.md           │
                └──────────────────────────────────────────────┘
                               │ 协议要求维护
                ┌──────────────▼───────────────┐
                │ STATE.md   当前设计唯一真相    │  决策记录(ADR-lite) + 已废弃墓地
                │ LEDGER.md  每个文件 TODO/DONE │  每次任务收尾必须更新
                └──────────────┬───────────────┘
                               │ 硬约束（两层）
        ┌──────────────────────┴──────────────────────────┐
        │ Claude Code 原生 hooks                           │
        │   PreToolUse: 拦截 _v2/_old/copy/副本 等新建；    │
        │               拦截写入系统 /tmp → 重定向 .tmp/    │
        │   Stop: 台账未同步或 .tmp/ 有残留 → 阻止收工      │
        │ git hooks（对 Codex/Kimi/人类同样生效）            │
        │   pre-commit: 垃圾命名拦截 + 台账同步检查          │
        │   commit-msg: 强制“做了什么/为什么/影响”的详细提交 │
        └──────────────────────────────────────────────────┘
```

选 AGENTS.md 做唯一入口的原因：Codex 与 Kimi Code CLI 原生读取项目根目录的 AGENTS.md（Kimi 的项目级 AGENTS.md 会覆盖其全局 `~/.kimi/AGENTS.md`，因此无需改动全局文件）；Claude Code 不直接读 AGENTS.md，但 CLAUDE.md 支持 `@AGENTS.md` 导入语法，可做成一行指针。软规则约束所有 Agent，git hooks 提供与 Agent 无关的强制层，Claude Code 额外获得提交前更早的原生拦截。

## 安装 / 卸载

```bash
# 安装到当前项目（幂等，可重复执行升级）
bash /path/to/tidykeep/install.sh

# 常用选项
bash install.sh /path/to/project      # 指定目标项目
bash install.sh --gemini              # 同时生成 GEMINI.md 指针
bash install.sh --ledger-mode warn    # 台账检查降级为仅提醒（block|warn|off）
bash install.sh --no-git-hooks        # 不接管 git hooks

# 卸载（按安装清单精确回滚；默认保留 STATE.md / LEDGER.md 这类项目知识）
bash /path/to/tidykeep/uninstall.sh
bash uninstall.sh --purge             # 连本工具创建的 STATE/LEDGER 一并移除
```

依赖：bash + python3（git 仓库可选）。所有注入内容都包在
`<!-- tidykeep:begin/end -->` 标记块里，卸载只移除标记块，不碰你自己的内容；
已有的 `.claude/settings.json` 会先备份到 `.tidykeep/backup/` 再做合并。

## 安装后的项目结构

```
project/
├── AGENTS.md            # 唯一规则入口（注入 tidykeep 协议块）
├── CLAUDE.md            # 指针: @AGENTS.md
├── STATE.md             # 当前设计唯一真相 + 决策记录 + 墓地
├── LEDGER.md            # 每个文件的 TODO/DONE 台账
├── .tmp/                # 临时/验证脚本专用（已 gitignore；收尾检查残留）
├── .tidykeep/           # 配置、hooks、卸载清单（建议提交入库供团队共享）
└── .claude/
    ├── settings.json    # 合并了 tidykeep 的 PreToolUse / Stop hooks
    └── skills/tidykeep/ # 初始化扫描 / 收尾同步 / 体检审计 技能
```

## 日常使用

**第一次（必做）**：让 Agent 执行初始化扫描——Claude Code 直接说"tidykeep 初始化扫描"；
Codex/Kimi 说"按照 AGENTS.md 的 tidykeep 协议执行初始化扫描"。它会填充 STATE.md、
为存量文件建台账，并清点出历史副本/死文件/过期文档的待处理清单，等你确认后清理。

**每次任务**：正常干活即可。协议 + hooks 会保证 Agent 开工前读 STATE/LEDGER、
收尾时更新台账并写详细 commit；想复制 `xxx_v2.py` 会被当场拦下；想把验证脚本写进
系统 `/tmp`、`~/.tmp` 也会被拦下并引导到项目内 `.tmp/`（收尾时检查残留，要求删除或说明）。

**定期**：说"tidykeep 体检审计"，产出死文件 / 重复实现 / 文档漂移 / 台账过期的
证据清单，逐项确认后执行清理，删除项自动登记进 STATE.md 墓地。

**团队协作**：把 AGENTS.md、CLAUDE.md、STATE.md、LEDGER.md、`.tidykeep/`、`.claude/`
提交入库；成员克隆后执行一次 `bash .tidykeep/enable-githooks.sh`
（`core.hooksPath` 是本地 git 配置，不随仓库同步）。

## 配置（.tidykeep/config，改后即时生效）

| 键 | 说明 | 默认 |
|---|---|---|
| `GUARD` | 命名拦截开关 | on |
| `ENFORCE_LEDGER` | 台账同步强制等级 block/warn/off | block |
| `CODE_EXTS` / `DOC_EXTS` | 视为"需同步台账"的扩展名 | 常见语言 / md 等 |
| `STALE_ERE` | 历史副本命名正则（ERE） | `_v2/_old/_final/copy/副本…` |
| `SCRATCH_DIR` | 项目内草稿区目录名 | .tmp |
| `FORBID_SYSTEM_TMP` | 禁止在系统 /tmp、~/tmp、~/.tmp、$TMPDIR 落盘 | on |
| `CHECK_TMP_LEFTOVER` | 收尾时检查草稿区残留文件 | on |
| `MIN_SUBJECT` / `MIN_BODY` | commit 主题/正文最小字符数 | 10 / 20 |

误报处理：把精确相对路径逐行加入 `.tidykeep/allowlist`。
临时绕过提交检查：`TIDYKEEP_SKIP=1 git commit ...`（协议要求向协作者说明原因）。

## FAQ

**为什么临时脚本放项目内 `.tmp/` 而不是系统 `/tmp`？** 系统 /tmp 里的残留脚本不可见、
无人清理、也进不了任何审计流程；项目内 `.tmp/` 已 gitignore（不污染仓库），但对
Stop hook、体检审计和你自己都可见——残留会被点名要求删除或说明。

**旧版本（草稿区叫 scratch/）如何升级？** 编辑 `.tidykeep/config` 把 `SCRATCH_DIR`
改为 `".tmp"`，重跑一次 `install.sh`（.gitignore 标记块会随配置刷新），再
`mv scratch/* .tmp/ && rmdir scratch`。想沿用 scratch 这个名字也完全可以，改配置即可。

**已用 husky / 已设 core.hooksPath？** 安装器不会覆盖，会打印两行接入代码，
把 tidykeep 的检查链进你现有 hooks。

**Stop hook 会不会死循环？** 不会：识别 `stop_hook_active` 标志，且同一会话最多强制一次
（标记存放于系统临时目录）。

**Windows？** 在 Git Bash 环境可用；Claude Code hooks 依赖 `python3` 命令存在于 PATH。
若只有 `python`，把 `.claude/settings.json` 中两处 `"command": "python3"` 改为 `"python"`。

**Kimi 全局规则？** 项目级 AGENTS.md 已覆盖全局，通常无需改 `~/.kimi/AGENTS.md`；
若想全局生效，可自行把协议块追加过去。

**为什么不做成 Claude Code 原生 plugin？** 原生 plugin 只覆盖 Claude Code；
本工具的核心诉求是同时约束 Codex/Kimi，git 层 + AGENTS.md 才是公共分母。
如只用 Claude Code，`.tidykeep` 的 hooks 与技能同样可以按 plugin 结构重新打包。
