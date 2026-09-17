# Conformance Cases

These expectations are normative for publication protocol `0.2.0`. Its pure-engine fixtures continue to target assessment schema, rubric, and scoring contract `0.1.0`. A model may generate fixtures and executable harness code, but it must not generate, infer from engine output, edit, skip, or weaken the expected results below.

## Contents

1. Harness rules
2. Base valid fixture
3. Required scoring cases
4. Required invalid assessment cases
5. Required concrete variant inventory
6. Required metamorphic cases
7. Harness-executable interface cases
8. Agent-evaluated publication gates
9. Agent-evaluated report-comparison cases
10. Qualification boundary

## Harness rules

1. Generate, inspect, freeze, and hash the engine source before creating executable fixtures or harness source.
2. Only after the engine is frozen, create the fixtures and separate harness source; inspect, freeze, and hash the harness before its first execution, and invoke the engine only through its command-line boundary.
3. Do not import engine internals or share its validation and arithmetic functions.
4. Express the expected values below as literal harness expectations.
5. Inspect the engine for case identifiers, repository-specific statuses, expected-score tables, or branches that special-case fixtures. Any match that affects behavior fails qualification.
6. Run every `S`, `V`, and `M` case plus executable interface cases `E-001` through `E-003`. The `0.1.0` pure-engine inventory has exactly 84 parent cases: 20 scoring, 49 invalid, 12 metamorphic, and 3 interface cases.
7. Run every harness-executable concrete variant in the fixed inventory below. A parent case passes only when all of its variants pass. Report both the 84-case parent total and the 197-variant concrete total, with every failed or skipped parent and variant label. The fixed Agent-side `E-009` digest self-tests are recorded separately and are not part of the 197-variant engine total.
8. A required rejection passes only when the engine exits exactly `2`, creates no output, preserves every existing named file byte-for-byte, leaves standard output empty, and writes exactly `rigor3: rejected` plus one line feed to standard error. A success passes only with exit `0` and both streams empty. Exit `3`, a crash, a signal, a traceback, or any extra output fails the case.
9. Do not alter an expectation after observing a failure. Regenerate or repair the engine and rerun the complete 84-parent, 197-variant suite.

The harness invokes exactly these engine commands:

```text
score <workspace-root> <unscored-input> <new-output>
verify-scored <workspace-root> <unscored-input> <scored-artifact>
```

The harness creates a fresh private workspace root and passes its canonical absolute path. Every other operand is a normalized workspace-relative path. `score` creates one scored artifact. `verify-scored` creates nothing: it validates both inputs, requires the scored artifact's source assessment to equal the explicit unscored input after canonical normalization, independently recomputes scoring, and rejects any mismatch. The harness never asks the engine to decide whether a computed result may be published as an official score.

## Base valid fixture

Every scoring case begins with a structurally valid assessment containing:

- contract and rubric version `0.1.0`;
- clean repository state and matching evidence revision;
- full, complete scope with no exclusions or gaps;
- Audit mode with every mutation authorization false and no mutations;
- exactly 20 applicable controls in each dimension, all passing;
- distinct complete level A pass evidence for every control;
- every mandatory broad gate present, passing, linked to the correct controls, and sharing eligible evidence;
- no findings, limitations, contradictions, or orphan evidence;
- valid timestamps, identifiers, paths, and bidirectional references.
- ASCII-only free-text fixture values except where a concrete variant explicitly supplies Unicode or control scalars.

The base result is case `S-001`. When a case changes a pass to fail, create qualifying failure evidence and one properly cross-linked active finding unless the case explicitly tests invalid data. When a case changes a control to not-run, unavailable, or not-applicable, update related gate states and evidence so the fixture remains valid unless invalidity is the point.

## Required scoring cases

These cases validate pure engine output. The scored artifact never contains `official_score`. A rated `computed_score` becomes a candidate for report-level publication only after the Agent separately passes every publication gate `E-004` through `E-010`. A provisional or unrated assessment is never eligible for official publication.

