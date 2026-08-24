# Rigor3 Rubric 0.1.0

## Contents

- [Scoring unit](#scoring-unit)
- [Code Hygiene](#code-hygiene)
- [Architecture Hygiene](#architecture-hygiene)
- [Engineering Hygiene](#engineering-hygiene)
- [Applicability](#applicability)
- [Anti-gaming rules](#anti-gaming-rules)

## Scoring unit

The rubric contains 60 atomic controls: 20 per dimension. Every control is worth 5 points, so each dimension has 100 possible points.

Use only these scored statuses:

- `pass`: the complete control claim is verified by current level A or B evidence;
- `fail`: a current level A or B counterexample confirms an unresolved violation;
- `not_run`: the applicable control was not evaluated;
- `unavailable`: evaluation was attempted but blocked by a documented external constraint;
- `not_applicable`: the control is conditional and its applicability rule is proven false.

Do not award partial credit. A broad gate may be partial, but each atomic control must resolve independently.

## Code Hygiene

### CH-COR — Correctness and behavioral safety — 20 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `CH-COR-01` | Critical invariants and primary behavior are implemented consistently with the repository's declared contracts. | Core |
| `CH-COR-02` | Relevant boundary values, empty states, invalid inputs, and failure paths are handled intentionally. | Core |
| `CH-COR-03` | Mutable state transitions and concurrent behavior avoid races, stale state, and invalid intermediate states. | Conditional: mutable shared state or concurrency exists |
| `CH-COR-04` | Observable side effects are ordered, bounded, and consistent with the operation's success or failure semantics. | Conditional: observable side effects exist |

### CH-READ — Readability and local maintainability — 15 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `CH-READ-01` | Names, interfaces, and local structure communicate intent without relying on hidden context. | Core |
| `CH-READ-02` | Control flow is cohesive, reviewable, and free of avoidable branching or temporal coupling. | Core |
| `CH-READ-03` | Dead, misleading, obsolete, and contradictory code is absent from the assessed scope. | Core |

### CH-CPLX — Complexity, duplication, and abstraction quality — 15 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `CH-CPLX-01` | Complexity is proportionate to the behavior and concentrated logic remains testable and understandable. | Core |
| `CH-CPLX-02` | Duplicated knowledge or behavior does not create credible divergence risk. | Core |
| `CH-CPLX-03` | Abstractions remove real repetition or isolate volatility without leaking unnecessary concepts. | Core |

### CH-CON — Contracts, validation, and type safety — 15 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `CH-CON-01` | Inputs crossing trust, process, persistence, or public API boundaries are validated before use. | Core |
| `CH-CON-02` | Nullability, optional states, variants, and invalid combinations are represented and handled safely. | Core |
| `CH-CON-03` | Types, schemas, API contracts, and implementations agree at every assessed boundary. | Core |

### CH-ERR — Error and resource lifecycle handling — 15 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `CH-ERR-01` | Errors are classified, propagated, logged, or presented at an actionable ownership boundary. | Core |
| `CH-ERR-02` | Files, connections, locks, subscriptions, transactions, and other resources are released on every relevant path. | Conditional: managed resources exist |
| `CH-ERR-03` | Timeouts, cancellation, retries, and backoff are bounded and do not amplify failure. | Conditional: asynchronous, remote, or retrying operations exist |

### CH-SEC — Code-level security hygiene — 10 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `CH-SEC-01` | Untrusted input cannot cross an injection, parsing, path, query, or command boundary without appropriate controls. | Core |
| `CH-SEC-02` | Authorization decisions and sensitive-data handling occur at enforceable boundaries and fail safely. | Core |

### CH-TST — Test design and behavioral confidence — 10 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `CH-TST-01` | Critical behavior and confirmed regression risks have focused automated tests or an equivalent executable specification. | Core |
| `CH-TST-02` | Tests are deterministic, meaningful, isolated at the right level, and fail for the behavior they claim to protect. | Core |

## Architecture Hygiene

### AH-BND — Module boundaries and dependency direction — 20 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `AH-BND-01` | Modules, layers, packages, services, or components have explicit responsibility boundaries. | Core |
| `AH-BND-02` | Dependencies point in the intended direction and policy does not depend on volatile implementation details. | Core |
| `AH-BND-03` | Dependency cycles are absent, intentionally isolated, or mechanically controlled. | Core |
| `AH-BND-04` | Cross-boundary access uses declared contracts rather than internal state or bypass paths. | Core |

### AH-COH — Cohesion, coupling, and change locality — 15 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `AH-COH-01` | Each architectural unit owns a coherent set of responsibilities. | Core |
| `AH-COH-02` | Ordinary feature or policy changes remain local instead of requiring synchronized edits across unrelated units. | Core |
| `AH-COH-03` | Shared abstractions and utilities have explicit ownership and do not become uncontrolled coupling hubs. | Core |

### AH-OWN — Domain, data, and state ownership — 15 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `AH-OWN-01` | Domain concepts, data, and mutable state have one authoritative owner. | Core |
| `AH-OWN-02` | State transitions and lifecycle rules are explicit and enforced at the owning boundary. | Core |
| `AH-OWN-03` | Persistence schemas, migrations, caching, and synchronization have clear ownership and consistency rules. | Conditional: persisted or replicated state exists |

### AH-EVO — Interface stability and evolvability — 15 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `AH-EVO-01` | Public and cross-boundary interfaces are minimal, stable, and independent of incidental implementation details. | Core |
| `AH-EVO-02` | Breaking changes, data evolution, and compatibility are handled through an explicit migration or versioning strategy. | Conditional: durable consumers or persisted contracts exist |
| `AH-EVO-03` | Expected variation has explicit extension seams without speculative framework building. | Core |

### AH-RES — Reliability and resilience architecture — 15 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `AH-RES-01` | Failures are isolated so one component cannot unnecessarily cascade across the system. | Core |
| `AH-RES-02` | Retry, idempotency, ordering, rate, and backpressure semantics are explicit at asynchronous or remote boundaries. | Conditional: asynchronous or remote boundaries exist |
| `AH-RES-03` | Recovery, consistency, and partial-failure behavior are defined for stateful workflows. | Conditional: stateful workflows exist |

### AH-RUN — Runtime and deployment topology — 10 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `AH-RUN-01` | Deployable units and runtime topology align with ownership, scaling, and failure boundaries. | Conditional: the repository defines deployable runtime units |
| `AH-RUN-02` | Environment, configuration, and runtime dependencies cross explicit, testable boundaries. | Core |

### AH-DOC — Architecture documentation and decision traceability — 10 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `AH-DOC-01` | A current architecture map explains the significant units, boundaries, data flows, and runtime relationships. | Core |
| `AH-DOC-02` | Important architectural decisions and rejected alternatives are durably traceable. | Core |

## Engineering Hygiene

### EH-BLD — Reproducible builds and dependency management — 20 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `EH-BLD-01` | Required runtimes, toolchains, package managers, and direct dependencies are declared and appropriately pinned or constrained. | Core |
| `EH-BLD-02` | A clean environment can restore dependencies and produce the intended build or artifact through documented commands. | Core |
| `EH-BLD-03` | Dependencies are maintained, justified, compatible, and reviewed for known health, license, and supply-chain risk. | Core |
| `EH-BLD-04` | Generated sources, lockfiles, schemas, and build artifacts have deterministic ownership and update workflows. | Conditional: generated or locked artifacts exist |

### EH-GATE — Automated quality gates — 20 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `EH-GATE-01` | Formatting and lint rules are automated and consistently enforce repository conventions. | Core |
| `EH-GATE-02` | Type checking or an equivalent static correctness gate covers the applicable code. | Core |
| `EH-GATE-03` | Automated tests cover the repository's critical risk layers and run through canonical commands. | Core |
| `EH-GATE-04` | Build, package, schema, or artifact validation catches integration errors before release. | Core |

### EH-CICD — CI/CD and release integrity — 15 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `EH-CICD-01` | Continuous integration runs required gates in an isolated, least-privilege environment. | Core |
| `EH-CICD-02` | Versioning, changelog, provenance, and release artifacts follow a repeatable release discipline. | Conditional: versioned artifacts or releases are produced |
| `EH-CICD-03` | Deployment includes environment separation, safe rollout, rollback, and post-deploy verification. | Conditional: deployments are produced |

### EH-SEC — Supply-chain, secret, and configuration security — 15 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `EH-SEC-01` | Secrets are excluded from source, minimized in scope, and protected by preventive or detective controls. | Core |
| `EH-SEC-02` | Dependency provenance, update policy, licenses, and build inputs are controlled against supply-chain risk. | Core |
| `EH-SEC-03` | Environment configuration and automation permissions follow least privilege and fail closed on missing sensitive values. | Core |

### EH-OPS — Operational readiness — 10 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `EH-OPS-01` | Long-running software exposes sufficient logs, metrics, traces, health signals, and actionable diagnostics. | Conditional: long-running or remotely operated software exists |
| `EH-OPS-02` | Stateful or critical operations have current runbooks, backup, recovery, and incident procedures. | Conditional: stateful or operationally critical software exists |

### EH-GOV — Repository governance — 10 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `EH-GOV-01` | Ownership, contribution, review, security reporting, and change-control expectations are documented. | Core |
| `EH-GOV-02` | Branch, tag, release, license, and repository metadata are internally consistent and maintained. | Core |

### EH-DX — Developer experience and automation — 10 points

| Control | Requirement | Applicability |
| --- | --- | --- |
| `EH-DX-01` | A new contributor can reproduce setup and the primary workflow without undocumented tribal knowledge. | Core |
| `EH-DX-02` | Common local tasks are documented, scriptable, reasonably fast, and consistent with CI. | Core |

## Applicability

Only controls explicitly marked **Conditional** may use `not_applicable`. Record the exact applicability rule, a rationale, and level A or B evidence that the rule evaluates false.

Core controls cannot be excluded. Every dimension must retain at least 70 applicable points; a conformant generated engine rejects an assessment below that floor unless a future versioned repository profile explicitly permits the reduction.

Repository type alone is not sufficient evidence. For example, a library may have no deployment controls, but it still needs build reproducibility, tests, CI, security reporting, and architecture boundaries.

## Anti-gaming rules

1. Freeze control identifiers, weights, and applicability under `rubric_version: 0.1.0`.
2. Unknown and unavailable controls earn zero assured points.
3. Missing tests, CI, documentation, security controls, or release discipline are failures when their control is applicable; absence is not `not_applicable`.
4. Give every root cause one finding and exactly one primary control. When the same root cause independently violates other controls, list them as secondary controls and reference the same finding from each failed control.
5. Scoring represents violated control obligations, not finding count. Each failed affected control loses its own 5 points, while multiple findings within one control cannot deduct more than that control's 5 points.
6. Use no manual points, bonuses, partial credit, or score overrides.
7. A pass requires evidence for the whole claim scope; one sufficient current counterexample may establish a fail.
8. A successful tool proves only its declared scope.
9. Record monorepo packages, filters, generated paths, vendored paths, and exclusions explicitly.
10. Accepted risk remains failed and continues to apply its severity ceiling.
11. Compare baseline and final scores only under the same rubric version, scope, and applicability decisions.
12. Let only a conformance-qualified runtime-generated engine derive totals. Reject supplied arithmetic that does not match independent recomputation.
