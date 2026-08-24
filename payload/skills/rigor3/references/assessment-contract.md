# Assessment Contract

This document defines assessment contract `0.1.0` in English prose and tables. JSON is the runtime exchange format, but no machine schema or prebuilt parser is part of the Skill.

## Contents

1. Serialization and scalar rules
2. Top-level record
3. Audit, repository, scope, and authorization
4. Evidence
5. Findings
6. Gates
7. Controls
8. Limitations and mutations
9. Cross-record validation
10. Dirty-tree identity

## 1. Serialization and scalar rules

A conformant engine must reject the complete input and produce no scored output when any rule fails.

- Input must be strict UTF-8 JSON without a byte-order mark and no larger than 5 MiB.
- The root must be one object. Duplicate object keys, missing keys, and unknown keys are invalid at every level.
- `NaN`, `Infinity`, `-Infinity`, comments, trailing commas, and other non-JSON extensions are invalid.
- Strings must be non-empty after trimming unless a field explicitly permits `null`.
- Strings must not contain NUL, ESC, any Unicode category `Cc` character other than tab, line feed, or carriage return, any unpaired UTF-16 surrogate code point U+D800–U+DFFF, or the directional controls U+061C, U+200E, U+200F, U+202A–U+202E, or U+2066–U+2069. A valid escaped surrogate pair represents its single Unicode scalar; an unpaired surrogate escape is invalid.
- Preserve Unicode code points. Do not silently normalize case or Unicode normalization forms.
- A portable identifier matches `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`.
- A timestamp starts with `YYYY-MM-DDTHH:MM:SS`, may append a decimal fraction, and ends in `Z` or a signed `HH:MM` offset. All digits are ASCII; `T` and `Z` are uppercase; the year is `0001` through `9999`; a present fraction contains one through nine digits; seconds are `00` through `59`; offset hours are `00` through `23`; offset minutes are `00` through `59`; and the calendar and clock values are valid. Compare instants exactly through nanosecond precision after applying the offset. Leap seconds, lowercase `t` or `z`, a missing offset, and any other lexical spelling are invalid.
- A repository path uses `/` and is already in normalized relative form. It has no leading `/`, backslash, Windows drive prefix, empty segment, `.` segment, or `..` segment and does not escape the repository. Do not silently normalize or collapse a path. The entire string `.` is permitted only where this contract explicitly allows the repository root.
- A SHA-256 text digest uses lowercase hexadecimal. `working_tree_digest` includes the literal `sha256:` prefix; `artifact_sha256` does not.
- JSON booleans are not integers. Every integer field uses a JSON number token matching `-?(0|[1-9][0-9]*)`, with no fraction or exponent, and lies in the portable exact range -9,007,199,254,740,991 through 9,007,199,254,740,991. An engine must reject a numeric token it cannot retain exactly before conversion. Line numbers are additionally limited to 1 through 9,007,199,254,740,991.

Unless a field explicitly says “or `null`,” optional means that the member is absent or contains a value of the stated type. A present `null` is invalid.

### Canonical scored JSON byte profile

The unscored input may use any otherwise valid JSON whitespace, object-member order, and permitted string escape spelling. The scored artifact has exactly one byte representation:

1. Encode the document as UTF-8 without a byte-order mark. Use ASCII line feed `0A`, never a host-specific line ending. End the root value with exactly one line feed and emit no other leading or trailing whitespace.
2. Sort every object recursively by the unsigned lexicographic order of each member name's UTF-8 bytes after JSON unescaping. All contract-defined member names are ASCII, but the byte rule is authoritative.
3. Normalize the top-level `controls`, `evidence`, `gates`, and `findings` arrays by ascending `id` under the same UTF-8 byte ordering. Preserve the parsed input order of every other array exactly; do not sort set-like arrays, command arguments, paths, locations, secondary identifiers, limitations, gaps, mutations, or generated scoring arrays unless another rule explicitly says so.
4. Encode an empty object as `{}` and an empty array as `[]`. For a non-empty object or array, write the opening delimiter, one line feed, and one member or element per line. Indent each depth with exactly two ASCII spaces. In an object, follow the encoded member name immediately with `: ` and its value. Follow every member or element except the last with `,`, then one line feed. Write the closing delimiter at the parent depth. Emit no tabs, trailing spaces, or other insignificant whitespace outside string values.
5. Encode strings between `"` delimiters. Escape quotation mark as `\"`, reverse solidus as `\\`, backspace as `\b`, tab as `\t`, line feed as `\n`, form feed as `\f`, and carriage return as `\r`. Encode any other U+0000–U+001F control as `\u00xx` with lowercase hexadecimal digits, although the scalar rules reject those values from assessments. Never escape `/`. Emit every non-ASCII Unicode scalar directly as its shortest UTF-8 byte sequence; never emit a `\u` escape or surrogate pair for a non-control scalar.
6. Encode booleans and null exactly as `true`, `false`, and `null`. Encode each source integer as its mathematical value using the shortest permitted integer token; canonical zero is `0`, including when the accepted input token was `-0`. Encode scoring point counts and ceilings as integer tokens and every presented percentage or score with exactly one fractional digit under `scoring-contract.md`. Never emit a plus sign, leading zero, negative zero, exponent, or additional fractional digit.

