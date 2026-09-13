---
name: pr-review
description: "Multi-lens correctness review for a diff or PR: project guideline compliance, real bugs, comment accuracy, test coverage gaps, silent failures/bad error handling, and type design. Use when the user asks to review a PR, review a diff, review before commit, or check code before opening a pull request. Complements ponytail-review (which only hunts over-engineering) — this one hunts correctness and quality."
homepage: https://github.com/anthropics/claude-plugins-official (pr-review-toolkit)
license: MIT
---

# PR Review

Review the diff (default: `git diff`, or whatever scope the user names) through
five lenses, in order. Skip a lens if it has nothing to say — don't pad the
report with empty sections.

## 1. Guidelines & bugs

Check adherence to explicit project rules (CLAUDE.md or equivalent): import
patterns, framework conventions, error handling, logging, testing practices,
naming. Then hunt real bugs: logic errors, null/undefined handling, race
conditions, memory leaks, security issues, performance problems.

Rate each finding 0-100 confidence. **Only report ≥ 80** — quality over
quantity, false positives erode trust in the review.

- 91-100: critical bug or explicit rule violation
- 76-90: important issue requiring attention
- ≤75: drop it (nitpick or pre-existing, not this diff's problem)

## 2. Comment accuracy

For every comment added or changed in the diff:
- Cross-reference claims against the actual code (signatures, behavior, edge cases, complexity claims).
- Flag comments that restate the obvious (delete) vs. comments that explain *why* (keep).
- Flag comments likely to rot: references to temporary states, TODOs that may already be done, examples that don't match the current implementation.
- Advisory only — report, don't rewrite comments unless asked.

## 3. Test coverage

Focus on behavioral coverage, not line coverage. For new/changed logic, check for:
- Untested error-handling paths that could fail silently.
- Missing edge cases and boundary conditions.
- Missing negative test cases for validation logic.
- Tests coupled to implementation rather than behavior (brittle, will break on harmless refactors).

Rate criticality 1-10; only surface 5+ (below that, it's optional polish, say so in one line, don't itemize).

## 4. Silent failures & error handling

Zero tolerance for errors that vanish without a trace. For every try/catch,
error callback, fallback, or optional-chaining-past-a-failure in the diff, ask:
- Is it logged with enough context to debug six months from now?
- Does the catch block target a specific error type, or could it swallow unrelated failures?
- Is a fallback explicit and justified, or does it quietly mask the real problem?
- Empty catch blocks and "log and continue" on unexpected errors are always CRITICAL.

Report: location, severity (CRITICAL/HIGH/MEDIUM), what's hidden, the fix.

## 5. Type design (new/changed types only)

For each new or substantially-changed type, check whether it makes illegal
states unrepresentable:
- Are invariants enforced at construction, or checkable only by convention/docs?
- Are internals encapsulated, or can invariants be violated from outside?
- Is validation at the boundary, not scattered across every call site?

Flag anemic models (no behavior, no enforcement) and types whose invariants
exist only in a comment. Don't demand ceremony for a type with no real
invariants — a plain struct is sometimes correct.

## Output

Group by lens, most severe first. One block per finding: `file:line — what's
wrong — why it matters — concrete fix`. If a lens found nothing, say so in one
line ("Tests: adequate coverage, no gaps.") and move on. Advisory only —
report the findings, apply fixes only if the user asks.
