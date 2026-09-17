# Runtime Engine Generation

Rigor3 deliberately ships no executable validator, scorer, renderer, or machine schema. Generate the smallest sufficient local implementation from the Markdown contracts each time numeric scoring is required.

## Contents

1. Required separation
2. Select a runtime
3. Generate outside the repository
4. Inspect before execution
5. Qualify the engine and publication path
6. Record provenance
7. Fail closed

## Required separation

Create two independent source artifacts in this order:

1. **Engine** — parses, validates, and scores one assessment according to `assessment-contract.md` and `scoring-contract.md`. Inspect, freeze, and hash it before creating fixtures or the harness.
2. **Harness** — created only after the engine is frozen; invokes the engine as a black box and checks every `S`, `V`, and `M` parent expectation plus executable interface cases `E-001` through `E-003`, including every fixed concrete variant in `conformance-cases.md`.

The harness must not import engine internals, share or copy engine implementation functions, ask the engine to produce expected values, or weaken expected results after a failure. It may independently implement the literal expectations and exact rational calculations required by `conformance-cases.md`, create fixtures from the fixed construction recipes, and invoke the engine through its command-line boundary. The Agent, not the harness or engine, evaluates orchestration and publication gates `E-004` onward.

Rendering Markdown is optional and must remain separate from score computation. Never let a renderer alter arithmetic.

## Select a runtime

1. Inventory already-installed general-purpose runtimes with a safe version command.
2. Prefer a maintained runtime already used by the host, or one identified by trusted user or host context available before repository reading, when it can satisfy the contract using only its standard library. Do not inspect repository files to select the phase-0 runtime.
3. Otherwise use any installed runtime with strict UTF-8 JSON parsing, exact decimal or rational arithmetic, SHA-256, safe temporary files, and subprocess support for the harness.
4. Do not require the engine language to match the audited repository language.
5. Do not download a runtime, install packages, modify dependency manifests, or access the network merely to score.

If no installed runtime can satisfy the contract, stop at **Unscored**.

## Generate outside the repository

Use a new private operating-system temporary directory outside the audited repository. Generate the engine while the audited repository is not the current working directory. Redirect compiler and runtime caches into that same temporary root. Generate only the engine, harness, fixtures, and outputs needed for the current run. Do not write caches, compiled artifacts, lockfiles, or configuration into the repository.

The Agent creates one new private workspace and passes its canonical absolute path explicitly. The engine exposes exactly two command forms:

```text
score <workspace-root> <unscored-input> <new-output>
verify-scored <workspace-root> <unscored-input> <scored-artifact>
```

`workspace-root` is the canonical absolute spelling of an existing ordinary directory created and owned by the Agent for this run. It must equal the operating system's resolved real path and must not itself be a symbolic link or reparse point. Every other path operand uses the normalized relative-path grammar in `assessment-contract.md`, with `.` forbidden. Resolve every operand beneath the supplied root without following symbolic links or reparse points. Each input and every existing path component must be an ordinary filesystem entry of the required type. An input is an ordinary regular file. An output parent is an existing ordinary directory, and the output does not exist. Reject absolute operands, traversal, normalization-changing spellings, links, special files, a root mismatch, or any resolution outside the root before reading or writing.

`score` validates the explicit unscored input, computes only the deterministic `scoring` object defined by `scoring-contract.md`, and exclusively creates a new canonical scored artifact at the distinct output path. It returns zero only after complete validation and scoring and never overwrites an existing output.

`verify-scored` validates the explicit unscored input and existing scored artifact, requires the artifact's source assessment to equal the explicit input after canonical normalization, independently recomputes scoring from that input, and returns zero only when the supplied `scoring` object matches exactly after canonical normalization. It creates no output and modifies neither input.