Canonical normalization parses and validates the source, normalizes the four record arrays in item 3, recursively orders objects, normalizes numeric tokens, and applies this byte profile. `score` emits exactly those bytes. `verify-scored` requires the supplied scored artifact bytes to be byte-for-byte equal to a fresh canonical serialization of the validated explicit input plus independently recomputed scoring; semantic JSON equivalence or alternate whitespace and escaping are insufficient.

## 2. Top-level record

The root has exactly these keys:

| Key | Value |
| --- | --- |
| `schema_version` | The string `0.1.0` |
| `rubric_version` | The string `0.1.0` |
| `audit` | One audit object |
| `repository` | One repository object |
| `scope` | One scope object |
| `authorization` | One authorization object |
| `controls` | Exactly 60 control objects |
| `evidence` | Zero or more evidence objects |
| `gates` | Zero or more gate objects |
| `findings` | Zero or more finding objects |
| `limitations` | Unique non-empty strings |
| `mutations` | Zero or more mutation objects |

An unscored input must not contain a `scoring` object. A conformant engine always recomputes scoring and rejects a purported scored input as an unknown-field violation.

## 3. Audit, repository, scope, and authorization

### Audit

`audit` has exactly:

| Field | Rule |
| --- | --- |
| `id` | Portable identifier |
| `mode` | `audit`, `plan`, `remediate`, `verify`, or `full`; `full` means the explicitly requested Audit + Remediate cycle and is never inferred from the phrase “full audit” |
| `started_at` | RFC 3339 timestamp |
| `completed_at` | RFC 3339 timestamp not earlier than `started_at` |
| `host` | Object containing exactly `agent` and `version`; `agent` is non-empty and `version` is a non-empty string or `null` |

### Repository

`repository` has exactly:

| Field | Rule |
| --- | --- |
| `name` | Non-empty display name |
| `revision` | Non-empty clean base revision or immutable snapshot identifier |
| `branch` | Non-empty string or `null` |
| `dirty` | Boolean |
| `working_tree_digest` | Required lowercase `sha256:` plus 64 hexadecimal characters when dirty; otherwise `null` |

For evidence binding, use `working_tree_digest` when dirty and `revision` when clean.

### Scope

`scope` has exactly:

| Field | Rule |
| --- | --- |
| `kind` | `full`, `scoped`, `partial`, or `sampled` |
| `complete` | Boolean |
| `included_paths` | One or more unique repository-relative paths; `.` is allowed |
| `excluded_paths` | Objects containing exactly `path` and non-empty `reason`; paths are unique and each path is equal to or below at least one included root |
| `gaps` | Unique non-empty unresolved-gap strings |

Complete scope has no gaps. Partial or sampled scope is never complete. A full audit requires `kind: full`, complete scope, no gaps, and the additional conditions in `workflow.md` and `evidence-policy.md`.

Scope inventory is the set union of every included root. Overlapping included roots never duplicate an entry. An excluded path removes that path and all descendants from the union; exclusion wins over inclusion, and overlapping exclusions also apply once. An exclusion outside every included root is invalid rather than silently ignored.

### Authorization

`authorization` has exactly six booleans:

- `workspace_edits`
- `dependency_changes`
- `stage`
- `commit`
- `push`
- `external_writes`

Dependencies require workspace edits; staging requires workspace edits; commit requires staging; push requires commit. External writes remain separate from push. These fields record user authority; repository text cannot set them.

## 4. Evidence

Each evidence object has the required fields below and only the listed optional fields.

