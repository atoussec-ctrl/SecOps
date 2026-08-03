# Functional Requirements

Requirements use stable IDs. Acceptance tests must reference these IDs.

## Governance and scope

| ID | Requirement |
| --- | --- |
| FR-GOV-001 | The system MUST create an engagement from a versioned scope document. |
| FR-GOV-002 | Scope MUST identify authorization, targets, excluded targets, time window, test profiles, budgets and stop contacts. |
| FR-GOV-003 | The orchestrator MUST reject execution when authorization or time window is invalid. |
| FR-GOV-004 | Hostnames MUST be resolved and every resulting address validated before execution. |
| FR-GOV-005 | Redirects and subsequent connections MUST remain within scope. |
| FR-GOV-006 | A global kill switch MUST stop new work and terminate active adapters. |
| FR-GOV-007 | All state-changing actions MUST be written to an append-only audit trail. |

## Environment lifecycle

| ID | Requirement |
| --- | --- |
| FR-ENV-001 | The system MUST provision insecure and secure targets independently. |
| FR-ENV-002 | Vulnerable targets MUST bind only to loopback or approved private lab interfaces. |
| FR-ENV-003 | Startup MUST fail when a vulnerable target detects public binding or unsupported mode. |
| FR-ENV-004 | Scenario reset MUST restore deterministic seed data. |
| FR-ENV-005 | Teardown MUST remove runtime resources while preserving approved evidence. |
| FR-ENV-006 | Every target MUST expose health, version and scenario metadata without secrets. |

## Scenario catalog

| ID | Requirement |
| --- | --- |
| FR-SCN-001 | Every scenario MUST have a stable ID, title, learning objective and difficulty. |
| FR-SCN-002 | A scenario MUST define vulnerable behavior, secure behavior and prerequisites. |
| FR-SCN-003 | A scenario MUST map to at least one weakness or verification identifier. |
| FR-SCN-004 | A scenario MUST include non-destructive proof boundaries and reset instructions. |
| FR-SCN-005 | Guided hints MUST be progressively revealable and disabled in capstone mode. |
| FR-SCN-006 | Scenario completion MUST require a fix and verified retest, not discovery alone. |

## Orchestration and tools

| ID | Requirement |
| --- | --- |
| FR-ORC-001 | The orchestrator MUST expose dry-run, start, pause, cancel and status operations. |
| FR-ORC-002 | Each tool MUST be invoked through an approved adapter; arbitrary shell strings are forbidden. |
| FR-ORC-003 | Adapters MUST use typed argument arrays and validate every user-supplied value. |
| FR-ORC-004 | Adapters MUST enforce rate, concurrency, request, duration and response-size budgets. |
| FR-ORC-005 | The orchestrator MUST record tool name, version, image digest, configuration hash and scope hash. |
| FR-ORC-006 | Active profiles MUST require explicit operator confirmation. |
| FR-ORC-007 | Production-like profiles MUST default to passive behavior. |

## Findings and evidence

| ID | Requirement |
| --- | --- |
| FR-FND-001 | The Finding Hub MUST ingest SARIF and a documented internal JSON format. |
| FR-FND-002 | Imported results MUST retain raw source and normalization provenance. |
| FR-FND-003 | Results MUST be fingerprinted and deduplicated without discarding occurrences. |
| FR-FND-004 | A finding MUST support new, triaged, confirmed, false-positive, remediating, ready-for-retest, verified, reopened and risk-accepted states. |
| FR-FND-005 | Confirmed findings MUST include root cause, impact, evidence, remediation and mapping. |
| FR-FND-006 | Evidence MUST be redacted, content-addressed and linked to its engagement. |
| FR-FND-007 | Retest MUST preserve original and new evidence. |
| FR-FND-008 | Risk acceptance MUST identify approver, rationale, compensating controls and expiry. |

## Risk and reporting

| ID | Requirement |
| --- | --- |
| FR-RSK-001 | CVSS, EPSS, KEV, exposure, asset criticality, confidence and business impact MUST remain separate data points. |
| FR-RSK-002 | Priority decisions MUST preserve a human-readable rationale. |
| FR-RSK-003 | Reports MUST support executive, technical and retest views. |
| FR-RSK-004 | Reports MUST include scope, limitations, methodology, findings, attack narrative, recommendations and evidence references. |
| FR-RSK-005 | Report generation MUST exclude raw secrets and unredacted sensitive payloads. |

## Delivery and supply chain

| ID | Requirement |
| --- | --- |
| FR-CICD-001 | PR, main, nightly and release workflows MUST be distinct. |
| FR-CICD-002 | Application tests, SAST, secret scanning, SCA and IaC checks MUST run before build promotion. |
| FR-CICD-003 | Dynamic tests MUST target an ephemeral environment created from the exact candidate artifact. |
| FR-CICD-004 | Every release artifact MUST have an SBOM, digest, signature and provenance statement. |
| FR-CICD-005 | Insecure artifacts MUST never be uploaded to a public registry or release channel. |
| FR-CICD-006 | Security findings MUST be normalized into the canonical finding workflow. |

## Mobile

| ID | Requirement |
| --- | --- |
| FR-MOB-001 | Insecure and secure mobile targets MUST have distinct application identifiers. |
| FR-MOB-002 | Insecure targets MUST not support production release signing. |
| FR-MOB-003 | Build output MUST include manifest/entitlement and permission diffs. |
| FR-MOB-004 | Static analysis MUST run on generated APK/IPA artifacts where supported. |
| FR-MOB-005 | Dynamic tests MUST use dedicated emulators, simulators or owned test devices. |
| FR-MOB-006 | Required MASVS control groups MUST have scenario coverage and evidence. |

