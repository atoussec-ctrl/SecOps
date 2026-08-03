# ADR-009: Lab Compose Topology Generated from a Validated Descriptor

Status: Accepted

## Context

The runtime architecture makes the lab topology a safety boundary: only the
console and control API may reach the host, targets stay on internal networks,
and exposure assertions must re-run after every topology change. Enforcing that
against hand-written Compose YAML means parsing YAML, and a partial parser that
misreads a construct would silently under-check a safety file.

The repository also has no third-party dependencies, and adding a YAML parser is
a supply-chain decision that Phase 0 is not ready to make.

## Decision

`infra/compose/lab-topology.json` is the source of truth. It is validated against
`packages/contracts/infra/lab-topology.schema.json` and an exposure policy, and
the Compose file is rendered from it by `tools/topology.mjs`.

The schema has no representation for a wildcard bind address, privileged mode,
host networking, added capabilities or bind mounts, so those configurations
cannot be written at all rather than being written and then rejected.

`node tools/repo.mjs check:exposure` validates the descriptor, applies the
policy and compares the generated Compose file with the file on disk. A
hand-edited Compose file therefore fails the check.

## Consequences

- The exposure assertion runs against a validated structure, and the tooling
  only emits YAML instead of parsing it.
- The Compose file is generated output. Editing it directly is a gate failure,
  and the header of the generated file says so.
- Any Compose feature the lab needs later, such as volumes for the datastores,
  requires a reviewed schema change rather than an ad-hoc edit. This is
  deliberate: bind mounts are how a Docker socket reaches a container.
- Container images resolve through `version-manifest.json` by immutable digest,
  so a topology cannot name an unreviewed image.

## Rejected alternatives

Hand-written Compose plus a YAML parser: the parser becomes security-relevant
code with no test corpus, and any construct it does not understand becomes an
unchecked configuration.

Hand-written Compose with no automated assertion: relies on review alone to
catch a public bind, which the threat model explicitly does not accept.
