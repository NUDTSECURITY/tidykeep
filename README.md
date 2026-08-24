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

| skill | 什么时候用它 |
|---|---|
| **`tidykeep`** | 知识与规范收尾。让代码、文档、Agent 规则、记忆、工作区彼此一致，下一个人只找到唯一现役答案。六个事实面各自标状态，不允许把未验证写成完成。<br>触发：收尾、体检审计、文档和代码对不上、整理记忆、交接、洁癖 |
| **`sdlc`** | 八阶段开发流程：需求澄清 → 价值评估 → 方案设计 → PRD → 开发 → 质量验证 → 修复回归 → 文档维护。强制按序，跳步会被拒绝。<br>触发：从零做个 X、写 PRD、需求分析、管理开发流程 |
| **`blind-test`** | 让测试真的能证伪。同一个模型先写实现再写测试时，测试会退化成把实现抄一遍。要求契约先行、测试作者与实现者上下文隔离、每条测试绑定一条里程碑验收条款、变异检查证明测试能挂。<br>触发：设计测试用例、补测试、TDD、测试写得太假、精简测试 |

三者边界写在各自的 SKILL.md 里（三向声明，任一被触发都能自己裁决）：
知识收尾归 tidykeep，长流程与技术文档归 sdlc，测试怎么写归 blind-test。

## 装到哪里

**用户级（默认）** —— 对所有项目生效，个人使用选这个：

```
~/.claude/skills/<name>/      Claude Code 与 Kimi Code 从这读
~/.agents/skills/<name>/      Codex 与 Kimi Code 从这读
```

**项目级** —— 随仓库分发给团队：

```bash
node bin/tidykeep.mjs init --project /path/to/project
```

除 skill 外还会注入 tidykeep 协议：`AGENTS.md` 规则块、`CLAUDE.md` 的 `@AGENTS.md`
指针、`.gitignore` 的 `.tmp/`，以及 `STATE.md`（仅当不存在时创建，**永不覆盖**）。

只铺 `.claude/skills` 和 `.agents/skills` 两处就覆盖三家：Codex 只扫 `.agents/skills`，
Claude Code 读 `.claude/skills`，Kimi Code 两处都读。

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
