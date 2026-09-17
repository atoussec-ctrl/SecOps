# External Project Assessment Mode

## Purpose

SecOps must be able to assess a repository that is not part of the SecOps
monorepo without copying SecOps into that repository, importing the target's
application modules, or modifying target source. The first supported mode is
**static-readonly**.

This mode exists so a corporate application can remain an independent product
while SecOps acts as an external security tool. Company-specific hostnames,
credentials, policy exceptions, internal routes and proprietary rules must stay
outside the generic SecOps repository.

## Architectural boundary

```text
external-project/                  SecOps/
├── application source             ├── orchestrator
├── package/lock files             ├── project discovery
├── CI configuration      --RO-->  ├── adapters
├── container/IaC files            ├── result normalization
└── tests                           └── policy/gates

SecOps workspace (write-only outputs)
├── inventory
├── sarif
├── sbom
├── findings
└── reports
```

The target is input. The SecOps workspace is output. No scanner may use the
target repository as an output directory.

## Two contracts, two responsibilities

`project-profile.schema.json` is discovery output. It describes the exact Git
snapshot and the technologies evidenced by repository files. Discovery has no
authority to select scanners or grant execution.

`external-assessment-plan.schema.json` is policy input. It binds an assessment
to the SHA-256 fingerprint of a project profile and defines which static
capabilities may run.

This separation prevents a discovery plugin from silently increasing its own
permissions.

## Version 1 safety invariants

The static-readonly contract deliberately has no representation for:

- a dirty/uncommitted Git snapshot;
- source write access;
- project package installation;
- execution of project lifecycle/package scripts;
- target network access during the scan;
- following symlinks outside the project root;
- reading outside the declared project root;
- retention of raw secret values;
- retention of unredacted raw evidence;
- arbitrary commands or user-defined scanner capabilities.

Advisory-dependent analysis consumes a pre-fetched, digest-addressed advisory
snapshot. Refreshing vulnerability databases is an infrastructure operation,
not part of scanning an untrusted source tree.

## Project discovery requirements

Discovery must produce evidence-backed detections for:

- languages;
- frameworks;
- package managers and lock files;
- build systems;
- test frameworks;
- CI systems;
- Docker/container definitions;
- infrastructure as code;
- API contracts;
- monorepo/workspace boundaries.

A technology is not reported merely because its name appears in arbitrary text.
Each detection carries one or more evidence paths.

The discovery engine must understand, at minimum, common indicators such as
`package.json`, lock files, `composer.json`, `pyproject.toml`, requirements
files, Java build descriptors, `.github/workflows`, Dockerfiles, Compose,
Terraform, Helm/Kubernetes manifests, OpenAPI/Swagger and GraphQL schemas.
Specific technology detectors are incremental and must be tested with positive,
negative and near-miss fixtures.

## Snapshot identity

An assessment is bound to a Git commit, not to a mutable directory name. The
profile records provider, owner, repository, branch and commit SHA. Version 1
requires a clean working tree so findings can be reproduced against exact
bytes.

Later support for intentionally dirty developer worktrees must use a separate
snapshot mechanism that hashes the complete source input; it must not weaken the
clean-Git contract.

## Path handling

The core operates on canonical paths. Platform adapters may translate Windows
and WSL paths at the boundary, but contracts and findings use project-relative
paths wherever possible.

Requirements:

- resolve the declared project root once;
- reject source reads whose canonical path escapes that root;
- do not follow symlinks in version 1;
- never treat a scanner output path as target source;
- normalize separators before fingerprinting locations;
- preserve case behavior appropriate to the source filesystem;
- test Windows drive paths, UNC rejection where unsupported, WSL `/mnt/<drive>`
  paths and ordinary Linux paths.

## Static capability model

Version 1 exposes a closed capability vocabulary:

- `inventory` — project and dependency inventory;
- `sast` — static source analysis;
- `secrets` — committed secret detection with mandatory redaction;
- `sca` — dependency/advisory analysis using offline advisory data;
- `iac` — infrastructure/configuration analysis;
- `workflow` — CI/CD workflow analysis;
- `sbom` — CycloneDX/SPDX generation.

A concrete tool is an implementation detail selected by an approved adapter
registry. The assessment contract authorizes capabilities, never command lines.

## No-install rule

Static-readonly does not execute `npm install`, `pnpm install`, Composer,
`pip install`, Gradle/Maven dependency resolution, package lifecycle hooks or
similar operations inside the target. Lock files and manifests are parsed as
data.

Build-aware analysis will be a separate isolated mode with a distinct threat
model, disposable filesystem, explicit network/package-registry policy and
separate authorization contract.

## Result normalization

Every adapter execution produces a `scanner-run` receipt that binds tool
identity/version, immutable tool artifact digest, assessment ID, project profile
digest, capability, timing, process result and output digest. A process exit
code alone is not a successful assessment.

