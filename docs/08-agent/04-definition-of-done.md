# Definition of Done

## Task-level Definition of Done

A task is done when:

- [ ] Requirement and backlog IDs are referenced.
- [ ] Failing test was written before or with the behavior change.
- [ ] Smallest maintainable implementation is complete.
- [ ] Positive, negative, boundary and failure tests pass.
- [ ] Coverage remains at or above required thresholds.
- [ ] Mutation target is met for security-critical code.
- [ ] Static, dependency, secret and relevant policy checks pass.
- [ ] No safety boundary, contract or architecture rule is weakened.
- [ ] Documentation/contracts/diagrams are updated.
- [ ] No secret, personal data, public target or unrelated edit is introduced.
- [ ] Changed files and verification evidence are recorded.

## Scenario-level Definition of Done

- [ ] Stable scenario ID/version and learning objective.
- [ ] Vulnerable behavior exists only in insecure target.
- [ ] Public-exposure and release-publication protections pass.
- [ ] Minimal synthetic proof and explicit stop boundary.
- [ ] Root cause and primary CWE documented.
- [ ] OWASP/ASVS/WSTG/API or MASVS mappings documented.
- [ ] Secure counterpart implements root-cause control.
- [ ] Regression fails vulnerable behavior and passes secure behavior.
- [ ] Reset/cleanup is deterministic.
- [ ] Finding template and retest evidence are complete.

## Milestone-level Definition of Done

- [ ] All exit criteria and mapped requirements pass.
- [ ] Full relevant test/security suite passes.
- [ ] Clean bootstrap and teardown succeed.
- [ ] Threat model and ADRs reflect implementation.
- [ ] Runbooks cover normal, failure and rollback paths.
- [ ] Artifacts have digests and required SBOM/provenance.
- [ ] No expired exception or unresolved required-tool failure.
- [ ] Demonstration uses exact candidate artifacts and synthetic data.

## Finding closure Definition of Done

- [ ] Confirmed root cause and impact.
- [ ] Redacted evidence with integrity metadata.
- [ ] Mappings and CVSS vector/risk rationale.
- [ ] Remediation change and regression reference.
- [ ] Independent retest against identified artifact/version.
- [ ] Original proof no longer succeeds.
- [ ] Valid behavior remains functional.
- [ ] Finding state is Verified with audit record.

## Not done examples

- Scanner reports zero issues but its output is missing.
- Coverage passes after broad exclusions.
- A failing security test is skipped.
- Fix blocks one payload but leaves the unsafe sink.
- Insecure and secure behavior share a release-time flag.
- Retest uses a rebuilt artifact with a different digest.
- Documentation claims a check that was not run.

