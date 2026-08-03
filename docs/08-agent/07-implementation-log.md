# Implementation Log

One entry per completed backlog task, recording the evidence required by
[`01-operating-manual.md`](01-operating-manual.md), "Quality evidence in
handoff". Do not record a check that was not run.

## E1-010 — Canonical finding model and lifecycle (preparation)

Status: **partial**. Depends on: E1-008. Phase 1.

### Changed files

- `packages/contracts/findings/occurrence.schema.json`
- `packages/contracts/findings/finding.schema.json`
- `packages/contracts/findings/finding-lifecycle.schema.json`
- `packages/contracts/findings/samples/**`, `packages/contracts/findings/README.md`
- `tests/foundation/finding-model.test.mjs`

### What is delivered

The canonical model existed only as prose and a state diagram. It is now three
contracts with a worked example: one Semgrep occurrence raised, confirmed,
remediated and verified.

Occurrence and finding are separate because SARIF is an interchange format, not
the domain model. The occurrence carries what a tool observed; the finding owns
identity, state and human decisions. That separation is what lets a scanner be
replaced without touching the workflow, and it is why `source_severity` sits on
the occurrence while `priority` sits on the finding with a rationale and a named
decider. Collapsing them is what
[vulnerability management](../04-security/07-vulnerability-management.md)
forbids, so the finding schema has no `severity` field at all and a test asserts
its absence.

The lifecycle is a contract rather than a diagram because the Finding Hub is
Python and the console is TypeScript, and both need the same answer to whether a
transition is allowed, who may perform it and what must exist first.

### Cross-checks rather than schema validation alone

Validation would let the state machine and the record drift apart, so the tests
tie them together: the two state sets must be identical, every transition must
name declared states, every state must be reachable from `new`, and every
non-terminal state must have an exit so a finding cannot strand.

The confirmation transition is asserted to demand exactly the ten evidence items
the [Finding Hub specification](../03-applications/05-finding-hub-spec.md)
lists, so weakening confirmation means changing a test that cites the source.
The sample's audit trail is asserted to be a legal path through the lifecycle,
chronological, and to end in the state the record claims.

### Correction made during implementation

The first sample finding carried a 65-character fingerprint. The contract check
caught it before the tests did, which is the intended order: a sample that no
longer matches its contract is how an unusable template reaches a reader.

### Tests executed

`node tools/repo.mjs check:all` — 7 checks, 257 tests, exit 0.

### Known limitations and remaining risk

- Nothing computes a fingerprint. The preference order is recorded per
  occurrence as `fingerprint_inputs.strategy`, but deduplication is E1-011.
- SARIF ingestion is not implemented. `source.format` records provenance so the
  mapping can be tested against real documents once a parser exists.
- Evidence redaction, quarantine and the ingestion receipt belong to the Finding
  Hub and need Python.
- The lifecycle is data, not an enforced state machine. Enforcement arrives with
  E1-012.

## E1-003 — Canonical scope serialization and digest (preparation)

Status: **partial**. Depends on: E0-004. Phase 1.

### Changed files

- `tools/scope-hash.mjs`
- `packages/contracts/security/canonical-form.schema.json`
- `packages/contracts/security/samples/canonical-form/canonical-vectors.json`
- `packages/contracts/security/samples/scope-record/*.json` — real digests.
- `packages/contracts/security/README.md`
- `adrs/011-canonical-scope-serialization.md`, `adrs/000-index.md`
- `docs/08-agent/08-specification-conflicts.md` — entry 12 partially addressed.
- `tests/foundation/scope-hash.test.mjs`

### What this closes

E0-004 left `approval.scope_hash` as a row of zeros in both sample scopes, with
a note that the serialization it covers was still undefined. That placeholder
was a hole: nothing verified the samples, and the field that makes a scope
tamper-evident carried no meaning.

The canonical form is now defined, implemented and pinned by vectors, and both
samples carry a real digest that is verified on every run. A scope edited
without re-approval is now detectable.

Recorded as [ADR-011](../../adrs/011-canonical-scope-serialization.md). The form
is deliberately narrower than JSON: sorted keys, preserved array order, no
insignificant whitespace, and integers only. Floating point has no single
textual form across languages and a scope has no use for one, so a non-integer
is an error rather than a value that would encode differently in Python.

