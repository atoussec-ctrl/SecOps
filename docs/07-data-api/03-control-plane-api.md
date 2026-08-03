# Control-plane API Contract

## Conventions

- Base path: `/v1`.
- JSON UTF-8 and explicit media types.
- Stable error envelope with correlation ID.
- Idempotency key required for create/start/cancel/report operations.
- Cursor pagination for lists.
- Loopback/private access only in the reference deployment.
- OpenAPI is the source of truth and generates typed clients.

## Error envelope

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

Do not expose stack traces, tool command lines, secrets or raw authorization
records.

## Engagement endpoints

| Method/path | Purpose |
| --- | --- |
| `POST /v1/engagements` | Create draft from scope document |
| `GET /v1/engagements` | List authorized engagements |
| `GET /v1/engagements/{id}` | Engagement detail |
| `POST /v1/engagements/{id}/validate` | Dry-run scope/environment validation |
| `POST /v1/engagements/{id}/activate` | Activate after successful validation |
| `POST /v1/engagements/{id}/stop` | Stop and begin cleanup |

## Run endpoints

| Method/path | Purpose |
| --- | --- |
| `POST /v1/engagements/{id}/runs:dry-run` | Resolve target/profile/budgets without execution |
| `POST /v1/engagements/{id}/runs` | Create and start approved run |
| `GET /v1/runs/{id}` | Status, counters and receipts |
| `POST /v1/runs/{id}:pause` | Pause supported adapter |
| `POST /v1/runs/{id}:resume` | Resume after revalidation |
| `POST /v1/runs/{id}:cancel` | Cancel run |
| `POST /v1/runs:kill-all` | Privileged global kill switch |

## Finding endpoints

| Method/path | Purpose |
| --- | --- |
| `POST /v1/ingestions` | Upload/register bounded result document |
| `GET /v1/findings` | Filtered finding list |
| `GET /v1/findings/{id}` | Finding detail and occurrences |
| `POST /v1/findings/{id}/transitions` | Audited state transition |
| `POST /v1/findings/{id}/remediations` | Submit remediation |
| `POST /v1/remediations/{id}/retests` | Create retest |
| `POST /v1/findings/{id}/risk-acceptances` | Submit acceptance for approval |

## Evidence/report endpoints

| Method/path | Purpose |
| --- | --- |
| `POST /v1/evidence` | Quarantine, redact and store evidence |
| `GET /v1/evidence/{id}/metadata` | Safe metadata |
| `GET /v1/evidence/{id}/preview` | Safe rendered preview |
| `POST /v1/reports` | Generate from immutable snapshot |
| `GET /v1/reports/{id}` | Status and output manifest |

## Idempotency

The server stores operation key, actor, normalized request hash and outcome.
Reusing a key with different input is rejected. Retrying the same input returns
the original operation result.

## Transition request example

```json
{
  "transition": "confirm",
  "reason": "Reproduced against canary order WEB-AC-001.",
  "evidence_ids": ["evidence_example"],
  "expected_version": 3
}
```

The actual implementation must define complete JSON Schemas/OpenAPI examples
and negative contract tests.

