# Multi-Agent Orchestration

Use this protocol whenever the host exposes subagents or equivalent independent workers. Maximize safe, useful concurrency without weakening scope, authorization, evidence, or verification.

## Capacity and fallback

Before inspecting repository-controlled content:

1. record whether the host exposes subagents;
2. record the maximum child-agent capacity when the host makes it observable;
3. identify currently ready assignments that can run independently;
4. use `min(available child-agent capacity, ready independent assignments)` child agents;
5. refill a vacated slot while eligible work remains.

If capacity is not observable, dispatch ordinary ready work until the host refuses additional concurrency or no ready assignment remains, then report the observed peak as a lower bound. Treat a capacity refusal as an orchestration constraint, not a failed repository assignment; retry queued work only after capacity is released. Do not create dummy work solely to probe capacity. If subagents are unavailable, continue with one primary Agent and record the permitted single-agent fallback. Do not claim multi-agent independence in that branch.

Do not invent duplicate, speculative, or low-value work merely to raise utilization. Authorization, dependency order, context isolation, tool limits, and exclusive mutation-domain ownership are valid reasons to use fewer workers; record the reason while ready work remains.

## Primary-Agent authority

Keep one primary Agent accountable for:

- user scope and authorization;
- the assignment graph and mutation-domain ownership;
- evidence integration and finding de-duplication;
- contradiction and conflict resolution;
- scoring-engine qualification;
- final publication-gate decisions;
- the final report and every external action.

A subagent cannot expand scope, authorize a mutation, publish a score, or close a finding solely from its own work. Only the primary Agent may stage, commit, push, create a pull request, release, deploy, or perform another external write after the user separately authorizes it.

## Assignment graph

Create dependency-aware assignments before dispatch. Each assignment records:

- a stable identifier, role, objective, and Rigor3 dimension or control set;
- included and excluded paths;
- read authorization and any exclusive mutation domain;
- dependencies and completion criteria;
- required evidence, author identities, and expected validation owner;
- execution state: `pending`, `ready`, `running`, `completed`, `failed`, `blocked`, `cancelled`, or `superseded`;
- validation state: `not_required`, `pending`, `passed`, `failed`, or `blocked`.

Decompose first by phase, then by dimension, subsystem, control cluster, evidence source, or non-overlapping remediation boundary. Dispatch only `ready` assignments. Keep work broad enough to produce meaningful independent evidence and narrow enough to avoid duplicated ownership.

Treat a completion, failure, blocker, cancellation, supersession, or newly satisfied dependency as a scheduling event. Retain the event, refresh the ready set, and fill every observable safe slot before waiting or beginning unrelated non-trivial primary-Agent work. Engine generation and freezing must complete before harness construction, and the phase-0 isolation boundary must complete before repository inspection.

A subagent must not create further subagents unless the primary Agent assigns an explicit worker-slot budget, a conflict-free assignment subtree, and ownership authority inside that subtree. Nested workers count against the same global capacity.

## Inspection

Parallelize read-only inspection across independent dimensions, subsystems, control clusters, or evidence surfaces. Require every inspector to return exact locations, sanitized commands and outputs, limitations, contradictions, and unresolved hypotheses. Treat a delegated conclusion without qualifying evidence as unusable.

The primary Agent merges duplicate observations into one root-cause finding. Agreement between agents does not increase evidence strength by itself, and disagreement remains visible until resolved with stronger evidence.

## Remediation

Assign each mutation domain to at most one active remediation owner. A mutation domain includes repository paths plus any shared Git index or branch, temporary workspace, cache, generated location, process, service, port, database, browser or credential-bearing session, cloud resource, or external target that work may mutate. Partition overlap, serialize it, or use genuinely isolated host-provided workspaces when authorized and safe. A worker must stop and return a blocker before crossing its declared boundary.

Do not trade integration safety for utilization. After parallel changes are combined, run proportionate integrated gates in addition to each assignment's focused checks.

## Independent validation

Independently validate every bounded batch of findings, applicability decisions, control or gate statuses, and remediation closures that contributes to the final assessment or publication decision when the host can provide a non-authoring agent. Every remediation batch used to close or downgrade a finding, change a control or gate status, or support a post-remediation assessment requires validation.

Give the validator the relevant source, raw evidence, artifact or frozen diff, completion criteria, and required checks without supplying the author's self-assessment as ground truth. The validator must inspect the underlying material directly, repeat required checks when safely authorized and feasible, and return its own evidence, limitations, and result. A validation assignment may run after its author finishes; independence does not require simultaneous execution.

When the host cannot provide an independent validator, keep verification self-performed, disclose the limitation, and do not describe it as independent validation. This limitation does not replace any evidence required to close a finding.

## Failure and reassignment

Retain failed, blocked, cancelled, and superseded assignments. Reassign unfinished work when a safe slot and eligible worker are available, but never erase the earlier state. A child failure, timeout, missing result, or partial result is not a pass. Distinguish validated, failed, blocked, unverified, and unfinished work in the final synthesis.

## E-010 decision

Evaluate `E-010` from retained orchestration facts:

- **pass** when all safely useful observable capacity was used, vacated slots were refilled at each scheduling event while ready work remained, mutation ownership stayed exclusive, assessment- and publication-contributing batches received independent validation when the host could provide it, and every exception was explained;
- **fail** when available safe capacity was knowingly left idle without rationale, duplicate work was created to simulate utilization, overlapping unisolated writes occurred, an available independent validation path was skipped, or assignment failures were hidden;
- **not applicable** only when the host exposes no subagent capability. Retain host-capability evidence and use the single-agent fallback.

Unknown maximum capacity is not automatically a failure. Report it as a limitation and prove use of all observable callable capacity. `E-010` is an Agent publication gate, not engine input, and does not change the fixed 84-parent or 197-variant executable inventory.

## Required orchestration record

Retain and report:

- host subagent support and declared capacity when observable;
- observed peak active subagents and peak total agents;
- assignment totals by inspection, remediation, and validation role;
- assignment ownership, dependencies, and final states;
- unexplained idle-capacity intervals or an explicit statement that none were observed;
- write conflicts, reassignments, failures, blockers, and fallback rationale;
- validator independence for every assessment- or publication-contributing batch that required it;
- the final `E-010` status and evidence.