### Correction made during implementation

The first generated vector file recorded `1e999` as a rejected input. It had
become `null` in the file, because `JSON.stringify` writes infinity as null, and
`null` is perfectly canonicalizable. Rejected cases are now held as JSON text
and parsed by the consumer, so an overflowing exponent survives intact.

### Tests executed

`node tools/repo.mjs check:all` — 7 checks, 238 tests, exit 0.
Coverage over the eleven unit suites: 99.78% line, 99.25% branch, 100% function.
`tools/scope-hash.mjs` is at 100% line, branch and function.

### Known limitations and remaining risk

- This is the serialization and digest only. The immutable snapshot store, the
  approval workflow and the state model of E1-003 need the Python orchestrator,
  which cannot be built here.
- Nothing signs the digest yet. Signer trust, key lifecycle and revocation are
  still open in the conflict register, entry 12.
- A future budget needing a fraction must use integer units, or the form changes
  deliberately with a new `form_version` and new vectors, invalidating every
  existing digest.

## E1-001 — Special-range policy conformance vectors (preparation)

Status: **partial — blocked**. Depends on: E0-004. Phase 1.

### Changed files

- `packages/contracts/security/address-policy.schema.json`
- `packages/contracts/security/samples/address-policy/ipv4-and-host-vectors.json`
- `tests/foundation/address-policy.test.mjs`

### What blocks completion

E1-001 implements canonicalization in `services/orchestrator`, which is Python.
Python is not installed on this workstation and its runtime and package manager
are still unselected in the version manifest, so the implementation and its
tests cannot be written or run here.

### What is delivered

The language-neutral half. The scope contract decides which targets may be
written down, and the Python canonicalizer will decide the same question at
runtime. Two implementations of one rule drift unless they share a definition,
so the definition is now a contract: 39 vectors giving an input, its
classification and whether it may appear in a scope record at all.

A test asserts that every vector agrees with the pattern the scope contract
already enforces, so the two cannot diverge silently. The vectors cover RFC 1918
boundaries on both sides, loopback, the cloud metadata address, the wildcard and
broadcast addresses, multicast, alternate encodings of loopback, an out-of-range
octet, a CIDR prefix below the policy minimum, reserved and public domains, and
URL userinfo used to disguise a public host as loopback.

When Python arrives, the canonicalizer is tested against the same file. Runtime
concerns that a static vector cannot express — DNS resolution and pinning,
answer drift and rebinding, redirect revalidation — remain E1-002.

## Revision — cross-language hazards in the canonical form

### Defect fixed

[ADR-011](../../adrs/011-canonical-scope-serialization.md) claims byte-exact
agreement between a TypeScript console and a Python orchestrator, and the form
as first written had two ways to break that claim silently.

**Key ordering.** JavaScript sorts by UTF-16 code unit and Python by code point.
The two agree across the basic multilingual plane and disagree above it, so a
key outside the BMP would have produced a different digest in each language with
nothing reporting a problem. Object keys are now restricted to
`[A-Za-z0-9_.-]`, which removes the divergence rather than relying on it never
being reached.

**String escaping.** Non-ASCII text is emitted literally. Python's `json.dumps`
escapes to `\uXXXX` by default, so an implementation written the obvious way
would disagree on every scope containing an accented character. The rule is now
stated in the ADR and in the contract README: serialize with
`ensure_ascii=False`.

An unpaired surrogate is also refused outright. It has no UTF-8 encoding, so no
two languages agree on its bytes.

### Why this mattered

Neither hazard would have surfaced as a failure. Both produce a digest that is
merely different, and a scope whose digest does not verify reads as tampering.
The failure would have appeared during Phase 1 integration as an authorization
boundary that intermittently refuses valid scopes.

### Verification

Existing digests are unchanged, so the hardening is backward compatible and both
sample scopes still verify. Three rejected vectors were added to the conformance
file so a second implementation is held to the same rules.

`node tools/repo.mjs check:all` — 7 checks, 242 tests, exit 0.
`tools/scope-hash.mjs` is at 100% line, branch and function coverage.

