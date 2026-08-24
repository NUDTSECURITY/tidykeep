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

- 最后核对: 2026-08-24
- TODO:
- DONE:
  - [x] 2026-08-12 CLI 入口:init/uninstall/status/doctor/enable-githooks 分发,parseArgs 零依赖
  - [x] 2026-08-12 严格校验命令选项与目标路径,补齐 doctor/升级/卸载返回码语义
  - [x] 2026-08-12 裸 --help 正常返回,拒绝命令与 --version 混用及多余位置参数
  - [x] 2026-08-24 头部注释补回 doctor 子命令,与 HELP 文本和实际分发保持一致

## src/commands/init.mjs

- 最后核对: 2026-08-12
- TODO:
  - [ ] dry-run 目前只打印概要,可细化为逐动作清单
- DONE:
  - [x] 2026-08-12 幂等安装器:机器区刷新/用户区保留/标记块 upsert;旧 bash 版迁移
  - [x] 2026-08-12 审查修复:unpaired 拒改写、CRLF 归一、SCRATCH_DIR 不被重跑重置、备份纯净性
  - [x] 2026-08-12 升级为完整 preflight + manifest v3 + 白名单 staging/journal;agents 增量并集刷新,所有权与项目边界 fail-closed
  - [x] 2026-08-12 中断后验证并丢弃不可信事务证据,按现场重规划;项目层提交后再补 Kimi/Git 外部接线
  - [x] 2026-08-12 runtime 作为 Node 数据文件统一安装为 0644,仅 Git 直接执行的 hooks 保留 0755

## src/commands/uninstall.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 按 manifest 精确回滚;created+剥空才删文件
  - [x] 2026-08-12 审查修复:问题文件备份搬项目根保留、悬空 hooksPath 自愈、git 缺失不崩溃
  - [x] 2026-08-12 外科卸载按已发布内容与精确接线证明所有权;外部 hooks/Kimi/未知 backup 或状态存在时保守保留并非零
  - [x] 2026-08-12 --purge 仅按当前知识模板精确内容删除;配置、allowlist、草稿与既有备份始终保留

## src/commands/status.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 只读体检:注入点/版本/hooksPath/Kimi 全局块,--json 机器可读
  - [x] 2026-08-12 增加 Git 仓库边界与卸载遗留报告,不读取父仓库 hooksPath

## src/commands/doctor.mjs

- 最后核对: 2026-08-12
- TODO:
  - [ ] 增加 AGENTS.md 逼近 32KiB 预算时的分级告警(现为单阈值 28KiB)
- DONE:
  - [x] 2026-08-12 深度体检:执行位/EOL/hooks 条目/runtime 探针/预算;--fix 修安全项且权限失败如实报告
  - [x] 2026-08-12 增加 manifest v3/逐资产 hash/配置严格性/外部 Git hooks/Kimi 精确注册与拆分 runtime 完整性检查
  - [x] 2026-08-12 漂移 runtime 永不执行或修复,标记块与 settings/Kimi 现场按完整结构精确验收

## src/lib/markers.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 标记块 upsert/strip,EOL 感知;修初稿重复安装累积空行 bug
  - [x] 2026-08-12 审查修复(critical):严格配对——孤立/逆序拒绝改写,merge 重复块归并/全剥
  - [x] 2026-08-12 删除事务化安装后零生产调用的文件写入 wrapper,只保留纯文本 API

## src/lib/settings-json.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 Claude/Codex hooks JSON 合并/剥离,先全剥再注入(幂等+python3 条目迁移)
  - [x] 2026-08-12 所有权收紧为 event + matcher + 完整 handler;描述符漂移拒绝覆盖或删除

## src/lib/manifest.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 安装清单 v2 + 旧文本清单迁移;审查修复:created 可刷新过期 modified 记录
  - [x] 2026-08-12 升级稳定 manifest v3:仅保存版本、agents 与确定性 managed 资产 hash;旧版对象伪造 fail-closed

## src/lib/jsonc.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 解析复用 runtime core;replaceJsoncValue 局部回写保留注释与排版
  - [x] 2026-08-12 新配置键只追加缺失项并保留现有 JSONC 注释、排版与值
  - [x] 2026-08-12 根键替换改为结构感知扫描,忽略注释/字符串/嵌套键并命中最终生效键;删除零调用写入 wrapper

## src/lib/kimi.mjs

- 最后核对: 2026-08-12
- TODO:
  - [ ] 跟踪 Kimi changelog:local.toml 若开放 hooks 则迁回项目级注入
