# DevSecOps and Secure Delivery Index

This section is the operational documentation hub for CI/CD, supply-chain security, external project assessment, GitOps delivery, runtime admission, authentication, and release operations.

## Status vocabulary

- **Implemented**: present on `main` and covered by repository tests.
- **Staged**: implemented on an open pull request but not yet part of `main`.
- **Specified**: normative design exists, but runtime implementation is not complete.
- **Planned**: accepted direction without an executable implementation yet.
- **Blocked**: intentionally prevented until a prerequisite or qualification gate passes.

## Current repository snapshot

As of 2026-09-17:

- external-project static-readonly assessment foundation is **Implemented** on `main` through PR #29;
- secure delivery, GitOps, supply-chain smoke, Kyverno and Argo Rollouts are **Staged** in PR #28;
- PR #28 head `f8441aa925652e6785b8839e56b69d8ac22d58e0` completed its pull-request workflow successfully;
- repository Rulesets are currently absent and `main` is currently unprotected;
- privileged release/sign/publish capabilities therefore remain **Blocked** from being treated as production-ready;
- no production application image is yet wired into the delivery manifests;
- external DAST against enterprise targets is **Planned** behind a separate authorization contract.

## Reading order

1. [`01-cicd-architecture.md`](01-cicd-architecture.md)
2. [`03-security-gates.md`](03-security-gates.md)
3. [`04-static-supply-chain.md`](04-static-supply-chain.md)
4. [`06-sbom-signing-provenance.md`](06-sbom-signing-provenance.md)
5. [`07-environments-release.md`](07-environments-release.md)
6. [`09-external-project-assessment.md`](09-external-project-assessment.md)
7. [`10-secure-delivery-operations.md`](10-secure-delivery-operations.md)
8. [`11-authentication-and-identity.md`](11-authentication-and-identity.md)
9. [`12-integration-runbook.md`](12-integration-runbook.md)
10. [`13-tool-qualification-and-testing.md`](13-tool-qualification-and-testing.md)
11. [`14-implementation-status.md`](14-implementation-status.md)
12. [`../07-data-api/06-integration-api-map.md`](../07-data-api/06-integration-api-map.md)

## Governing principles

1. Build a release artifact once and promote the same immutable digest.
2. Treat source, workflow, builder identity, artifact digest, SBOM, provenance, signature, attestation and runtime digest as one verifiable trust chain.
3. Keep pull requests and merge-queue candidates read-only.
4. Fail closed when evidence, scanner output, identity or policy state is missing or inconsistent.
5. Separate deployment rollback from security incident response.
6. Never allow documentation or automation to imply that a staged or unverified control is already enforced in production.