## Revision — review pass over Phase 0

### Defect fixed

`tools/schema.mjs` compiled `pattern` with the unicode flag at validation time.
Unicode mode rejects identity escapes that are legal in an ordinary ECMA-262
pattern, so a schema using `\-` would have thrown a `SyntaxError` out of the
middle of a validation run instead of reporting a problem, and the expression
was recompiled for every array element. Patterns are now compiled once during
the schema walk, cached, and an invalid one is a `SchemaError` like any other
schema fault. Four tests cover it, including a pattern that is only reachable
when no instance visits it.

### Simplification

Three near-identical reporters in `tools/repo.mjs` became one. Every check now
returns `{problems, deferred?, note?}` and shares the same output shape and
exit-code meaning, and deferred work is reported as `{id, blockedBy}` by both
the topology and workflow checks rather than in two different shapes.

### Added

`check:all` runs every check in bootstrap order and stops at the first failure.
This is the single documented bootstrap command the root README calls for and
the "clean bootstrap invokes smoke tests" criterion in the Phase 0 exit.

It is verified by running it, not by a test: `check:all` runs
`check:foundation`, so a test that executed it would recurse into the suite that
contains the test. Its parts are individually covered.

### Verification

`node tools/repo.mjs check:all` — 7 checks, 223 tests, exit 0.
Coverage over the nine unit suites: 99.77% line, 99.19% branch, 100% function.

## E0-007 — Create base PR workflow with minimal permissions

Status: **partial — blocked**. Depends on: E0-002, E0-003. Phase 0.

The descriptor, contract, policy, renderer and check are complete and tested.
No workflow file exists, and the task is not done.

### Changed files

- `packages/contracts/ci/workflow-set.schema.json`
- `.github/workflow-set.json`
- `tools/workflows.mjs`, `tools/repo.mjs` — adds `check:workflows`.
- `tools/prerequisites.mjs` — actions now carry a pinned or unselected status.
- `adrs/010-generated-ci-workflows.md`, `adrs/000-index.md`
- `tests/foundation/workflow-policy.test.mjs`
- `version-manifest.json`, `tests/foundation/version-manifest.test.mjs`

### What blocks completion

**Action SHAs cannot be resolved here.** The CI architecture requires
third-party actions pinned to immutable commit SHAs, and a workflow cannot check
out the repository without `actions/checkout`. Resolving a real SHA needs
network access to the action repository. Writing a plausible-looking SHA would
fabricate a supply-chain pin, so the manifest records both actions as
`unselected` and rendering fails closed. To finish this part, pin
`actionsCheckout` and `actionsSetupNode` in `version-manifest.json`, then run
`node tools/repo.mjs check:workflows`.

**Four normative conflicts remain open**, all in
[the conflict register](08-specification-conflicts.md): required-tool error
semantics (entry 1), coverage and triage thresholds (entry 4), protected policy
independence (entry 8) and PR active-profile terminology (entry 9). Those govern
the security-gate behaviour of the workflow, not the base job, so the base job
is specified here and the gate stages wait for a decision.

### What is enforced now

The descriptor is validated and the policy runs today, so the rules are live
before the first workflow file exists. Recorded as
[ADR-010](../../adrs/010-generated-ci-workflows.md), applying the same
generate-rather-than-parse decision as ADR-009.

Structure removes several problems entirely: `pull_request_target` is not a
trigger, only the permission scopes this project uses exist, a job must declare
`timeout_minutes`, and an action is named by manifest identifier so no
repository and tag can be written inline.

Policy adds what structure cannot express: no write permission on a
pull-request workflow, no `${{ }}` interpolation reaching a `run` command or an
action input, and a runtime version that must agree with the version manifest.

The injection rule matters most. A `run` step containing
`${{ github.event.pull_request.title }}` is the standard GitHub Actions remote
execution path, because the expression is substituted before the shell sees the
script. It is covered by test.

### Tests executed

`node tools/repo.mjs check:workflows` — policy clean, 2 actions pending, exit 0.
`node tools/repo.mjs check:foundation` — 211 tests, 211 passed, exit 0.

