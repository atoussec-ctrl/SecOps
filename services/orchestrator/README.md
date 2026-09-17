# services/orchestrator

Python control plane and CLI foundation for scope validation, guarded tool
execution, run control, audit and external-project discovery.

Python 3.12.10, standard library only. Run the suite with
`node tools/repo.mjs check:orchestrator`, which `check:all` also runs.

## Implemented

| Module | State |
| --- | --- |
| `scope/address_policy.py` | Classifies addresses, CIDRs, hostnames and URLs against the explicit special-range policy. |
| `scope/resolution.py` | Resolver-injected DNS pinning and redirect revalidation. |
| `grants/` | Short-lived execution grants, verification and replay protection. |
| `audit/` | Tamper-evident audit chain and fail-closed security decision recording. |
| `runs/` | Idempotent run state machine, budgets, kill switch and heartbeat handling. |
| `adapters/` | Typed adapter registry and argument-vector construction; arbitrary command strings are not representable. |
| `projects/discovery.py` | Deterministic, read-only technology discovery for a clean external Git snapshot. No project scripts, package installation, network access or symlink traversal. |

The lab scope and the external-project boundary are intentionally different.
Lab dynamic execution remains constrained by Scope Guard. External project
`static-readonly` discovery treats another repository only as source data and
produces a project profile; it does not grant scanner execution by itself.

## External-project invariants

- the source snapshot is clean and bound to a commit SHA;
- the logical project root in the profile is `.` so fingerprints do not depend
  on Windows, WSL or Linux host paths;
- source is read-only;
- generated/dependency trees such as `node_modules`, `vendor`, `dist` and
  `build` are not traversed;
- project-root symlinks and symlinked files/directories are not followed;
- package manifests are parsed as bounded data;
- discovery never invokes package managers, build tools, shell commands or
  application code;
- the profile fingerprint is a canonical SHA-256 of the discovery result;
- discovery describes technologies; a separate assessment plan authorizes
  capabilities.

## Specification

- `docs/03-applications/04-orchestrator-spec.md`
- `docs/04-security/09-tool-safety-guardrails.md`
- `docs/05-devsecops/09-external-project-assessment.md`
- `adrs/008-guarded-adapters.md`

## Boundary rules

- Scanner execution belongs only to the orchestrator and only through a
  reviewed adapter registered by ID and pinned to an approved immutable tool
  artifact.
- Dynamic runs require an in-scope, unexpired execution grant. Scope Guard,
  kill switch and audit logging fail closed.
- Adapter arguments are fixed and typed. No shell interpolation, no
  user-controlled command strings, globs, variables or response files.
- Lab network adapters independently deny public, link-local, metadata and
  control-plane addresses, and revalidate DNS/redirect targets after a grant is
  issued.
- External static discovery has no target network access at all. Authorized
  enterprise DAST will use a separate future contract rather than weakening the
  lab scope.
- Python dependencies are locked with hashes when third-party dependencies are
  introduced; the current discovery module remains standard-library only.
