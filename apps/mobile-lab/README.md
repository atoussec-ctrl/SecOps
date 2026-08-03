# apps/mobile-lab

React Native bare workspace with distinct Android and iOS native targets.
Reserved by backlog task E0-001; implementation begins at E4-001.

## Specification

- `docs/03-applications/03-mobile-lab-spec.md`
- `docs/04-security/06-mobile-security-test-catalog.md`

## Boundary rules

- Insecure and secure application identifiers are distinct and carry the
  explicit `.insecurelab` and `.securelab` suffixes.
- Insecure Mobile targets can never be release-signed
  (`docs/08-agent/02-implementation-phases.md`, Phase 4 exit).
- Consumes the Java API through the generated typed client from
  `packages/contracts`.
- Dynamic testing runs on dedicated lab devices or emulators with synthetic
  accounts and lab-only certificates, and resets state per run.
