# services/orchestrator

Python control plane and CLI: scope validation, safe tool execution and run
control. Reserved by backlog task E0-001; implementation begins at E1-001.

## Specification

- `docs/03-applications/04-orchestrator-spec.md`
- `docs/04-security/09-tool-safety-guardrails.md`
- `adrs/008-guarded-adapters.md`

## Boundary rules

- The only module permitted to execute a scanner, and only through a reviewed
  adapter registered by ID and pinned to an immutable image digest.
- Every run requires an in-scope, unexpired execution grant. Scope Guard,
  kill switch and audit logging fail closed.
- Adapter arguments are fixed and typed. No shell interpolation, no
  user-controlled globs, variables or response files.
- Adapters independently deny public, link-local, metadata and control-plane
  addresses, and revalidate DNS and redirects after the grant is issued.
- Python dependencies are locked with hashes.
