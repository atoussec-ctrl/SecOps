# Document Map and Reading Order

## Mandatory reading order for build agents

1. [`README.md`](../../README.md)
2. [`01-vision-goals.md`](01-vision-goals.md)
3. [`02-scope-non-goals.md`](02-scope-non-goals.md)
4. [`02-rules-of-engagement.md`](../04-security/02-rules-of-engagement.md)
5. [`01-system-context.md`](../02-architecture/01-system-context.md)
6. [`02-container-component.md`](../02-architecture/02-container-component.md)
7. [`000-index.md`](../../adrs/000-index.md)
8. [`01-operating-manual.md`](../08-agent/01-operating-manual.md)
9. [`02-implementation-phases.md`](../08-agent/02-implementation-phases.md)
10. [`03-task-backlog.md`](../08-agent/03-task-backlog.md)
11. Relevant application specification and test catalog.
12. [`04-definition-of-done.md`](../08-agent/04-definition-of-done.md)

## Ownership map

| Area | Authoritative document |
| --- | --- |
| Product behavior | [`01-prd.md`](../01-product/01-prd.md) |
| Functional requirements | [`03-functional-requirements.md`](../01-product/03-functional-requirements.md) |
| Quality attributes | [`04-non-functional-requirements.md`](../01-product/04-non-functional-requirements.md) |
| Requirement traceability | [`06-requirements-traceability.md`](../01-product/06-requirements-traceability.md) |
| Architecture | [`01-system-context.md`](../02-architecture/01-system-context.md) |
| Module boundaries | [`03-monorepo-module-boundaries.md`](../02-architecture/03-monorepo-module-boundaries.md) |
| Data schema | [`02-database-schema.md`](../07-data-api/02-database-schema.md) |
| Control-plane API | [`03-control-plane-api.md`](../07-data-api/03-control-plane-api.md) |
| Finding model | [`05-sarif-finding-model.md`](../07-data-api/05-sarif-finding-model.md) |
| Threats and mitigations | [`01-threat-model.md`](../04-security/01-threat-model.md) |
| Safe execution | [`09-tool-safety-guardrails.md`](../04-security/09-tool-safety-guardrails.md) |
| CI/CD | [`01-cicd-architecture.md`](../05-devsecops/01-cicd-architecture.md) |
| Testing | [`01-test-strategy.md`](../06-testing/01-test-strategy.md) |
| Agent behavior | [`01-operating-manual.md`](../08-agent/01-operating-manual.md) |
| Completed task evidence | [`07-implementation-log.md`](../08-agent/07-implementation-log.md) |
| Unresolved normative conflicts | [`08-specification-conflicts.md`](../08-agent/08-specification-conflicts.md) |
| Operations | [`01-local-development-runbook.md`](../09-operations/01-local-development-runbook.md) |

## Change control

- A requirement change updates its requirement ID and dependent acceptance test.
- An architectural change requires an ADR.
- A schema change requires forward and rollback migrations.
- A safety-boundary change requires threat-model and RoE review.
- A pipeline-gate exception requires an expiring risk acceptance.
- Documents should link to identifiers rather than duplicate normative text.

## Package conventions

- `MUST`, `MUST NOT`, `SHOULD` and `MAY` have their common requirements meaning.
- IDs are stable and never reused.
- Mermaid is the diagram source of record.
- Examples use reserved domains, private address space and synthetic identities.
- Templates are starting points; completed records belong in the implementation
  repository under version control.
