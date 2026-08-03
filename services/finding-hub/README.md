# services/finding-hub

Python finding and evidence API: normalization, triage, evidence and risk
workflow. Reserved by backlog task E0-001; implementation begins at E1-008.

## Specification

- `docs/03-applications/05-finding-hub-spec.md`
- `docs/07-data-api/05-sarif-finding-model.md`
- `adrs/004-sarif-canonical-import.md`, `adrs/005-postgresql-outbox.md`

## Boundary rules

- Owns the finding/evidence PostgreSQL schema. No other service reads its
  tables directly.
- Tool output is untrusted input: quarantine, validate, redact, hash after
  redaction, then store content-addressably
  (`docs/04-security/08-evidence-privacy.md`).
- Evidence files are reachable only through the evidence service.
- Never retains real credentials, personal data, full database dumps or
  unbounded captures.
- Scanner output enters as an observation. Confirmation requires reproduction,
  root cause and impact; closure requires an independent retest.