Coverage over the nine unit suites: 99.76% line, 99.17% branch, 100% function.

### Change to the version manifest contract

Actions previously had to carry a 40-character commit SHA, which left no way to
record an action that is known but not yet pinned. An action now declares
`pinned` with a repository and SHA, or `unselected` with the task that must pin
it, matching how runtime and image entries already work. The invariant is
unchanged: a tag is never accepted in place of a pin, and there is no third
state.

Without this the workflow check would have been permanently red with no way to
make it green, which teaches people to ignore it.

## E0-006 — Add architecture dependency fitness tests

Status: complete. Depends on: E0-001. Phase 0.

### Changed files

- `tools/architecture-check.mjs`
- `tools/repo.mjs` — adds `check:architecture`.
- `tests/foundation/architecture-check.test.mjs`

### What is enforced

Dependency edges are default deny. Every module declares the modules it may
import, and an edge that is not declared is a violation, so a new coupling has
to be added deliberately rather than appearing by accident.

Three of the fitness functions in
[architecture quality](../02-architecture/07-architecture-quality.md) are now
executable: prohibited dependency edges, no import from an insecure target into
a secure one, and no process execution outside orchestrator adapters. The other
listed fitness functions are already covered elsewhere — public port mapping and
non-root containers by `check:exposure`, and contract examples by
`check:contracts`.

A secure module importing `apps/web-lab-insecure` is reported with its own
message rather than the generic edge message, because
[security gates](../05-devsecops/03-security-gates.md) makes that an
unconditional gate failure rather than an ordinary boundary breach.

Process execution is detected across JavaScript, Python and Java, so the rule
holds for the orchestrator and Java API before either exists. Repository tooling
under `tools/` and its tests are declared as permitted process starters, since
they run the checks themselves.

### Tests executed

`node tools/repo.mjs check:architecture` — no problems across 16 source files.
`node tools/repo.mjs check:foundation` — 179 tests, 179 passed, exit 0.

Coverage over the eight unit suites: 99.70% line, 99.24% branch, 100% function.

Two tests exist to stop the check passing vacuously. One asserts it analyses at
least ten real files including `tools/repo.mjs`. The other parses the layout
table in
[module boundaries](../02-architecture/03-monorepo-module-boundaries.md) and
asserts every documented module is declared in the enforced graph, so a module
added to the specification cannot stay unenforced.

### Correction made during implementation

The first version of the secure-imports-insecure test reported no violation. The
checker was right and the fixture was wrong: the relative specifier used three
parent steps, which escapes `apps/` entirely and resolves outside any module.
Worth recording because a looser assertion would have accepted the empty result
and left the most important gate untested.

### Known limitations and remaining risk

- Only relative specifiers are resolved. Once workspace package names exist,
  bare specifiers such as `@seclab/ts-domain` need mapping too, or an intended
  edge will pass unchecked.
- Imports are found by pattern, not by parsing. A specifier inside a comment or
  string literal would be treated as real.
- The dependency graph is analysed for JavaScript and TypeScript only. Python
  and Java need their language-native tooling, and the module boundaries
  document expects that where possible.
- The graph lives in `tools/architecture-check.mjs` rather than in a validated
  contract. It is coupled to the specification by test instead.

## E0-005 — Create private Compose topology and exposure assertion

Status: complete. Depends on: E0-001. Phase 0.

### Changed files

- `packages/contracts/infra/lab-topology.schema.json`
- `infra/compose/lab-topology.json`, `infra/compose/README.md`
- `tools/topology.mjs` — exposure policy and Compose rendering.
- `tools/repo.mjs` — adds `check:exposure`.
- `tools/schema.mjs` — adds byte-order-mark tolerant JSON parsing.
- `adrs/009-generated-lab-topology.md`, `adrs/000-index.md`
- `tests/foundation/lab-topology.test.mjs`
- `version-manifest.json` — adds container image entries.

### Decision: generated, not hand-written

Enforcing the exposure invariants against hand-written Compose YAML would mean
parsing YAML, and a partial parser that misreads a construct silently
under-checks a safety file. Adding a YAML dependency is a supply-chain decision
Phase 0 is not ready to make. The topology is therefore a validated JSON
descriptor, and the Compose file is rendered from it. Recorded as
[ADR-009](../../adrs/009-generated-lab-topology.md).

