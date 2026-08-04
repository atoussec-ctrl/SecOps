# Domain Event Contracts

## Envelope

```json
{
  "event_id": "event_example",
  "event_type": "finding.confirmed.v1",
  "occurred_at": "2026-08-03T12:00:00Z",
  "producer": "finding-hub",
  "aggregate_type": "finding",
  "aggregate_id": "finding_example",
  "aggregate_version": 4,
  "correlation_id": "corr_example",
  "causation_id": "event_previous",
  "payload": {}
}
```

## Mandatory events

| Event | Producer | Consumers |
| --- | --- | --- |
| `engagement.activated.v1` | Orchestrator | UI/read model, audit |
| `engagement.stopped.v1` | Orchestrator | UI, reporting |
| `run.started.v1` | Orchestrator | UI, metrics |
| `run.budget_warning.v1` | Orchestrator | UI, alerting |
| `run.cancelled.v1` | Orchestrator | UI, ingestion |
| `run.completed.v1` | Orchestrator | Finding Hub, UI |
| `ingestion.accepted.v1` | Finding Hub | Orchestrator, gate |
| `finding.created.v1` | Finding Hub | UI, metrics |
| `finding.confirmed.v1` | Finding Hub | Gate, reporting |
| `remediation.submitted.v1` | Finding Hub | CI/retest queue |
| `retest.completed.v1` | Finding Hub | UI, report, gate |
| `risk_acceptance.expiring.v1` | Finding Hub | Alerting, owner |
| `report.generated.v1` | Report Generator | UI, audit |
| `artifact.approved.v1` | Delivery pipeline | Signer/release manifest |

## Transactional outbox

Domain mutation and outbox insert commit in one database transaction. A relay
publishes/dispatches events and records delivery. Consumers are idempotent using
`event_id` and aggregate version.

## Compatibility

- Event type includes major version.
- Additive optional fields are backward-compatible.
- Removing/redefining a field creates a new major event.
- Consumers ignore unknown optional fields.
- Events contain identifiers and safe facts, not evidence bytes or secrets.

## Ordering

Ordering is guaranteed only per aggregate via version. Consumers detect gaps
and rebuild from source API/read model instead of guessing.

`aggregate_version` is a single-writer counter. Exactly one producer writes each
aggregate type, and an event type is named for the aggregate it versions. Two
writers on one aggregate either collide on a version or open gaps that are not
losses, and a consumer cannot tell either case from a real one.

## Failure behavior

- Relay retry is bounded and observable.
- Poison events move to a review queue with reason.
- Delivery failure never rolls back already committed domain state.
- A required gate waits for its event/read-model receipt rather than assuming
  eventual completion.

