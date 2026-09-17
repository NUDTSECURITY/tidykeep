# tidykeep

Personal development protocol & quality assurance skill for AI agents.

## What is this?

A unified skill covering four dimensions of software development:

- **§1 Knowledge Cleanup** — Sync code, docs, rules, STATE.md, workspace
- **§2 Test Integrity** — Contract-first, isolation, mutation checks
- **§3 Development Workflow** — 8-phase requirements-to-delivery
- **§4 Code Audit** — 3-dimension 60-control scoring

## Installation

### For Claude Code

Copy this directory to:
```bash
~/.claude/skills/tidykeep/          # User-level (all projects)
# or
<project>/.claude/skills/tidykeep/  # Project-level
```

### For Codex

Copy this directory to:
```bash
~/.agents/skills/tidykeep/          # User-level
# or
<project>/.agents/skills/tidykeep/  # Project-level
```

### For Kimi Code

Copy this directory to both locations above (Kimi reads both paths).

## Usage

The skill auto-triggers based on task context:
- Code done, ready to commit → §1 Knowledge Cleanup
- Need to write tests → §2 Test Integrity
- Vague idea to working system → §3 Development Workflow
- Assess repo quality → §4 Code Audit

Or invoke explicitly by mentioning "tidykeep" or the module you need.

## Structure

```
tidykeep/
├── SKILL.md                    # Skill definition & routing
├── references/                 # Detailed protocols (loaded as needed)
│   ├── core/                  # §1 Knowledge Cleanup
│   ├── test/                  # §2 Test Integrity
│   ├── sdlc/                  # §3 Development Workflow
│   └── audit/                 # §4 Code Audit (rigor3 v0.2.0)
└── templates/                 # Reusable templates
```

## Credits

- §4 Code Audit module upstream: [MaySudo/rigor3](https://github.com/MaySudo/rigor3) v0.2.0 (MIT)

## License

MIT