| ID | Override | Exact expected result |
| --- | --- | --- |
| `S-001` | None | Every dimension has applicable 100, verified 100, passed 100, quality 100.0, coverage 100.0, confidence 100.0, assured 100.0, ceiling 100, score 100.0, and rated qualification. Overall rated; computed score, assured floor, and profile average are 100.0. |
| `S-002` | One Code control fails under one P0 finding | Code assured 95.0, ceiling 39, score 39.0. Overall computed score 39.0; profile average 79.7. |
| `S-003` | One Code control fails under one P1 finding | Code score 69.0; overall computed score 69.0; profile average 89.7. |
| `S-004` | One Code control fails under one P2 finding | Code score 89.0; overall computed score 89.0; profile average 96.3. |
| `S-005` | One Code control fails under one P3 finding | Code assured and score 95.0; overall computed score 95.0; profile average 98.3. |
| `S-006` | One P1 root cause has a primary Code control and secondary Architecture control; both fail | Code 69.0, Architecture 69.0, Engineering 100.0; one finding; computed score 69.0; profile average 79.3. |
| `S-007` | Three Code controls become not-run | Code verified and passed 85, quality 100.0, coverage 85.0, confidence 100.0, assured and score 85.0, rated. Overall rated; computed score 85.0. |
| `S-008` | Four Code controls become not-run | Code coverage and score 80.0, provisional. Overall provisional; computed score and assured floor 80.0. |
| `S-009` | Eight Code controls become not-run | Code coverage and score 60.0, provisional. Overall provisional; computed score and assured floor 60.0. |
| `S-010` | Nine Code controls become not-run | Code coverage and score 55.0, unrated. Overall unrated; computed score and assured floor 55.0. |
| `S-011` | Every control becomes not-run | Every dimension has verified quality 0.0, coverage 0.0, confidence 0.0, assured and score 0.0. Overall coverage and overall evidence confidence are 0.0. Overall unrated; computed score and assured floor 0.0. |
| `S-012` | Every valid conditional control becomes not-applicable and all remaining controls pass | Applicable points are Code 80, Architecture 75, Engineering 75. Every dimension and overall are rated at 100.0; computed score is 100.0. |
| `S-013` | Variant 1 gives one Code control complete B evidence while the other 19 have complete A; variant 2 gives `AH-DOC-01` only complete level B `artifact_inspection` evidence while every other Architecture control has complete A | The affected dimension's confidence is 99.3 and remains rated. In variant 1, adding partial A evidence to the B-backed control leaves confidence at 99.3. Variant 2 proves that direct inspection of the documentation artifact can establish only its bounded artifact claim. |
| `S-014` | Every verified control has complete B evidence | Every dimension has confidence 85.0 and remains rated at complete coverage under the fixed 80 threshold. Overall computed score is 100.0. |
| `S-015` | All controls pass, but scope is partial, incomplete, and has one gap | Every dimension is rated; overall is provisional. Computed score and assured floor are 100.0. |
| `S-016` | A formerly P0 finding is fixed with complete current pass evidence and its control passes | No active ceiling; every score is 100.0 and overall is rated. |
| `S-017` | One P1 finding is accepted risk and its control fails | The finding remains active; affected dimension ceiling and score are 69.0. |
| `S-018` | One P2 finding is blocked and its control fails | The finding remains active; affected dimension ceiling and score are 89.0. |
| `S-019` | All five conditional Architecture controls are not-applicable; 13 of the 15 remaining controls pass and two are not-run | Architecture applicable points 75, verified and passed points 65, coverage, assured, and score 86.7 after half-up presentation. Threshold decisions use the unrounded 86.666… value. |
| `S-020` | Canonical normalization and serialization stress | Variant 1 permutes controls, evidence, gates, and findings and produces a byte-identical complete scored artifact to the unpermuted input. Variant 2 retains the all-pass result while exercising direct non-ASCII scalars, required string escapes, preserved nested-array order, empty containers, and accepted source token `-0`; output follows the exact canonical byte profile and normalizes `-0` to `0`. |

## Required invalid assessment cases

Every case must exit invalid and create no scored output. The table states parent requirements; the concrete variant inventory immediately after it is also normative.