- DONE:
  - [x] 2026-08-12 全局 config.toml 标记块 + shim 分发
  - [x] 2026-08-12 审查修复:realpath+大小写归一键、projects.d/ 原子引用计数(取代 manifest.json 无锁读写)
  - [x] 2026-08-12 全局 TOML 块、shim hash、项目注册与用户锁均精确验证;缺失、漂移和并发状态 fail-closed
  - [x] 2026-08-12 清单不再接收 Kimi 本机路径或瞬态返回面;共享路由只由现场精确注册计数

## src/lib/blocks.mjs

- 最后核对: 2026-08-12
- TODO:
  - [ ] 实机验证 Windows 下 Codex command 的 $(git rev-parse) 解析,必要时加平台覆盖
- DONE:
  - [x] 2026-08-12 全部注入内容单一来源;审查修复:Codex 命令改 git 根绝对解析(官方 cwd=会话目录)
  - [x] 2026-08-12 将安装事务/锁加入忽略块,并固定 workflow 与两家 skill 的 LF 发布格式

## payload/runtime/core.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 检查逻辑唯一真源,行为对齐 python 基线(heredoc/mktemp/台账矩阵/码点计数)
  - [x] 2026-08-12 审查修复:here-string 按 shell 门控、方向敏感扫描、尾随换行防绕过、POSIX 大小写、UNC、~user、status -uall -z、scissors 截断、超长 session id 摘要
  - [x] 2026-08-12 新增 AUTO_COMMIT 配置键与 newDoneItemsFromDiff / buildAutoCommitMessage(自动提交信息生成,满足自身 commit-msg 规范)
  - [x] 2026-08-12 重构为稳定 facade;配置、路径、写策略、台账和 Git 策略拆分为独立模块
  - [x] 2026-08-12 稳定导出受管变更的语义收尾事实摘要接口
  - [x] 2026-08-12 删除已被逐文件 ledgerSync/coverage 流程取代的 stagedLedgerSync 兼容导出

## payload/runtime/hook.mjs

- 最后核对: 2026-08-12
- TODO:
  - [ ] 实机验证 Kimi PreToolUse 字段名后收紧防御式解析;Codex deny reason 回传完整度
- DONE:
  - [x] 2026-08-12 三家统一入口,异常一律放行(guardrail 契约)
  - [x] 2026-08-12 审查修复:写入工具名正向门控(只读工具放行)、Stop 标记写失败降级 warn、Codex warn 用 systemMessage
  - [x] 2026-08-12 AUTO_COMMIT 三档:Stop 时"有改动且台账已同步"触发 remind 打回/auto 直接提交(信息取 LEDGER 新增 DONE,失败原因喂回 agent)
  - [x] 2026-08-12 移除 hook 自动暂存/提交;旧 auto 降级 remind,逐文件台账覆盖且嵌套仓库不继承外层 runtime
  - [x] 2026-08-12 Stop 对受管变化强制触发一次 tidykeep Skill 语义收尾,即使台账已机械同步也不跳过
  - [x] 2026-08-12 删除配置归一后不可达的 auto 分支,运行时只处理 off/remind

## payload/runtime/githook.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 git 兜底层业务逻辑;审查修复:暂存路径 -z(修非 ASCII 文件名绕过)
  - [x] 2026-08-12 Git 查询与内部异常改为拒绝提交;逐文件验证暂存台账,保留显式 TIDYKEEP_SKIP 逃生门

## payload/runtime/enable-githooks.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 团队成员一次性启用;husky 共存打印链式接入指引
  - [x] 2026-08-12 验证 Git 根与外部 hooks 两类真实链路;未完整生效时非零退出

## payload/runtime/kimi-shim.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 用户级路由:未启用项目 exit 0;审查修复:只转发 0/2 退出码,不泄堆栈
  - [x] 2026-08-12 路由前验证 canonical 项目注册与普通文件 runtime,未注册项目不能借全局 hook 执行代码

## payload/runtime/messages.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 全部拦截文案单一来源,每条含行动指令(改原文件/放 .tmp//加 allowlist)
  - [x] 2026-08-12 增加有界 Git 事实与语义核对信号,明确 Hook 不下结论且不得自动删除候选
  - [x] 2026-08-12 对仓库文件名做可见转义与长度上限,防止证据文本伪装成 Hook 指令
  - [x] 2026-08-12 收窄事实载荷为文案实际消费的删除/重命名与代码/文档/关键文件计数

## payload/githooks/pre-commit

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 sh 薄壳:TIDYKEEP_SKIP 豁免、legacy 链式、node 缺失 fail-open
  - [x] 2026-08-12 改为 Git/runtime 故障 fail-closed;仅 tidykeep 自接管时回链 legacy hook,避免外部递归

## payload/githooks/commit-msg

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 sh 薄壳,同上
  - [x] 2026-08-12 对齐 pre-commit 的根解析、legacy 链路与 fail-closed 语义

