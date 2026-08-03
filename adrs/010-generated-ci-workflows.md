# ADR-010: CI Workflows Generated from a Validated Descriptor

Status: Accepted

## Context

Workflow permissions, third-party action pinning and shell interpolation are
security properties, not formatting. The static analysis specification lists a
dedicated workflow layer covering permissions, injection and pinning, and the
CI architecture requires the default token to be read-only and third-party
actions to be pinned to immutable commit SHAs.

Checking those properties on hand-written workflow YAML requires a YAML parser,
and any construct the parser does not understand becomes unchecked
configuration. [ADR-009](009-generated-lab-topology.md) already settled this
trade-off for the lab topology.

## Decision

`.github/workflow-set.json` is the source of truth. It is validated against
`packages/contracts/ci/workflow-set.schema.json` and a policy, and the workflow
files under `.github/workflows/` are rendered from it by `tools/workflows.mjs`.

The schema removes whole classes of problem by leaving them unrepresentable:

- `pull_request_target` is not a trigger, so a workflow cannot run untrusted
  code in a context that holds repository secrets;
- only the permission scopes this project uses exist, so an unknown scope
  cannot be granted;
- a job must declare `timeout_minutes`, so no job is unbounded;
- an action is referenced by manifest identifier, so a repository and tag cannot
  be written inline.

The policy adds what structure cannot express: no write permission on a
pull-request workflow, no `${{ }}` interpolation reaching a `run` command or an
action input, and a runtime version that must agree with the version manifest.

`node tools/repo.mjs check:workflows` validates the descriptor, applies the
policy and compares each generated file with the file on disk.

## Consequences

- Workflow files are generated output. Editing one directly is a gate failure,
  and a file under `.github/workflows/` with no descriptor entry is reported.
- Any workflow feature the project needs later requires a reviewed schema
  change. This is deliberate for the same reason as ADR-009.
- Actions resolve through `version-manifest.json`, so pinning is a manifest
  change reviewed alongside every other pinned artifact.
- Until every referenced action is pinned, nothing renders and the check reports
  the pending actions rather than failing. A workflow file present anyway is
  reported as unverified.

## Rejected alternatives

Hand-written workflows plus a YAML parser: the parser becomes security-relevant
code, and permissions and pinning are exactly the properties a parser gap would
hide.

Hand-written workflows with review only: the CI architecture requires safety
checks that do not depend on repository input, which review by itself cannot
provide.
