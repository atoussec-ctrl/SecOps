# apps/api-java-lab

Java REST/GraphQL target for authorization and business-flow scenarios.
Reserved by backlog task E0-001; implementation begins at E3-001.

## Specification

- `docs/03-applications/02-java-api-lab-spec.md`
- `docs/04-security/05-api-security-test-catalog.md`

## Boundary rules

- Java LTS, Spring Boot and PostgreSQL, with Gradle/Maven dependency locking and
  verification (`docs/02-architecture/03-monorepo-module-boundaries.md`).
- Packages are reverse-domain under a reserved example namespace.
- REST and GraphQL contracts are published to `packages/contracts`; clients are
  generated at the edges rather than shared as internals.
- Owns its own schema. No other service reads its tables.
- Insecure and secure behavior stay in distinct deployable units, as in the Web
  labs.
