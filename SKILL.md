---
name: tidykeep
description: >-
  Keep code, docs, and workspace in sync. Use proactively after coding,
  before commits, when writing tests, or for code-quality audits;
  do not wait for the user to mention tidykeep. Ensures one current answer
  instead of conflicting versions (old files, outdated docs, temp scripts).
  Also provides test writing and code audit checklists, plus this
  repository's research-document governance rules (single-authoritative
  doc, evidence pointers, git-as-archive).
when_to_use: >-
  Invoke automatically during software development after implementing or
  changing code, before committing or wrapping up, when adding or updating
  tests, and when reviewing code quality or preparing a refactor.
  Select Cleanup, Testing, or Audit according to the situation.
  Explicit mentions of tidykeep, wrap up, or done are additional triggers,
  not requirements.
---

# tidykeep

Apply the relevant checklist proactively when the trigger conditions match.
Do not wait for the user to mention tidykeep.

**Prose rule**: 如果某句话的作用只是防止被质疑而不是推进论证，请删除。
If a sentence only defends against criticism instead of advancing the
argument, delete it.

**No speculative defenses**:
- Don't add complexity for guessed, near-impossible race/security edge cases.
  If you think one is real, state the concrete failure, its likelihood, and the
  code cost — and wait for approval.
- Don't silently widen the change scope.
- Validate external data once at the entry point; don't re-check known types deeper in.
- Don't extract a function used only once — only when it reuses, wraps real
  complexity, or names a clear concept.
- Main function: happy path only; push validation and details into small helpers below it.
- Comments: only non-obvious constraints and counterintuitive behavior, never the obvious.
- Don't hand-edit generated files; fix the source and regenerate.
- Tests exercise the real implementation; don't copy business logic into tests, minimize mocks.
- Follow the repo's existing tooling and workflow; don't import new tools or processes.

Personal development protocol. Three simple tools, plus this repo's
governance layer:

## 1. Cleanup — Keep things in sync

**When**: Code done, ready to commit, or user says "wrap up"

**What**: Ensure README/docs match code, delete temp files, one truth per fact.

→ Read [references/cleanup.md](references/cleanup.md)

---

## 2. Testing — Write meaningful tests

**When**: Need to write or add tests

**What**: One acceptance criterion = one test. Avoid testing implementation details.

→ Read [references/testing.md](references/testing.md)

---

## 3. Audit — Quick health check

**When**: Just inherited a project, before major refactor, or "how's the code quality?"

**What**: 13-item checklist across code hygiene, architecture, and engineering.

→ Read [references/audit.md](references/audit.md)

---

## 4. Research-document governance (this repository)

Rules distilled from the 2026-10-07 consolidation; apply them on every
wrap-up in this repo.

### Single truth per fact, layered

| Layer | File | Rule |
|---|---|---|
| 规划/分析 | `doc/paper-master-plan.md` | 唯一权威。只放定位、冻结契约、实验矩阵、红线、**指针**；不复制数字细节，不保留迭代历史与留言区 |
| 决策状态 | `research/research_state.yaml` | 机器可读。decision_log 每条一行（date/id/一句话）；完整原文只活在 git 历史 |
| 代码用法 | `attack/*/README.md`、`experiments/README.md` | 脚本索引与命令，跟代码同改；分析性内容不上移到规划文档 |
| 评估/状态 | `supervisor/verdict-and-plan.md`、`supervisor/status.md` | 各一页；新报告合并入这两份而非新增文件 |
| 证据 | `runs/` | 只追加不修改；每个 headline 数字可回溯到冻结 run 目录 |

### Git is the archive

- 精简=删除旧内容后提交，**不**留 `_old/_v2/副本` 副本文件；原文用
  `git show <commit>:<path>` 找回。
- 大版本切换（如 master plan v4→v5）在提交信息里注明"原文在某提交"。
- runs/（824G）、upstream/、venv、tools/ 永不入库（.gitignore 已冻结）。

### Sync checks（每次 wrap-up 过一遍）

1. 文档间无数字漂移：正文数字 ↔ runs 冻结文件 ↔ master plan §5 指针。
2. 无过时状态标记（"待重生成/待补/两个受害"式残留）——完成即删。
3. 受害工具命名全文一致（RevDecode/BinEnhance/ReSIM 具名）；
   我方内部臂（adaptive/random/K0/安慰剂）不写作"对比工具"。
4. YAML 可被 PyYAML 解析；改 research_state 用解析器重写而非正则手术
   （2026-10-07 正则压缩曾破坏多行流式条目）。
5. 新增文档前先问：能否并入既有五层之一？默认并 入。

---

## Installation

Copy this directory to:
- `~/.claude/skills/tidykeep/` (Claude Code)
- `~/.agents/skills/tidykeep/` (Codex)

## License

MIT
