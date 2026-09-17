# Integration and Operations Runbook

## Purpose

This runbook is a command-oriented companion to the architecture and authentication documents. Commands use placeholders and MUST be adapted to the target environment without weakening permissions or trust conditions.

## Repository validation

Run the complete repository gate locally:

```bash
node tools/repo.mjs check:all
```

Individual checks:

```bash
node tools/repo.mjs check:prerequisites
node tools/repo.mjs check:docs
node tools/repo.mjs check:contracts
node tools/repo.mjs check:architecture
node tools/repo.mjs check:exposure
node tools/repo.mjs check:workflows
node tools/repo.mjs check:foundation
node tools/repo.mjs check:orchestrator
node tools/repo.mjs check:mutation
```

Repository task exit semantics:

```text
0 = success
1 = task failed
2 = invalid invocation
```

## GitHub workflow validation

The source of truth is `.github/workflow-set.json`. Do not hand-edit generated workflow YAML.

After changing the descriptor or version manifest:

```bash
node tools/repo.mjs check:workflows
node tools/repo.mjs check:foundation
```

A PR and merge queue candidate must remain read-only.

## External project static-readonly assessment

The foundation on `main` establishes read-only discovery, fingerprinting, baseline semantics, redaction and scanner-completeness rules.

The intended packaged CLI remains:

```bash
secops project inspect --project ../external-project
secops project scan --project ../external-project --plan assessment.json
secops project report --assessment ASM-YYYY-NNNN
```

Until that CLI is packaged, use repository-defined test/task entry points. Do not create a wrapper that executes project lifecycle scripts or installs target dependencies.

## GHCR operations

### Human/operator login

```bash
export CR_PAT="<read-or-write-packages PAT classic>"
echo "$CR_PAT" | docker login ghcr.io -u "<github-user>" --password-stdin
unset CR_PAT
```

### Pull exact artifact

```bash
docker pull ghcr.io/<org>/<image>@sha256:<digest>
```

### Inspect local artifact

```bash
docker inspect ghcr.io/<org>/<image>@sha256:<digest>
```

Deployment manifests SHOULD reference the same digest form.

## Artifact attestation

A container attestation binds the fully qualified image name without a tag to the exact `sha256:` digest.

Required workflow permissions:

```yaml
permissions:
  contents: read
  packages: write
  attestations: write
  id-token: write
```

## Cosign verification

```bash
cosign verify "ghcr.io/<org>/<image>@sha256:<digest>" \
  --certificate-identity "<approved-workflow-identity>" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

Do not use an unconstrained production identity.

## Argo CD operations

```bash
export ARGOCD_SERVER="argocd.example.invalid"
export ARGOCD_AUTH_TOKEN="<short-lived-token>"
```

Inspect applications:

```bash
argocd app list
argocd app get <application>
argocd app resources <application>
```

When automated sync is enabled, a pipeline does not need to invoke sync for every Git change. If explicit sync is required:

```bash
argocd app sync <application>
argocd app wait <application>
```

REST inspection:

```bash
curl -fsS \
  -H "Authorization: Bearer $ARGOCD_AUTH_TOKEN" \
  "https://$ARGOCD_SERVER/api/v1/applications"
```

## Argo Rollouts operations

Observe:

```bash
kubectl argo rollouts get rollout <rollout> -n <namespace> --watch
```

Promote one step:

```bash
kubectl argo rollouts promote <rollout> -n <namespace>
```

Abort:

```bash
kubectl argo rollouts abort <rollout> -n <namespace>
```

After abort, restore Git desired state to the stable digest. Runtime rollback alone is not a complete GitOps rollback.

List rollouts:

```bash
kubectl argo rollouts list rollouts -n <namespace>
```

## Kubernetes verification

Confirm runtime image IDs:

```bash
kubectl get pods -n <namespace> \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .status.containerStatuses[*]}{.imageID}{"\n"}{end}{end}'
```

Inspect rollout and analysis state:

```bash
kubectl get rollout -n <namespace>
kubectl get analysisrun -n <namespace>
kubectl describe rollout <rollout> -n <namespace>
```

## Kyverno verification

```bash
kubectl get imagevalidatingpolicies
kubectl get validatingpolicies
```

Before production enablement, test at least:

- unsigned image -> denied;
- signed image from wrong identity -> denied;
- valid signature but wrong digest -> denied;
- privileged pod -> denied;
- root container -> denied;
- missing required workload hardening -> denied where configured.

## Rollback runbook

1. Confirm the new rollout is the source of degradation.
2. Capture Rollout, AnalysisRun and application telemetry.
3. Abort the rollout if still progressing.
4. Identify the last known-good verified digest.
5. Restore that digest in Git desired state.
6. Allow Argo CD to reconcile.
7. Verify application health and exact runtime digest.
8. Re-run smoke and security checks.
9. Open incident/RCA if integrity, credentials or supply chain are involved.

## Security incident runbook

```text
freeze promotion
-> quarantine digest
-> restore known-good workload if safe
-> revoke/rotate affected credentials or trust
-> preserve logs/attestations/provenance
-> identify environments that consumed the digest
-> rebuild trusted artifact from reviewed source
-> independently verify
-> complete RCA
```
