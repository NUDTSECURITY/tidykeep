# Report Format

Use this semantic structure for a human-readable Rigor3 report. Exact prose may vary across hosts; required facts, arithmetic, qualification labels, and limitations may not.

## Contents

1. Outcome
2. Runtime qualification and provenance
3. Scorecard
4. Scope and evidence coverage
5. Findings
6. Quality gates
7. Remediation plan
8. Post-remediation comparison
9. Limitations and manual actions
10. Structured assessment

## 1. Outcome

Lead with:

- operating mode and assessed scope;
- baseline or post-remediation status;
- engine conformance: `conformance-qualified`, `conformance-failed`, or `unavailable`;
- execution qualification: `publication-qualified`, `publication-unqualified`, or `not reached`;
- assessment qualification: `rated`, `provisional`, `unrated`, or not computed;
- official Rigor3 Score, provisional computed result, assured floor, or **Unscored** as appropriate;
- overall coverage and evidence confidence when computed;
- whether repository files changed;
- whether a commit, push, pull request, release, deployment, or other external action occurred.

Use these distinctions exactly:

- **Unscored**: no engine became conformance-qualified or the real run did not become publication-qualified. Show no Rigor3 numeric result, including quarantined engine output.
- **Unrated**: a publication-qualified run computed valid metrics, but evidence is below provisional thresholds. Show the assured floor and keep `official_score` null.
- **Provisional Rigor3 result**: every dimension reached at least provisional, but the complete rated rule did not. Show `computed_score`; keep `official_score` null.
- **Official Rigor3 Score**: execution is publication-qualified and the complete assessment is rated. The value is `official_score`.

Do not call a provisional or unrated number a score without its qualification label.

## 2. Runtime qualification and provenance

Report a table containing:

| Field | Required value |
| --- | --- |
| Rigor3 package version | Exact version |
| Publication protocol version | Exact version |
| Assessment and rubric versions | Exact versions |
| Skill source | Revision when available and the canonical package digest defined below |
| Agent host | Name and visible version/model information |
| Engine conformance | Conformance-qualified, conformance-failed, or unavailable |
| Execution qualification | Publication-qualified, publication-unqualified, or not reached |
| Engine language and runtime | Family and exact version |
| Engine source | Retained absolute path and SHA-256 |
| Harness source | Retained absolute path and SHA-256 |
| Conformance | Parent cases passed/84, concrete variants passed/197, and every failed or skipped parent or variant label |
| Agent publication gates | Separate `E-004` through `E-010` status, evidence, every mandatory E-009 synthetic digest self-test result, E-010 orchestration facts, and any permitted not-applicable rationale; never only an aggregate result |
| Multi-agent orchestration | Host support, declared child capacity when observable, observed peak children and total agents, assignment totals by role and final state, idle-capacity exceptions, write conflicts, validator independence, failures, blockers, fallback, and final E-010 status |
| Deterministic replay | Both output digests and equality result |
| Syntax or compile check | Command/result or unavailable |
| Dependency installation | Must be false for qualification |
| Network access | Must be false for qualification |
| Repository code executed by engine | Must be false for qualification |
| Repository pollution | Before/after comparison and unexplained paths |
| Artifact retention | Retained paths or precise cleanup status |

If source is not retained, say that complete replay is impossible. A source digest alone does not make the execution independently reproducible. Format compatibility with an Agent host is not behavioral conformance for that host version.

## 3. Scorecard

For valid computed results, use:

| Dimension | Verified quality | Coverage | Evidence confidence | Assured score | Final score | Active ceiling |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Code Hygiene | 0–100 | 0–100% | 0–100% | 0–100 | 0–100 | 39/69/89/100 |
| Architecture Hygiene | 0–100 | 0–100% | 0–100% | 0–100 | 0–100 | 39/69/89/100 |
| Engineering Hygiene | 0–100 | 0–100% | 0–100% | 0–100 | 0–100 | 39/69/89/100 |

Then report:

- assessment `qualification`;
- `computed_score`;
- report-level `official_score`, including `null` explicitly and never presenting it as an engine field;
- `profile_average`;
- `overall coverage`;
- `minimum dimension coverage`;
- `overall evidence confidence`.

Explain every active severity ceiling immediately below the table. Attribute it only to active findings affecting that dimension and order tied finding identifiers lexicographically. Call a ceiling binding only when it reduces the assured score. Never average away a weak dimension.

Use these labels for final dimension scores:

| Score | Label |
| ---: | --- |
| 90–100 | Exemplary |
| 80–89.9 | Strong |
| 70–79.9 | Acceptable |
| 60–69.9 | Fragile |
| 0–59.9 | Failing |

## 4. Scope and evidence coverage

