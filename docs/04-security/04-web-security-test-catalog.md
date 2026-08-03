# Web Security Test Catalog

## Test workflow

For each item: understand normal behavior, test manually, use bounded
automation, capture minimum evidence, review source, fix, add regression and
retest. Record WSTG, ASVS and CWE mappings in the implementation catalog.

## Catalog

| Area | Mandatory tests | Automation role |
| --- | --- | --- |
| Information gathering | Routes, frameworks, metadata, backup/debug files, client assets | Crawl and passive header inventory |
| Configuration | TLS, headers, proxy trust, CORS, CSP, cache, debug behavior | Passive DAST and configuration policy |
| Identity | Registration, enumeration, role lifecycle, duplicate identities | Differential integration tests |
| Authentication | Password policy, recovery, MFA, rate limits, token validation | Bounded negative tests |
| Authorization | Anonymous, horizontal, vertical, tenant, object, function | Generated authorization matrix plus manual logic tests |
| Session | Fixation, rotation, timeout, logout, concurrent session, cookie flags | Stateful integration tests |
| Input | SQL/NoSQL/command/template/header/log injection | SAST plus controlled DAST |
| Browser | Reflected/stored/DOM XSS, CSRF, CORS, clickjacking, storage, messaging | Browser E2E and passive checks |
| Server-side | SSRF, path traversal, upload, XXE, deserialization, host header | Mock internal services and sandbox fixtures |
| Business logic | Workflow bypass, replay, idempotency, price/limit abuse, race | Model/property tests plus bounded concurrency |
| Error handling | Stack/data leakage, fail-open behavior, exception floods | Fault injection and assertions |
| Logging | Security events, correlation, redaction and alert thresholds | Event contract tests |
| Supply chain | Components, integrity, build metadata and assets | SCA, SBOM and provenance checks |

## Authorization matrix example

| Operation | Anonymous | Customer owner | Other customer | Support | Admin other tenant |
| --- | --- | --- | --- | --- | --- |
| Read public product | Allow | Allow | Allow | Allow | Allow |
| Read order | Deny | Allow | Deny | Scoped support only | Deny |
| Cancel order | Deny | State-dependent | Deny | Deny | Deny |
| View audit event | Deny | Deny | Deny | Limited | Tenant-scoped |
| Change user role | Deny | Deny | Deny | Deny | Tenant-scoped |

The implementation must generate tests from the complete operation/role matrix.

## Safe evidence examples

- One seeded canary object demonstrating ownership failure.
- A local browser marker proving XSS context.
- A synthetic preference update proving CSRF.
- A mock metadata response proving SSRF.
- A harmless sandbox marker proving process/path weakness.
- A bounded transaction pair proving race/idempotency failure.

## Not automated as a release attack

- Broad credential guessing.
- Availability stress beyond explicit disposable scenarios.
- Request smuggling against shared infrastructure.
- Any active scan of a non-ephemeral or unapproved environment.

## Completion criteria

- Vulnerable assertion behaves exactly as documented.
- Secure assertion blocks the proof without breaking valid behavior.
- Root cause is identified at the correct layer.
- Regression runs in protected CI.
- Report text describes impact without publishing reusable live secrets.

