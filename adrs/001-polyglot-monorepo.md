# ADR-001: Use a Polyglot Monorepo

Status: Accepted

## Context

The platform intentionally uses TypeScript, Python, Java/Kotlin and Swift while
sharing contracts, scenarios, infrastructure, pipelines and documentation.

## Decision

Use one repository with explicit module ownership and language-native build
systems. Expose a small repository-level task interface for common workflows.
Contracts are language-neutral and generate clients at boundaries.

## Consequences

- Atomic changes can update contract, clients, tests and docs.
- One pipeline can enforce cross-language architecture and security invariants.
- Checkout and CI can be heavier; affected-module execution and caching are
  required.
- Shared-code temptation is controlled by module boundaries and fitness tests.

## Rejected alternatives

- Many repositories: premature coordination/version overhead.
- One language only: conflicts with learning/product objectives.
- Cross-language build platform immediately: complexity without measured need.

