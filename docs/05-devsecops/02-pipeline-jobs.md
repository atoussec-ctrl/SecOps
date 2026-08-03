# Pipeline Job Specification

## Stage 0 — Metadata and change scope

1. Validate repository metadata, schemas and lockfiles.
2. Determine affected modules without omitting cross-cutting safety tests.
3. Validate third-party action pins and workflow permissions.
4. Check documentation links, diagram fences and generated contract drift.

## Stage 1 — Quality

| Job | Required checks |
| --- | --- |
| TypeScript | Format, lint, type check, unit/component tests, coverage |
| Python | Format, lint, type check, pytest, coverage |
| Java/Kotlin | Format/static checks, compile, JUnit, coverage |
| Swift | Format/lint, compile and supported tests |
| Contracts | JSON Schema/OpenAPI/GraphQL validation and compatibility |
| Architecture | Dependency rules and insecure-to-secure import prohibition |

## Stage 2 — Static security

- CodeQL for supported languages.
- Semgrep repository and custom rule suites.
- Language-specific analyzers where they add coverage.
- Gitleaks or equivalent secret scanning including history policy on protected
  branches.
- SCA for every lockfile/ecosystem.
- Terraform/Compose/Kubernetes/IaC configuration scanning.
- Workflow and containerfile policy checks.

## Stage 3 — Build

- Build once from reviewed source.
- Produce Web/API/service images and Mobile artifacts.
- Tag by commit for convenience but address by digest.
- Record compiler, runtime, dependency and base-image versions.
- Produce test and coverage artifacts.

## Stage 4 — Supply chain

- Generate CycloneDX or SPDX SBOM for each releaseable artifact.
- Scan artifacts and SBOMs for vulnerabilities/licenses.
- Scan final image, not only source manifests.
- Verify base image and dependency integrity.
- Produce provisional provenance tied to the candidate digest.

## Stage 5 — Ephemeral verification

1. Create private isolated environment.
2. Deploy exact candidate digests.
3. Seed synthetic deterministic fixtures.
4. Run public-exposure and health assertions.
5. Run integration, contract and browser E2E tests.
6. Run permitted dynamic security profiles.
7. Tear down and verify closed ports/resources.

## Stage 6 — Security result consolidation

- Validate every output file and receipt.
- Normalize SARIF and internal result formats.
- Deduplicate against baseline findings.
- Distinguish new, existing, fixed and tool-error results.
- Apply suppression only when an unexpired reviewed record matches exactly.

## Stage 7 — Gate and release

- Evaluate quality, security, safety and supply-chain gates.
- Produce a human-readable gate report.
- Require protected approval for release.
- Sign approved secure digests and final provenance.
- Publish only allowed artifacts.
- Store release evidence manifest.

## Failure semantics

- Missing result is failure, not zero findings.
- Scanner crash is tool failure, not security pass.
- Teardown failure blocks completion until resources are accounted for.
- Finding Hub ingestion failure blocks a protected release.
- Flaky tests are fixed or quarantined with owner/expiry; they are not silently
  retried until green.

