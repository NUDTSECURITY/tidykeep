# 文件台账(LEDGER)

> 由 tidykeep 协议维护。每个受管的代码文件与文档文件各占一节。
> **每次任务收尾必须更新**:完成项从 TODO 移入 DONE(附日期),新待办登记进 TODO,刷新"最后核对"。
> 条目格式请勿更改(hooks 与审计流程依赖它)。删除文件时,整节移除并在 STATE.md 墓地登记。

## 使用规则

- 一个文件一节,标题格式:`## <相对路径>`。
- `最后核对` 表示"该条目最近一次与文件实际状态对齐"的日期。
- DONE 只增不删(它就是这个文件的变更简史)。

---

## bin/tidykeep.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 CLI 入口:init/uninstall/status/doctor/enable-githooks 分发,parseArgs 零依赖

## src/commands/init.mjs

- 最后核对: 2026-08-12
- TODO:
  - [ ] dry-run 目前只打印概要,可细化为逐动作清单
- DONE:
  - [x] 2026-08-12 幂等安装器:机器区刷新/用户区保留/标记块 upsert;旧 bash 版迁移
  - [x] 2026-08-12 审查修复:unpaired 拒改写、CRLF 归一、SCRATCH_DIR 不被重跑重置、备份纯净性

## src/commands/uninstall.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 按 manifest 精确回滚;created+剥空才删文件
  - [x] 2026-08-12 审查修复:问题文件备份搬项目根保留、悬空 hooksPath 自愈、git 缺失不崩溃

## src/commands/status.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 只读体检:注入点/版本/hooksPath/Kimi 全局块,--json 机器可读

## src/commands/doctor.mjs

- 最后核对: 2026-08-12
- TODO:
  - [ ] 增加 AGENTS.md 逼近 32KiB 预算时的分级告警(现为单阈值 28KiB)
- DONE:
  - [x] 2026-08-12 深度体检:执行位/EOL/hooks 条目/runtime 探针/预算;--fix 修安全项且权限失败如实报告

## src/lib/markers.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 标记块 upsert/strip,EOL 感知;修初稿重复安装累积空行 bug
  - [x] 2026-08-12 审查修复(critical):严格配对——孤立/逆序拒绝改写,merge 重复块归并/全剥

## src/lib/settings-json.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 Claude/Codex hooks JSON 合并/剥离,先全剥再注入(幂等+python3 条目迁移)

## src/lib/manifest.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 安装清单 v2 + 旧文本清单迁移;审查修复:created 可刷新过期 modified 记录

## src/lib/jsonc.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 解析复用 runtime core;replaceJsoncValue 行级回写(注释零损失,支持数组)

## src/lib/kimi.mjs

- 最后核对: 2026-08-12
- TODO:
  - [ ] 跟踪 Kimi changelog:local.toml 若开放 hooks 则迁回项目级注入
- DONE:
  - [x] 2026-08-12 全局 config.toml 标记块 + shim 分发
  - [x] 2026-08-12 审查修复:realpath+大小写归一键、projects.d/ 原子引用计数(取代 manifest.json 无锁读写)

## src/lib/blocks.mjs

- 最后核对: 2026-08-12
- TODO:
  - [ ] 实机验证 Windows 下 Codex command 的 $(git rev-parse) 解析,必要时加平台覆盖
- DONE:
  - [x] 2026-08-12 全部注入内容单一来源;审查修复:Codex 命令改 git 根绝对解析(官方 cwd=会话目录)

## payload/runtime/core.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 检查逻辑唯一真源,行为对齐 python 基线(heredoc/mktemp/台账矩阵/码点计数)
  - [x] 2026-08-12 审查修复:here-string 按 shell 门控、方向敏感扫描、尾随换行防绕过、POSIX 大小写、UNC、~user、status -uall -z、scissors 截断、超长 session id 摘要
  - [x] 2026-08-12 新增 AUTO_COMMIT 配置键与 newDoneItemsFromDiff / buildAutoCommitMessage(自动提交信息生成,满足自身 commit-msg 规范)

