# Performance and Resilience Testing

## Purpose

Performance tests verify safety budgets, predictable operation and failure
containment. They are not uncontrolled stress or denial-of-service exercises.

## Test areas

### Control plane

- Concurrent run creation within configured local capacity.
- Scope validation for large but bounded target lists.
- Kill-switch latency under active workload.
- Adapter heartbeat loss and cancellation.
- Queue/backpressure behavior.

### Finding Hub

- Ingest bounded SARIF files and 10k finding dataset.
- Fingerprint/deduplicate concurrent occurrences idempotently.
- Search/filter at documented latency target.
- Generate reports from large bounded engagement.
- Expire evidence/risk records in batches.

### Targets

- Valid business-load baseline.
- Bounded concurrency for race scenarios.
- Rate-limit and body/result-size enforcement.
- Timeout/circuit-breaker behavior for mock integrations.

## Safety budgets

Every performance profile specifies target, maximum request rate, concurrency,
duration, total requests, body/response size, CPU/memory and stop threshold.
Hard OS/container limits supplement application limits.

## Resilience scenarios

| ID | Failure | Expected behavior |
| --- | --- | --- |
| RES-001 | Adapter hangs | Timeout, kill and incomplete run |
| RES-002 | Target restarts | Pause/cancel, no automatic scope expansion |
| RES-003 | Ingestion unavailable | Backpressure, bounded spool, no false success |
| RES-004 | Database transient failure | Safe retry with idempotency |
| RES-005 | Evidence store failure | Metadata transition fails atomically |
| RES-006 | Teardown partial failure | Retry from resource inventory |
| RES-007 | Disk budget reached | Stop new evidence and alert before corruption |

## Acceptance

- Budgets cannot be increased above profile maximum by user input.
- Stop thresholds work under load.
- No test uses public or shared infrastructure.
- Results include load profile and artifact versions.
- Resource cleanup is verified after each test.

