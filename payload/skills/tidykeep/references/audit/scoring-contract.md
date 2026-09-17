# Scoring Contract

This document defines scoring contract `0.1.0`. A generated engine must use exact integer, rational, or decimal arithmetic until final presentation. Binary floating-point values must not decide thresholds, ceilings, or rounding.

## Contents

1. Fixed constants
2. Dimension arithmetic
3. Severity ceilings
4. Dimension qualification
5. Overall arithmetic and qualification
6. Presentation
7. Labels

## Fixed constants

| Constant | Value |
| --- | --- |
| Control count | 60 |
| Controls per dimension | 20 |
| Control weight | 5 points |
| Evidence strength A | 1.00 |
| Evidence strength B | 0.85 |
| Evidence strength C | 0.60 |
| Evidence strength D | 0.30 |
| Active finding states | `open`, `accepted_risk`, `blocked` |
| P0 ceiling | 39 |
| P1 ceiling | 69 |
| P2 ceiling | 89 |
| P3 or no active finding ceiling | 100 |

Only `pass` and `fail` are verified statuses. Only `pass` earns points. `not_run` and `unavailable` remain applicable and earn zero. `not_applicable` is excluded from both numerator and denominator.

## Dimension arithmetic

For each dimension, calculate from validated controls:

```text
applicable_points = weight of controls not marked not_applicable
verified_points   = weight of controls marked pass or fail
passed_points     = weight of controls marked pass

verified_quality  = passed_points / verified_points * 100
coverage          = verified_points / applicable_points * 100
assured_score     = passed_points / applicable_points * 100
```

Use zero when the verified-points denominator is zero. The applicable-points denominator cannot be zero because the assessment contract requires at least 70 applicable points per dimension.

For each verified control, select the strongest qualifying evidence that matches its status:

- pass: level A or B, `supports_pass`, complete scope;
- fail: level A or B, `supports_failure`, complete or counterexample scope.

Partial or sampled evidence never displaces complete B evidence. Additional weaker evidence does not reduce confidence. Sum `control weight * selected evidence strength` and calculate:

```text
evidence_confidence = confidence_points / verified_points * 100
```

The confidence thresholds are defensive and future-facing. Under contract `0.1.0`, a structurally verified control already requires A or B evidence, so coverage is often the binding qualification constraint. Implementations must not silently change the thresholds to compensate.

## Severity ceilings

For each dimension, collect severities from every active finding whose primary or secondary control belongs to that dimension. Choose the lowest mapped ceiling. Then calculate:

```text
final_dimension_score = min(unrounded_assured_score, severity_ceiling)
```

A ceiling is active even when it does not reduce the assured score. Fixed and false-positive findings apply no ceiling. Accepted-risk and blocked findings remain active. Severity is not an additional point deduction.

## Dimension qualification

Compare unrounded values:

| Qualification | Requirement |
| --- | --- |
| `rated` | Coverage at least 85 and evidence confidence at least 80 |
| `provisional` | Coverage at least 60 and evidence confidence at least 60 |
| `unrated` | Anything below provisional |

## Overall arithmetic and qualification

Calculate:

```text
computed_score    = minimum unrounded final dimension score
profile_average   = arithmetic mean of unrounded final dimension scores
overall_coverage  = total verified points / total applicable points * 100
overall_confidence = total confidence points / total verified points * 100
```

When total verified points is zero, `overall_confidence` is exactly `0.0`.

Overall qualification is:

- `rated` only when every dimension is rated, scope is complete, and scope gaps are empty;
- `provisional` when every dimension is either rated or provisional but the rated rule is not met;
- `unrated` otherwise.

`assured_floor` equals `computed_score` and remains available after any valid computation.

The pure engine does not emit `official_score` and cannot certify either qualification stage. After the engine is conformance-qualified, the real invocation completes, and every final Agent gate establishes publication-qualified status, the Agent makes a separate report-level publication decision:

```text
official_score = computed_score
  only if execution_qualification is publication-qualified
  and overall assessment qualification is rated
  and complete provenance is retained
otherwise official_score = null
```

Do not add this publication field to the deterministic scored assessment. Record it in the human report or a separate provenance envelope. A provisional numeric result must be labeled **Provisional Rigor3 result**, never **Official Rigor3 Score**.

## Presentation

Keep all intermediate values exact. Round only presented metrics to one decimal place using decimal round-half-up: a tie moves away from zero. Thresholds, minima, means, and ceilings use unrounded values.

In the scored JSON, point counts and `severity_ceiling` use integer tokens. Every presented percentage or score uses a decimal JSON number with exactly one fractional digit, including `.0`. Exponential notation, an omitted fractional digit, additional trailing digits, and JSON strings are invalid presentations even when they denote the same mathematical value.

The scored assessment adds one top-level `scoring` object containing exactly:

- `schema_version`: `0.1.0`;
- `rubric_version`: `0.1.0`;
- `dimensions`: exactly `code`, `architecture`, and `engineering`;
- `overall`.

Each dimension contains exactly:

- `applicable_points`;
- `verified_points`;
- `passed_points`;
- `verified_quality`;
- `coverage`;
- `evidence_confidence`;
- `assured_score`;
- `severity_ceiling`;
- `score`;
- `qualification`.

`overall` contains exactly:

- `qualification`;
- `computed_score`;
- `assured_floor`;
- `profile_average`;
- `coverage`;
- `minimum_dimension_coverage`;
- `evidence_confidence`;
- `headline_rule`, fixed to `minimum_dimension_score`.

The `score <workspace-root> <unscored-input> <new-output>` command rejects a supplied `scoring` field and emits the canonical scored assessment described above using the complete byte profile in `assessment-contract.md`. The `verify-scored <workspace-root> <unscored-input> <scored-artifact>` command validates the explicit input and artifact, requires the artifact's source assessment to equal the explicit input after canonical normalization, recomputes every scoring field, serializes the complete expected artifact under that byte profile, and requires byte-for-byte equality with the supplied artifact. It rejects alternate whitespace, member order, string escaping, numeric spelling, array normalization, or any scoring mismatch even when a generic JSON parser would consider the values equivalent. The root and relative operands obey `engine-generation.md`. Verification creates no output and modifies neither input. Neither command accepts or emits `official_score`.

## Labels

Labels describe final dimension values; they do not alter arithmetic.

| Presented score | Label |
| ---: | --- |
| 90.0–100.0 | Exemplary |
| 80.0–89.9 | Strong |
| 70.0–79.9 | Acceptable |
| 60.0–69.9 | Fragile |
| 0.0–59.9 | Failing |

The profile average is context only and must never replace the weakest-dimension headline.