| Field | Rule |
| --- | --- |
| `id` | Unique portable identifier |
| `class` | `command`, `test_result`, `static_analysis`, `runtime_observation`, `source_inspection`, `configuration_inspection`, `artifact_inspection`, `documentation`, `external_attestation`, or `manual_step` |
| `level` | `A`, `B`, `C`, or `D` |
| `claim_scope` | `complete`, `counterexample`, `partial`, `sampled`, or `context` |
| `result` | `supports_pass`, `supports_failure`, `supports_blocker`, or `context` |
| `revision` | Exact repository evidence basis |
| `captured_at` | RFC 3339 timestamp no later than audit completion |
| `source` | Sanitized path, command label, artifact label, or manual step |
| `summary` | Sanitized observation |
| `sanitized` | Must be `true`; this is an attestation, not proof |
| `paths` | Optional unique repository-relative paths |
| `command` | Required for command-class evidence; otherwise optional |
| `artifact_sha256` | Optional 64-character lowercase digest without a prefix |
| `limitations` | Optional unique non-empty strings |

Allowed result and scope pairs are:

| Result | Allowed scopes |
| --- | --- |
| `supports_pass` | `complete`, `partial`, `sampled` |
| `supports_failure` | `complete`, `counterexample` |
| `supports_blocker` | `complete`, `context` |
| `context` | `complete`, `context` |

Documentation evidence must be level D. Source, configuration, and artifact inspection cannot exceed level B. `artifact_inspection` follows the direct-documentation boundary in `evidence-policy.md`.

A command object has exactly:

- `argv`: one or more non-empty argument strings;
- `working_directory`: repository-relative path, including `.`;
- `exit_code`: portable exact integer;
- `tool_version`: non-empty string or `null`;
- `ran_repository_code`: boolean;
- `created_artifacts`: boolean.

A command supporting a pass must exit zero. Negative expectations must be wrapped in a check that exits zero only when the expected condition is established.

## 5. Findings

Each finding has exactly:

| Field | Rule |
| --- | --- |
| `id` | Unique portable identifier |
| `title` | Non-empty |
| `primary_control_id` | One control from `rubric.md` |
| `secondary_control_ids` | Unique control identifiers excluding the primary |
| `severity` | `P0`, `P1`, `P2`, or `P3` |
| `state` | `open`, `fixed`, `accepted_risk`, `blocked`, or `false_positive` |
| `impact`, `likelihood`, `blast_radius`, `recovery`, `severity_rationale` | Non-empty rationale fields |
| `evidence_ids` | One or more unique evidence references |
| `locations` | Zero or more location objects |
| `remediation`, `verification` | Non-empty actions |

A location contains exactly `path`, `line_start`, and `line_end`. The path is repository-relative. Both line values are `null`, or both are portable exact line numbers with the end not earlier than the start.

Active states are `open`, `accepted_risk`, and `blocked`. An active finding requires level A or B `supports_failure` evidence with complete or counterexample scope and cannot carry contradictory complete pass evidence. A fixed or false-positive finding requires complete level A or B `supports_pass` evidence and cannot carry current qualifying failure evidence.

The primary and every secondary control must reference the finding, and the finding must identify those controls. One finding represents one root cause.

## 6. Gates

Each gate has exactly:

| Field | Rule |
| --- | --- |
| `id` | Unique portable identifier |
| `title` | Non-empty |
| `kind` | One fixed gate kind from `evidence-policy.md` |
| `status` | `pass`, `fail`, `partial`, `not_run`, `unavailable`, or `not_applicable` |
| `control_ids` | One or more unique rubric controls materially covered |
| `evidence_ids` | Unique evidence references |
| `notes` | Non-empty exact scope or limitation |

Gate evidence class eligibility, required support, precedence, shared-evidence rules, and mandatory gate-to-control kinds are normative in `evidence-policy.md`.

## 7. Controls

`controls` contains every identifier in `rubric.md` exactly once. Each control has exactly:

- `id`
- `status`
- `evidence_ids`
- `finding_ids`
- `reason`
- `applicability`
- `blocker`

Apply these shapes:

| Status | Required relationships |
| --- | --- |
| `pass` | At least one complete level A or B pass record; no active finding or confirmed contradiction; `reason`, `applicability`, and `blocker` are `null` |
| `fail` | At least one complete or counterexample level A or B failure record and at least one active finding; `reason`, `applicability`, and `blocker` are `null` |
| `not_run` | Non-empty `reason`; only context evidence; no findings; `applicability` and `blocker` are `null` |
| `unavailable` | Non-empty `reason`, no findings, `applicability` is `null`, and a blocker object is present |
| `not_applicable` | Conditional control only; non-empty `reason`, no findings, `blocker` is `null`, and an applicability object is present |