The strongest property is that unsafe configuration is not representable. The
schema has no field for a wildcard bind address, privileged mode, host
networking, added capabilities or bind mounts, and container hardening uses
`const true`, so `read_only` cannot be switched off. There is nothing to reject
because there is nothing to write.

### Tests executed

`node tools/repo.mjs check:foundation` — 161 tests, 161 passed, exit 0.
`node tools/repo.mjs check:exposure` — no problems, 4 images deferred, exit 0.

Coverage over the seven unit suites: 99.82% line, 99.43% branch, 100% function.
`schema.mjs`, `docs-check.mjs`, `contracts-check.mjs` and `topology.mjs` are at
100% line and branch.

Tests cover a target that publishes a host port, a target attached to the
ingress network, a second ingress network, duplicate host ports, undeclared
network and service references, an image outside the manifest, an image pinned
by tag instead of digest, and a hand-edited Compose file that swaps
`127.0.0.1` for `0.0.0.0`.

### Correction made during implementation

The topology first referenced the `node`, `python` and `java` version-manifest
entries directly. The exposure check rejected that, correctly: those entries pin
a host runtime, which is not the same artifact as a container base image. The
manifest now carries separate `nodeImage`, `pythonImage` and `javaImage`
entries, and image resolution requires an immutable sha256 digest rather than a
tag, per [ADR-007](../../adrs/007-pinned-artifacts.md).

### Known limitations and remaining risk

- No Compose file is generated yet. Every container image is unselected because
  a digest cannot be resolved without registry access, and rendering fails
  closed rather than emitting a tag-pinned file. The check asserts that no
  unverified Compose file exists in the meantime.
- The schema cannot express volumes, so the datastore services are not yet
  runnable. Adding volumes is a reviewed schema change on purpose: a bind mount
  is how a Docker socket reaches a container.
- This is a static assertion over a definition. Probing actually listening
  sockets, verifying routes and confirming closed ports after teardown need
  running containers and arrive with the first real service in E2-001.
- Egress denial is expressed only as network `internal: true`. Per-service
  egress allowlists remain open in the conflict register, entry 10.

## E0-004 — Define scope JSON Schema and safe sample scopes

Status: complete. Depends on: E0-001. Phase 0.

### Changed files

- `packages/contracts/security/scope-record.schema.json`
- `packages/contracts/security/samples/scope-record/lab-loopback.json`
- `packages/contracts/security/samples/scope-record/lab-private-network.json`
- `packages/contracts/security/README.md`
- `tests/foundation/scope-record.test.mjs`

### What the contract makes impossible

The schema carries every mandatory scope field from
[the Rules of Engagement](../04-security/02-rules-of-engagement.md) and the
[orchestrator specification](../03-applications/04-orchestrator-spec.md), and it
turns several rules from prose into structure. Address and hostname patterns
admit only loopback, RFC 1918 space and RFC 2606 reserved domains, so a public
target cannot be expressed. `allowed_profiles` has no value that authorizes
destructive tooling. Every budget is bounded above. `synthetic_data_only` must
be `true`. Unknown properties are rejected everywhere.

### Tests executed

`node tools/repo.mjs check:foundation` — 134 tests, 134 passed, exit 0.

The Phase 0 exit criterion that deliberate public and out-of-scope fixtures are
rejected is covered by tests that feed the contract public addresses
(`8.8.8.8`, `93.184.216.34`, `172.32.0.1`), the cloud metadata address
`169.254.169.254`, the wildcard `0.0.0.0`, alternate encodings of loopback
(`127.000.000.001`, `2130706433`, `0x7f.0.0.1`, `::ffff:127.0.0.1`), public
hostnames and URLs, non-http schemes, a destructive profile, real-data handling,
over-ceiling budgets and a missing approval. Unsafe fixtures are built inside the
test rather than stored as files, so an out-of-scope document can never be
mistaken for a usable template.

### Known limitations and remaining risk

