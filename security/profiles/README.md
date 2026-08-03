# security/profiles

Versioned passive and bounded-active scan profiles. Reserved by backlog task
E0-001; profiles are consumed from E1-007 onward.

## Specification

- `docs/04-security/09-tool-safety-guardrails.md`
- `docs/04-security/02-rules-of-engagement.md`

## Boundary rules

- A profile declares explicit ceilings: requests, concurrency, wall time, CPU,
  memory and output size. There is no unbounded profile.
- Profile classes are passive and bounded active. Destructive tooling is not
  part of this product and requires a separately designed disposable
  environment plus authorization.
- Profiles are data consumed by the orchestrator. They never contain shell
  strings, and they cannot widen a scope grant.
- A profile change that relaxes a limit is a reviewed change, not a
  configuration convenience.
