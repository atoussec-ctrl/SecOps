# apps/web-lab-secure

Secure companion Web target and regression baseline. Reserved by backlog task
E0-001; implementation begins at E2-001.

## Specification

- `docs/03-applications/01-web-lab-spec.md`
- `docs/04-security/03-secure-coding-standard.md`
- `adrs/002-separate-insecure-secure.md`

## Boundary rules

- Implements the root-cause control for every scenario the insecure target
  exposes, as an independent implementation rather than a patched copy.
- Importing anything from `apps/web-lab-insecure` is an unconditional gate
  failure (`docs/05-devsecops/03-security-gates.md`).
- Secure and insecure behavior may never be selected by a release-time flag.
- This is a separate deployable unit with its own database.