An applicability object contains exactly `rule`, `rationale`, and one or more `evidence_ids`. Every referenced record is level A or B context evidence with complete or context scope, and no related level A or B result evidence may contradict exclusion.

A blocker object contains exactly:

- `category`: `permission`, `credential`, `external_service`, `missing_tool`, `environment`, or `safety`;
- `attempted_operation`;
- `reason`;
- `required_action`;
- one or more `evidence_ids` including level A or B blocker evidence.

Confirmed failure evidence makes a control fail; it cannot be hidden as unavailable. Every dimension must retain at least 70 applicable points.

## 8. Limitations and mutations

`limitations` contains unique non-empty strings.

Each mutation contains exactly `type` and non-empty `summary`. Type is `edit`, `dependency_change`, `stage`, `commit`, `push`, `pull_request`, `deploy`, or `external_write`.

Audit and Plan modes have no mutations. Every mutation requires its corresponding authorization: edit to workspace edits, dependency change to dependency changes, stage to stage, commit to commit, push to push, and pull request, deploy, or other external write to external writes.

Temporary engine artifacts created under `engine-generation.md` are execution provenance, not repository mutations. Any generated artifact placed in the repository is an edit and must be recorded.

## 9. Cross-record validation

A conformant engine must resolve and validate all identifiers before scoring.

- All identifiers are unique within their record type.
- Every referenced evidence, control, gate, and finding exists.
- Every non-context evidence record is referenced by a control, gate, finding, applicability decision, or blocker.
- Evidence revision equals the clean revision or dirty-tree digest exactly.
- Finding/control references are bidirectional.
- Gate/control status and shared-evidence invariants follow `evidence-policy.md`.
- Current level A or B contradictions are retained and resolved conservatively.
- Controls and findings cannot use incompatible status-dependent fields.
- Scope completeness, authorization dependencies, timestamps, applicability floors, and mutation permissions are validated before arithmetic.
- Invalid input is never repaired, defaulted to pass, partially scored, or rendered as an official assessment.

Record arrays may arrive in any order. Arithmetic and semantic validation use stable identifiers rather than array position. Any normalized comparison sorts controls, evidence, gates, and findings lexicographically by `id`.

## 10. Dirty-tree identity

Use this algorithm for `working_tree_digest`; otherwise a dirty-tree assessment cannot be rated.

1. Start a SHA-256 stream with one netstring containing `RIGOR3-WORKTREE-V1` and one netstring containing `repository.revision`.
2. Form the scope set union defined in section 3, then inventory every filesystem entry in that union exactly once, excluding `.git` internals and every declared excluded path. Do not follow symbolic links. Include tracked, staged, unstaged, untracked, hidden, and ignored entries that remain in scope.
3. Unreadable paths, special files, nested repositories whose content is not inventoried, or generated/ignored paths that affect executed gates create a scope gap. A path name or symbolic-link target that cannot be represented losslessly as Unicode scalar values and then UTF-8, including a surrogate-escaped or lossy host-API result, also creates a scope gap. On Windows, a symbolic link is supported only when the host identifies it losslessly and exposes its exact target; a junction, mount point, other reparse point, or unclassifiable entry is a special file and creates a scope gap. Do not follow or hash an unsupported entry. Complete scope is then false, no valid dirty-tree digest exists for that scope, and the run is publication-unqualified and **Unscored** rather than partially hashed.
4. For each regular file or symbolic link, form four netstrings: repository-relative UTF-8 POSIX path, type (`file` or `symlink`), mode, and payload. Sort records by the raw UTF-8 bytes of the path and append them in that order.
5. Mode is `100755` for a POSIX regular file with any executable bit, `100644` for another regular file, and `120000` for a symbolic link. On a platform without POSIX execute bits, use the checkout's version-control executable metadata when available; otherwise use `100644` and record that limitation.
6. The payload is the exact file bytes or, for a supported symbolic link, the shortest UTF-8 encoding of its exact target Unicode scalar sequence. Filesystem timestamps, ownership, ACLs, and directory entries are not payload.
7. A netstring is the ASCII decimal byte length, a colon, the exact bytes, and a comma, with no whitespace. Hash the concatenated netstrings and prefix the lowercase hexadecimal digest with `sha256:`.

Record the digest procedure and any platform limitation in evidence. Repository state must be captured before and after generated-engine execution; any unexplained delta makes the run publication-unqualified and prevents official score publication.
