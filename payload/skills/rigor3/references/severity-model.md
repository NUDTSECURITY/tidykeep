# Severity Model

Assign severity from demonstrated impact, likelihood or reachability, blast radius, and recoverability. Never use cleanup effort or personal preference as severity.

## Levels

### P0 — Critical

Use P0 when confirmed evidence shows one or more of:

- credible compromise of confidentiality, integrity, or availability;
- irreversible data loss or corruption in a primary workflow;
- systemic release or supply-chain compromise;
- exposed high-impact credentials or unauthorized privileged access;
- catastrophic production failure with no practical containment.

P0 requires immediate containment before normal remediation continues.

### P1 — High

Use P1 when confirmed evidence shows one or more of:

- a core workflow is broken or materially unsafe for a significant user group;
- a serious security boundary failure needs plausible preconditions;
- a critical-path reliability failure has broad or repeated impact;
- architecture coupling or state ownership makes ordinary changes highly regression-prone;
- required build, migration, test, release, or deployment gates consistently fail;
- recovery is possible but costly, risky, or operationally disruptive.

### P2 — Medium

Use P2 when confirmed evidence shows one or more of:

- bounded but meaningful correctness, reliability, accessibility, maintainability, or engineering harm;
- a non-core defect has a practical workaround;
- localized duplication, complexity, weak contracts, or missing coverage creates credible repeated risk;
- inconsistent automation or documentation causes recurring engineering friction.

### P3 — Low

Use P3 for bounded quality defects with limited immediate impact, such as:

- minor clarity or consistency problems;
- low-risk dead code or stale documentation;
- small repository hygiene defects;
- defensive improvements whose absence is not causing material failure.

Use unscored **Info** observations for optional improvements without a confirmed obligation violation. Do not report subjective style preferences as findings unless they violate an established repository rule or create measurable harm.

## Required rationale

Every scored finding must explain:

- impact;
- likelihood or reachability;
- blast radius;
- reversibility or recovery;
- affected users, systems, or engineering workflows;
- why the adjacent higher and lower severity were rejected.

## Finding states

Use one state:

- `open`: confirmed and unresolved;
- `fixed`: remediated and verified against the assessed revision;
- `accepted_risk`: intentionally retained with explicit owner acceptance;
- `blocked`: remediation cannot proceed because of a concrete external dependency or missing authority;
- `false_positive`: disproved by stronger evidence and excluded from score ceilings.

Code changes alone do not justify `fixed`. Attach current level A or B verification evidence. `accepted_risk` and `blocked` remain active risk.

## Score ceilings

Severity ceilings are not additional point deductions. Apply the lowest ceiling from active findings after calculating the affected dimension's assured score:

| Highest active severity | Affected dimension ceiling |
| --- | ---: |
| P0 | 39 |
| P1 | 69 |
| P2 | 89 |
| P3 or none | 100 |

Apply a finding's ceiling to the dimension of its primary control and to every dimension containing an independently violated secondary control. The headline Rigor3 Score is the lowest final dimension score, so an affected dimension automatically limits the overall result. Findings in `fixed` or `false_positive` state do not apply a ceiling.

## Deduplication

Use one primary finding for one root cause. Reference secondary controls or dimensions without deducting again.

Separate findings only when they have independently actionable obligations, evidence, remediation, and verification paths. Multiple findings attached to one atomic control cannot deduct more than that control's fixed 5 points.
