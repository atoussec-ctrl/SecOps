# Integration and API Map

## Purpose

This document maps internal SecOps contracts and external platform integrations. It explicitly distinguishes implemented library/contracts from specified HTTP interfaces and external vendor APIs.

## Integration map

| Interface | Protocol | Authentication | Source of truth | Status |
| --- | --- | --- | --- | --- |
| SecOps control plane | HTTPS/JSON `/v1` | future service auth/RBAC | `03-control-plane-api.md` | specified |
| External project assessment | files + JSON contracts | local policy boundary | contracts + orchestrator | implemented foundation |
| Finding Hub | Python service/library + contracts | process boundary today | finding/evidence schemas | implemented foundation |
| GitHub repository | Git/REST/Actions | GitHub identity / `GITHUB_TOKEN` | GitHub | active |
| GitHub OIDC | OIDC/JWT | workflow identity | GitHub issuer | staged for release |
| GHCR | OCI Registry API | `GITHUB_TOKEN` or PAT classic | `ghcr.io` | staged |
| GitHub artifact attestations | Actions/attestation API | OIDC + token permissions | GitHub | staged |
| Sigstore/Cosign | OCI + Sigstore | keyless OIDC identity | Sigstore | staged |
| Argo CD | REST/gRPC/GitOps | SSO/token/RBAC | Argo CD | staged manifests |
| Argo Rollouts | Kubernetes CRDs/API | Kubernetes RBAC | cluster | staged manifests |
| Kyverno | Kubernetes admission/CEL | Kubernetes admission identity | cluster policy | staged manifests |
| Prometheus | HTTP query API | deployment-specific | metrics backend | staged query contract |

## Internal control-plane API

The normative control-plane base path is:

```text
/v1
```

### Engagements

```text
POST /v1/engagements
GET  /v1/engagements
GET  /v1/engagements/{id}
POST /v1/engagements/{id}/validate
POST /v1/engagements/{id}/activate
POST /v1/engagements/{id}/stop
```

### Runs

```text
POST /v1/engagements/{id}/runs:dry-run
POST /v1/engagements/{id}/runs
GET  /v1/runs/{id}
POST /v1/runs/{id}:pause
POST /v1/runs/{id}:resume
POST /v1/runs/{id}:cancel
POST /v1/runs:kill-all
```

### Findings and remediation

```text
POST /v1/ingestions
GET  /v1/findings
GET  /v1/findings/{id}
POST /v1/findings/{id}/transitions
POST /v1/findings/{id}/remediations
POST /v1/remediations/{id}/retests
POST /v1/findings/{id}/risk-acceptances
```

### Evidence and reports

```text
POST /v1/evidence
GET  /v1/evidence/{id}/metadata
GET  /v1/evidence/{id}/preview
POST /v1/reports
GET  /v1/reports/{id}
```

These are **specified interfaces**. Do not present them as deployed network endpoints until an actual service implementation and OpenAPI artifact exist.

## Request conventions

The control plane requires JSON UTF-8, stable media types, correlation IDs, idempotency keys for mutating operations, cursor pagination, fail-closed errors and no stack traces or raw secrets in responses.

Canonical error shape:

```json
{
  "error": {
    "code": "SCOPE_TARGET_REJECTED",
    "message": "Target is outside the authorized scope.",
    "correlation_id": "corr_example",
    "details": []
  }
}
```

## External assessment contracts

Static-readonly assessment currently uses file/JSON boundaries rather than a network API.

Key contracts include:

```text
project-profile
external-assessment-plan
scanner-run
evidence-record
baseline-set
finding lifecycle
```

The project profile is discovery output. The assessment plan is authorization input. A scanner may not increase its own authority by changing discovery data.

## GitHub integration

### Inbound triggers

```text
pull_request
merge_group
workflow_dispatch for explicitly privileged/manual workflows
```

`pull_request_target` is intentionally not representable in the generated workflow contract.

### Token model

PR/merge-group:

```text
contents: read
```

Release jobs may add only required scopes:

```text
packages: write
attestations: write
id-token: write
```

### GitHub OIDC

Issuer:

```text
https://token.actions.githubusercontent.com
```

The receiving provider should validate subject/audience and, where supported, immutable repository/workflow claims.

## GHCR integration

Registry:

```text
ghcr.io
```

Canonical artifact identity:

```text
ghcr.io/<owner>/<image>@sha256:<digest>
```

Tags are human-readable aliases. Security decisions and deployment manifests use the digest.

GitHub Actions SHOULD use `GITHUB_TOKEN` for packages linked to the repository. Manual CLI usage uses a minimally scoped PAT classic when required.

## GitHub artifact attestation integration

Container build provenance binds:

```text
subject-name = fully-qualified image name without tag
subject-digest = sha256:<exact published digest>
```

Required workflow permissions:

```text
contents: read
packages: write
attestations: write
id-token: write
```

The attestation is evidence. Deployment policy verifies it rather than merely generating it.

## Sigstore/Cosign integration

Signing is keyless in CI. Verification requires artifact digest, expected certificate identity and expected OIDC issuer. A valid signature from an unexpected repository/workflow is rejected.

## Argo CD API integration

Argo CD exposes Swagger at:

```text
/swagger-ui
```

REST automation uses:

```http
Authorization: Bearer <token>
```

Common endpoints:

```text
GET  /api/v1/applications
POST /api/v1/session
```

The session endpoint is for enabled local accounts. Production automation SHOULD prefer SSO/external OIDC or a narrowly scoped automation account instead of built-in admin.

## Argo Rollouts integration

Argo Rollouts is operated through Kubernetes CRDs and the Kubernetes API.

Primary resource types:

```text
Rollout
AnalysisTemplate
AnalysisRun
Experiment
```

Authentication is Kubernetes authentication; authorization is Kubernetes RBAC.

## Kyverno integration

Staged secure-delivery policy types:

```text
policies.kyverno.io/v1 ImageValidatingPolicy
policies.kyverno.io/v1 ValidatingPolicy
```

Image validation can require matching GHCR reference, digest verification, trusted keyless identity, signature/attestation verification and fail-closed admission.

## Prometheus integration

Argo Rollouts queries Prometheus during canary analysis. Prometheus endpoints, credentials, metric names and SLO thresholds are deployment-specific and MUST NOT be hard-coded as universal defaults.

## Data ownership rule

External vendor APIs may transport or verify evidence, but canonical SecOps state remains defined by SecOps contracts. GitHub SARIF limits, registry tags or Argo controller status must never become the only copy of finding or release identity.
