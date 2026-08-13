# tidykeep

让项目只保留当前有效的代码、文档和设计。支持 Claude Code、Codex、Kimi Code，要求 Node.js >= 20.11，运行时零第三方依赖。

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

默认接入三家 Agent 和 git hooks。按需指定：

```bash
node /absolute/path/to/tidykeep/bin/tidykeep.mjs init /path/to/project \
  --agents claude,codex --ledger-mode block --scratch-dir .tmp
```

`--agents` 是增量接入，不会移除项目已有的 Agent 集成。
独立目录可安装；若目录属于 Git 仓库，目标必须是主 worktree 根。

## 重复安装

再次运行 `init` 即升级：

- 完整预检后幂等升级；保留配置、知识文件和标记块外内容，`--agents` 只增不减；
- 受管文件被修改、标记不成对或接入冲突时返回非零，不静默覆盖；
- 中断后会验证并丢弃旧 staging，再按现场重规划，绝不回放项目内 journal；
- 项目文件先提交，Kimi/Git 接线随后完成；接线失败时项目层保留，修复后重跑即可；
- 若崩溃留下锁，确认报错所示进程已退出后，手工删除该精确锁目录再重跑。

## 常用命令

```bash
node /absolute/path/to/tidykeep/bin/tidykeep.mjs status /path/to/project
node /absolute/path/to/tidykeep/bin/tidykeep.mjs doctor /path/to/project
node /absolute/path/to/tidykeep/bin/tidykeep.mjs doctor /path/to/project --fix
node /absolute/path/to/tidykeep/bin/tidykeep.mjs uninstall /path/to/project
```

`uninstall` 保留 `STATE.md`、`LEDGER.md`、项目配置、allowlist、草稿和既有备份。`--purge` 仅删除内容仍精确等于当前内置模板的 `STATE.md`、`LEDGER.md`；其余保留并返回非零。

团队成员克隆已接入的项目后运行：

```bash
node .tidykeep/runtime/enable-githooks.mjs
```

## 工作方式

- `AGENTS.md`：统一规则入口；
- `STATE.md`：当前设计、决策和废弃记录；
- `LEDGER.md`：每个受管文件的 TODO、DONE 和核对日期；
- native hooks：写入前执行确定性拦截；Stop 时汇总受管变更并自动触发 tidykeep Skill 做语义收尾；
- Skill：查看实际 diff，判断 STATE、文档和清理候选；候选文件不会被 Hook 自动删除；
- git hooks：提交前只验收文件名、逐文件台账和提交信息等可机械证明的结果；
- `.tmp/`：项目内一次性脚本目录，用完清理。

配置位于 `.tidykeep/config.jsonc`。误报时把精确相对路径加入 `.tidykeep/allowlist`。

这些 hooks 是流程 guardrail，不是安全沙箱。`TIDYKEEP_SKIP=1` 可显式跳过 tidykeep 提交检查，但不会跳过原有 hook。外部 `core.hooksPath` 须链入两类 hook；卸载前先移除外部接线并 unset。Kimi 全局路由需每位用户各自运行一次 `init`。

Agent 的工作边界到本地 commit；push、tag 和 publish 由人决定。

## License

MIT