| ID | Invalid mutation |
| --- | --- |
| `V-001` | Duplicate JSON object key |
| `V-002` | `NaN`, `Infinity`, or `-Infinity` |
| `V-003` | Invalid UTF-8 |
| `V-004` | Input larger than 5 MiB |
| `V-005` | Unknown schema or rubric version |
| `V-006` | Missing or extra top-level key, including a supplied `scoring` key |
| `V-007` | 59 controls |
| `V-008` | 61 controls, duplicate control ID, or unknown control ID |
| `V-009` | Core control marked not-applicable |
| `V-010` | Fewer than 70 applicable points in any dimension |
| `V-011` | Pass without complete level A or B pass evidence |
| `V-012` | Pass with current qualifying contradictory failure evidence |
| `V-013` | Fail without qualifying failure evidence |
| `V-014` | Fail without an active finding |
| `V-015` | Not-run without a reason or with non-context result evidence |
| `V-016` | Unavailable without attempted operation, blocker evidence, or required action |
| `V-017` | Unavailable with confirmed failure evidence |
| `V-018` | Not-applicable without qualifying context evidence or with contradictory result evidence |
| `V-019` | Active finding without qualifying failure evidence |
| `V-020` | Fixed or false-positive finding without complete current pass evidence |
| `V-021` | Closed finding carrying current qualifying failure evidence |
| `V-022` | Finding not referenced by every primary and secondary control it names |
| `V-023` | Non-context evidence referenced nowhere |
| `V-024` | Evidence revision differs from clean revision or dirty-tree digest |
| `V-025` | Evidence timestamp follows audit completion, audit completion precedes audit start, or a timestamp violates the fixed lexical profile |
| `V-026` | Documentation evidence above D or source, configuration, or artifact inspection at A |
| `V-027` | Static evidence certifies runtime, browser, release, deployment, or operational success |
| `V-028` | A supports-pass command has nonzero exit code |
| `V-029` | `supports_failure` with `partial` or `sampled` claim scope |
| `V-030` | Passing gate and linked passing control do not share qualifying evidence |
| `V-031` | Failed gate links to a non-failed control |
| `V-032` | Partial or not-run gate links to a passing or not-applicable control |
| `V-033` | Unavailable gate hides a confirmed higher-precedence failure |
| `V-034` | Mandatory executable control lacks a linked gate of an allowed kind |
| `V-035` | Absolute, traversing, backslash, empty, normalization-changing, or drive-qualified repository path |
| `V-036` | NUL, ESC, forbidden C0 character, Unicode directional control, or unpaired UTF-16 surrogate in a string |
| `V-037` | Mutation appears in Audit or Plan mode |
| `V-038` | Dependency change without edits, stage without edits, commit without stage, or push without commit |
| `V-039` | Mutation record lacks its corresponding authorization |
| `V-040` | Dirty repository has a missing or structurally invalid `working_tree_digest`, or a clean repository has a non-null `working_tree_digest` |
| `V-041` | Finding primary and secondary identifiers overlap or reference unknown controls |
| `V-042` | Gate, finding, control, applicability, or blocker references an unknown identifier |
| `V-043` | Identifier exceeds 128 characters or contains a nonportable character |
| `V-044` | Invoke `verify-scored` with the unchanged unscored input and a scored artifact whose arithmetic differs from independent recomputation by 0.1 or more; the command rejects and modifies neither input |
| `V-045` | An unknown field appears inside any nested record |
| `V-046` | An integer field uses a boolean or non-integer numeric token, or a line number or command exit code lies outside the portable exact integer range |
| `V-047` | An included or excluded scope path is duplicated, or an exclusion lies outside every included root |
| `V-048` | Optional `command` or `artifact_sha256` is present as `null` instead of being absent |
| `V-049` | `verify-scored` receives a semantically equivalent scored artifact whose bytes violate the canonical scored JSON profile |

## Required concrete variant inventory

Every parent case not listed below has exactly one concrete variant labeled `<parent>.1`. For each listed parent, execute the ordered mutations from left to right as `.1`, `.2`, and so on. Semicolon-separated mutations are distinct variants; words joined by **and** inside one mutation describe one composite fixture. Do not substitute a different malformed shape that happens to exercise nearby code.

