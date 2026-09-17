# Test Writing Protocol

## The Problem

When the same person writes tests and implementation:
- Implementation: `if (x <= 100)`
- Test: `expect(fn(100)).toBe(true)`
- Bug: Should be `x < 100`, but test follows the bug

**Tests validate the error**, not the spec.

## The Core Idea

**One acceptance criterion = one test.** No criterion = no test.

---

## How to Write Tests

### 1. Write acceptance criteria FIRST

```
Feature: User login
  ✓ Valid credentials → success
  ✓ Wrong password → error "Invalid password"
  ✓ Unknown email → error "User not found"
  ✓ Empty fields → error "Required"
```

Each line is decidable: true or false, no implementation details.

### 2. One criterion = one test

```js
test('valid credentials returns success', ...)
test('wrong password returns Invalid password error', ...)
test('unknown email returns User not found error', ...)
test('empty fields returns Required error', ...)
```

**Don't write a fifth test.**

### 3. What NOT to test

| Don't Test | Why |
|---|---|
| Framework behavior | Not your code |
| One function = one test | Functions aren't behavior units |
| Implementation mirroring | `if (x)` in code → `expect(x).toBe(true)` in test is coupling, not coverage |
| Multiple similar inputs | `fn(1)`, `fn(2)`, `fn(3)` all walk same branch — keep one |

**Rule**: Can't explain "if this test fails, what user problem did we catch?" → delete it.

---

## Optional: Mutation Check

Best way to prove tests actually work:

1. Change implementation (e.g., `<=` → `<`)
2. Run tests
3. **At least one test must fail**
4. Revert change

If tests stay green after mutation → fake test, doesn't verify that behavior.

---

## The Real Rule

Tests should fail when behavior is wrong, not when implementation changes.

If you rename a function and 20 tests break, those aren't tests — they're coupling.
