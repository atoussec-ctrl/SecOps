# Implementation Task Backlog

Tasks are ordered by dependency. A task is complete only under the project
Definition of Done.

## Epic E0 — Foundation

| ID | Task | Depends on |
| --- | --- | --- |
| E0-001 | Create polyglot monorepo and repository task interface | None |
| E0-002 | Add version manifest, exact lockfiles and prerequisite verifier | E0-001 |
| E0-003 | Implement documentation/contract validation jobs | E0-001 |
| E0-004 | Define scope JSON Schema and safe sample scopes | E0-001 |
| E0-005 | Create private Compose topology and exposure assertion | E0-001 |
| E0-006 | Add architecture dependency fitness tests | E0-001 |
| E0-007 | Create base PR workflow with minimal permissions | E0-002, E0-003 |

## Epic E1 — Orchestrator and Finding Hub

| ID | Task | Depends on |
| --- | --- | --- |
| E1-001 | Implement URL/IP/CIDR canonicalization and special-range policy | E0-004 |
| E1-002 | Implement DNS resolution/pinning and redirect revalidation | E1-001 |
| E1-003 | Implement immutable scope snapshot/hash/approval model | E1-001 |
| E1-004 | Implement execution grants and replay protection | E1-003 |
| E1-005 | Implement run state machine, idempotency and budgets | E1-004 |
| E1-006 | Implement global kill and adapter heartbeat | E1-005 |
| E1-007 | Implement typed adapter registry and synthetic adapter | E1-005 |
| E1-008 | Create Finding Hub schema and migrations | E0-001 |
| E1-009 | Implement evidence quarantine, redaction, digest and retention | E1-008 |
| E1-010 | Implement SARIF/internal ingestion and receipts | E1-008, E1-009 |
| E1-011 | Implement fingerprint/deduplication and occurrences | E1-010 |
| E1-012 | Implement finding/remediation/retest/risk workflows | E1-011 |
| E1-013 | Implement transactional outbox and idempotent consumers | E1-008 |
| E1-014 | Implement minimal Console engagement/run/finding views | E1-005, E1-012 |
| E1-015 | Add passive ZAP adapter behind Scope Guard | E1-007, E1-010 |

## Epic E2 — Web labs

| ID | Task | Depends on |
| --- | --- | --- |
| E2-001 | Bootstrap independent insecure and secure targets/databases | E0-005 |
| E2-002 | Add shared external contracts without shared insecure internals | E2-001 |
| E2-003 | Implement identity, session and deterministic seed foundation | E2-002 |
| E2-004 | Implement authorization matrix and policy engine | E2-003 |
| E2-005 | Implement catalog/cart/order/support/admin business features | E2-004 |
| E2-006 | Add AUTH/SESSION scenarios and secure counterparts | E2-003 |
| E2-007 | Add object/function authorization scenarios | E2-004 |
| E2-008 | Add injection scenarios with bounded sandbox proofs | E2-005 |
| E2-009 | Add browser XSS/CSRF/CORS scenarios | E2-005 |
| E2-010 | Add SSRF/upload/path scenarios with mock services | E2-005 |
| E2-011 | Add business/race/error/logging scenarios | E2-005 |
| E2-012 | Add Playwright journeys and security regressions | E2-006 to E2-011 |
| E2-013 | Add bounded authenticated DAST profile | E1-015, E2-012 |

## Epic E3 — Java API

| ID | Task | Depends on |
| --- | --- | --- |
| E3-001 | Bootstrap Java LTS/Spring/PostgreSQL module with locks | E0-002 |
| E3-002 | Implement account/beneficiary/transfer domain and migrations | E3-001 |
| E3-003 | Implement transfer state machine and idempotency | E3-002 |
| E3-004 | Publish REST/OpenAPI contract and generated client | E3-002 |
| E3-005 | Publish bounded GraphQL schema and resolver policy | E3-002 |
| E3-006 | Implement authorization model/matrix | E3-002 |
| E3-007 | Add mandatory REST/API scenarios and secure counterparts | E3-003, E3-006 |
| E3-008 | Add mandatory GraphQL/resource scenarios | E3-005, E3-006 |
| E3-009 | Add Testcontainers, model, concurrency and mutation tests | E3-007, E3-008 |
| E3-010 | Add bounded contract-fuzz adapter/profile | E1-007, E3-004 |

## Epic E4 — Mobile

| ID | Task | Depends on |
| --- | --- | --- |
| E4-001 | Bootstrap React Native bare workspace and distinct target IDs | E0-002, E3-004 |
| E4-002 | Implement shared use cases and typed Java API client | E4-001 |
| E4-003 | Implement Android secure capability adapters | E4-002 |
| E4-004 | Implement iOS secure capability adapters | E4-002 |
| E4-005 | Add STORAGE/CRYPTO/AUTH scenarios | E4-003, E4-004 |
| E4-006 | Add NETWORK/PLATFORM scenarios | E4-003, E4-004 |
| E4-007 | Add CODE/RESILIENCE/PRIVACY scenarios | E4-003, E4-004 |
| E4-008 | Add manifest/entitlement/permission diff jobs | E4-001 |
| E4-009 | Add MobSF static adapter/import | E1-007, E4-001 |
| E4-010 | Add dedicated device/emulator dynamic suite and reset | E4-005 to E4-009 |

## Epic E5 — DevSecOps and reporting

| ID | Task | Depends on |
| --- | --- | --- |
| E5-001 | Add CodeQL/Semgrep/language analysis matrix | E0-007 |
| E5-002 | Add tested custom security-rule packs | E2/E3/E4 scenario code |
| E5-003 | Add secrets, SCA, IaC, image and workflow checks | E0-007 |
| E5-004 | Generate/validate SBOMs for final artifacts | E2-001, E3-001, E4-001 |
| E5-005 | Implement normalized result consolidation and gate report | E1-012, E5-001, E5-003 |
| E5-006 | Implement suppression and expiring risk-acceptance policy | E1-012, E5-005 |
| E5-007 | Implement exact-digest promotion, signing and provenance | E5-004, E5-005 |
| E5-008 | Add insecure-publication hard gate tests | E5-007 |
| E5-009 | Implement Markdown/HTML report generator | E1-012 |
| E5-010 | Add executive/technical/retest templates and redaction tests | E5-009 |
| E5-011 | Add observability dashboards/alerts and audit views | E1-013 |
| E5-012 | Add backup/restore and maintenance automation | E1-009, E1-012 |

## Epic E6 — Capstone

| ID | Task | Depends on |
| --- | --- | --- |
| E6-001 | Create full disposable capstone scope and fixture | E2, E3, E4, E5 |
| E6-002 | Execute black-box Web/API/Mobile assessment | E6-001 |
| E6-003 | Perform white-box root-cause review | E6-002 |
| E6-004 | Submit remediation PRs and run protected pipeline | E6-003 |
| E6-005 | Execute independent retest | E6-004 |
| E6-006 | Generate final reports and release evidence | E6-005 |
| E6-007 | Teardown and prove no vulnerable services remain | E6-006 |

