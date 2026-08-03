# Architecture Quality Attributes and Review

## Quality attribute scenarios

### QA-01 Scope safety

When an operator submits a target that resolves outside the signed private
range, the system rejects it before tool creation, records the canonical target
and reason, and leaks no network request to that target.

### QA-02 Reproducibility

When a supported clean workstation checks out a release tag and follows the
bootstrap runbook, it obtains the documented tool manifest, fixtures and passing
smoke tests without manual source changes.

### QA-03 Failure containment

When a scanner container hangs or exceeds a budget, the orchestrator cancels
the job, stops the container, preserves partial output and leaves other
engagements available.

### QA-04 Auditability

When a finding state or risk decision changes, an evaluator can identify actor,
time, previous state, new state, reason and related evidence.

### QA-05 Replaceability

When a scanner is replaced, only its adapter and normalization mapping change;
the canonical finding, workflow and reports remain compatible.

## Architecture fitness functions

The implementation pipeline should enforce:

- prohibited dependency edges;
- no imports from insecure target modules into secure targets;
- no direct process execution outside registered orchestrator adapters;
- no public port mapping for vulnerable Compose services;
- contract schemas validate every example;
- migrations apply from empty and previous supported release;
- all container images run as non-root unless an approved lab exception exists;
- every releaseable artifact has SBOM and provenance.

## Review checklist

- Are safety policies enforced in code, not only documentation?
- Can a lower-trust component mutate a higher-trust source of record?
- Does a new dependency cross an ownership boundary?
- Is external input bounded before parsing or storage?
- Can a retry duplicate a privileged action?
- Is rollback possible without deleting evidence?
- Do diagrams, contracts and implementation agree?
- Is complexity justified by a measured requirement?

## Deliberate simplifications

- Modular services instead of many microservices.
- PostgreSQL outbox instead of a message broker.
- Local content-addressed evidence storage before cloud object storage.
- PostgreSQL search before a dedicated search cluster.
- One policy engine interface with repository-owned rules.

These are architectural commitments for 1.0. Scaling changes require evidence
and an ADR, not anticipation.

