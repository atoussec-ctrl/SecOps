# Tool Qualification and Security Regression Testing

## Purpose

A scanner is not trusted merely because it starts successfully or is the newest release. Tool qualification verifies that the exact version and artifact used by SecOps still detects known fixtures, emits expected machine-readable output, honors redaction and returns understood exit semantics.

## Qualification states

| State | Meaning |
| --- | --- |
| candidate | version discovered, not trusted |
| qualified | exact artifact passed acceptance fixtures |
| blocked | known regression or integrity concern |
| deprecated | replacement selected, temporarily supported |
| revoked | must not execute or authorize release decisions |

## Required qualification evidence

Record product/version, immutable artifact digest, source/release location, upstream signature/provenance where available, invocation mode, network requirement, exit-code mapping, output format, positive/negative fixtures, malformed-output behavior, redaction, timeout behavior and known upstream issues.

## Mandatory canary fixtures

Each scanner integration MUST contain a deterministic fixture proving the scanner actually detects what SecOps expects.

Examples:

- secret scanner: one synthetic supported token and one near miss;
- SAST: one deterministic vulnerable sample and one fixed variant;
- IaC scanner: one prohibited configuration and one compliant configuration;
- SCA scanner: offline advisory snapshot with one known match;
- image scanner: controlled image/SBOM with an expected finding.

A scanner that returns zero findings on its positive canary fixture is **incomplete/blocked**, not clean.

## Gitleaks qualification hold

Gitleaks `v8.30.1` is not approved by version number alone. An upstream 2026 issue reported a regression in which canonical secrets could produce `no leaks found` and exit `0`. The project's latest public release currently remains `v8.30.1`.

Therefore:

```text
gitleaks 8.30.1
  -> candidate/blocked
  -> run positive canary fixture
  -> if detection fails: do not integrate
  -> if corrected release appears: pin exact artifact and requalify
```

SecOps MUST NOT interpret process start or exit `0` as sufficient evidence that a secret scanner is operational.

## Exit semantics normalization

Scanner process exit codes are tool-specific. Adapters MUST normalize them to:

```text
clean
findings
error
```

The raw exit code remains evidence, while completeness logic consumes the normalized outcome. A `findings` outcome means the scanner completed and found issues. It is not an infrastructure failure.

## Output integrity

A complete scanner-run receipt binds assessment ID, project/profile digest, scanner identity/version, immutable scanner artifact digest, capability, timing, raw exit code, normalized outcome, output digest and media type.

Missing or unreadable output is never translated into zero findings.

## Supply-chain qualification

Privileged release jobs MUST pin tools to immutable references. Prefer full commit SHA for Actions, SHA-256 for binaries and digest-pinned OCI images. Mutable `latest`, branch references and floating Action tags are not acceptable for the trusted release path.

## Pipeline self-tests

Security regression cases should cover:

- unpinned Action;
- `permissions: write-all`;
- write token on `pull_request`;
- write token on `merge_group`;
- raw workflow expression in shell commands;
- missing SBOM;
- invalid provenance;
- invalid signature;
- wrong signing identity;
- tampered digest;
- poisoned-cache isolation;
- canary metric failure;
- expired security exception;
- unsigned admission attempt.

## Test commands

```bash
node tools/repo.mjs check:foundation
node tools/repo.mjs check:orchestrator
node tools/repo.mjs check:mutation
node tools/repo.mjs check:all
```

The mutation check verifies that the suite detects catalogued defects instead of merely reporting a high raw test count.

## Promotion rule for tools

A candidate becomes qualified only when immutable identity is recorded; the tool starts in the intended runtime; positive and negative fixtures behave correctly; output parses; timeout/errors fail closed; redaction passes; exit semantics are normalized; known critical upstream regressions are reviewed; and qualification evidence is version controlled.