Use fresh input and output paths for every variant and retain its exit status, complete process streams, and input/output preservation result. The stable inventory contains 197 harness-executable concrete variants in total. The parent count remains 84; a parent passes only when every child variant below it passes. Agent-side publication-gate subchecks are recorded separately.

| Parent | Variant count | Ordered required mutations |
| --- | ---: | --- |
| `S-001` | 2 | unchanged base fixture; valid timestamp boundaries with `started_at` `0001-01-01T00:00:00Z`, `completed_at` `9999-12-31T23:59:59.999999999Z`, the two lexicographically first evidence records' `captured_at` values set respectively to `2026-01-01T00:00:00.123456789+23:59` and `2026-01-01T00:00:00.123456789-23:59`, and every other timestamp unchanged and valid |
| `S-013` | 2 | one Code control backed by complete B plus partial A evidence; `AH-DOC-01` backed solely by complete level B `artifact_inspection` evidence for the current architecture artifact |
| `S-020` | 2 | permute the four ID-normalized record arrays; set one command `exit_code` with raw JSON token `-0`, set one evidence `paths` array exactly to `z/path`, then `a/path`, and add exactly one limitation whose scalar sequence is `A`, U+0009, `B`, U+000A, `C`, U+000D, `D`, U+0022, `E`, U+005C, `F/G`, U+0020, `café`, U+0020, U+1F600, U+0020, `<&>`, U+0020, U+2028, U+0020, U+2029, while retaining valid all-pass semantics and at least one empty array |
| `V-002` | 3 | `NaN`; `Infinity`; `-Infinity` |
| `V-005` | 2 | unknown assessment schema version; unknown rubric version |
| `V-006` | 3 | missing required top-level key; unknown ordinary top-level key; supplied `scoring` key |
| `V-008` | 3 | 61 controls; duplicate control ID; unknown control ID |
| `V-010` | 3 | Code below 70 applicable points; Architecture below 70; Engineering below 70 |
| `V-015` | 2 | not-run without a reason; not-run with non-context result evidence |
| `V-016` | 4 | unavailable with no blocker object; missing attempted operation; no qualifying blocker evidence; missing required action |
| `V-018` | 2 | not-applicable without qualifying context evidence; not-applicable with contradictory result evidence |
| `V-020` | 2 | fixed without complete current pass evidence; false-positive without complete current pass evidence |
| `V-021` | 2 | fixed with current qualifying failure evidence; false-positive with current qualifying failure evidence |
| `V-022` | 2 | missing the primary-control backlink; missing one required secondary-control backlink |
| `V-024` | 2 | clean evidence revision mismatch; dirty evidence digest mismatch |
| `V-025` | 16 | evidence timestamp after audit completion; audit completion before audit start; lowercase `t`; lowercase `z`; leap second `:60`; replace the first year digit with fullwidth `２`; year `0000`; five-digit year `10000`; empty fraction before `Z`; ten-digit fraction; missing offset; invalid calendar date `2025-02-29`; hour `24`; minute `60`; offset `+24:00`; offset `+00:60` |
| `V-026` | 4 | documentation evidence above D; source inspection at A; configuration inspection at A; artifact inspection at A |
| `V-027` | 5 | static evidence certifies runtime success; browser success; release success; deployment success; operational success |
| `V-029` | 2 | `supports_failure` with `partial` scope; `supports_failure` with `sampled` scope |
| `V-031` | 4 | failed gate links to a passing control; not-run control; unavailable control; not-applicable control |
| `V-032` | 4 | partial gate links to a passing control; partial gate links to a not-applicable control; not-run gate links to a passing control; not-run gate links to a not-applicable control |
| `V-034` | 7 | missing allowed gate for `EH-BLD-02`; `EH-GATE-01`; `EH-GATE-02`; `EH-GATE-03`; `EH-GATE-04`; `EH-CICD-01`; applicable `EH-CICD-03` |
| `V-035` | 7 | absolute path; parent traversal; backslash path; invalid empty path; repeated separator `a//b`; interior dot segment `a/./b`; Windows drive prefix `C:/x` |
| `V-036` | 5 | NUL; ESC; forbidden C0 character; Unicode directional control; unpaired surrogate escape `\uD800` |
| `V-037` | 2 | mutation in Audit mode; mutation in Plan mode |
| `V-038` | 4 | dependency change without edits; stage without edits; commit without stage; push without commit |
| `V-039` | 8 | unauthorized edit; dependency change; stage; commit; push; pull request; deployment; other external write |
| `V-040` | 3 | dirty repository with missing digest; dirty repository with structurally invalid digest; clean repository with non-null digest |
| `V-041` | 3 | primary/secondary overlap; unknown primary control; unknown secondary control |
| `V-042` | 5 | gate references an unknown identifier; finding does; control does; applicability does; blocker does |
| `V-043` | 2 | identifier longer than 128 characters; identifier with a nonportable character |
| `V-045` | 15 | unknown field in audit; audit host; repository; scope; excluded-path item; authorization; evidence; evidence command; finding; finding location; gate; control; applicability; blocker; mutation |
| `V-046` | 5 | `line_start` above 9,007,199,254,740,991; `exit_code` below -9,007,199,254,740,991; boolean token `true` as `exit_code`; decimal JSON token `0.0` as `exit_code`; exponent JSON token `0e0` as `exit_code` |
| `V-047` | 3 | duplicate `scope.included_paths` entry; duplicate `scope.excluded_paths` path; included roots contain only `src` while an excluded path is `docs` |
| `V-048` | 2 | optional `command` present as `null`; optional `artifact_sha256` present as `null` |
| `V-049` | 4 | compact otherwise canonical scored JSON onto one line; in the `S-020.2` artifact replace its sole direct UTF-8 `é` with `\u00e9`; reorder two members of one nested object; replace one canonical integer token `0` in the source-assessment portion with semantically equal token `-0` |
| `M-007` | 2 | add a fixed finding; add a false-positive finding |
| `M-008` | 2 | add an accepted-risk finding; add a blocked finding |
| `E-003` | 2 | output path is a symbolic link; output path traverses outside the supplied workspace root |