- This is a static check on a document, not the Scope Guard. Canonicalizing a
  requested target, pinning DNS answers, revalidating redirects and rejecting
  hostnames that only resolve into private space at runtime remain E1-001 to
  E1-004.
- IPv6 targets are not expressible. The lab topology is IPv4 for now, and adding
  IPv6 needs the same private-range treatment plus the dual-stack exposure tests
  named in the conflict register, entry 10.
- The sample `scope_hash` is a placeholder. The canonical serialization it
  covers is defined with the immutable scope snapshot in E1-003.
- The schema cannot express "at least one address family is present", because
  that needs a keyword the validator deliberately does not support. Requiring a
  non-empty application and port list is the closest structural equivalent.

## E0-003 — Implement documentation/contract validation jobs

Status: complete. Depends on: E0-001. Phase 0.

### Changed files

- `tools/schema.mjs` — JSON Schema subset validator.
- `tools/docs-check.mjs`, `tools/contracts-check.mjs`
- `tools/repo.mjs` — adds `check:docs` and `check:contracts`.
- `tests/foundation/schema-validator.test.mjs`
- `tests/foundation/documentation-check.test.mjs`
- `tests/foundation/contracts-check.test.mjs`

### Design note: a validator that fails closed

`tools/schema.mjs` implements a subset of JSON Schema draft 2020-12 and throws
on any keyword it does not implement. A validator that ignores an unknown
keyword would report a security contract as valid while enforcing less than the
contract states, which is the same class of false pass as a missing scanner
result. Unsupported input is therefore an error, not a silent allowance.

This is why the repository has no JSON Schema dependency. Selecting one is a
supply-chain decision that needs registry access and review, and the subset here
is small enough to test exhaustively.

### Tests executed

`node tools/repo.mjs check:docs` — no problems across 104 Markdown files.
`node tools/repo.mjs check:contracts` — no problems.
`node tools/repo.mjs check:foundation` — 134 tests, 134 passed, exit 0.

Coverage, measured over the six unit suites with
`node --test --experimental-test-coverage`: 99.63% line, 98.93% branch, 100%
function. Per module: `contracts-check.mjs` and `docs-check.mjs` at 100%,
`schema.mjs` at 99.69% line, `prerequisites.mjs` at 99.18% line.

The documentation suite asserts that the checker actually reads more than fifty
Markdown files before reporting success, so a checker that inspected nothing
cannot pass as clean.

### Known limitations and remaining risk

- Only repository-relative links are verified. External URLs and heading
  anchors are not resolved.
- Fence checking counts fences rather than parsing Mermaid. A syntactically
  invalid diagram still passes.
- The validator supports no combinator keywords (`oneOf`, `anyOf`, `allOf`,
  `if`/`then`), so a contract needing one will fail to compile rather than be
  half-enforced. Adding one is a deliberate change with its own tests.

## E0-002 — Add version manifest, exact lockfiles and prerequisite verifier

Status: complete. Depends on: E0-001. Phase 0.

### Changed files

- `version-manifest.json` — version manifest covering every field required by
  [`07-assumptions-version-policy.md`](../00-overview/07-assumptions-version-policy.md).
- `package.json`, `package-lock.json` — private root manifest with exact
  `engines` pins and a lockfile.
- `tools/prerequisites.mjs` — manifest validation and prerequisite evaluation.
- `tools/repo.mjs` — adds the `check:prerequisites` task.
- `tests/foundation/version-manifest.test.mjs`
- `tests/foundation/prerequisite-verifier.test.mjs`
- `tests/foundation/repository-task-interface.test.mjs` — task wiring and
  fail-closed manifest handling.
- `MANIFEST.md`, `docs/09-operations/01-local-development-runbook.md`

### Pinned versions

`node` 24.18.1, `npm` 11.16.0 and `containerRuntime` (Docker Engine) 29.6.2.
Each was verified on this workstation on 2026-08-03 by running its version
command, not by assuming presence.

Every other required field is present but recorded as `unselected` with the
backlog task that must decide it. Selecting them means choosing currently
maintained releases, which needs registry access and, for the Python package
manager and signing toolchain, a decision that is still open. The manifest
schema forbids a prerequisite required by the active phase from staying
unselected, so an unpinned tool cannot slip through: it fails the check.

