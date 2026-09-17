# tidykeep

Personal development protocol for AI agents.

## What is this?

Three simple tools to keep your projects clean:

1. **Cleanup** — Sync docs with code, delete temp files, one truth per fact
2. **Testing** — Write meaningful tests (one criterion = one test)
3. **Audit** — Quick 12-item health check

## Installation

```bash
# Clone
git clone https://github.com/NUDTSECURITY/tidykeep.git

# Copy to Claude Code
cp -r tidykeep ~/.claude/skills/

# Or copy to Codex
cp -r tidykeep ~/.agents/skills/
```

## Usage

Triggers automatically when:
- You finish coding and say "wrap up" / "done"
- You need to write tests
- You ask "how's the code quality?"

Or invoke explicitly: "use tidykeep cleanup" / "tidykeep testing" / "tidykeep audit"

## Structure

```
tidykeep/
├── SKILL.md              # Entry point (40 lines)
└── references/           # Details (< 200 lines each)
    ├── cleanup.md       # Cleanup protocol
    ├── testing.md       # Test writing guide
    └── audit.md         # Code health checklist
```

Total: ~600 lines, 20 KB (vs previous 3,373 lines, 221 KB)

## License

MIT