## payload/runtime/hook.mjs

- 最后核对: 2026-08-12
- TODO:
  - [ ] 实机验证 Kimi PreToolUse 字段名后收紧防御式解析;Codex deny reason 回传完整度
- DONE:
  - [x] 2026-08-12 三家统一入口,异常一律放行(guardrail 契约)
  - [x] 2026-08-12 审查修复:写入工具名正向门控(只读工具放行)、Stop 标记写失败降级 warn、Codex warn 用 systemMessage
  - [x] 2026-08-12 AUTO_COMMIT 三档:Stop 时"有改动且台账已同步"触发 remind 打回/auto 直接提交(信息取 LEDGER 新增 DONE,失败原因喂回 agent)

## payload/runtime/githook.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 git 兜底层业务逻辑;审查修复:暂存路径 -z(修非 ASCII 文件名绕过)

## payload/runtime/enable-githooks.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 团队成员一次性启用;husky 共存打印链式接入指引

## payload/runtime/kimi-shim.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 用户级路由:未启用项目 exit 0;审查修复:只转发 0/2 退出码,不泄堆栈

## payload/runtime/messages.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 全部拦截文案单一来源,每条含行动指令(改原文件/放 .tmp//加 allowlist)

## payload/githooks/pre-commit

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 sh 薄壳:TIDYKEEP_SKIP 豁免、legacy 链式、node 缺失 fail-open

## payload/githooks/commit-msg

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 sh 薄壳,同上

## payload/rules.md

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 AGENTS.md 协议块(≤3KiB 守 Codex/Kimi 32KiB 预算),任务循环+Commit 规范+指路行

## payload/docs/workflows.md

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 三工作流(初始化扫描/收尾同步/体检审计)单一真源

## payload/skill/SKILL.md

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 Claude/Kimi 共用薄指针技能(指向 workflows.md,防多份漂移)

## payload/STATE.md

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 目标项目的 STATE 模板(日期占位符化)

## payload/LEDGER.md

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 目标项目的 LEDGER 模板

## test/lib/markers.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 标记块行为向量(对齐初稿 python)+ 不成对/逆序/重复块回归

## test/lib/jsonc.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 注释/尾逗号/字符串内保护/行级回写

## test/lib/settings-json.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 合并/剥离/幂等/python3 迁移/解析失败跳过

## test/lib/manifest.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 first-wins + created 刷新 + 旧文本清单迁移

## test/runtime/core.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 核心逻辑表驱动单测(35 项,含两轮审查回归)

## test/runtime/hook-e2e.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 三家适配器子进程 e2e(deny/allow/stop/防死循环/shim 损坏静默)

## test/runtime/githook-e2e.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 真实 git commit e2e(拦截/豁免/链式/quotepath/scissors)

## test/cli/init-e2e.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 init 幂等/uninstall 回滚/迁移/Kimi 引用计数与 symlink/备份保留/不成对保护

## test/cli/doctor-e2e.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 体检通过/检出并 --fix/未安装报告

## README.md

- 最后核对: 2026-08-12
- TODO:
  - [ ] npm publish 后:补安装徽章与 registry 链接,删除"尚未发布"提示行
  - [ ] 实机验证 Codex:apply_patch tool_input 实际形状、deny reason 回传完整度、项目级 hooks 首次信任确认、Windows 下 $(git rev-parse) 解析
  - [ ] 实机验证 Kimi:PreToolUse 字段确切名称(验证后收紧防御式解析并加 matcher)、deny 双通道哪个回传更完整、Stop 输入字段
  - [ ] 实机验证 Windows:PowerShell 工具 tool_input 字段名、GUI git 客户端 PATH 中 node 可见性
- DONE:
  - [x] 2026-08-12 按官方核查结论重写(修正初稿 Kimi 两处错误断言),单一来源
  - [x] 2026-08-12 体检审计(用户指出):维护者向"发布前 TODO 清单"移出 README 改为"已知边界"表述,可执行待办迁入本台账;补"未发布前从源码调用"说明

## AGENTS.md

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 自装生成(tidykeep 协议块)
