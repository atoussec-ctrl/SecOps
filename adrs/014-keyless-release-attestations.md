# ADR-014: Keyless release attestations and fail-closed signing

Status: Proposed

## Context

The delivery specification currently has two unresolved supply-chain conflicts. The pipeline describes provisional provenance during build and final provenance later, while the integrity diagram places provenance only after the policy gate. The signing document prefers keyless OIDC "when available" but does not define key custody, rotation, revocation, or recovery for a static-key fallback.

A release workflow therefore needs two separate facts: where an artifact came from, and whether it passed the release gate. Treating both as one undifferentiated "provenance" record makes failed or rejected artifacts indistinguishable from releasable ones. Silently falling back from short-lived GitHub OIDC identity to a long-lived signing key would also widen the trust boundary exactly when the preferred mechanism is unavailable.

## Decision

1. **Build provenance and release approval are separate attestations.**
   - Build provenance binds the immutable artifact digest to repository, workflow and commit identity after the artifact digest exists.
   - Release/gate attestation is emitted only after mandatory SBOM, malware, vulnerability, signature/provenance and policy checks succeed. It records the policy result and the exact immutable digest being promoted.
2. **Release artifacts are built once.** Scanners, SBOM generation, signing and attestations operate on the same image bytes/digest; promotion never rebuilds the artifact.
3. **Keyless GitHub Actions OIDC is the only automated signing identity for this path.** The job receives `id-token: write` only where signing/attestation occurs. That permission authorizes requesting an OIDC token; it does not grant resource write access by itself.
4. **There is no automatic static-key fallback.** If OIDC, Fulcio/Sigstore, transparency-log requirements, or the configured attestation service are unavailable, signing/attestation fails closed and the release is not promoted.
5. **Identity verification is narrow.** Verification must constrain the OIDC issuer and the approved repository/workflow identity, not merely accept any certificate issued to the organization.
6. **Registry publication and attestation are distinct permissions.** `packages: write`, `attestations: write`, and `id-token: write` are granted only to the trusted release job; pull-request workflows remain read-only.
7. **GitHub artifact attestations and Cosign are complementary.** GitHub artifact attestations provide SLSA/in-toto-compatible provenance/SBOM attestations associated with the repository. Cosign provides OCI signature verification suitable for admission policy. Both bind to the same digest.
8. **A release is promotable only when verification succeeds.** The promotion record must identify the digest, source commit, provenance identity, SBOM, security-gate result and signature verification result.

## Consequences

### Positive

- Removes ambiguous "provisional versus final provenance" semantics.
- Prevents a degraded signing service from silently changing the trust model.
- Eliminates long-lived signing secrets from the normal GitHub Actions path.
- Gives admission controllers and operators independent evidence: build provenance, SBOM attestation, gate decision and OCI signature.
- Keeps DEV, HOMOL and PROD on the exact same immutable artifact.

### Negative/trade-offs

- Sigstore/OIDC or attestation-service outages can stop releases even when the application itself is healthy.
- Private repositories may have plan-dependent GitHub artifact-attestation availability; portable Cosign/Sigstore verification remains required when GitHub-hosted attestation features are unavailable.
- Identity regexes and admission policies must be updated deliberately when the trusted workflow path changes.
- This decision does not make builds hermetic or reproducible; that remains a separate requirement.

### Follow-up work

- Pin the approved Cosign installer/action and Cosign release.
- Pin the SBOM and vulnerability scanner toolchains.
- Extend the generated workflow contract with typed action expressions rather than raw `${{ }}` interpolation.
- Add a supply-chain fixture that exercises build-once, GHCR push, provenance, SBOM attestation and keyless signature verification before enabling application publication.
- Narrow the Kyverno identity rule to the final release workflow identity after that workflow exists.
- Define and test the release/gate attestation predicate schema.

## Alternatives considered

**Static repository signing key.** Rejected for the normal automated path because custody, rotation, revocation, backup and compromise recovery are not specified and would create a long-lived secret in CI.

**Fallback from OIDC to a static key.** Rejected because an outage or identity failure would silently weaken authentication at the exact point where a release should stop.

**One provenance record generated only at the end.** Rejected because provenance describes artifact origin, while release approval describes a policy decision. They have different lifecycle semantics.

**Rebuild during promotion.** Rejected because the artifact tested in DEV/HOMOL would no longer be cryptographically identical to the one entering PROD.

## Security and operational impact

The trusted release job becomes a privileged boundary. It may write packages and attestations and request an OIDC identity, so it must never run against untrusted pull-request code. Third-party actions remain pinned to full commit SHA. Raw workflow expressions remain forbidden in shell commands. OIDC unavailability, invalid signature, missing SBOM, invalid provenance, mismatched digest or failed release-gate evidence are blocking failures.

Rollback changes desired state to a previously verified digest or rolls forward; it does not rebuild the old release. Destructive database or infrastructure migrations remain outside blind automatic rollback.

Required tests include expression allowlisting, action SHA pinning, token-permission isolation, digest equality across evidence, rejected untrusted identities, failed attestation/signature handling, and verification of the exact pushed digest.

## References

- `docs/08-agent/08-specification-conflicts.md`, entries 5 and 6.
- `docs/05-devsecops/06-sbom-signing-provenance.md`.
- `docs/05-devsecops/02-pipeline-jobs.md`.
- `adrs/007-pinned-artifacts.md`.
- `adrs/010-generated-ci-workflows.md`.
