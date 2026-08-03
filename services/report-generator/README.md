# services/report-generator

TypeScript renderer for executive, technical and retest reports. Reserved by
backlog task E0-001; implementation begins at E5-009.

## Specification

- `docs/03-applications/06-report-generator-spec.md`
- `templates/pentest-report-template.md`

## Boundary rules

- Reads findings and evidence through the Finding Hub API, never from its
  database or the evidence filesystem.
- Applies the redaction policy on render. Redaction tests are release-blocking
  (`docs/08-agent/02-implementation-phases.md`, Phase 6 exit).
- Report content is treated as untrusted input and rendered safely: no active
  markup, no external references.
- Reports carry integrity metadata for the artifacts and findings they cite.
