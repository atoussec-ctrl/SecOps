# Implementation Status and Readiness

## Snapshot

Status date: 2026-09-17.

This document prevents architecture intent from being confused with deployed enforcement.

## Implemented on `main`

Merged through PR #29:

- static-readonly external project assessment boundary;
- deterministic project discovery;
- clean Git snapshot binding;
- project profile fingerprinting;
- baseline/finding identity logic;
- redacted evidence contract;
- scanner completeness checks;
- read-only/no-install/no-project-script invariants;
- symlink/root escape protection tests;
- repository task interface and full foundation/orchestrator/mutation checks.

Current `main` commit at this snapshot:

```text
8e181f2289ce0e590abef6746a8c46714544279d
```

## Staged in PR #28

PR #28 contains the secure-delivery slice:

- Argo CD application manifests;
- Argo Rollouts canary baseline;
- DEV/HOMOL/PROD overlays;
- stable/canary services;
- Prometheus rollout analysis;
- rollback window;
- workload hardening;
- Kyverno CEL admission policies;
- supply-chain release-gate contracts;
- build-once smoke workflow;
- SBOM/provenance/signature/attestation plumbing;
- GHCR-oriented publication path;
- merge queue workflow support;
- generated-workflow hardening.

Current documented head:

```text
f8441aa925652e6785b8839e56b69d8ac22d58e0
```

The GitHub pull-request workflow for that head completed successfully.

## Administrative blockers

Production publication MUST remain blocked while any of the following is true:

- repository Rulesets are absent;
- `main` is unprotected;
- required checks are not enforced;
- merge queue is not enforced;
- release workflow identity is broader than the final approved identity;
- production registry/cluster credentials are not configured with least privilege.

At this snapshot, GitHub reports no repository Rulesets and `main` is not protected.

## Technical blockers before production

- real application image and digest replacing placeholder fixture;
- real cluster execution of Argo CD/Rollouts/Kyverno manifests;
- schema validation with pinned Kubernetes/Kustomize/Kyverno tooling;
- calibrated Prometheus queries and production SLO thresholds;
- final signing identity restriction;
- protected GitOps promotion automation;
- last-known-good release ledger implementation;
- DAST authorization contract and enterprise target integration;
- API fuzz/load/stress/chaos execution;
- disaster-recovery exercise;
- runtime security integration;
- production incident-response drill.

## Tool qualification blockers

A discovered scanner version is not automatically approved. Gitleaks `v8.30.1` remains blocked from being treated as qualified until the secret-detection regression concern is resolved by a validated artifact/version and a positive canary test.

## Readiness gates

### Gate A — repository governance

Pass only when Rulesets/branch protection are live and independently verified.

### Gate B — supply-chain qualification

Pass only when the exact final application artifact can prove:

```text
source -> workflow -> builder -> digest -> SBOM -> scan -> provenance
-> signature -> attestation -> registry -> admission -> runtime digest
```

### Gate C — deployment validation

Pass only after DEV and HOMOL execute real Argo CD/Rollouts/Kyverno flows with known failure injection.

### Gate D — production authorization

Pass only after production SLOs, ownership, alert routing, rollback/runbook, incident contacts and change control are agreed.

## Definition of production-ready

The platform is production-ready only when all four readiness gates pass. A green CI run is necessary but not sufficient.
