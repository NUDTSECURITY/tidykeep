# tidykeep — 个人 Agent Skill 库

我自己维护的 Agent Skill 集合，配一个安装器。**换机器、换环境时 clone 一次、跑一条命令，
全部 skill 就位**，不用再去一个个下载。

支持 Claude Code、Codex、Kimi Code。要求 Node.js >= 20.11，运行时零第三方依赖。

## 快速开始

```bash
git clone https://github.com/NUDTSECURITY/tidykeep.git
cd tidykeep

node bin/tidykeep.mjs list     # 看看库里有什么
node bin/tidykeep.mjs init     # 全装到用户级，对所有项目生效
```

发布到 npm 后可省去 clone：`npx tidykeep init`。

## 库里有什么

**这些 skill 不需要你点名，按任务自动触发**（机制见下节）：

| 你在做什么 | 自动拉起 | 它做什么 |
|---|---|---|
| 改完代码准备提交、一个功能做完、说「就这样吧」 | **`tidykeep`** | 知识收尾。核对文档与代码是否对得上、清会话残留、同步 `STATE.md`。六个事实面各自标状态，不允许把未验证写成完成。 |
| 要为新功能或缺陷写测试、补测试、说「加点测试」 | **`blind-test`** | 让测试真的能证伪。同一个模型先写实现再写测试时，测试会退化成把实现抄一遍。要求契约先行、测试作者与实现者上下文隔离、每条测试绑定一条里程碑验收条款、变异检查证明测试能挂。 |
| 接手陌生项目、觉得代码乱说不清烂在哪、大改前摸底 | **`rigor3`** | 仓库级质量审计。代码卫生 / 架构卫生 / 工程卫生三维度，60 条控制项各 5 分，只读取证不跑代码。**最低维度决定结论**，优势维度不能靠平均掩盖短板。分数由临时生成的引擎算出并经一致性校验，不合格就不发布——不允许模型手算或编造。<br>上游 [MaySudo/rigor3](https://github.com/MaySudo/rigor3) v0.2.0，MIT |
| 「我想做个 X」「帮我搭个 Y」、需求还很模糊 | **`sdlc`** | 八阶段：需求澄清 → 价值评估 → 方案设计 → PRD → 开发 → 质量验证 → 修复回归 → 文档维护。强制按序，跳步会被拒绝。 |

四者边界写在各自的 SKILL.md 里（四向声明，任一被触发都能自己裁决）：

```
知识层 ──→ tidykeep     STATE/规则/记忆/文档漂移/工作区残留
代码层 ──→ rigor3       重复/死代码/错误处理/架构边界/依赖/安全
测试   ──→ blind-test   怎么写（rigor3 评估充分性 → 转它来写）
流程   ──→ sdlc         需求到交付的八阶段（6.9 负责跑测试）
```

## 装到哪里

**用户级（默认）** —— 对所有项目生效，个人使用选这个：

```
~/.claude/skills/<name>/          skill 本体：Claude Code 与 Kimi Code 从这读
~/.agents/skills/<name>/          skill 本体：Codex 与 Kimi Code 从这读

~/.claude/CLAUDE.md               ← 路由表（标记块内）
~/.codex/AGENTS.md                ← 路由表（若已有 AGENTS.override.md 则写它）
```

后两个是**自动触发的关键**，见下节。它们只注入一个 `<!-- tidykeep:begin -->` 标记块，
你原有的内容一字不动；`uninstall` 会精确剥离。

Kimi Code 的用户级指令路径尚未经官方文档核实，暂不写入——它的 skill 仍能从上面两个
skill 目录发现，只是少一层路由兜底。

**项目级** —— 随仓库分发给团队：

```bash
node bin/tidykeep.mjs init --project /path/to/project
```

除 skill 外还会注入 tidykeep 协议：`AGENTS.md` 规则块、`CLAUDE.md` 的 `@AGENTS.md`
指针、`.gitignore` 的 `.tmp/`，以及 `STATE.md`（仅当不存在时创建，**永不覆盖**）。

只铺 `.claude/skills` 和 `.agents/skills` 两处就覆盖三家：Codex 只扫 `.agents/skills`，
Claude Code 读 `.claude/skills`，Kimi Code 两处都读。

## 自动触发怎么做到的

不用记命令，也不用点名 skill。两层：

**第一层 · skill 的 `description` 描述任务情形。** 写的是「一段开发工作告一段落时」
「即将为新功能动手写实现时」，而不是「当用户提到 xxx 时」——后者要求你先背咒语。
Agent 在会话启动时读取所有 skill 的 `name` 和 `description`（约 100 tokens），
按当前任务语义匹配。

**第二层 · 路由表写进规则文件。** description 是语义匹配，可能不命中；而规则文件
（`~/.claude/CLAUDE.md`、Codex 全局指令、项目的 `AGENTS.md`）**每次会话必然全量加载**。
路由表放在那里才是硬的：

```
| 遇到这种情形                    | 调用       |
| 要写测试、改测试、补测试        | blind-test |
| 告一段落、准备提交              | tidykeep   |
| 判断仓库整体质量、盘技术债      | rigor3     |
| 从模糊想法做出系统、写 PRD      | sdlc       |
```

**改了 skill 要新开会话才生效**——`description` 和规则文件都只在会话启动时读一次。

## 常用命令

```bash
tidykeep list                          # 库里有哪些 skill
tidykeep doctor                        # 只校验格式，不写任何文件

tidykeep init                          # 全装到用户级
tidykeep init --skills blind-test      # 只装其中几个
tidykeep init --dry-run                # 先看会发生什么
tidykeep init --project .              # 装到当前项目（含协议文件）

tidykeep uninstall                     # 从用户级卸载
tidykeep uninstall --skills sdlc       # 只卸其中几个
```

## 往库里加 skill

把目录放进 `payload/skills/<name>/`，**不用改任何代码**——安装器自动发现。

```
payload/skills/<name>/
├── SKILL.md          必需：YAML frontmatter + 正文
├── references/       可选：按需加载的细节
└── ...
```

加完跑 `tidykeep doctor` 验一遍。它会挡住这些问题（装错格式的 skill 会被 Agent
**静默忽略**——不报错，只是不生效，所以安装前就 fail-closed）：

- `name` 必须等于目录名，且符合规范命名（小写字母数字 + 单连字符）
- `description` 非空且 ≤ 1024 字符
- `SKILL.md` < 500 行 / < 24 KB，超了应下沉到 `references/`
- 正文里的相对链接全部可达
- `references/` 下没有正文引用不到的孤儿文件

## 重复安装

再跑一次 `init` 即升级：库里的文件直接覆盖，内容没变则不写盘（输出「无变化」）。
项目级模式下，标记块孤立或逆序时**整体拒绝**并返回非零，绝不吞掉夹在标记之间的内容——
请先手工修好标记再重跑。

## 卸载

只删能证明是本库发布的东西：skill 文件内容需精确等于当前版本，标记块需严格配对。
任何一项无法证明所有权就保守保留并返回非零。项目级的 `STATE.md` **始终保留**——
它是你的知识，不是安装物。

## 注意

- 改了 skill 之后**要新开会话**。Agent 在会话启动时才扫描 skill 目录读取
  `name` 和 `description`；正文是激活后才读。改触发词不重开会话完全不生效。
- 这里没有任何 hook，不拦截任何操作。skill 是提示词，靠 Agent 遵守。

## License

MIT
