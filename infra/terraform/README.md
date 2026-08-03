# infra/terraform

Optional infrastructure and identity definitions. Reserved by backlog task
E0-001.

## Specification

- `docs/02-architecture/04-runtime-deployment.md`
- `docs/05-devsecops/07-environments-release.md`
- `adrs/003-local-first-isolation.md`

## Boundary rules

- The product is local-first. Anything defined here supports CI identity,
  signing trust and release evidence, not a hosted lab.
- Vulnerable targets have no public or persistent deployment environment. No
  definition here may create one.
- Definitions are scanned by the IaC policy checks in the static security stage.
- No real secret material is committed. Identity is preferably federated via
  OIDC rather than long-lived keys.
