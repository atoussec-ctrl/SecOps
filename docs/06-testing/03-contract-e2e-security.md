# Contract, End-to-end and Security Testing

## Contract testing

### HTTP/OpenAPI

- Validate specification syntax and examples.
- Generate/validate typed clients.
- Test request/response status, schemas and error model.
- Compare backward compatibility against supported contract version.
- Verify authentication and authorization metadata matches runtime policy.

### GraphQL

- Validate schema and resolver coverage.
- Detect breaking field/type changes.
- Test per-resolver authorization and error redaction.
- Enforce depth, complexity, batch and result budgets.

### Events

- Validate event envelope and payload schema.
- Test idempotent consumer behavior.
- Test unknown optional fields and supported prior versions.
- Preserve ordering only where a domain aggregate requires it.

## E2E journeys

| ID | Journey |
| --- | --- |
| E2E-001 | Create engagement, approve scope and provision lab |
| E2E-002 | Reject out-of-scope target without process/network side effect |
| E2E-003 | Complete guided Web scenario and verified retest |
| E2E-004 | Run role-based API scenario and inspect state |
| E2E-005 | Import Mobile static result and attach evidence |
| E2E-006 | Remediate finding and enforce CI gate |
| E2E-007 | Generate redacted technical and executive report |
| E2E-008 | Sign secure candidate and reject insecure publication |
| E2E-009 | Kill an active run and verify cleanup |
| E2E-010 | Backup, restore and verify evidence digests |

## Security regression contract

Every confirmed finding supplies a machine-readable regression reference:

- finding/scenario ID;
- target version and test identity;
- fixture and preconditions;
- expected vulnerable outcome;
- expected secure outcome;
- cleanup behavior;
- related mapping and remediation commit.

## Black-box capstone

Capstone tests receive only scope, user-facing contracts and seeded lab
identities. They may not import target internals or reveal hints. White-box
review follows after black-box evidence capture.

## Failure injection

- Database unavailable during transition.
- Evidence storage unavailable after redaction.
- Adapter heartbeat lost.
- Tool output truncated/invalid.
- DNS changes mid-run.
- Target restart during active profile.
- Signing identity unavailable.

The expected state and recovery for each fault are asserted.

