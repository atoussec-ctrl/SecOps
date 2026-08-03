# Non-functional Requirements

## Security

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-SEC-001 | Default-deny network policy | Automated connectivity tests |
| NFR-SEC-002 | No secret in source, image layer, report or log | Secret scan plus fixture tests |
| NFR-SEC-003 | Least-privilege containers and services | Policy-as-code checks |
| NFR-SEC-004 | Immutable audit records for privileged actions | Integration and tamper tests |
| NFR-SEC-005 | Evidence encrypted at rest where platform support exists | Configuration and restore tests |
| NFR-SEC-006 | Safe parsing of SARIF, archives and uploaded artifacts | Fuzz, size and path traversal tests |
| NFR-SEC-007 | No public ingress to vulnerable targets | Network assertion in every environment |

## Reliability and resilience

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-REL-001 | Idempotent bootstrap | Three consecutive clean runs succeed |
| NFR-REL-002 | Idempotent teardown | No orphaned lab resources after retry |
| NFR-REL-003 | Adapter heartbeat | Lost heartbeat detected within configured timeout |
| NFR-REL-004 | Crash-safe run state | Interrupted run becomes incomplete/cancelled, never successful |
| NFR-REL-005 | Backup integrity | Quarterly restore rehearsal succeeds |

## Performance budgets

Performance exists to protect the workstation, not maximize scan speed.

| ID | Requirement | Default budget |
| --- | --- | --- |
| NFR-PERF-001 | PR pipeline feedback | 15 minutes at the 75th percentile |
| NFR-PERF-002 | Main pipeline feedback | 30 minutes at the 75th percentile |
| NFR-PERF-003 | Nightly security suite | 90 minutes maximum unless approved |
| NFR-PERF-004 | Finding list response | 500 ms at 95th percentile for 10k findings |
| NFR-PERF-005 | Scanner request rate | Scenario-specific; default at most 5 requests/second |
| NFR-PERF-006 | Evidence item size | 10 MiB default, explicit override required |

## Maintainability

- Cyclomatic complexity thresholds are enforced with language-appropriate tools.
- Security-critical functions require explicit unit and negative tests.
- Dependency direction follows documented module boundaries.
- Architectural changes require ADRs.
- Generated code is isolated and reproducible.
- Public contracts are versioned and contract-tested.
- Tool integrations implement one common adapter protocol.

## Testability

- Line, statement, function and branch coverage: at least 95% for maintained
  application code.
- Mutation score: at least 80% for security-critical modules.
- Every security regression test fails against the vulnerable implementation
  and passes against the secure implementation.
- Test fixtures never rely on real services or personal data.
- Clock, random, DNS and external intelligence clients are injectable.

## Portability

- Linux is the reference CI environment.
- macOS is supported for local development and required for full iOS builds.
- Windows development is supported through WSL2 for the core platform.
- Container architecture differences are documented and tested where feasible.
- Core workflows do not require a commercial cloud account.

## Accessibility and usability

- UI meets WCAG 2.2 AA for learner-facing flows.
- Color is never the sole severity or state indicator.
- Keyboard navigation and screen-reader labels are mandatory.
- Dangerous actions require clear scope and impact confirmation.
- Raw tool output and normalized finding views remain distinguishable.

## Privacy and retention

- Synthetic data by default.
- Evidence has configurable retention with a safe default of 30 days.
- Audit records retain metadata but not unnecessary request bodies.
- Deletion preserves a tombstone and authorization record.
- Export packages are redacted and contain a manifest of included files.

## Observability

- Structured logs with correlation, engagement and run IDs.
- Metrics for runs, adapter budgets, failures, findings and gate decisions.
- Traces for control-plane actions, excluding sensitive payload bodies.
- Alerts for public exposure, scope rejection bypass attempts, kill-switch
  failure, audit-store failure and expired risk acceptance.

