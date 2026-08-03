# Monorepo and Module Boundaries

## Repository layout to implement

| Path | Content |
| --- | --- |
| `apps/console-web` | Learner and finding-management UI |
| `apps/web-lab-insecure` | Isolated vulnerable Web target |
| `apps/web-lab-secure` | Secure companion Web target |
| `apps/api-java-lab` | Java REST/GraphQL target |
| `apps/mobile-lab` | React Native workspace with distinct native targets |
| `services/orchestrator` | Python control plane and CLI |
| `services/finding-hub` | Python finding/evidence API |
| `services/report-generator` | TypeScript report renderer |
| `packages/contracts` | Language-neutral OpenAPI, JSON Schema and event specs |
| `packages/ts-domain` | Shared TypeScript domain primitives only |
| `security/rules` | Tested Semgrep/CodeQL/policy rules |
| `security/profiles` | Versioned passive and active scan profiles |
| `infra/compose` | Local and CI lab topology |
| `infra/terraform` | Optional infrastructure and identity definitions |
| `tests/capstone` | Black-box acceptance and safety assertions |
| `docs` | Living implementation documentation and ADRs |

## Build orchestration

- Use one repository-level task interface such as `make` or `task` for humans
  and agents.
- Language-native build systems remain authoritative inside each module.
- Node dependencies use a workspace lockfile.
- Python dependencies use a locked environment and hashes.
- Java dependencies use Gradle/Maven dependency locking and verification.
- Mobile native dependencies are locked with Gradle and Swift package/CocoaPods
  mechanisms selected by the implementation ADR.
- Do not introduce a cross-language build platform until normal task
  orchestration is demonstrably insufficient.

## Module rules

1. Applications do not import another application's internals.
2. Shared packages contain stable primitives, not arbitrary convenience code.
3. Contracts are language-neutral and generate clients at the edges.
4. Vulnerable code cannot be imported by secure targets.
5. Scanner execution exists only in orchestrator infrastructure adapters.
6. Evidence files are accessed only through the evidence service.
7. Database access is owned by the service that owns the schema.
8. Every rule breach is tested with dependency-analysis tooling where possible.

## Scenario packaging

Each scenario contains:

- stable ID and metadata;
- vulnerable target reference;
- secure target reference;
- deterministic fixture reference;
- automated vulnerable assertion;
- automated secure assertion;
- learning content and mappings;
- proof boundary and reset procedure.

Scenario metadata belongs in a neutral catalog consumed by UI and CI. It must
not contain executable shell strings.

## Naming

- IDs: uppercase domain prefix plus numeric suffix, for example `WEB-AC-001`.
- Database tables and JSON fields: `snake_case`.
- TypeScript symbols: idiomatic `camelCase`/`PascalCase`.
- Java packages: reverse-domain under a reserved example namespace.
- Mobile insecure and secure IDs must include explicit `.insecurelab` and
  `.securelab` suffixes.

## Dependency update policy

- Exact versions and lockfiles are mandatory.
- Automated update PRs are grouped by ecosystem and risk.
- Security updates run the complete relevant scenario set.
- Major upgrades require compatibility evidence and, when architecture changes,
  an ADR.
- Tool containers are pinned by digest in protected workflows.

