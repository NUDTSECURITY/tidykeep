---
name: tidykeep
description: >-
  Keep code, docs, and workspace in sync. Use proactively after coding,
  before commits, when writing tests, or for code-quality audits;
  do not wait for the user to mention tidykeep.
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

Personal development protocol. Three simple tools:

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

## Installation

Copy this directory to:
- `~/.claude/skills/tidykeep/` (Claude Code)
- `~/.agents/skills/tidykeep/` (Codex)

## License

MIT
