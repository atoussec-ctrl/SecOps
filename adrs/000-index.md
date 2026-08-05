# Architecture Decision Records

All records below are accepted for version 1.0 unless superseded by a later ADR.

| ADR | Decision |
| --- | --- |
| [ADR-001](001-polyglot-monorepo.md) | Polyglot monorepo with language-native builds |
| [ADR-002](002-separate-insecure-secure.md) | Separate insecure and secure deployable units |
| [ADR-003](003-local-first-isolation.md) | Local-first private execution boundary |
| [ADR-004](004-sarif-canonical-import.md) | SARIF for interchange, canonical domain model for workflow |
| [ADR-005](005-postgresql-outbox.md) | PostgreSQL and transactional outbox before broker |
| [ADR-006](006-progressive-gates.md) | Progressive evidence-based security gates |
| [ADR-007](007-pinned-artifacts.md) | Exact versions, image digests, SBOM and provenance |
| [ADR-008](008-guarded-adapters.md) | Security tools execute only through guarded adapters |
| [ADR-009](009-generated-lab-topology.md) | Lab Compose topology generated from a validated descriptor |
| [ADR-010](010-generated-ci-workflows.md) | CI workflows generated from a validated descriptor |
| [ADR-011](011-canonical-scope-serialization.md) | Canonical serialization for the scope digest |
| [ADR-012](012-execution-grants.md) | Execution grant contract, skew and replay window (proposed) |

Use [`templates/adr-template.md`](../templates/adr-template.md) for new records.

