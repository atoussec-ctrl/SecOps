# Backup and Restore Runbook

## Scope

Back up canonical Finding Hub data, approved evidence bytes/manifests,
configuration schemas and release/report metadata. Do not back up rebuildable
vulnerable target databases, scanner caches or ephemeral secrets.

## Backup requirements

- Encrypted destination with least privilege.
- Database-consistent snapshot.
- Evidence manifest and content digests.
- Product/schema version and migration state.
- Backup ID, time, operator/automation identity and retention.
- Verification that no forbidden secrets or raw quarantined data are included.

## Restore rehearsal

1. Create isolated restore environment with no vulnerable public ingress.
2. Verify backup integrity and expected identity.
3. Restore database to compatible version.
4. Restore approved evidence by manifest.
5. Run migrations if documented.
6. Verify record counts, foreign keys and aggregate invariants.
7. Recompute sample/all evidence digests as policy requires.
8. Generate a sample report and compare references.
9. Destroy rehearsal environment.

## Acceptance

- All canonical records restore.
- Evidence digests match.
- Deleted evidence remains deleted/tombstoned.
- Audit/outbox state is consistent and no events are accidentally republished.
- No runtime secret from the source environment is restored.

## Failure

Stop on digest, schema or ownership mismatch. Preserve logs and do not overwrite
the last known good backup. Create a corrective action and repeat rehearsal.

