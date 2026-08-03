# Database Schema Specification

## General conventions

- PostgreSQL with UTC timestamps.
- UUIDv7 or another time-sortable opaque ID selected by ADR at bootstrap.
- `snake_case` names.
- Optimistic version column on mutable aggregates.
- Foreign keys and check constraints enforce basic integrity.
- Domain layer enforces complex state/authorization rules.
- Append-only audit and outbox tables.
- Soft deletion only where retention/audit requires it; evidence-byte deletion
  uses tombstones.

## Core tables

| Table | Key fields |
| --- | --- |
| `engagements` | id, name, purpose, status, scope_snapshot_id, environment_state, version |
| `scope_snapshots` | id, canonical_document, document_hash, signer, valid_from, valid_until |
| `assets` | id, engagement_id, type, canonical_locator, criticality, data_classification |
| `runs` | id, engagement_id, scenario_id, adapter_id, profile, status, budgets, scope_hash, timestamps |
| `run_artifacts` | run_id, artifact_id, purpose |
| `tool_provenance` | run_id, tool, version, image_digest, config_hash |
| `findings` | id, fingerprint, algorithm_version, title, state, confidence, priority, owner, version |
| `occurrences` | id, finding_id, run_id, asset_id, rule_id, location, source_fingerprint, raw_result_id |
| `finding_mappings` | finding_id, taxonomy, identifier, version, primary_flag |
| `risk_signals` | finding_id, kind, value, source, observed_at |
| `priority_decisions` | finding_id, priority, rationale, actor, policy_version, created_at |
| `remediations` | id, finding_id, description, change_ref, status, submitted_by |
| `retests` | id, remediation_id, run_id, outcome, notes, tester, completed_at |
| `risk_acceptances` | id, finding_id, owner, approver, rationale, controls, expires_at, status |
| `evidence` | id, digest, media_type, size, classification, redaction_version, retention_state |
| `evidence_links` | evidence_id, entity_type, entity_id, purpose |
| `artifacts` | id, digest, type, secure_classification, source_ref, build_ref |
| `sboms` | id, artifact_id, format, digest, generator, version |
| `signatures` | id, artifact_id, identity, issuer, signature_ref, verified_at |
| `provenance` | id, artifact_id, predicate_type, digest, builder_identity |
| `audit_events` | id, actor, action, entity_type, entity_id, before_hash, after_hash, reason, timestamp |
| `outbox_events` | id, aggregate_type, aggregate_id, event_type, payload, created_at, published_at |

## Indexes

- Unique finding fingerprint plus algorithm version within its identity scope.
- Run status/engagement/time.
- Finding state/priority/owner/updated time.
- Occurrence asset/rule/location.
- Mapping taxonomy/identifier.
- Risk-acceptance expiry/status.
- Evidence digest unique.
- Artifact digest unique.
- Outbox unpublished created time.
- Full-text index on sanitized finding title/description if implemented.

## Row-level concerns

The reference local deployment may use application authorization, but queries
must always include engagement/tenant scope. Row-level security can be added as
defense in depth if the chosen deployment warrants it; it does not replace
application object authorization.

## Migration requirements

- Apply from empty database and previous supported release.
- Data migrations are bounded, resumable and observable.
- Destructive schema changes use expand/migrate/contract sequence.
- Rollback or forward-fix procedure documented.
- Migration artifacts and checksums are version-controlled.

## Audit behavior

Audit rows are insert-only to the application role. Corrections create a new
event. Do not place secret-bearing request bodies in audit payloads.