## Required metamorphic cases

| ID | Transformation and invariant |
| --- | --- |
| `M-001` | Adding weaker supporting evidence to a control with stronger complete evidence does not lower confidence. |
| `M-002` | Adding partial A evidence to complete B evidence does not raise that control's confidence strength. |
| `M-003` | Reordering records does not change normalized scoring. |
| `M-004` | Changing one pass to not-run cannot increase coverage, assured score, or qualification. |
| `M-005` | Changing one pass to fail cannot increase verified quality or assured score. |
| `M-006` | Raising an active finding from P2 to P1 cannot increase an affected score. |
| `M-007` | Adding a fixed or false-positive finding cannot activate a ceiling. |
| `M-008` | Adding an accepted-risk or blocked finding activates its ceiling when its affected control fails. |
| `M-009` | Increasing an unrelated dimension cannot increase a weaker dimension or the weakest-dimension headline. |
| `M-010` | Two fresh processes using frozen source and identical input bytes produce byte-identical scored output. |
| `M-011` | After a successful `score`, edit any supplied arithmetic in a separate copy of the scored artifact. `verify-scored` with the unchanged unscored input rejects and modifies neither input. |
| `M-012` | A new status vector created after engine freeze agrees with a separate harness calculation for every presented per-dimension field. The harness derives its expected values with independent exact rational arithmetic, checks threshold and ceiling decisions against those unrounded rationals, and does not rely only on the headline. |

## Harness-executable interface cases

The black-box harness runs these cases with the `score` command. They count in the executable conformance total.

| ID | Expected qualification behavior |
| --- | --- |
| `E-001` | Invoke `score` with identical input and output paths: the engine rejects and preserves the input. |
| `E-002` | Invoke `score` when the output path already exists: the engine rejects and preserves the existing output. |
| `E-003` | Invoke `score` for each fixed unsafe-output variant: the engine rejects before writing and does not follow a link or escape the supplied workspace root. |

## Agent-evaluated publication gates

