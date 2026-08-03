# Maintenance and Upgrade Runbook

## Maintenance cadence

- Weekly: review failed/incomplete scans and expiring exceptions.
- Monthly: dependency/tool update PRs and restore selected fixtures.
- Quarterly: backup restore rehearsal, threat-model review and full capstone
  smoke.
- On standard/tool release: evaluate mappings and compatibility before adoption.

## Dependency upgrade

1. Open isolated update PR with exact lockfile changes.
2. Review release/security notes and ownership.
3. Run unit, contract, scenario and supply-chain suites.
4. Rebuild final artifacts and compare SBOM.
5. Run relevant dynamic/Mobile tests.
6. Document new findings, behavior and rollback.

## Scanner/tool upgrade

- Pin new image digest/version.
- Run adapter contract and budget/cancellation tests.
- Compare output schema and fingerprint behavior.
- Evaluate false-positive/false-negative fixtures.
- Do not replace historical tool provenance.
- Roll out to nightly before protected release gate.

## Standards update

- Record new version/retrieval date.
- Build an explicit old-to-new mapping.
- Do not overwrite historical finding mappings.
- Update scenario coverage and reports.
- Review changes with security owner.

## Database migration

- Test empty and supported upgrade path.
- Back up canonical data.
- Use expand/migrate/contract for destructive changes.
- Verify outbox/audit/evidence integrity.
- Document rollback or forward-fix procedure.

## Decommission

- Revoke tool/signing identities.
- Remove images/artifacts from allowed registries where policy permits.
- Preserve required release and finding records.
- Delete evidence per retention authorization.
- Verify no vulnerable service, device profile or lab certificate remains.

