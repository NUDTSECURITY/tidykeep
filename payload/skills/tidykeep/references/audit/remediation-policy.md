# Remediation Policy

Read this file before modifying a repository, staging files, committing, pushing, deploying, or writing to an external service.

Runtime engine synthesis under `engine-generation.md` is not repository remediation. Audit authority permits a private temporary engine outside the repository only when the user has not prohibited local code generation, process execution, or temporary writes. It never authorizes dependency installation, network use, repository changes, or external actions. If temporary generation or execution is prohibited, continue evidence collection and report **Unscored**.

## Authorization ladder

Treat each level as separate authorization. A higher level includes only the lower actions necessary to complete it, not unrelated actions.

1. **Audit**: read files and run safe, non-mutating checks.
2. **Edit**: modify files within the confirmed scope.
3. **Local dependency change**: update manifests and lockfiles; network access may require approval.
4. **Commit**: stage intended files and create a local commit.
5. **Push**: write a named commit range to a named remote and branch.
6. **External action**: create or modify pull requests, issues, releases, deployments, cloud resources, or third-party records.

Do not infer authorization for levels 4–6 from permission to fix code.

## Remediation order

Prioritize work in this order:

1. Contain active P0 risk.
2. Restore correctness, security boundaries, data integrity, and required gates.
3. Repair architecture boundaries and ownership defects that block safe change.
4. Improve tests, automation, reproducibility, and supply-chain controls.
5. Remove localized complexity, duplication, dead code, and documentation drift.

Group changes by root cause and verification path. Avoid broad rewrites when a smaller change resolves the confirmed finding.

## Change rules

- Preserve required behavior and public contracts unless the user authorizes a breaking change.
- Preserve unrelated and pre-existing working-tree changes.
- Follow repository-native package management, formatting, migration, and generation workflows.
- Update generated files only through their canonical generator when available.
- Do not silence a quality gate merely to make it green.
- Do not weaken tests, types, lint rules, security controls, or coverage thresholds without an evidence-backed rationale and explicit disclosure.
- Do not add compatibility layers, abstractions, or dependencies without a demonstrated need.
- Do not expose credentials or store environment values in source control.
- Prefer recoverable operations and avoid destructive Git or filesystem commands.
- Keep generated audit engines, harnesses, compiler caches, and scoring artifacts outside the repository. Persisting any of them in the repository requires workspace-edit authorization and a declared mutation.
- Remove only temporary artifacts created and positively identified by the current run. Never clean unknown paths or user files as a side effect of remediation.

## Parallel ownership and validation

Apply `orchestration.md` whenever the host supports subagents:

- assign each mutation domain to at most one active remediation owner, including repository paths, Git state, temporary workspaces, caches, processes, services, databases, browser sessions, and external targets;
- partition, serialize, or safely isolate overlapping mutation domains instead of allowing concurrent writes;
- require a worker to stop before expanding beyond its declared write boundary;
- keep staging, committing, pushing, pull-request creation, releasing, deploying, and other external writes exclusively with the primary Agent after separate authorization;
- validate every remediation batch used to close or downgrade a finding, change a control or gate status, or support a post-remediation assessment with an agent that did not implement it when the host can provide one;
- retain failed validation and reopen or block the finding instead of accepting the author's self-assessment;
- run proportionate integrated gates after independently verified changes are combined.

Use fewer workers when exclusive ownership or dependency order requires it and record that reason under `E-010`.

## Verification ladder

After editing, run the smallest credible check first, then expand in proportion to risk:

1. syntax or compile check for changed files;
2. focused unit or component tests;
3. affected package lint and type checks;
4. broader package or repository test suite;
5. build and packaging checks;
6. integration, browser, deployment, or production verification when authorized and available.

Record checks that cannot run. Never claim a higher verification level from a lower one.

## Finding closure

Mark a finding `fixed` only when:

- the root cause was addressed;
- the relevant focused check passes;
- proportionate regression checks pass or are explicitly unavailable;
- new evidence is attached to the finding;
- no contradictory evidence remains unresolved.

If code changed but verification is incomplete, keep the finding `open` or mark it `blocked` with the exact missing condition.

## Git operations

Before committing:

1. inspect branch and working-tree status;
2. identify pre-existing changes;
3. inspect the final diff;
4. run proportionate checks;
5. stage only intended files;
6. describe the exact commit scope.

Before pushing:

1. name the remote URL;
2. name the target branch;
3. name the commit or commit range;
4. confirm that the local commit exists;
5. avoid force-push unless the user explicitly requests it and the exact consequences are understood.

Report local commit, remote push, pull request, and deployment as distinct outcomes.

## External and manual work

Do not simulate or claim completion of actions that require unavailable credentials, a human approval, a browser session, production access, or another team. Record them as explicit manual actions with an owner, required input, and verification condition when known.
