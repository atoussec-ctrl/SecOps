# apps/web-lab-insecure

Isolated vulnerable Web target. Reserved by backlog task E0-001; implementation
begins at E2-001.

## Specification

- `docs/03-applications/01-web-lab-spec.md`
- `docs/04-security/04-web-security-test-catalog.md`
- `adrs/002-separate-insecure-secure.md`

## Boundary rules

- Deliberately vulnerable behavior lives here and nowhere else.
- Binds to loopback or the private lab network only. Public reachability is an
  unconditional gate failure (`docs/05-devsecops/03-security-gates.md`).
- `apps/web-lab-secure` may never import from this module.
- Artifacts use the lab-only namespace: never release-signed, never published to
  a public registry, never listed in a release manifest.
- Fixtures are synthetic. No real credentials, tokens or personal data.
