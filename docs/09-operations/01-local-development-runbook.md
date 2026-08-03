# Local Development Runbook

## Purpose

Bootstrap, verify and stop the local platform without exposing vulnerable
targets. The final implementation must replace conceptual task names below with
its actual repository task interface while preserving behavior.

## Prerequisites

- Supported Linux/macOS host or Windows with WSL2 for core services.
- Container runtime with non-privileged local use.
- Pinned language runtimes selected by bootstrap policy.
- macOS/Xcode for iOS builds.
- Sufficient disk/memory for selected target and scanner profiles.

## First bootstrap

1. Verify repository signature/source and release tag if applicable.
2. Run prerequisite/version check.
3. Install dependencies strictly from lockfiles.
4. Verify tool/container image digests.
5. Build secure core services and run unit/contract tests.
6. Create local-only configuration from safe sample; generate synthetic secrets.
7. Start control and finding planes bound to loopback.
8. Run public-exposure and health checks.

Do not start vulnerable targets during dependency bootstrap.

## Start a lab scenario

1. Select a safe scope template.
2. Review resolved addresses, ports, profile and budgets in dry-run.
3. Activate the engagement.
4. Provision only the required target and fixture.
5. Verify visible lab marker and private-only reachability.
6. Begin manual or approved adapter work.

## Expected local health

- Console and control API reachable only through loopback.
- Finding Hub/PostgreSQL healthy.
- No vulnerable target mapped to all interfaces.
- Audit and evidence redaction healthy.
- Kill switch available.
- No unaccounted scanner container running.

## Stop

1. Cancel/complete active runs.
2. Revoke execution grants.
3. Capture approved final logs/evidence.
4. Stop targets and scanner adapters.
5. Remove engagement network and ephemeral volumes.
6. Verify vulnerable ports closed.
7. Keep only approved Finding Hub/evidence state.

## Troubleshooting

- Version mismatch: use pinned bootstrap versions; do not loosen ranges.
- Port occupied: identify owner and choose documented loopback port; never bind
  publicly as workaround.
- Scanner unhealthy: mark required run incomplete and inspect adapter logs.
- Mobile device dirty: revert snapshot/profile before continuing.
- Teardown partial: use tracked resource inventory and retry; do not delete broad
  unrelated Docker resources.
