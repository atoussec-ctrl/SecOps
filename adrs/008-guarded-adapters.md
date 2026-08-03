# ADR-008: Guard All Security Tool Execution

Status: Accepted

## Context

Security tools accept powerful targeting and execution options. Direct UI,
shell or agent invocation can cross scope or inject commands.

## Decision

Execute every security tool through a registered adapter with typed schema,
immutable tool identity, scope grant, DNS/address pinning, budgets, no-shell
invocation, isolation, heartbeat, cancellation and result receipt.

## Consequences

- Adding tools requires adapter engineering and tests.
- Safety behavior becomes consistent and auditable.
- Users cannot access arbitrary tool flags through the product.

## Rejected alternatives

- Free-form command templates: injection and scope risk.
- Trust each tool's scope flags: inconsistent and incomplete.

