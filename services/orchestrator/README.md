# services/orchestrator

Python control plane and CLI: scope validation, safe tool execution and run
control.

Python 3.12.10, standard library only. Run the suite with
`node tools/repo.mjs check:orchestrator`, which `check:all` also runs.

## Implemented

| Module | Task | State |
| --- | --- | --- |
| `scope/address_policy.py` | E1-001 | Classifies an address, CIDR, hostname or URL against the special-range policy and decides scope eligibility. Tested against the shared conformance vectors. |

`ipaddress` is used to parse and never to decide. Its `is_private` returns
`True` for `169.254.169.254`, the cloud metadata endpoint, and `False` for
carrier-grade NAT, so eligibility comes from an explicit allowlist of four
ranges. A test asserts that trap still exists.

Not yet built: DNS resolution and address pinning, redirect revalidation
(E1-002), grants, runs, budgets, adapters, provisioning, audit, CLI and API.

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
