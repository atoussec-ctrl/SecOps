# AI Agent Checklists

## Before implementation

- [ ] Read normative docs and accepted ADRs.
- [ ] Identify requirement, task, scenario and contract IDs.
- [ ] Inspect current repository state and preserve unrelated changes.
- [ ] Confirm task is inside authorized implementation/lab scope.
- [ ] Identify tests and documents that must change.
- [ ] Identify whether a new ADR is required.

## Before running tools

- [ ] Tool is registered/pinned or is a normal build/test tool.
- [ ] Security target is local/private and listed in active scope.
- [ ] Dry-run succeeded.
- [ ] Active profile has explicit confirmation.
- [ ] Budgets, timeout and kill behavior are configured.
- [ ] No real credentials or personal data are involved.

## Before committing a security scenario

- [ ] Vulnerable code is isolated from secure build graph.
- [ ] Insecure artifact is visibly marked and non-releaseable.
- [ ] Proof uses bounded synthetic impact.
- [ ] Secure fix addresses root cause.
- [ ] Regression and cleanup tests exist.
- [ ] Mapping and learning documentation exist.

## Before marking a task complete

- [ ] Focused tests pass.
- [ ] Full relevant gates pass.
- [ ] Coverage/mutation checked.
- [ ] Diff inspected for secrets, public endpoints and disabled controls.
- [ ] Contracts/diagrams/docs updated.
- [ ] Verification commands and limitations recorded.

## Before release

- [ ] Candidate was built once and addressed by digest.
- [ ] Tested/scanned/gated/signed/published digest matches.
- [ ] SBOM and provenance validate.
- [ ] No insecure component/artifact appears.
- [ ] No unresolved required-tool failure.
- [ ] Risk acceptances are valid and safety invariants all pass.
- [ ] Rollback and release evidence are ready.

## Stop and ask

- [ ] Target or authorization is ambiguous.
- [ ] Task needs broader network/credential authority.
- [ ] Safety gate conflicts with requested behavior.
- [ ] A public/vulnerable deployment is requested.
- [ ] Destructive testing or real data is required.
- [ ] Overlapping user work cannot be safely preserved.

