# Code Audit Checklist

Quick code health check. Score each 0-2 (0=bad, 1=ok, 2=good).

## Code Hygiene

- [ ] **No obvious duplication** (same logic copy-pasted)
- [ ] **No dead code** (unused functions, commented-out blocks)
- [ ] **Errors handled** (not silent failures or bare exceptions)
- [ ] **Has tests** (critical paths covered)
- [ ] **Names make sense** (fn/var names explain purpose)

## Architecture

- [ ] **Clear boundaries** (modules/layers don't leak internals)
- [ ] **Dependencies managed** (no circular imports, minimal coupling)
- [ ] **Data flows one way** (easy to trace where values come from)
- [ ] **Config separated** (secrets/env not hardcoded)

## Engineering

- [ ] **Security basics** (input validation, no SQL injection, secrets not in repo)
- [ ] **Logs exist** (can debug production without re-deploying)
- [ ] **Build/deploy documented** (README has "how to run")
- [ ] **Performance reasonable** (no obvious O(n²) on large data)

---

## Scoring

- **16-24**: Good shape
- **8-15**: Needs work
- **0-7**: Significant tech debt

Lowest category determines health (can't have great code with terrible security).

---

## Remediation Priority

1. **Security** (injection, secrets, auth bypass) — fix immediately
2. **Correctness** (wrong output, silent failures) — fix before features
3. **Maintainability** (duplication, coupling) — fix when touching code
4. **Polish** (naming, comments) — nice to have

---

## When to Audit

- Just inherited a project
- Before major refactor
- Feels messy but can't articulate why
- Need to prioritize tech debt

Don't audit for the sake of auditing. Audit to make decisions.
