# TDD, Coverage and Mutation Testing

## TDD cycle

1. Write a failing behavior or invariant test.
2. Implement the smallest correct change.
3. Refactor while tests remain green.
4. Add boundary, negative and failure-path tests.
5. Run relevant static/security checks.

For a vulnerability scenario, first encode the intended vulnerable teaching
behavior in the isolated insecure target, then write the secure requirement as
a failing test against the secure target before implementing the fix.

## Coverage thresholds

Maintained application code must meet at least:

- 95% line coverage;
- 95% statement coverage;
- 95% function/method coverage;
- 95% branch coverage.

Generated clients, framework bootstraps or platform-owned glue may be excluded
only by an exact reviewed configuration. Whole directories cannot be excluded
for convenience.

## Coverage interpretation

Coverage proves execution, not correct assertions or security. A suite with high
coverage can still miss authorization, state transitions, races and malicious
input. Review assertion quality and use mutation/property tests.

## Mutation targets

Security-critical modules require at least 80% mutation score:

- scope and URL/IP validation;
- authorization and tenant/object policy;
- token/session validation;
- redaction and evidence integrity;
- finding state transitions;
- risk-acceptance expiry;
- secure file/path/URL wrappers;
- gate evaluation and artifact-digest matching.

Equivalent or unreachable mutants must be documented narrowly.

## Language approach

| Ecosystem | Coverage | Mutation candidate |
| --- | --- | --- |
| TypeScript | V8/Istanbul-compatible | Stryker |
| Python | coverage.py/pytest-cov | mutmut or equivalent |
| Java/Kotlin | JaCoCo | PIT |
| Swift | Xcode coverage | supported mutation tool if stable; otherwise targeted fault tests |

Tool selection is finalized and pinned during bootstrap.

## Required negative tests

- unauthenticated and unauthorized subjects;
- other tenant/object owner;
- expired/replayed tokens and grants;
- overlong, malformed and duplicate fields;
- alternate address/path encodings;
- error, timeout and cancellation paths;
- concurrent duplicate commands;
- missing scanner report/receipt;
- expired exception and mismatched artifact digest.

## Review checklist

- Does the test fail for the intended reason?
- Would it detect a missing authorization check?
- Does it assert persistent state, not just HTTP status?
- Are security-sensitive branches exercised?
- Does it avoid real secrets and outside services?
- Is cleanup deterministic?