List:

- repository revision or dirty working-tree digest and digest method;
- included components and paths;
- excluded, generated, vendored, fixture, migration, infrastructure, and documentation paths with reasons;
- commands and runtime environments used;
- unavailable credentials, services, platforms, or tools;
- whether the work is full, scoped, partial, or sampled;
- any scope gaps or repository changes observed during engine execution.

Do not bury low coverage or digest limitations in a footnote.

## 5. Findings

Order by severity, user impact, dependency order, then stable identifier. Use:

```text
[P1] R3-004 — Concise title
Dimension: Architecture Hygiene
Primary control: AH-BND-02 — Dependency direction
Secondary controls: CH-CON-03, EH-GATE-02, or none
State: open
Evidence: src/example.ts:42; command and exit status
Impact: Concrete user, system, or engineering consequence
Severity rationale: Why adjacent levels were rejected
Remediation: Smallest credible correction
Verification: Exact check needed to close the finding
```

Keep hypotheses in a separate **Unverified hypotheses** section and exclude them from controls, ceilings, and scores.

Escape repository-controlled Markdown before rendering: prefix leading heading/list/quote characters with a backslash, replace table pipes with `\|`, fence multiline text safely, and render control or directional characters as visible Unicode labels rather than executing them. Never reproduce secrets.

## 6. Quality gates

Report every discovered gate, including unexecuted gates:

| Gate | Kind | Status | Controls | Evidence | Exact scope or limitation |
| --- | --- | --- | --- | --- | --- |

Keep static, focused, integration, browser, deployment, and production observations distinct.

## 7. Remediation plan

Provide an ordered Todo List. Every item names:

- finding identifiers;
- intended change and affected paths;
- prerequisite or dependency;
- verification gate;
- additional authorization required, if any.

Separate confirmed remediation from optional improvements.

## 8. Post-remediation comparison

When fixes occurred in Audit + Remediate mode, report two distinct assessment runs. Close and freeze the baseline run immediately before the first remediation mutation. Close the final run after every authorized mutation assignment reaches a retained terminal state, no mutation remains active, and every available required independent validation finishes or its unavailable or single-Agent limitation is recorded. The final assessment must retain failed, blocked, cancelled, superseded, unverified, and residual work rather than requiring every remediation to succeed.

Audit + Remediate reports require this section. Remediate and Verify reports require it only when a compatible retained baseline exists. Without one, report remediation-only verification and no before-and-after Rigor3 score comparison. Audit reports stop at the baseline, and Plan reports add a remediation backlog without inventing a final result.

Start with a comparability decision:

- **Directly comparable** requires identical assessment, rubric, and scoring-contract versions; declared scope; included and excluded surfaces; control-applicability decisions; and evidence-plan identity. Both runs must use the same publication protocol, or the frozen baseline must have a separate append-only requalification attestation under the final protocol with every then-required publication gate evaluated from retained evidence.
- **Not directly comparable** requires every mismatch to be listed. Present the two results separately and do not calculate or imply a numeric delta.

The evidence-plan identity is the canonical, protocol-independent report-level set of evaluation questions frozen before baseline evidence collection. It identifies what both repository states are asked to prove, not which Rigor3 package interprets the answers. The evidence policy has no independent version; package version, publication-protocol version, and retained Skill source digest remain separate bundle provenance. Protocol compatibility is established independently by using the same publication protocol or by requalifying the baseline under the final protocol.

Compute the Skill source digest from the installed package declared by `PACKAGE-MANIFEST.txt`. Require the manifest to contain unique portable ASCII relative paths, require its declared inventory to match the package exactly, reject symbolic links and non-regular files, and sort the paths by ascending ASCII byte order. Hash the exact byte sequence consisting of `RIGOR3-PACKAGE-V1` plus one line feed, followed for each path by a netstring of its path bytes and then a netstring of its raw file bytes. A netstring is the ASCII decimal byte length with no leading zero, except zero is `0`, then colon, the exact bytes, and comma. Do not normalize text, line endings, Unicode, or file contents. Spell the resulting SHA-256 as 64 lowercase hexadecimal characters without a prefix when placing it in `skill_source_sha256`; retain the `sha256:`-prefixed form for human provenance.

Create one canonical JSON record containing exactly these members in this order:

1. `record_version`, fixed to `RIGOR3-EVIDENCE-PLAN-V1`;
2. `questions`, containing exactly one object for every applicable control.

Each question object contains exactly these members in this order:

1. `control_id`;
2. `gate_kinds`, the planned qualifying gate kinds;
3. `claim_scopes`, the planned evidence claim scopes;
4. `verification_surfaces`, selected from `static`, `focused`, `integration`, `browser`, `deployment`, `production`, `platform`, and `runtime`;
5. `target_ids`, stable platform, browser, runtime, deployment, or other environment targets when the declared scope names them, otherwise an empty array.