## payload/rules.md

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 AGENTS.md 协议块(精简守 Codex/Kimi 32KiB 预算),任务循环+Commit 规范+指路行
  - [x] 2026-08-12 新增"对外动作边界":agent 到 commit 为止,push/发布由人决定;发布前强制体检审计(D-009)
  - [x] 2026-08-12 规则改用配置 SCRATCH_DIR,明确 Git hooks 故障拒绝与 escape hatch 边界
  - [x] 2026-08-12 明确 Hook 调度、Skill 语义判断与 Git Hook 机械验收的三层职责

## payload/docs/workflows.md

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 三工作流(初始化扫描/收尾同步/体检审计)单一真源
  - [x] 2026-08-12 初始化扫描纳入 WATCH_FILES,收尾草稿区说明与运行配置一致
  - [x] 2026-08-12 收尾工作流接收 Stop 自动触发,要求查看实际 diff 并禁止按启发式信号自动删除

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
  - [x] 2026-08-12 补充 CRLF、重复块与严格所有权边界回归
  - [x] 2026-08-12 随零调用文件写入 wrapper 一并删除仅覆盖该 wrapper 的测试

## test/lib/jsonc.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 注释/尾逗号/字符串内保护/行级回写
  - [x] 2026-08-12 覆盖缺失键追加、未知键与损坏 JSONC 的保守处理
  - [x] 2026-08-12 覆盖结构感知根键替换并删除零调用写入 wrapper 的测试

## test/lib/settings-json.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 合并/剥离/幂等/python3 迁移/解析失败跳过
  - [x] 2026-08-12 覆盖 matcher/event/handler 任一漂移时不误认领

## test/lib/manifest.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 first-wins + created 刷新 + 旧文本清单迁移
  - [x] 2026-08-12 覆盖 v3 schema、未来版本、traversal、原型链、管理路径白名单和恶意旧版清单

## test/runtime/core.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 核心逻辑表驱动单测(35 项,含两轮审查回归)
  - [x] 2026-08-12 扩展配置/路径/shell/逐文件台账/Git 消息策略及跨平台边界测试
  - [x] 2026-08-12 覆盖语义交接事实的分类、计数、截断和纯事实边界
  - [x] 2026-08-12 覆盖生成类 WATCH_FILES、rename 双列解析与已删除兼容导出

## test/runtime/hook-e2e.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 三家适配器子进程 e2e(deny/allow/stop/防死循环/shim 损坏静默)
  - [x] 2026-08-12 覆盖首次未跟踪台账、嵌套 Git、提醒不提交及 Kimi 精确注册路由
  - [x] 2026-08-12 覆盖已同步台账仍触发 Skill、证据注入及语义收尾后再提醒提交的顺序

## test/runtime/githook-e2e.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 真实 git commit e2e(拦截/豁免/链式/quotepath/scissors)
  - [x] 2026-08-12 覆盖 Git 查询失败、Node 缺失、逐文件台账、rename 与 legacy/external 链路
  - [x] 2026-08-12 对齐 fail-closed 与逐文件台账缺口的新提示文本并清理无用测试导入

## test/cli/init-e2e.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 init 幂等/uninstall 回滚/迁移/Kimi 引用计数与 symlink/备份保留/不成对保护
  - [x] 2026-08-12 覆盖事务中断续跑、并发锁、增量 agents、恶意 manifest、外部 hooks、Git 根和保守 purge/uninstall
  - [x] 2026-08-12 覆盖中断证据丢弃重规划、崩溃锁拒绝、外部接线补偿与精确 purge
  - [x] 2026-08-12 在 POSIX 验证 Node runtime 无冗余执行位而 Git hooks 仍可执行
  - [x] 2026-08-12 Kimi v2 迁移改用固定已发布夹具,避免从移动的 Git HEAD 伪造历史版本

## test/cli/doctor-e2e.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 体检通过/检出并 --fix/未安装报告
  - [x] 2026-08-12 覆盖拆分 runtime、v3 所有权、配置漂移、外部 hooks、Git 边界与 symlink 安全修复

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
  - [x] 2026-08-12 精简使用文档,删除重复论证与 FAQ;纠正 hooks 边界、--purge 范围和 AUTO_COMMIT 风险表述
  - [x] 2026-08-12 再次精简安装/重装/卸载说明,明确源码安装、增量升级与外部 hooks 处理逻辑
  - [x] 2026-08-12 说明 Hook 自动调度、Skill 语义分析、Git Hook 验收及不自动删除边界
  - [x] 2026-08-12 用短版说明明确非 Git/主 worktree 安装边界、重装事务与锁处理语义

## AGENTS.md

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 自装生成(tidykeep 协议块)
  - [x] 2026-08-12 同步 Hook 调度 Skill 做语义收尾的项目规则

