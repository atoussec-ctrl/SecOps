# tests/capstone

Black-box acceptance and safety assertions for the full lab. Reserved by
backlog task E0-001; the capstone engagement runs in Epic E6.

## Specification

- `docs/08-agent/02-implementation-phases.md`, Phase 7
- `docs/01-product/05-acceptance-criteria.md`
- `docs/06-testing/03-contract-e2e-security.md`

## Boundary rules

- Exercises the lab as an external tester would, against the exact candidate
  artifacts, using only synthetic data.
- Safety assertions are release-blocking and cannot be risk-accepted: no public
  ingress, no unrestricted egress, working kill switch, audit and redaction, no
  insecure-to-secure import, no insecure publication.
- Teardown must prove no vulnerable service remains reachable (E6-007).
- Proof stops at the minimum demonstrated impact defined by the Rules of
  Engagement.