Use only ASCII identifiers in this record. A `target_id` must match `[a-z0-9][a-z0-9._:@/-]*`; reject rather than normalize another spelling. Sort `questions` by `control_id` and sort every set-like string array by ascending ASCII byte order after rejecting duplicates. Serialize the fixed member order as strict UTF-8 JSON on one line with no insignificant whitespace, BOM, or trailing line feed. Retain those exact bytes and spell their digest as `sha256:` followed by 64 lowercase hexadecimal characters. The final bundle must reuse the frozen baseline record bytes; changing the record creates a different plan and makes the runs not directly comparable. Requalification under a later protocol re-evaluates the frozen baseline evidence under that protocol and records new provenance, but does not alter this protocol-independent plan record.

Repository-discovered gate identities, evidence records, command outcomes, tool or credential availability, finding states, and the volume or strength of collected evidence are results under that plan, not part of its identity. A newly available or newly passing check is therefore comparable when it answers the same planned question; adding, removing, or redefining a question or verification surface makes the runs not directly comparable.

For directly comparable publication-qualified results, add the per-dimension table:

| Dimension | Metric | Baseline | Final | Change | Evidence-based explanation | Residual risk |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Code Hygiene | Verified quality / coverage / evidence confidence / assured score / final score / active ceiling | Required values | Required values | Required deltas | Changed controls, evidence, findings, or ceilings | Remaining exposure |
| Architecture Hygiene | Verified quality / coverage / evidence confidence / assured score / final score / active ceiling | Required values | Required values | Required deltas | Changed controls, evidence, findings, or ceilings | Remaining exposure |
| Engineering Hygiene | Verified quality / coverage / evidence confidence / assured score / final score / active ceiling | Required values | Required values | Required deltas | Changed controls, evidence, findings, or ceilings | Remaining exposure |

Then add the overall table:

| Metric | Baseline | Final | Change or transition |
| --- | ---: | ---: | --- |
| Assessment qualification | Required | Required | State transition |
| `computed_score` | Required | Required | Numeric delta |
| Report-level `official_score` | Value or `null` | Value or `null` | Numeric delta only when both are non-null; otherwise state transition |
| `profile_average` | Required | Required | Numeric delta |
| Overall coverage | Required | Required | Percentage-point delta |
| Minimum dimension coverage | Required | Required | Percentage-point delta |
| Overall evidence confidence | Required | Required | Percentage-point delta |

Attribute every material movement to changed control outcomes, new or invalidated evidence, opened or closed findings, or changed active ceilings. Never use the existence of a diff, a passing command, or additional evidence volume as the explanation by itself.

If either side is **Unscored**, do not reveal quarantined engine metrics and do not manufacture numeric deltas. Instead compare visible scope, evidence, finding states, publication gates, qualification reasons, and residual risks. If either side is Unrated or Provisional, preserve that label and keep `official_score` null as required; compare allowed computed metrics only when both runs are publication-qualified, and describe `official_score` only as a qualification-state transition unless both values are non-null.

## 9. Limitations and manual actions

End with explicit lists for:

- checks not run;
- incomplete or contradictory evidence;
- engine or provenance limitations;
- manual external actions and owners;
- accepted risks;
- blocked items and exact unblock conditions;
- browser, deployment, production, or host behavior not verified.

Rated does not mean defect-free, security-certified, deployed, or production-verified.

## 10. Structured assessment

For a comparison, retain disjoint baseline and final bundles. List each bundle's role, stable identifier, capture timestamp, retained paths, unscored and scored SHA-256 digests when present, repository revision or working-tree digest, package and contract versions, scope and applicability identity, normalized evidence-plan identity and digest, publication-envelope and gate status, and successful `verify-scored` result when a scored artifact exists. Recalculate retained artifact digests before comparison. Record any later protocol requalification as a new append-only attestation; never edit the frozen baseline bundle.

Each bundle retains the unscored assessment defined by `assessment-contract.md`, the scored assessment produced under `scoring-contract.md` when available, and the separate runtime provenance. The scored assessment is the source for deterministic arithmetic. The Agent's publication envelope or human report may add `official_score`, but must not place that field inside the scored assessment, alter computed values, or hide a null publication decision.

Validate an existing scored artifact through `verify-scored <workspace-root> <unscored-input> <scored-artifact>`. That operation independently recomputes from the retained unscored assessment, requires the source records to match after canonical normalization, and rejects any scoring mismatch without modifying either input. Human-readable reports are not promised to be byte-identical across models or hosts.
