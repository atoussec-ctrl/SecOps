# infra/compose

Local and CI lab topology. Reserved by backlog task E0-001; implementation
begins at E0-005.

## Specification

- `docs/02-architecture/04-runtime-deployment.md`
- `docs/09-operations/01-local-development-runbook.md`
- `adrs/003-local-first-isolation.md`

## How the topology is defined

`lab-topology.json` is the source of truth, validated against
`packages/contracts/infra/lab-topology.schema.json`. The Compose file is
rendered from it, never hand-written. See
[ADR-009](../../adrs/009-generated-lab-topology.md).

Run `node tools/repo.mjs check:exposure` after any topology change. It validates
the descriptor, applies the exposure policy and fails when the generated Compose
file on disk differs from what the descriptor renders.

No Compose file is generated yet, because every container image is still
unselected in `version-manifest.json`. Images resolve by immutable sha256
digest, so rendering stays blocked until they are pinned.

## Boundary rules

- Lab targets bind to loopback or an internal network only. A public-exposure
  assertion runs before any dynamic work and after teardown.
- Containers run non-root with dropped capabilities and read-only filesystems
  where supported. No Docker socket, no host network, no privileged mode
  (`docs/04-security/01-threat-model.md`).
- Resource ceilings are explicit and teardown is deterministic and verified.
- Secure and insecure targets are separate services with separate databases,
  never two modes of one service.