The isolation boundary distinguishes generated source from controlled runtime data. Neither source artifact may be derived from repository-specific information. During conformance, neither process receives repository metadata, paths, evidence, raw content, or the repository fingerprint. During the controlled real invocation, the engine receives only the structured, sanitized assessment file copied into the private workspace. That input necessarily includes the declared repository display name, revision or digest, normalized relative paths, and sanitized evidence summaries and locations. It never includes the actual repository root, raw repository files, the `E-005` fingerprint, credentials, secret values, or unsanitized command output. The harness never receives or processes the real assessment.

The pure engine never emits, accepts, or decides `official_score`. That is an Agent report-level publication decision after all qualification gates pass. The process protocol is exact:

- success exits `0` with empty standard output and empty standard error;
- an argument, path, input, or scored-artifact rejection exits `2`, leaves standard output empty, and writes exactly `rigor3: rejected` plus one line feed to standard error;
- an unexpected internal failure exits `3`, leaves standard output empty, and writes exactly `rigor3: internal failure` plus one line feed to standard error;
- a signal, panic, exception traceback, other status, or any extra output never satisfies a conformance expectation.

Neither failure message may contain assessment data, path operands, environment data, or secrets.

The engine must:

- use only its runtime's standard library;
- make no network requests;
- invoke no shell and execute no repository code;
- perform no dynamic evaluation or runtime code loading;
- read only the validated input paths named by the active command and its own immutable source;
- for `score`, exclusively create only the named new output beneath the supplied workspace root;
- for `score`, reject an output that already exists, any link or special entry, identical input/output paths, and any path with a linked component;
- for `verify-scored`, read only the two named inputs and write nothing;
- parse at most 5 MiB of strict UTF-8 JSON;
- reject duplicate object keys, non-finite numbers, unknown fields, missing fields, unsafe paths, invalid identifiers, forbidden controls, and unsupported contract versions;
- validate all cross-record invariants before scoring;
- use exact arithmetic until final one-decimal presentation rounding;
- avoid current time, randomness, locale-sensitive ordering, and unordered iteration in score computation;
- emit the exact canonical UTF-8 JSON byte profile in `assessment-contract.md`, including recursive object ordering, string escaping, array normalization, whitespace, numeric tokens, and one trailing line feed.

## Inspect before execution

Read both generated source files in full. Reject and regenerate either source if it contains:

- networking, package installation, telemetry, or external-service calls;
- shell evaluation, unbounded process execution, or execution of repository files;
- writes outside the explicit temporary output paths;
- dynamic code evaluation, deserialization into executable objects, or plugin loading;
- secret, environment, credential, or complete-process-environment collection;
- destructive cleanup or mutation of the audited repository.

Additionally reject the engine if it contains conformance case identifiers, expected-score tables, repository-specific statuses, or fixture-specific branches. The harness must contain literal expectations from `conformance-cases.md`; reject it only when those expectations are derived from actual engine output, weakened, or implemented by importing, sharing, or copying engine internals. Independently implementing the contract's exact rational calculations for `M-012` is required and is not prohibited sharing.

Run a syntax, compile, or static check before the first execution when the selected runtime supports one without installing dependencies.

## Qualify the engine and publication path

Qualification and publication are orchestrated in this order:

1. Evaluate `E-007` by recording a suitable already-installed runtime or stopping as unavailable.
2. Generate the engine alone, run its syntax or compile check, inspect it under `E-006`, then freeze and hash it before creating any executable fixture or harness source.
3. Generate fixtures and the independent harness, run its syntax or compile check, inspect it under `E-006`, then freeze and hash it before its first execution.
4. Begin `E-005` with an Agent-owned, sanitized repository-state fingerprint covering tracked, staged, unstaged, untracked, ignored, cache, and relevant nested-worktree entries. A safe helper may hash file bytes without returning names or contents to model context. Neither generated source nor either conformance process receives the repository root, fingerprint, filenames, metadata, or content. The later controlled real-input exception is limited to the structured assessment boundary defined above.
5. Run all 84 harness-executable parent cases and all 197 concrete variants required by `conformance-cases.md`. A parent passes only when every child variant passes and the engine's exact exit status, streams, input preservation, and complete output artifact match the fixed expectation. Extra output, silently normalized invalid input, skipped variants, or rewritten expectations are failures.
6. Recalculate both frozen source hashes and the repository fingerprint. Passing `E-006`, the permitted `E-007` branch, every executable case, deterministic replay, and this unchanged interim check establishes **conformance-qualified** status. That status permits only controlled processing of the real assessment inside the same owned workspace; it does not permit use or publication of computed metrics.
7. Rehash both sources and recapture repository state after every real `score` or `verify-scored` invocation contributing to a report. Complete final `E-004` and `E-005` only after the last such invocation, evaluate `E-009`, complete the `E-010` orchestration review after the last contributing assignment, and aggregate all results under `E-008`.

