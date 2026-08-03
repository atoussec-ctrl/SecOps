# Product Acceptance Criteria

## System acceptance scenarios

### AC-SAFE-001 — Reject an external target

Given a signed scope containing only private lab CIDRs, when an operator submits
an Internet hostname or public IP, then dry-run and execution both fail before a
tool process or container is created, and an audit event records the rejection.

### AC-SAFE-002 — Detect DNS rebinding or address drift

Given an allowlisted hostname, when its resolved address changes outside the
validated set before or during execution, then the run is cancelled, adapters
receive the kill signal and partial evidence is marked incomplete.

### AC-SAFE-003 — Prevent vulnerable publication

Given any insecure target artifact, when a release or registry publication job
is requested, then policy evaluation fails regardless of branch or manual
workflow input.

### AC-SCN-001 — Complete vulnerability lifecycle

Given a mandatory scenario, the vulnerable assertion fails securely defined
tests, the minimal proof is captured, the secure implementation passes the same
tests, a finding is remediated, and a retest verifies closure.

### AC-FND-001 — Deduplicate without data loss

Given equivalent Semgrep and CodeQL results at the same normalized location,
the system creates one canonical finding with two source occurrences and
preserves both raw result references.

### AC-FND-002 — Reopen failed remediation

Given a finding ready for retest, when the original proof still succeeds against
the candidate fix, then the finding becomes reopened and the new evidence is
linked without overwriting previous evidence.

### AC-PIPE-001 — Test the exact release artifact

Given a release candidate, the image digest dynamically tested, scanned, signed
and published is identical. Rebuilding between these steps is forbidden.

### AC-PIPE-002 — Expired exception blocks release

Given a confirmed High finding with an expired risk acceptance, the release gate
fails and identifies the finding and expired record.

### AC-MOB-001 — Distinct mobile identities

Given insecure and secure Mobile builds, their package/bundle identifiers,
signing policies and visible lab banners are distinct; the insecure target has
no production release task.

### AC-REP-001 — Redacted report

Given evidence containing seeded secret-like values, report generation replaces
the values with stable redaction markers while preserving enough context to
understand the finding.

## Milestone acceptance checklist

- [ ] All requirement IDs in the milestone map to automated or documented tests.
- [ ] All required diagrams match the implemented boundaries.
- [ ] No unfinished marker, placeholder secret or disabled gate remains.
- [ ] Coverage and mutation thresholds pass.
- [ ] Dependency, image and IaC scans pass or have valid expiring exceptions.
- [ ] Threat model changes were reviewed.
- [ ] Bootstrap and teardown were tested from a clean state.
- [ ] Documentation includes operator rollback and failure behavior.
- [ ] The exact candidate artifacts are archived with digests.
- [ ] The milestone demo uses only synthetic fixtures.

## Capstone acceptance

The 1.0 capstone is accepted only when an evaluator can:

1. Bootstrap the lab from the documented prerequisites.
2. Verify scope enforcement using a deliberately rejected target.
3. Complete one Web, one API and one Mobile scenario.
4. Import static and dynamic results into the Finding Hub.
5. Confirm, remediate and retest at least one finding.
6. Produce an executive, technical and retest report.
7. Verify the SBOM, signature and provenance of secure release artifacts.
8. Destroy the environment and prove no vulnerable service remains reachable.
