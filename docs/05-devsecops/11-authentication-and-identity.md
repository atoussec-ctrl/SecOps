# Authentication and Workload Identity

## Purpose

This document maps every authentication boundary used or planned by the secure delivery platform. It distinguishes human authentication, automation identity, registry authentication, signing identity and cluster authorization.

## Identity matrix

| Boundary | Preferred identity | Secret type | Status |
| --- | --- | --- | --- |
| Developer -> GitHub | GitHub account + organization policy | human session/SSO | external |
| PR workflow -> repository | `GITHUB_TOKEN` read-only | short-lived token | implemented |
| Release workflow -> GHCR | `GITHUB_TOKEN` + `packages: write` | short-lived token | staged |
| Release workflow -> GitHub attestation | OIDC + `attestations: write` | short-lived JWT | staged |
| Release workflow -> Sigstore | GitHub OIDC keyless | ephemeral certificate | staged |
| Argo CD -> Git repository | deploy key/App/token/OIDC-backed integration | scoped credential | deployment-specific |
| Operator -> Argo CD | SSO or bounded account token | bearer token | specified |
| Argo CD -> Kubernetes | service account/RBAC | Kubernetes credential | specified |
| Kyverno -> private GHCR | registry provider/secret in Kyverno namespace | scoped registry auth | staged design |
| Human -> GHCR CLI | PAT classic only when needed | PAT classic | external/manual |

## GitHub `GITHUB_TOKEN`

PR and merge-queue workflows use least privilege:

```yaml
permissions:
  contents: read
```

Writable scopes are job-specific and MUST NOT appear in PR or merge-group jobs.

Release jobs may require:

```yaml
permissions:
  contents: read
  packages: write
  attestations: write
  id-token: write
```

`id-token: write` permits a job to request a GitHub OIDC JWT. It does not itself grant write access to cloud resources.

## GitHub OIDC trust

Issuer:

```text
https://token.actions.githubusercontent.com
```

Trust policies SHOULD constrain at least repository/immutable repository ID, repository owner/owner ID, ref or environment, workflow identity, reusable workflow identity when used, expected event and audience where supported.

Repositories created after 2026-07-15 use immutable default subjects containing owner and repository IDs. Older repositories keep the previous format until opting in. Provider trust must be updated before switching formats.

Claims worth evaluating:

```text
sub
aud
repository
repository_id
repository_owner
repository_owner_id
workflow_ref
workflow_sha
job_workflow_ref
job_workflow_sha
environment
event_name
runner_environment
```

A cloud role MUST NOT trust every workflow in an organization merely because the issuer is GitHub.

## GHCR authentication

### GitHub Actions

For packages associated with the workflow repository, use `GITHUB_TOKEN` rather than a long-lived PAT.

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
```

The publishing job needs `packages: write`.

### Human/local CLI

GitHub Packages uses a PAT classic for CLI authentication. Use the smallest scope necessary: `read:packages` for pull and `write:packages` for push. Avoid unnecessary `repo` scope.

Never paste the PAT into shell history. Use an environment variable or approved secret store and pipe it with `--password-stdin`.

## Sigstore/Cosign keyless identity

Automated release signing is keyless. Verification MUST constrain identity and issuer.

```bash
cosign verify "$IMAGE@sha256:$DIGEST" \
  --certificate-identity "<approved-workflow-identity>" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

Wildcard production identities are not acceptable.

## Argo CD authentication

Preferred interactive authentication is organization SSO. Automation SHOULD use a narrowly scoped account/token or supported external OIDC mechanism.

```bash
curl -H "Authorization: Bearer $ARGOCD_AUTH_TOKEN" \
  "https://$ARGOCD_SERVER/api/v1/applications"
```

The local-account session endpoint exists for enabled local accounts, but production automation SHOULD avoid depending on the built-in `admin` account.

## Kubernetes authorization

Argo CD and operators authenticate to Kubernetes through their own identities; Kubernetes RBAC authorizes actions.

- no shared cluster-admin identity for routine automation;
- Argo CD gets only required namespaces/resources;
- production operator and read-only support roles are separate;
- application ServiceAccount tokens are not mounted unless needed;
- `kubectl` activity is audit-logged.

## Kyverno registry access

For private GHCR images, ImageValidatingPolicy may need credentials to retrieve signatures or attestations. Configure these in the Kyverno control plane, not in application manifests. Registry secrets, when needed, belong in the Kyverno namespace.

## Secret-handling rules

Authentication material MUST NOT be committed, placed in SARIF/finding evidence, copied into PR text, echoed by CI, persisted in scanner logs, embedded in deployment manifests or included in provenance environment dumps.

## Break-glass identity

Emergency access MUST be separate from normal automation, time bounded, fully audited, two-person approved where available, and revoked or rotated after use.
