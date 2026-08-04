# Package Manifest

## Package summary

- Specification version: 1.0.0
- Deliverable type: Markdown-only source package inside ZIP
- Normative language: English
- Portuguese entrypoint: `README.pt-BR.md`
- Diagram source: Mermaid fenced blocks
- Implementation status: E0-001 to E0-006 complete; E0-007, E1-001, E1-003,
  E1-010 and E1-013 partial
- Bootstrap command: `node tools/repo.mjs check:all`
- Verification: 7 checks, 273 tests

## Sections

| Path | Purpose |
| --- | --- |
| `README.md` | Normative entrypoint and non-negotiable constraints |
| `README.pt-BR.md` | Portuguese executive entrypoint |
| `docs/00-overview` | Vision, scope, standards, roadmap and maps |
| `docs/01-product` | PRD, personas, requirements, acceptance and traceability |
| `docs/02-architecture` | Context, components, deployment, data and contracts |
| `docs/03-applications` | Implementation specifications for every application |
| `docs/04-security` | Threat model, RoE, coding and security test catalogs |
| `docs/05-devsecops` | Pipelines, gates, scanners, SBOM and release |
| `docs/06-testing` | TDD, coverage, mutation, E2E and resilience |
| `docs/07-data-api` | Domain model, schema, APIs, events and SARIF mapping |
| `docs/08-agent` | Agent manual, phases, backlog, DoD, bootstrap prompt, implementation log and conflict register |
| `docs/09-operations` | Local, scan, incident, backup and maintenance runbooks |
| `adrs` | Accepted architectural decisions and index |
| `templates` | Finding, report, threat, test, risk, ADR, runbook and PR templates |

## Implementation sections

| Path | Purpose |
| --- | --- |
| `tools` | Repository task interface (`node tools/repo.mjs help`) |
| `version-manifest.json` | Pinned toolchain versions and undecided selections |
| `package.json`, `package-lock.json` | Private root manifest and exact Node lockfile |
| `apps` | Console, Web labs, Java API lab and Mobile lab module boundaries |
| `services` | Orchestrator, Finding Hub and report generator boundaries |
| `packages` | Language-neutral contracts and shared TypeScript primitives |
| `packages/contracts/security` | Scope record schema and safe scope samples |
| `security` | Scan rule packs and versioned scan profiles |
| `infra` | Compose lab topology and optional infrastructure definitions |
| `packages/contracts/infra` | Lab topology schema used by the exposure assertion |
| `packages/contracts/ci` | Workflow set schema used by the workflow policy check |
| `packages/contracts/findings` | Occurrence, finding and lifecycle contracts |
| `packages/contracts/events` | Event envelope and catalog of mandatory events |
| `.github/workflow-set.json` | CI workflow descriptor that workflow files are rendered from |
| `tests` | Foundation acceptance suite and capstone assertions |

## Completeness checklist

- [x] Product vision and scope
- [x] Functional and non-functional requirements
- [x] Acceptance criteria
- [x] System, component, runtime and data architecture
- [x] Application specifications
- [x] Database, API, event and finding contracts
- [x] Threat model and Rules of Engagement
- [x] Web, API and Mobile security test catalogs
- [x] CI/CD jobs, gates and environment strategy
- [x] SAST, SCA, secrets, IaC, DAST, fuzz and Mobile automation
- [x] SBOM, signing and provenance
- [x] TDD, ≥95% coverage and mutation requirements
- [x] Agent operating manual and dependency-ordered backlog
- [x] Runbooks and reusable templates
- [x] Mermaid diagram catalog
