# Secure delivery reference

Reference implementation for GitHub-hosted CI/CD with GitOps, progressive delivery, admission policy, rollback controls, and pipeline self-tests.

## Trust chain

`source SHA -> workflow identity -> artifact digest -> SBOM/provenance/signature -> GitOps digest -> admission policy -> runtime digest`

## Promotion invariant

Build an artifact once. Promote the exact OCI digest through `dev -> homol -> prod`; never rebuild per environment.

## Rollback invariant

Application rollback restores traffic to a last-known-good digest and then reconciles Git desired state. Database and destructive infrastructure changes require a compatibility or roll-forward plan; they are not blindly reversed.

## Validate

```bash
python tests/pipeline/selftest.py
```

The initial self-test is dependency-free and checks the core delivery safety invariants. A later gate will add pin-and-verify manifest schema validation with Kustomize/Kubeconform before cluster admission.
