# packages/contracts

Language-neutral OpenAPI, JSON Schema and event specifications. Reserved by
backlog task E0-001; first contracts land at E0-004 (scope schema).

## Specification

- `docs/07-data-api/03-control-plane-api.md`
- `docs/07-data-api/04-event-contracts.md`
- `docs/07-data-api/05-sarif-finding-model.md`
- `docs/02-architecture/06-integrations-contracts.md`

## Boundary rules

- Contracts are language-neutral. Clients are generated at the edges; no
  language-specific runtime code lives here.
- This package is the single source of truth for cross-service payloads.
  Consumers do not redefine them locally.
- Contract changes are checked for compatibility in the pipeline quality stage.
- Scenario metadata is neutral data and must never contain executable shell
  strings (`docs/02-architecture/03-monorepo-module-boundaries.md`).
