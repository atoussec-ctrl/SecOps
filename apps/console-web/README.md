# apps/console-web

Learner and finding-management UI. Reserved by backlog task E0-001;
implementation begins at E1-014.

## Specification

- `docs/03-applications/07-ui-ux-design-system.md`
- `docs/02-architecture/02-container-component.md`

## Boundary rules

- Reaches the Control API and Finding API over loopback only; it never talks to
  a lab target or a scanner directly.
- UI input may never reach tool execution. Runs are requested by adapter ID and
  typed parameters (`docs/04-security/09-tool-safety-guardrails.md`).
- Evidence is read through the evidence service, never from the filesystem.
- Does not import internals of any other application.
