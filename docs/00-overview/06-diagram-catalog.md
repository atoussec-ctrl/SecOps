# Diagram Catalog

Mermaid source blocks are the diagrams of record. This catalog lets an
implementing agent locate every major system relationship and flow.

## Product and delivery

| Diagram | Document |
| --- | --- |
| Platform architecture at a glance | [`README.md`](../../README.md) |
| Learning loop | [`01-vision-goals.md`](01-vision-goals.md) |
| Environment boundary | [`02-scope-non-goals.md`](02-scope-non-goals.md) |
| Delivery Gantt and milestone dependencies | [`04-roadmap.md`](04-roadmap.md) |
| Product user journey | [`01-prd.md`](../01-product/01-prd.md) |
| Guided scenario and scanner sequences | [`02-personas-use-cases.md`](../01-product/02-personas-use-cases.md) |

## Architecture

| Diagram | Document |
| --- | --- |
| System context and trust boundaries | [`01-system-context.md`](../02-architecture/01-system-context.md) |
| Container/components and dependency direction | [`02-container-component.md`](../02-architecture/02-container-component.md) |
| Local runtime topology and startup sequence | [`04-runtime-deployment.md`](../02-architecture/04-runtime-deployment.md) |
| Evidence retention lifecycle | [`05-data-architecture.md`](../02-architecture/05-data-architecture.md) |
| Adapter integration sequence | [`06-integrations-contracts.md`](../02-architecture/06-integrations-contracts.md) |

## Applications and data

| Diagram | Document |
| --- | --- |
| Web component architecture | [`01-web-lab-spec.md`](../03-applications/01-web-lab-spec.md) |
| Transfer state and authorization flow | [`02-java-api-lab-spec.md`](../03-applications/02-java-api-lab-spec.md) |
| Mobile adapter architecture | [`03-mobile-lab-spec.md`](../03-applications/03-mobile-lab-spec.md) |
| Scope validation and run state | [`04-orchestrator-spec.md`](../03-applications/04-orchestrator-spec.md) |
| Finding lifecycle | [`05-finding-hub-spec.md`](../03-applications/05-finding-hub-spec.md) |
| Report generation | [`06-report-generator-spec.md`](../03-applications/06-report-generator-spec.md) |
| UI information architecture | [`07-ui-ux-design-system.md`](../03-applications/07-ui-ux-design-system.md) |
| Entity-relationship model | [`01-domain-model.md`](../07-data-api/01-domain-model.md) |
| SARIF deduplication | [`05-sarif-finding-model.md`](../07-data-api/05-sarif-finding-model.md) |

## Security and delivery

| Diagram | Document |
| --- | --- |
| Threat paths | [`01-threat-model.md`](../04-security/01-threat-model.md) |
| Engagement lifecycle | [`02-rules-of-engagement.md`](../04-security/02-rules-of-engagement.md) |
| GraphQL enforcement flow | [`05-api-security-test-catalog.md`](../04-security/05-api-security-test-catalog.md) |
| Finding/remediation workflow | [`07-vulnerability-management.md`](../04-security/07-vulnerability-management.md) |
| Evidence ingestion | [`08-evidence-privacy.md`](../04-security/08-evidence-privacy.md) |
| CI/CD pipeline and artifact sequence | [`01-cicd-architecture.md`](../05-devsecops/01-cicd-architecture.md) |
| Gate evaluation | [`03-security-gates.md`](../05-devsecops/03-security-gates.md) |
| Authenticated DAST sequence | [`05-dynamic-mobile.md`](../05-devsecops/05-dynamic-mobile.md) |
| Build integrity | [`06-sbom-signing-provenance.md`](../05-devsecops/06-sbom-signing-provenance.md) |
| Release lifecycle | [`07-environments-release.md`](../05-devsecops/07-environments-release.md) |

## Testing, agent and operations

| Diagram | Document |
| --- | --- |
| Test pyramid and security layer | [`01-test-strategy.md`](../06-testing/01-test-strategy.md) |
| Fixture lifecycle | [`04-test-data-fixtures.md`](../06-testing/04-test-data-fixtures.md) |
| Agent operating loop | [`01-operating-manual.md`](../08-agent/01-operating-manual.md) |
| Controlled scan flow | [`02-scan-runbook.md`](../09-operations/02-scan-runbook.md) |

## Diagram quality rules

- Keep labels short and put details in surrounding text.
- Use top-down layout when a flow exceeds five horizontal nodes.
- Do not add executable links or HTML labels.
- Update diagrams in the same change as architecture/flow changes.
- Validate fence balance and supported diagram declarations in CI.

