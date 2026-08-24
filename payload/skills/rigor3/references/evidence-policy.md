# Evidence Policy

## Contents

- [Evidence levels](#evidence-levels)
- [Evidence record requirements](#evidence-record-requirements)
- [Broad quality gates](#broad-quality-gates)
- [Control status rules](#control-status-rules)
- [Coverage, confidence, and qualification](#coverage-confidence-and-qualification)
- [Full-audit requirements](#full-audit-requirements)
- [Orchestration evidence](#orchestration-evidence)
- [Sanitization](#sanitization)
- [Claim boundaries](#claim-boundaries)

Use this policy for every Rigor3 assessment. A scored control is valid only when its status is supported by current, traceable, sanitized evidence.

## Evidence levels

Assign one evidence level:

| Level | Strength | Meaning |
| --- | ---: | --- |
| `A` | 1.00 | Current-revision, reproducible machine or runtime evidence with sufficient scope |
| `B` | 0.85 | Direct current source, configuration, artifact, or manually reproducible counterexample sufficient for the claim |
| `C` | 0.60 | Partial, sampled, indirect, stale, truncated, or incompletely reproducible evidence |
| `D` | 0.30 | Documentation, assertion, or inference without direct confirmation |

Use an evidence class to describe its origin:

- `command`
- `test_result`
- `static_analysis`
- `runtime_observation`
- `source_inspection`
- `configuration_inspection`
- `artifact_inspection`
- `documentation`
- `external_attestation`
- `manual_step`

Source-inspection, configuration-inspection, and artifact-inspection evidence cannot exceed level B. Documentation-class evidence is always level D. Do not inflate any category merely because the material is current, complete, or authoritative.

Use `artifact_inspection` only when the control claim is directly about the existence, absence, current content, completeness, or internal consistency of an inspectable non-executable artifact, such as an architecture map, ADR, ownership policy, contribution guide, setup guide, runbook, license, changelog, or release document. A complete direct inspection of that artifact or a complete inventory establishing its absence may be level B and may support the corresponding documentation, governance, developer-experience, or operational-documentation control. It does not prove that described commands work, people follow the policy, architecture matches runtime behavior, recovery succeeds, or any other behavior outside the artifact itself; those claims require separate qualifying evidence.

Use `documentation` when a document, comment, assertion, citation, or prose claim is offered to prove some other source, configuration, runtime, security, build, test, release, deployment, or operational fact. It remains level D even when current or authoritative. When one record would mix a direct artifact claim with a behavioral claim, split it into separate evidence records with the appropriate classes and strengths.

Rules:

1. A `pass` requires level A or B evidence and complete scope for the control's claim.
2. A `fail` requires a level A or B current counterexample.
3. Level C or D evidence may create an unverified hypothesis but cannot establish a scored `pass` or `fail`.
4. A sampled search may find a failure but cannot prove repository-wide absence of failures.
5. Documentation-class evidence and artifact inspection alone cannot prove runtime, security, build, test, deployment, recovery, policy adoption, or production behavior. Artifact inspection may prove only the bounded artifact claim defined above.
6. Stale-revision evidence has no scoring strength unless the audited content is proven byte-identical. In a dirty-tree assessment, every evidence record must use the repository's `working_tree_digest` as its revision basis; the base commit alone is insufficient.
7. Every non-context result record must be referenced by at least one gate, finding, control, applicability decision, or blocker; do not orphan inconvenient evidence.

## Evidence record requirements

Every evidence record must include:

- `id`: a unique identifier within the assessment;
- `class`: one class listed above;
- `level`: `A`, `B`, `C`, or `D`;
- `claim_scope`: `complete`, `counterexample`, `partial`, `sampled`, or `context`;
- `result`: `supports_pass`, `supports_failure`, `supports_blocker`, or `context`;
- `revision`: the clean repository revision, or the exact `working_tree_digest` for a dirty tree;
- `captured_at`: an RFC 3339 timestamp no later than `audit.completed_at`;
- `source`: a sanitized command, repository-relative path, artifact label, or manual step;
- `summary`: a concise observation;
- `sanitized`: `true` after sensitive values and terminal control sequences are removed.

When applicable, also include:

- repository-relative paths and stable line numbers;
- exact sanitized command arguments, working directory, and exit code;
- tool and runtime versions;
- retained output or artifact SHA-256 digest;
- whether repository-controlled code ran;
- whether the command created or modified any artifacts;
- limitations, filtering, truncation, and package selection.

Use compatible result and scope pairs only:

- `supports_pass`: `complete`, `partial`, or `sampled`;
- `supports_failure`: `complete` or `counterexample`;
- `supports_blocker`: `complete` or `context`;
- `context`: `complete` or `context`.

Any observed failure is a counterexample, even when the surrounding run was sampled or incomplete. Evidence with class `command` must include the structured command object.
Any structured command attached to a `supports_pass` record must have exit code `0`, regardless of the record's evidence class. Wrap negative expectations in a check that returns zero only when the expected condition is established.

For a control with several mandatory claims, create a complete evidence record only after every mandatory claim is covered. Assign that record the lowest strength among the evidence needed for those claims. Evidence for only one subclaim is `partial`, not `complete`; supplementary partial or sampled evidence does not displace qualifying complete evidence in the confidence calculation.

A single root cause may independently violate several controls. Keep one finding, give it one primary control, list every other independently violated obligation in `secondary_control_ids`, and reference that finding from each affected failed control. Each control still needs its own qualifying evidence. Do not list a secondary control merely because it is related; list it only when its own rubric claim fails.

## Broad quality gates

Record every discovered build, test, lint, type, package, security, integration, browser, deployment, or operational gate in the assessment's `gates` array. A gate contains a stable `id`, title, `kind`, status, one or more `control_ids`, evidence references, and notes describing exact scope or limitation. `control_ids` names only atomic claims materially covered or contradicted by the gate; it does not award points.

Gate kinds are `format`, `lint`, `type`, `test`, `build`, `package`, `schema`, `artifact`, `dependency`, `security`, `integration`, `browser`, `ci`, `release`, `deployment`, `operational`, or `other`.

Gate statuses are `pass`, `fail`, `partial`, `not_run`, `unavailable`, or `not_applicable`. A pass requires complete level A or B `supports_pass` evidence. A fail requires complete or counterexample level A or B `supports_failure` evidence. Partial requires partial or sampled level A or B `supports_pass` evidence and no confirmed failure; split mixed outcomes and use `fail` for any confirmed counterexample. Unavailable requires direct blocker evidence and no confirmed repository failure. Not-run may reference context evidence only. A not-applicable gate needs level A or B context evidence proving the gate has no applicable surface and may contain no current level A or B pass, failure, or blocker result.

A passing or partial gate requires an evidence class that can establish its kind of claim:

| Gate kinds | Eligible passing or partial evidence classes |
| --- | --- |
| `format`, `lint`, `type`, `schema`, `artifact`, `dependency` | `command`, `test_result`, `static_analysis`, `external_attestation`, `manual_step` |
| `test`, `build`, `package`, `integration`, `browser`, `ci`, `release`, `deployment`, `operational`, `other` | `command`, `test_result`, `runtime_observation`, `external_attestation`, `manual_step` |
| `security` | Any of the six executed classes above, including `static_analysis` and `runtime_observation` |

Static analysis cannot certify execution, browser behavior, release state, deployment state, or operational runtime behavior. Documentation, source inspection, configuration inspection, and artifact inspection can prove that a gate is missing, misconfigured, undocumented, or not applicable; they cannot prove that it executed successfully.

One gate record has one outcome across every listed control. Split package, workspace, browser, artifact, or command results when their outcomes differ. Gates describe command and workflow outcomes. They do not directly add or remove points. Atomic controls consume relevant evidence and remain the only scoring units, so one broad passing command never turns several unverified claims into passes.

Enforce these cross-record invariants:

1. A passing gate shares qualifying complete pass evidence with every linked control that passes.
2. A failed gate maps every listed control to `fail` and shares qualifying failure evidence with it.
3. A partial or not-run gate prevents every linked control from being `pass` or `not_applicable`.
4. An unavailable gate maps linked controls to `unavailable` unless a failed gate takes precedence, and shares blocker evidence.
5. A not-applicable gate shares context evidence with any linked conditional control also marked not applicable. If it is linked to a passing control, another linked passing gate must independently verify that control.
6. The executable claims `EH-BLD-02`, `EH-GATE-01` through `EH-GATE-04`, `EH-CICD-01`, and applicable `EH-CICD-03` require a linked gate of the matching kind. A pass requires at least one passing linked gate.
7. Use precedence `fail`, `unavailable`, `partial` or `not_run`, `pass`, then `not_applicable` when several material gates cover one control.

The required control-to-gate-kind mapping is fixed:

| Control | Allowed gate kinds |
| --- | --- |
| `EH-BLD-02` | `build`, `package` |
| `EH-GATE-01` | `format`, `lint` |
| `EH-GATE-02` | `type` |
| `EH-GATE-03` | `test`, `integration`, `browser` |
| `EH-GATE-04` | `build`, `package`, `schema`, `artifact` |
| `EH-CICD-01` | `ci` |
| `EH-CICD-03` | `deployment` |

The generated engine must enforce the complete `assessment-contract.md`, including local record shapes, status-dependent nullability, dirty-tree state, scope completeness, authorization dependencies, ID resolution, evidence semantics, revision matching, gate-control consistency, finding relationships, mutation authorization, control uniqueness, applicability floors, timestamps, and arithmetic across records. Acceptance by a conformance-qualified engine produces only quarantined metrics. The assessment is not publishable until the run becomes publication-qualified, and an official score additionally requires a Rated assessment.

## Control status rules

Use exactly one status per atomic control in `references/rubric.md`:

| Status | Earned points | Verified coverage | Requirement |
| --- | ---: | ---: | --- |
| `pass` | full control weight | yes | At least one qualifying `supports_pass` record covers the complete claim and no unresolved contradiction remains |
| `fail` | zero | yes | At least one qualifying `supports_failure` record and at least one active confirmed finding |
| `not_run` | zero | no | A relevant evaluation was not performed, with a non-empty reason |
| `unavailable` | zero | no | Evaluation was attempted but blocked, with blocker evidence and a required action |
| `not_applicable` | excluded | excluded | A conditional applicability rule is proven false |

Do not award partial credit. When a broad command is partial, classify each atomic control separately from the evidence it actually establishes.

Additional rules:

1. Preserve contradictory evidence and choose the more conservative status until resolved.
2. Missing required capability is usually `fail`, not `not_run`. For example, no CI configuration fails an applicable CI control.
3. Tool or credential absence is `unavailable` only after recording the attempted operation and blocker.
4. Only controls marked Conditional in the rubric may be `not_applicable`.
5. `not_applicable` requires the exact rule, rationale, and level A or B evidence that the rule evaluates false.
   Current level A or B pass, failure, or blocker evidence contradicts this status.
6. An entire dimension can never be `not_applicable`.
7. A timed-out or truncated check cannot establish a pass.
8. A `not_run` control may reference context evidence only. Confirmed failure evidence makes it `fail`; direct blocker evidence makes it `unavailable`.

## Coverage, confidence, and qualification

A conformance-qualified generated engine calculates these values for each dimension under `scoring-contract.md`:

```text
applicable_points = weight of every control except not_applicable
verified_points   = weight of pass and fail controls
passed_points     = weight of pass controls

verified_quality  = passed_points / verified_points × 100
coverage          = verified_points / applicable_points × 100
assured_score     = passed_points / applicable_points × 100
```

`verified_quality` describes observed quality inside the verified slice. `coverage` describes how much applicable rubric weight was verified. `assured_score` is the conservative scoring basis: unknown controls earn no points.

Evidence confidence is the weighted evidence strength across verified controls:

```text
evidence_confidence =
  sum(control weight × strongest qualifying evidence strength)
  / verified_points × 100
```

Additional weaker evidence does not reduce confidence merely because it is recorded. However, current level A or B failure evidence with complete or counterexample scope contradicts a pass and must be resolved; it cannot be omitted or averaged away.

Use these qualifications:

| Qualification | Requirement |
| --- | --- |
| `rated` | Every dimension has coverage at least 85 and confidence at least 80; declared scope is complete; no unresolved scope gaps |
| `provisional` | Every dimension has coverage at least 60 and confidence at least 60 |
| `unrated` | Any dimension is below provisional thresholds |

Always calculate the assured floor after valid scoring. The pure engine emits no `official_score`; the Agent records that report-level field as null unless the assessment is rated and the current execution is qualified. Report an unrated result as, for example, **Unrated; 10.0 points positively established**. A provisional result may show `computed_score` for diagnosis but is not an official Rigor3 Score.

Confidence describes evidence strength, not model certainty.

## Full-audit requirements

Call an assessment a **full repository audit** only when it:

- inventories every top-level component in scope;
- classifies generated, vendored, fixture, migration, infrastructure, and documentation paths;
- evaluates every applicable atomic control;
- records every skipped or unavailable gate;
- avoids replacing full inspection with an undisclosed sample;
- declares a complete scope with no unresolved gaps;
- reaches at least rated qualification.

If any condition is unmet, use **scoped audit**, **partial audit**, or **sampled review** as appropriate.

## Orchestration evidence

Keep orchestration provenance separate from scored control evidence. Record host subagent support, declared capacity when observable, observed peak active subagents, peak total agents, assignments by role, execution state, and validation state, dependencies, read authority and mutation-domain ownership, reassignment, idle-capacity exceptions, validator identity, failures, blockers, and fallback rationale.

An assignment contributes evidence only through the same current, traceable, sanitized record requirements as primary-Agent work. Agent agreement does not multiply evidence strength. A missing or failed child result cannot establish a control outcome. Preserve contradictions until stronger evidence resolves them.

Evaluate `E-010` under `orchestration.md`. When the host exposes no subagents, retain capability evidence for the permitted not-applicable result. When capacity is unknown, report the observed peak as a lower bound and the exact limitation. Do not infer unused capacity merely from an unknown host limit, but fail the gate when observable callable slots were left idle while safe ready work existed without rationale.

## Sanitization

Never place these values in evidence or reports:

- passwords, API keys, access tokens, session cookies, or private keys;
- complete environment variable values when they may be sensitive;
- credentials embedded in remote URLs;
- personal data that is unnecessary for the finding;
- private source content outside the authorized scope;
- unredacted command output containing customer or production data;
- uncontrolled terminal escape sequences or Unicode directional controls that can spoof rendered text.

Report the presence, source location, and risk of a secret without reproducing it. Prefer counts, hashes, placeholders, or redacted excerpts. Never enumerate the complete process environment.

## Claim boundaries

- Static inspection can establish source or configuration facts; it cannot establish deployed behavior.
- An unauthenticated response can establish route reachability; it cannot establish authenticated success.
- A focused test can establish its tested behavior; it cannot establish that every suite passes.
- A local build can establish local build success; it cannot establish CI, deployment, or production health.
- A dependency scan can establish results for its database, configuration, and timestamp; it cannot prove the absence of unknown vulnerabilities.
- A passing gate does not erase stronger contradictory evidence.
- No findings means no confirmed findings within the assessed scope and completed checks, not proof of defect absence.
- A format-compatible Agent host is not a release-verified host until live conformance tests pass there.
