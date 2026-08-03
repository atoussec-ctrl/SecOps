# packages/ts-domain

Shared TypeScript domain primitives. Reserved by backlog task E0-001.

## Specification

- `docs/07-data-api/01-domain-model.md`

## Boundary rules

- Stable primitives only. This is not a home for arbitrary convenience code
  (`docs/02-architecture/03-monorepo-module-boundaries.md`, module rule 2).
- No I/O, no network access, no framework coupling.
- Contains no scenario logic and no vulnerable code, so that both secure and
  insecure targets can depend on it without breaching separation.
- Symbols follow idiomatic `camelCase`/`PascalCase`.
