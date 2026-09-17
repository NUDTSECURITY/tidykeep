# Test Integrity Module

**Purpose**: Make tests actually falsifiable, not just copying known implementation into assertions.

**When**: About to write implementation for new feature or bugfix (contract & acceptance criteria first), existing code needs tests added, or user says "add tests" / "test coverage insufficient".

## The Problem

When test writer and implementer share same context, tests degenerate to "copy implementation once". Model in same latent space statistically tends to generate **tests that validate its own errors**: implementation writes `<=` as `<`, test boundary values follow that and don't expose the difference.

This isn't attitude, it's structure. **Swapping order doesn't fix it; must swap person.**

Empirical: agent self-written tests show identical frequency for "solved tasks" and "unsolved tasks" — tests have no discriminating power; plus these tests mostly act as observational print statements, not assertion checks.

## Completion Contract

One blind-test only completes when these four all have clear results:

| Item | Question | Evidence |
|---|---|---|
| Contract | What behavior tested? Where's boundary? | Milestone acceptance criteria list, no implementation detail |
| Isolation | Did test author see implementation? | Independent context / child agent + tool permissions; degraded mode needs explanation |
| Economy | What did each test buy? | Each test ↔ one acceptance criterion, one-to-one |
| Falsifiability | Can these tests actually fail? | Mutation check: each injected mutation hangs at least one test |

If any can't be done, honestly mark `pending`; **don't use "tests all green" to impersonate "tests valid"**.
All green only proves current implementation and current assertions self-consistent; doesn't prove assertions meaningful.

## Three Roles & Firewall

```
        Contract (milestone acceptance criteria)
                │
    ┌───────────┴───────────┐
    │                       │
Test Author             Implementer
Readable: contract      Readable: failed test + contract
Unreadable: impl        Unreadable: test author reasoning
Writable: test file     Writable: impl file
Unwritable: impl file   Unwritable: test file
```

**Key in tool permissions, not prompts.** Merely "please don't look at implementation" doesn't constrain — revoke permissions to constrain:
test author no edit-implementation permission = can't adapt impl to fit test; implementer can't get test author reasoning = can only reverse-infer intent from assertions.

Platform landing (subject to current env actual support; explore if uncertain):
- **Claude Code**: Use Agent tool to spawn child agent, constrain `tools` in `.claude/agents/*.md` frontmatter; or use skill frontmatter `allowed-tools` (experimental field, verify support by platform docs)
- **Other platforms**: Find that platform's child-agent / restricted-tool mechanism; if none, use degraded mode below and honestly report in summary isolation is by convention not enforcement

**Degraded mode (single session, can't spawn child agent)**: Next best, but must do all three, else doesn't count as isolated —
1. First write contract & test **code**, `git commit` to disk
2. Only after commit start implementation; during implementation **don't modify test file**; if must change, first explain reason and commit separately
3. Wrap-up must do mutation check — under degraded mode it's the only remaining means to prove tests valid

## Milestone → Acceptance Criteria → Test, One-to-One

This is the only rule controlling redundancy: **no acceptance criterion = no test; one acceptance criterion = max one test.**

First write milestones as decidable acceptance criteria. Criteria must be one-sentence true/false, no implementation detail:

```text
M1 Marker block upsert
  A1  File has no markers, block appends to end, original content unchanged
  A2  File already has paired markers, block replaced, out-of-block content unchanged
  A3  Markers orphaned or reversed, refuse rewrite and return unpaired, original text returned as-is
  A4  CRLF file written back still CRLF, don't mix in orphan LF
```

Four criteria → four tests. **Don't write a fifth.**

How to pick criteria: Only write "if wrong, user suffers" behavior — data swallowed, boundary miscalculated, failure treated as success, contract externally promised stuff. "Function can be called" / "return value not undefined" aren't acceptance criteria.

## Test Economics: What Doesn't Deserve Tests

Delete or simply don't write these. They're agent's default test artifacts; occupy volume but provide no falsifiability:

| Anti-pattern | Why Useless |
|---|---|
| Test framework/library itself behavior | You're testing others' code; if it breaks isn't your test's job to discover |
| Test mock behavior | Assertion only proves mock exists; unrelated to real behavior |
| One function one test | Function isn't behavior unit; acceptance criterion is; private functions especially shouldn't have tests |
| Copy implementation statements reversed into assertions | Impl changes one line test hangs, but never found bug — that's coupling, not coverage |
| Multiple similar cases for same criterion | Input 1, input 2, input 3 all walk same branch, keep only one |
| Snapshot/golden file as main assertion | It locks current output, not correctness; impl wrong can still "pass" by updating snapshot |
| Only assert "didn't throw exception" | Not throwing and behavior correct are two things |

**Criterion**: Can't say "this test hangs, what problem will user encounter" → delete it.

## Mutation Check: Only Mechanical Proof

Previous items are process constraints, rely on human adherence. Mutation check is the only **automatic** proof of test validity; must do.

Method (no mutation test framework installation needed):
1. Confirm workspace clean (`git status`); else first commit or stash — **mutations must be fully revertible**
2. For this milestone's core logic, pick **3–5 spots** inject mutations, one spot at a time:
   - Boundary: `<=` → `<`, `>` → `>=`
   - Condition negate: `if (x)` → `if (!x)`
   - Delete guard: remove one early return / validation branch
   - Swap return value: success code ↔ failure code, return `null` ↔ return empty object
   - Change constant: threshold ±1
3. Each injection run tests. **Must have at least one test hang.**
4. `git checkout -- <file>` revert, then do next spot. All done confirm workspace back to clean.

**Surviving mutation = fake test.** Means this behavior actually not covered by any assertion. Two handling options, must pick one, not allowed to fudge:
- This behavior important → which acceptance criterion does it correspond to? Add that test
- This behavior unimportant → in report clearly state "this branch no verification"; don't pretend it's tested

Mutation check cost & method details (which positions, minimal operations per language) see [mutation-check.md](mutation-check.md).

## Final Checklist

- [ ] Each test can point back to one milestone acceptance criterion; no orphan tests
- [ ] Each acceptance criterion has one and only one test; no near-duplicate similar cases
- [ ] Test author vs implementer isolation method written; degraded mode honestly stated as convention not enforcement
- [ ] Degraded mode test code separately committed before implementation
- [ ] Mutation check executed, injection positions & results recorded; surviving mutations given disposition (add test | explicitly state no verification)
- [ ] Workspace reverted, no residual any injected mutation
- [ ] Haven't reported "tests all green" as "tests valid"
- [ ] Anti-pattern table checked row by row; no test-framework, test-mock, copy-implementation cases

## Reporting Template

```text
## Test Integrity Complete

**Milestone**: <M1 name>

| Criterion | Test | Mutation Check |
|---|---|---|
| A1 <one sentence> | <test name> | Injected boundary mutation → hangs ✓ |
| A2 <one sentence> | <test name> | Injected condition negate → hangs ✓ |
| A3 <one sentence> | <test name> | **Survived** ← see below |

**Isolation Method**: <child agent + restricted tools / degraded mode (test first commit, commit <hash>)>

**Surviving Mutations**: <what injected, why didn't hang, added test or explicitly stated no verification>

**Unverified Behaviors**: <clearly list; write "None" if none>
```

Don't write "all tests passed" in this report — that's run result, not conclusion.
Conclusion is "which behaviors truly verified, which not".