Scanner output is untrusted input. It is validated and redacted before it may
become canonical evidence. Persisted evidence uses the
`evidence-record.schema.json` contract, whose digest addresses **redacted
bytes**, never raw secret-bearing output.

Prefer SARIF 2.1.0 where the source tool supports it. SecOps also keeps its own
canonical occurrence/finding format so GitHub-specific result limits do not
become data-loss limits for Finding Hub.

The GitHub publishing adapter is responsible for partitioning/prioritizing SARIF
when repository code-scanning limits require it; the canonical SecOps result set
must remain complete.

## Secret evidence

A secret detector never stores the full value in findings, ordinary evidence or
reports. Version 1 records only the secret type/category, safe location metadata
and redacted placeholders needed to explain the finding.

Version 1 deliberately does **not** persist a plain hash of the raw secret. A
hash of a low-entropy password or token-like value can itself become an offline
guessing oracle. If a future workflow needs cross-event secret correlation, it
must introduce a separately reviewed keyed construction and lifecycle rather
than silently widening this contract.

If a future incident-response workflow needs protected raw evidence, that is a
different capability with different storage, access control, retention and
authorization requirements.

## Baseline and change decisions

A reviewed baseline is represented by `baseline-set.schema.json` and binds its
finding identities to a project/profile digest, Git commit and policy version.
Canonical fingerprints are versioned and exclude volatile scanner message text,
timestamps and absolute line numbers.

Subsequent scans distinguish:

- `new` — present now and absent from the reviewed baseline;
- `existing` — present now and previously open;
- `regressions` — present now after having been independently verified fixed;
- `not_observed` — previously open but absent from this scan;
- `verified_absent` — previously verified and still absent.

`not_observed` is intentionally **not** called `fixed`. Scanner absence may be
caused by configuration drift, coverage loss, parser failure or changed evidence.
A finding reaches the existing lifecycle's `verified` state only after the
required independent retest against the named artifact.

Security gates should primarily prevent new verified risk and regressions while
existing debt is tracked under explicit remediation or expiring risk acceptance.
Hard safety invariants remain blocking regardless of baseline.

## Company policy isolation

Generic SecOps may ship generic policy packs such as `web`, `api` and
`supply-chain`. A company's private overlay must live in a separate private
location and may contain organization-specific thresholds, ownership, approved
registries, internal package namespaces and risk decisions.

The generic repository must not contain a customer's:

- internal hostnames or IPs;
- production URLs;
- credentials or authentication material;
- vulnerability exceptions;
- private architecture inventory;
- proprietary source-derived rules unless intentionally contributed.

## Future CI consumption

The eventual GitHub integration should be a thin caller of a centrally managed,
SHA-pinned reusable SecOps workflow. The target repository should not copy the
SecOps implementation into its own workflow.

The desired trust model is:

```text
target repository
       |
       v
small caller workflow
       |
       v
approved reusable SecOps workflow @ immutable SHA
       |
       +--> read-only checkout
       +--> project discovery
       +--> static assessment
       +--> normalized results
       +--> policy decision
       +--> SARIF/report publication
```

OIDC and write permissions are unnecessary for the initial local/static scan.
They are introduced only for specific later responsibilities such as protected
result publication, artifact signing or deployment.

## Dynamic testing is a different boundary

Do not extend the lab `scope-record` by making public destinations generally
expressible. The lab contract intentionally rejects them.

Authorized enterprise DAST will use a separate contract requiring explicit
hostname/environment, authorization reference, validity window, approved
profile, exclusions, rate/concurrency/request budgets, stop contacts and audit.
It is not part of static-readonly v1.

## Target CLI

The intended user experience is eventually:

```text
secops project inspect --project ../external-project
secops project scan --project ../external-project --plan assessment.json
secops project report --assessment ASM-YYYY-NNNN
```

The implementation may initially be exposed through the repository task
interface before a packaged CLI exists.

## Exit semantics

The external mode must preserve fail-closed behavior:

- `0`: complete assessment and policy decision permits continuation;
- `1`: complete assessment and policy gate blocks;
- `2`: invalid invocation or contract;
- `3`: scanner/infrastructure failure;
- `4`: incomplete assessment/result ingestion.

A scanner crash, absent output or unreadable result is never interpreted as
zero findings.

## Acceptance for the first executable increment

Before static-readonly is considered implemented:

1. project discovery is deterministic for the same clean commit;
2. canonical profile hashing is stable across supported host path forms;
3. no test can write into the target fixture tree;
4. symlink/root-escape tests fail closed;
5. project lifecycle scripts are never executed;
6. scanner adapters receive typed arguments rather than shell command strings;
7. secret results are redacted before persistence;
8. all result records bind to project profile digest and commit SHA;
9. missing scanner output produces incomplete/failure, never pass;
10. baseline diff produces stable new/existing/regression/not-observed classifications;
11. Windows/WSL/Linux path fixtures are covered;
12. company-specific policy can be loaded externally without being committed to
    the generic SecOps repository.