## STATE.md

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 同步 manifest v3、事务安装、逐文件台账、精确所有权与保守卸载的当前设计和墓地
  - [x] 2026-08-12 记录 Hook 调度、Skill 判断、Git Hook 验收的 D-016 设计
  - [x] 2026-08-12 记录稳定清单、不回放事务、崩溃锁、结构化 JSONC 与非 Git 边界的 D-017 至 D-021

## package.json

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 增加测试覆盖率命令并保持零运行时依赖与发布文件清单
  - [x] 2026-08-12 测试改为单并发执行,避免真实 Git 子进程在受限环境中争抢资源

## .gitignore

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 忽略项目内草稿、事务 staging/journal、锁目录与测试临时产物

## .gitattributes

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 固定 CLI、payload runtime 与 Git hook 的 LF 发布格式

## .github/workflows/ci.yml

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 增加 Node 20.11/22 在 Linux、macOS、Windows 的测试矩阵与覆盖率任务

## payload/config.jsonc

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 增加 WATCH_FILES 与只提醒不自动提交的配置模板
  - [x] 2026-08-12 扩充常见配置/锁文件扩展名并将 .gitignore/.gitattributes 纳入默认逐文件台账

## payload/runtime/config.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 拆出 JSONC、默认值、严格配置归一与 allowlist 加载
  - [x] 2026-08-12 同步常见配置格式与生成类根文件默认 WATCH_FILES

## payload/runtime/paths.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 集中处理 POSIX/Windows/UNC、项目内路径、系统临时目录与大小写边界

## payload/runtime/write-policy.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 拆出单文件、apply_patch、Bash 与 PowerShell 写入裁决和方向敏感扫描

## payload/runtime/ledger.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 实现逐文件受管变化、台账 section 覆盖证明与不跟 symlink 的草稿残留检查
  - [x] 2026-08-12 生成有界受管变更事实,按动作与代码/文档/关键文件分类供 Skill 语义交接
  - [x] 2026-08-12 修正 worktree 列 rename/copy 解析,收窄事实字段并删除旧 stagedLedgerSync

## payload/runtime/git-policy.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 拆出提交信息、commentChar/scissors 和 Stop 会话标记策略

## src/lib/fs-safe.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 提供同目录原子写入、权限继承与 SHA-256 原语

## src/lib/directory-lock.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 提供 PID/host/start-token 所有权、活锁保护与竞态安全回收的通用目录锁
  - [x] 2026-08-12 锁策略收紧为未知、活锁和崩溃残留均拒绝自动回收,只允许精确 owner 释放

## src/lib/project-lock.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 用项目内精确目录锁串行化 init 与 uninstall

## src/lib/project-paths.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 集中校验目标、项目相对路径、Git 根/worktree 与项目内 symlink 边界

## src/lib/install-transaction.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 实现白名单 staging/journal、完整 preflight、before/after 恢复及记录-操作强绑定
  - [x] 2026-08-12 中断恢复改为验证布局后丢弃 staging/journal 并从现场重规划,删除旧回放认证分支

## src/lib/legacy-assets.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 用逐文件已发布 hash 证明旧 runtime/skill/Python hook/Kimi shim 所有权
  - [x] 2026-08-12 删除零生产调用的路径式旧 Python hook 判定 wrapper

## src/lib/git-hooks.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 严格识别外部 pre-commit/commit-msg 的真实执行与故障传播链路

## test/helpers/temp.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 将全部测试临时文件隔离在项目 `.tmp/tests` 并自动清理

## test/lib/install-transaction.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 覆盖损坏 stage、不可信 journal、未知 staging 与事务恢复边界
  - [x] 2026-08-12 证明中断事务不回放任何项目内 stage,而是清理后由调用方重规划

## test/lib/directory-lock.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 覆盖未知内容、symlink、owner 被替换及保守释放目录锁的边界
  - [x] 2026-08-12 覆盖进程退出后的崩溃锁仍 fail-closed,不依赖可伪造 start-token 自动回收

## test/lib/git-hooks.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 覆盖真实外部链路、注释/echo/死分支和不传播失败的伪接线

## test/lib/kimi.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 覆盖伪造注册、TOML 块漂移、状态枚举、用户锁与保守卸载

## test/cli/package-e2e.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 覆盖离线 npm pack/install、CLI 版本与发布 payload 完整性

## test/cli/manifest-portability.test.mjs

- 最后核对: 2026-08-12
- TODO:
- DONE:
  - [x] 2026-08-12 验证 manifest 不持久化用户路径、安装时间、settings 内容或机器 EOL
  - [x] 2026-08-12 验证同一版本重复安装清单字节稳定且跨目录仅由 agents/资产决定
