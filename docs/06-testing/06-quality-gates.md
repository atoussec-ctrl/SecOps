# Test and Quality Gates

## Required gates

| Gate | Required outcome |
| --- | --- |
| Formatting/lint | No error; warnings follow explicit policy |
| Compilation/type | All maintained modules pass |
| Unit/component | Pass with no quarantined expired test |
| Coverage | At least 95% line/statement/function/branch |
| Mutation | At least 80% for security-critical modules |
| Contracts | Valid and backward-compatible for supported versions |
| Architecture | Dependency and insecure/secure separation rules pass |
| Security regression | All protected findings remain fixed |
| Static/security | Policy described in DevSecOps gates |
| E2E | Mandatory journey subset passes |
| Cleanup | No orphaned target or reachable vulnerable port |

## Quality exception

An exception is narrow, owned, reviewed and expiring. It identifies exact file,
rule/test, reason, compensating verification and removal date. Safety invariants
cannot be excepted.

## Flaky-test policy

1. Preserve failure evidence and seed.
2. Reproduce locally/isolated CI.
3. Fix shared state, clock, network or cleanup cause.
4. If temporary quarantine is necessary, add owner and expiry.
5. Do not lower retry count until green as a substitute for repair.

## Release test report

The final report includes suite versions, counts, coverage, mutation, skipped or
quarantined tests, artifact digests, environment and known limitations. A
missing required suite is a release failure.

