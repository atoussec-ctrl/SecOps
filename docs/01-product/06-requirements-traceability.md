# Requirements Traceability Matrix

This matrix identifies the authoritative design, implementation tasks and
verification for each requirement family. The implementation repository must
expand it to individual requirements as tests are created.

| Requirement family | Design/specification | Backlog | Primary verification |
| --- | --- | --- | --- |
| `FR-GOV-*` | Orchestrator, RoE, threat model | E0-004, E1-001 to E1-006 | AC-SAFE-001/002, scope property tests |
| `FR-ENV-*` | Runtime/deployment architecture | E0-005, E2-001, E6-007 | Exposure, bootstrap and teardown E2E |
| `FR-SCN-*` | Web/API/Mobile app specs | E2-006 to E2-011, E3-007/008, E4-005 to E4-007 | Scenario vulnerable/secure assertions |
| `FR-ORC-*` | Orchestrator and adapter specs | E1-004 to E1-007, E1-015, E3-010, E4-009 | Run state, budget, kill and adapter contract tests |
| `FR-FND-*` | Finding Hub, domain/data/SARIF models | E1-008 to E1-013 | AC-FND-001/002 and workflow tests |
| `FR-RSK-*` | Vulnerability management/report specs | E5-005/006/009/010 | Risk-decision and redacted report tests |
| `FR-CICD-*` | CI/CD, gates, SBOM and release specs | E5-001 to E5-008 | AC-PIPE-001/002 and release policy tests |
| `FR-MOB-*` | Mobile app and Mobile pipeline specs | E4-001 to E4-010 | AC-MOB-001 and artifact/device tests |
| `NFR-SEC-*` | Threat model and security standards | Cross-cutting | Security invariants and negative tests |
| `NFR-REL-*` | Runtime and resilience test specs | E1/E5/E6 | Fault injection and operations tests |
| `NFR-PERF-*` | Performance/resilience specification | Relevant service tasks | Bounded performance profiles |

## Traceability record required in code

Every automated test covering a normative requirement should include the stable
requirement/scenario/finding ID in its test metadata or name. Generated reports
must be able to show:

- requirement/control;
- implementation module/version;
- test suite/case and last result;
- evidence/artifact digest;
- known limitation or valid exception.

## Change rules

- A new requirement is not accepted without an owner and verification approach.
- A changed requirement updates affected tests and this matrix.
- A removed requirement remains in history and points to its superseding
  decision; IDs are never reused.
- A failing trace link is a documentation/quality-gate failure.

