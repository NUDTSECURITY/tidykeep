# Development Workflow Module

**Purpose**: Requirements → PRD → Development → Delivery. Eight-phase flow with enforced sequence.

**When**: Starting from vague idea, need to write PRD, requirements themselves unclear needing follow-up, or user says "I want to build X" / "help me set up Y system" / "how to implement this requirement".

## Eight Phases (Mandatory Sequential)

| Phase | Name | One-line | Reference |
|---|---|---|---|
| 1 | Requirements Clarification | Understand problem before talking solution | [phase1-requirements.md](phase1-requirements.md) |
| 2 | Value Assessment | Decide should-do or not | [phase2-evaluation.md](phase2-evaluation.md) |
| 3 | Solution Design | Output executable product solution | [phase3-design.md](phase3-design.md) |
| 4 | PRD Delivery | Output structured product requirements doc | [phase4-prd.md](phase4-prd.md) |
| 5 | Tech Design & Dev | Based on PRD complete system dev (5.1-5.6 sub-phases) | [phase5-development.md](phase5-development.md) |
| 6 | Quality Verification | Pre-launch comprehensive quality check (6.1-6.9 sub-phases) | [phase6-quality.md](phase6-quality.md) |
| 7 | Fix & Regression | Fix issues and re-verify | [phase7-fix-and-regression.md](phase7-fix-and-regression.md) |
| 8 | Project Docs | Aggregate tech docs, maintain doc-code sync (8.1-8.4 sub-phases) | [phase8-documentation.md](phase8-documentation.md) |

**Collaboration with other modules**:
- Phase 6.8 test design → hand to §2 Test Integrity
- Phase 8 complete for delivery → hand to §1 Knowledge Cleanup
- Discover code quality issues → hand to §4 Code Audit

## Phase Declaration (Must)

Every reply opening must declare current phase:
```
【Current Phase: XXX】
```

## User Jump Flow Handling

When user requests:
- Direct solution → refuse, need requirements clarification first
- Direct code → refuse, need PRD first
- Skip testing → refuse, need quality verification (static + dynamic)
- Skip dynamic testing (when env permits) → refuse, dynamic verification is necessary functional verification link
- Skip doc maintenance → negotiable, but need to warn doc-code divergence risk

**Refusal wording**: Explain where current should be, plus skip risk.

## Phase Loading

> **Phase Reference Loading**: When entering any phase, Read corresponding reference file from `references/sdlc/` and follow instructions within. Do NOT attempt to recall phase details from memory — always load file to ensure full, up-to-date instructions applied.

## Key Constraints

- **Requirements-driven**: All work begins with requirements understanding, ends with requirements verification
- **Phased advance**: Strict phase execution, each phase must obtain confirmation before entering next
- **Doc-driven dev**: Development must base on confirmed product docs; not allowed to detach from docs and self-design
- **Doc-code sync**: Maintain tech docs while developing; code changes must sync to docs; prohibit code-doc divergence
- **Inquiry priority**: Insufficient info must ask; prohibit guessing
- **Quality closed-loop**: Post-dev must go through quality verification; issues must fix before delivery

## Additional References

- [deliverables.md](deliverables.md) — Deliverable catalog across all phases
- [poc-test-template.md](poc-test-template.md) — POC test case format