These seven orchestration and provenance gates are not engine input cases. The Agent evaluates and records each one outside the harness at the prescribed phase: `E-007` runtime discovery, `E-006` source inspection, and `E-010` capability discovery begin before repository inspection; interim source and repository checks after the harness establish conformance-qualified status; final `E-004`, `E-005`, `E-009`, and `E-010` are completed only after the last real invocation and the last contributing assignment, then `E-008` aggregates them to establish or deny publication-qualified status. The pure engine never receives or reports either status or `official_score`.

| ID | Required publication behavior |
| --- | --- |
| `E-004` | Recalculate both frozen source digests after executable conformance and after every real engine invocation contributing to the report. A change to either source invalidates qualification and requires the complete executable suite to rerun. The final publication decision occurs only after the last real invocation. |
| `E-005` | Compare the sanitized audited-repository fingerprint captured immediately before the first engine execution, after executable conformance, and after every real engine invocation contributing to the report. Any unexplained delta at any boundary makes the current run publication-unqualified and **Unscored**, with report-level `official_score` null; no automatic cleanup touches user files. Neither generated source nor either conformance process receives repository-specific information. During the controlled real invocation, the engine receives only the structured, sanitized assessment described by `assessment-contract.md`; the harness never receives it, and the engine never receives the actual repository root, raw repository files, the fingerprint, secrets, or unsanitized content. |
| `E-006` | Inspect engine and harness source before execution. Networking, dependency installation, environment enumeration, shell evaluation, dynamic loading, repository execution, or writes outside the temporary root make either source ineligible. Engine case identifiers or hard-coded fixture outcomes are forbidden. Harness literal expectations required by this document are allowed, but deriving them from engine output, importing engine internals, or sharing engine implementation functions is forbidden. |
| `E-007` | If a suitable installed runtime is recorded, mark this negative branch not applicable with that evidence. If none exists, mark the engine unavailable, report **Unscored**, and keep the report-level `official_score` null. |
| `E-008` | Aggregate all 84 parent results, all 197 concrete-variant results, and Agent gates `E-004` through `E-007`, `E-009`, and `E-010` after the last real engine invocation and contributing assignment. If a parent or variant is skipped or fails, or an aggregated Agent gate lacks its required pass or explicitly permitted not-applicable result, mark the current run publication-unqualified, report **Unscored**, and keep report-level `official_score` null. A documented E-007 suitable-runtime branch, E-009 clean-repository reproduction branch, and E-010 no-subagent branch are valid not-applicable results, not failures; every E-009 synthetic self-test is always required. `E-008` does not recursively aggregate itself. |
| `E-009` | First run every fixed synthetic digest self-test below on every assessment. Then, for every dirty assessment, independently reproduce the real `working_tree_digest` procedure in `assessment-contract.md` after scoring and require an exact match, regardless of scope kind or completeness. A failed self-test, mismatch, or inability to inventory every required path makes the current run publication-unqualified and **Unscored**, with report-level `official_score` null; it is not an engine structural-validation failure. For a clean repository, only the real-repository reproduction branch is not applicable; retain every passing synthetic self-test result and clean-state evidence. |
| `E-010` | Apply `orchestration.md` throughout the run. Pass only when the Agent used all safely useful observable child-agent capacity, continuously backfilled at scheduling events, preserved exclusive mutation-domain ownership, independently validated assessment- and publication-contributing batches when a non-authoring agent was available, retained every assignment outcome, and explained every capacity exception. Fail on unjustified idle safe capacity, utilization-padding work, overlapping unisolated mutations, skipped available independent validation, or hidden assignment failure. Mark not applicable only with evidence that the host exposes no subagents; use the single-agent fallback and disclose the limitation. This gate is Agent-side and does not change the 84-parent or 197-variant executable inventory. |

### Fixed E-009 synthetic digest self-test

The positive fixed `E-009` synthetic self-test uses revision `fixture-revision`, included roots `src`, `src/nested`, and `src/generated`, and exclusions `src/generated` and `src/generated/nested`. Create non-executable regular files `src/a.txt` with exact bytes `A` plus line feed, `src/nested/b.txt` with exact byte `B`, `src/generated/c.txt` with exact byte `C`, `src/generated/nested/d.txt` with exact byte `D`, and `docs/out.txt` with exact bytes `OUT`. The normalized inventory must contain only `src/a.txt` and `src/nested/b.txt`, each exactly once and with mode `100644`; the generated and descendant paths are excluded, and the `docs` file is outside the union. The digest must equal `sha256:2810beb350047c41124b6fc985cb004401e4dce5eb2c78a17599b958070c7be0`. This subcheck proves overlapping included-root de-duplication, exclusion precedence over an explicit included root, descendant exclusion, overlapping-exclusion idempotence, and omission of out-of-scope paths.