### Tests executed

`node tools/repo.mjs check:foundation` — 61 tests, 61 passed, exit 0.
`node tools/repo.mjs check:prerequisites` — 3 satisfied, 20 deferred, exit 0.

Coverage of `tools/prerequisites.mjs`, measured with
`node --test --experimental-test-coverage` over the two unit suites: 99.10%
line, 97.26% branch, 100% function. This meets the 95% threshold in
[`02-tdd-coverage-mutation.md`](../06-testing/02-tdd-coverage-mutation.md). The
only uncovered lines are the `resolveNpmCli` fallback that returns `null`, which
is unreachable while a bundled npm exists.

### Design note: presence is not evidence

The verifier accepts a tool only when its version command produces output
matching the expected pattern. The workstation demonstrates why: `python` and
`python3` both resolve on PATH to Microsoft Store stubs that exit without
printing a version. A presence check would have reported Python as installed.

The npm probe runs npm's CLI through the current Node binary rather than the
`npm.cmd` shim, because Node refuses to spawn `.cmd` without a shell and the
secure coding standard prohibits shell execution.

### Known limitations and remaining risk

- Coverage is measured but not enforced. A repository-wide gate cannot be set
  honestly yet: `tools/repo.mjs` runs only as a subprocess, so its coverage
  reads as zero, and the exclusion policy that would fix this belongs to the
  quality-gate task rather than to an ad-hoc decision here.
- The lockfile has no dependencies to lock. It fixes the root manifest only.
- `postgresql` needs an image digest rather than a host version, so the
  verifier has no probe for it. That is recorded on the entry and must be
  resolved with the Compose topology in E0-005.
- No mutation testing exists yet.

## E0-001 — Create polyglot monorepo and repository task interface

Status: complete. Depends on: none. Phase 0.

### Changed files

- `tools/repo.mjs` — repository task interface.
- `apps/{console-web,web-lab-insecure,web-lab-secure,api-java-lab,mobile-lab}/README.md`
- `services/{orchestrator,finding-hub,report-generator}/README.md`
- `packages/{contracts,ts-domain}/README.md`
- `security/{rules,profiles}/README.md`
- `infra/{compose,terraform}/README.md`
- `tests/capstone/README.md`
- `tests/foundation/repository-task-interface.test.mjs`
- `MANIFEST.md`

Each module directory carries a README stating its purpose, its authoritative
specification and the boundary rules from
[`03-monorepo-module-boundaries.md`](../02-architecture/03-monorepo-module-boundaries.md).

### Tests executed

`node tools/repo.mjs check:foundation` — 15 tests, 15 passed, exit 0.

The suite covers the prescribed module boundaries, physical separation of the
insecure and secure Web targets, the task interface contract, and the
fail-closed behavior of the foundation check.

### Defect found and fixed during implementation

The foundation check initially reported success while its own tests failed. A
nested `node --test` that inherits `NODE_TEST_CONTEXT` skips every file and
exits 0, so any invocation from inside a Node test context produced a green
result that ran nothing — the "scanner reports zero issues but its output is
missing" case from [`04-definition-of-done.md`](04-definition-of-done.md).
`tools/repo.mjs` now clears `NODE_TEST_CONTEXT` and `NODE_TEST_WORKER_ID`
before spawning the runner, and two regression tests cover it.

### Versions

Node.js v24.18.1 on Windows 10. No third-party dependencies were introduced.

### Known limitations and remaining risk

- Coverage and mutation thresholds are not yet measured. The tooling arrives
  with E0-002 and E0-003; the current suite exercises every branch of
  `tools/repo.mjs` except two defensive paths (spawn failure, missing error
  code).
- The workspace is not a Git repository and `git` is not installed, so no
  commit, diff review or history exists yet.
- `python` and `java` are not installed. Both are prerequisites for
  `services/*` (E1) and `apps/api-java-lab` (E3) and belong in the E0-002
  prerequisite verifier.
- Only `check:foundation` exists. Lint, type, coverage and security tasks are
  added by their own backlog tasks rather than stubbed here.
