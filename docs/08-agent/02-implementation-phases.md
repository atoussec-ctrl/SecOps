# Implementation Phases and Checkpoints

## Phase 0 — Repository and governance

### Build

- Polyglot directory structure and repository task interface.
- Version/lock policy and local prerequisites check.
- Scope schema, canonicalization library skeleton and test fixtures.
- Docker private topology skeleton and public-exposure test.
- Documentation validation and ADR process.

### Exit

- Clean bootstrap invokes smoke tests.
- Deliberate public/out-of-scope fixtures are rejected.
- CI quality skeleton runs without privileged secrets.

## Phase 1 — Control and finding planes

### Build

- Scope Guard, execution grants and run state machine.
- One synthetic adapter and one passive real adapter.
- PostgreSQL schema, outbox, evidence quarantine/redaction and Finding Hub API.
- SARIF ingestion, fingerprinting and finding workflow.
- Minimal Console screens for engagement/run/finding.

### Exit

- A synthetic result travels from scoped run to verified finding lifecycle.
- Kill switch and incomplete-result semantics pass fault tests.

## Phase 2 — Web labs

### Build

- Equivalent insecure/secure business features.
- Identity/session/authorization foundation.
- Mandatory Web scenarios in small scenario slices.
- Browser E2E, authorization matrix and security regressions.
- ZAP passive and bounded active profiles.

### Exit

- All mandatory Web scenarios demonstrate vulnerable and secure behavior.
- No insecure module is present in secure build graph.

## Phase 3 — Java API lab

### Build

- Domain and transfer state machine.
- REST/OpenAPI and GraphQL contracts.
- Authorization matrix, resource budgets and idempotency.
- Mandatory API scenarios and contract fuzz profile.

### Exit

- Contract compatibility, model/property and concurrent tests pass.
- API findings import and retest through canonical workflow.

## Phase 4 — Mobile lab

### Build

- Shared React Native UI/use cases and distinct native targets.
- Android and iOS secure capability adapters.
- Mandatory MASVS scenarios.
- Manifest/entitlement diff, artifact checks and MobSF integration.
- Dedicated dynamic-test runbooks.

### Exit

- Static and dynamic evidence exists for required control groups.
- Insecure Mobile targets cannot be release-signed.

## Phase 5 — DevSecOps and supply chain

### Build

- Full PR/main/nightly/release workflows.
- Custom SAST rules and rule tests.
- SCA, secret, IaC, image and workflow checks.
- SBOM, signing, provenance and exact-digest verification.
- Progressive gate and suppression/risk-acceptance behavior.

### Exit

- Secure artifact is built once, tested, scanned, gated, signed and verified.
- Insecure publication attempt fails unconditionally.

## Phase 6 — Reports and operations

### Build

- Executive/technical/retest reports.
- Evidence export manifest.
- Observability, alerts and operational runbooks.
- Backup/restore, maintenance and upgrade flows.

### Exit

- Report redaction/integrity tests pass.
- Restore rehearsal reproduces canonical finding/evidence metadata.

## Phase 7 — Capstone

### Build/execute

- Black-box assessment of disposable full lab.
- White-box root-cause review.
- Remediation PRs and protected pipeline.
- Independent retest and final reports.
- Teardown and no-reachable-vulnerable-service proof.

### Exit

All product acceptance criteria pass and release evidence is complete.