Metamorphic case `M-010` scores one valid fixture twice into two new files and requires byte-identical output. The harness independently hashes both files and requires equal SHA-256 digests.

The Agent records every `E-004` through `E-010` result separately from the harness transcript. Any unexplained repository delta, dirty-tree reproduction failure, or orchestration-gate failure makes the current run publication-unqualified and **Unscored**. Do not revert or delete a delta automatically because it may overlap user work; report exact paths and the recovery condition.

A frozen engine is **conformance-qualified** only when:

- source inspection passed;
- syntax or compilation succeeded when available;
- all 84 required parent cases and all 197 concrete variants passed;
- deterministic replay `M-010` passed;
- no dependency installation, network access, repository execution, or repository mutation occurred.

A run is **publication-qualified** only after the engine is conformance-qualified, the real invocation completes, and every Agent gate `E-004` through `E-010` passes or uses an explicitly permitted not-applicable branch at the final post-invocation and assignment boundary. Only publication qualification permits use of the computed metrics. Official-score publication remains a separate decision and also requires a rated assessment plus complete retained provenance. The engine itself never represents either qualification stage or the publication decision.

Both qualification stages apply only to the recorded source bytes, harness bytes, runtime family and version, contract versions, workspace, repository-state boundaries, and current run. Any change invalidates the affected stage and requires the prescribed requalification.

## Record provenance

Retain and report:

- engine language, runtime family, and exact runtime version;
- package and publication protocol versions;
- assessment and rubric contract versions;
- absolute temporary engine and harness paths;
- SHA-256 of engine source and harness source;
- all 84 executable parent case identifiers and pass/fail status;
- all 197 concrete variant labels and pass/fail status;
- Agent publication-gate identifiers `E-004` through `E-010`, with pass/fail/not-applicable status and evidence;
- deterministic replay output SHA-256;
- whether syntax or compilation was checked;
- `dependency_installation: false`;
- `network_access: false`;
- `repository_code_executed_by_engine: false`;
- repository mutations, which must be an empty list unless separately authorized for non-engine work;
- repository before/after comparison, including any ignored or nested-worktree delta;
- any retained limitations.

Do not place volatile provenance inside the deterministic scored assessment. Put it in the human report or a separate provenance artifact.

## Fail closed

If generation, inspection, compilation, executable conformance, deterministic replay, `E-006`, `E-007`, or an interim source or repository integrity check fails before the controlled real invocation:

1. do not use that engine on real assessment data;
2. do not copy a score from partial output;
3. do not hand-calculate a replacement;
4. preserve collected repository evidence and findings;
5. report **Unscored**, the failed stage and case, and the exact unblock condition.

If a final `E-004`, `E-005`, `E-008`, `E-009`, or `E-010` publication gate fails after the controlled real invocation, quarantine and discard the generated metrics without using or revealing them, keep report-level `official_score` null, preserve collected repository evidence and findings, and report **Unscored**, the failed gate, and the exact unblock condition. A post-invocation failure cannot retroactively make the invocation absent; it denies publication qualification.

A different installed runtime or a regenerated implementation may be attempted, but it must pass the full qualification sequence independently.

The generated-engine boundary reduces correlated mistakes but does not prove independence when one model authors both engine and harness. Retain the complete sources and transcripts, and scope public conformance claims to the tested host, model, runtime, and version.
