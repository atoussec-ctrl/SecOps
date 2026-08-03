# Observability, Audit and Alerting

## Objectives

- Explain every run and gate decision.
- Detect safety-boundary failure quickly.
- Diagnose tool failure without exposing sensitive payloads.
- Measure learning, quality and vulnerability-management outcomes.

## Structured log fields

- timestamp, severity and service;
- trace, correlation, engagement and run IDs;
- actor/service identity;
- action and outcome;
- target label, never raw secret-bearing URL;
- adapter/tool ID and version;
- budget counters;
- error category and safe message;
- configuration/scope hash when relevant.

Do not log passwords, tokens, cookies, authorization headers, key material,
unredacted bodies or evidence bytes.

## Metrics

### Safety

- scope rejections by reason;
- redirects/address drift blocked;
- kill-switch latency;
- public-exposure assertion failures;
- adapter budget violations;
- audit/evidence service health.

### Delivery

- pipeline duration and failure category;
- coverage and mutation score;
- scanner success/incomplete/error counts;
- artifact/SBOM/signature/provenance completeness;
- gate decisions and exception usage.

### Vulnerability management

- findings by state, priority, root cause and asset;
- time to triage/remediate/retest;
- false-positive and reopened rates;
- expired risk acceptances;
- standards/scenario coverage.

## Tracing

Trace control requests through scope validation, provisioning, adapter start,
result ingestion and gate evaluation. Exclude request/evidence bodies and use
events for meaningful state transitions.

## Alerts

Immediate local/CI alert for:

- vulnerable target public exposure;
- kill switch or audit store unavailable;
- attempted out-of-scope execution;
- insecure artifact publication attempt;
- signing/provenance mismatch;
- required result missing or ingestion failed;
- expired P0/P1 risk acceptance.

## Audit vs operational logs

Audit events are append-only records of privileged decisions and transitions.
Operational logs are diagnostic and may rotate. Do not rely on ordinary logs to
prove authorization, finding state or release approval.