Run two negative synthetic classifier subchecks before accepting the positive digest: a record whose path contains the unpaired surrogate U+D800, and a record classified as an unsupported Windows reparse point. Invoke the Agent-side digest implementation at its inventory-to-record boundary; each input must fail closed before any netstring or digest is emitted. If the implementation has no independently callable boundary capable of these fixed inputs, its E-009 implementation is not qualified. These subchecks prove that lossy or non-UTF-8 names and unsupported entry kinds cannot be silently hashed. All three subchecks are Agent-side gate evidence, not pure-engine input cases and not part of the 197 concrete-variant count.

## Agent-evaluated report-comparison cases

Apply these fixed interpretation cases whenever a report compares baseline and final results. They are Agent-side report-protocol cases, not engine or harness inputs, do not change the 84-parent or 197-variant inventory, and do not permit access to quarantined metrics.

| ID | Class | Fixed expectation |
| --- | --- | --- |
| `RPT-001` | Positive | Two separately closed, publication-qualified runs with identical assessment, rubric, scoring, and publication protocols, identical scope and applicability, and the same normalized evidence-plan identity may report attributed per-dimension and overall numeric deltas. A newly available or newly passing check remains comparable when it answers the same planned question. |
| `RPT-002` | Negative | Different assessment, rubric, or scoring versions; scope surfaces; applicability decisions; or planned evaluation questions or verification surfaces make the results not directly comparable and forbid every numeric delta. |
| `RPT-003` | Boundary | Different publication protocols forbid direct comparison unless the frozen baseline receives a separate append-only requalification attestation under the final protocol with every then-required gate evaluated from retained evidence. |
| `RPT-004` | Safety | If either run is **Unscored**, reveal no quarantined metric and report no numeric delta; compare only visible scope, evidence, findings, gates, qualification reasons, and residual risk. |
| `RPT-005` | Boundary | For Rated to Provisional, Provisional to Rated, or any transition where either `official_score` is null, preserve allowed computed metrics only when both runs are publication-qualified and report `official_score` as a state transition, never a numeric Official Score delta. |
| `RPT-006` | Boundary | A final assessment is still required when remediation or validation ends failed, blocked, cancelled, superseded, unavailable, or under the single-Agent fallback; retain those outcomes and residual findings rather than inventing successful completion. |
| `RPT-007` | Negative | Remediate or Verify mode without a compatible retained baseline produces no before-and-after Rigor3 score comparison and must not synthesize a baseline or silently become Audit + Remediate. |
| `RPT-008` | Metamorphic | Changing diff size, prose, command count, or evidence volume without changing qualifying control outcomes, evidence strength, findings, ceilings, or scoring inputs cannot by itself justify or explain a metric increase. |
| `RPT-009` | Safety | The baseline and final bundles remain disjoint and digest-stable. A later qualification decision is a new attestation; mutating or reconstructing either frozen bundle invalidates the comparison. |

## Qualification boundary

Self-generated tests reduce risk but do not prove independent correctness. Retain engine source, harness source, hashes, parent and concrete-variant transcripts, and Agent publication-gate results for auditability. Conformance-qualified status requires all 84 parent cases and all 197 concrete variants plus the prescribed interim integrity checks to pass. Publication-qualified status additionally requires every final Agent gate `E-004` through `E-010`, including all fixed E-009 synthetic self-tests and the E-010 orchestration review, to pass or use an explicitly permitted not-applicable branch after the last real invocation and contributing assignment. The synthetic self-tests are never not applicable. Official publication further requires a rated assessment. Release claims require fresh forward tests using at least two materially different runtime families and must name host, host version, model, date, runtime, parent-case results, concrete-variant results, and publication-gate results separately.
