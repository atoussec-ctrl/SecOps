# Static Analysis and Supply-chain Specification

## Analysis layers

| Layer | Purpose | Candidate tools |
| --- | --- | --- |
| SAST | Data flow and unsafe code patterns | CodeQL, Semgrep |
| Language checks | Ecosystem-specific unsafe constructs | Bandit, SpotBugs/FindSecBugs, linters |
| Secrets | Detect committed credentials/material | Gitleaks |
| SCA | Known component vulnerabilities/licenses | Trivy, OWASP Dependency-Check/OSV-compatible tools |
| IaC | Misconfiguration and policy | Trivy config, Checkov or equivalent |
| Containers | Packages, config, secrets and base images | Trivy and policy checks |
| Workflow | Permissions, injection and pinning | CodeQL/policy/custom rules |

Use the smallest complementary set that provides coverage; duplicate tools are
not a quality objective.

## Custom rule backlog

### TypeScript

- Request-derived shell/process execution.
- Raw SQL/string interpolation in queries.
- Unsafe DOM/raw HTML sink without reviewed wrapper.
- Permissive CORS with credentials.
- JWT decode used as verification.
- URL fetch outside hardened client.

### Python

- `shell=True` or command construction at trust boundary.
- Unsafe pickle/YAML/deserialization.
- Archive extraction without path containment.
- Debug server or traceback enabled in release config.
- Request-derived URL/process/file path outside approved wrappers.

### Java/Kotlin

- Request binding directly to persistence entity.
- Process/command execution from external input.
- Native object deserialization on untrusted bytes.
- Weak/deprecated crypto or TLS configuration.
- Missing authorization annotation/policy on protected endpoint patterns.

### Mobile

- Android exported component without explicit access policy.
- Broad cleartext/ATS exception.
- Sensitive logging and insecure local storage wrapper.
- WebView bridge/content configuration outside approved component.
- Debuggable/release signing misconfiguration.

## Rule quality requirements

- Positive vulnerable fixture.
- Negative secure fixture.
- At least one near-miss false-positive fixture.
- Rule metadata: CWE, language, severity rationale and remediation.
- Stable rule ID and changelog.
- Benchmark time budget.

## SCA process

1. Inventory source and final artifacts.
2. Generate SBOM.
3. Match advisories and preserve source/retrieval time.
4. Determine whether the component is present and reachable/relevant.
5. Check KEV/EPSS where a CVE exists.
6. Patch, remove, mitigate or accept with expiry.
7. Retest the final artifact.

## Dependency policy

- Direct and transitive dependencies are locked.
- New packages require purpose and ownership.
- Abandoned/unmaintained packages trigger review.
- Installation scripts and generated binaries are treated as privileged.
- Package-manager caches are not trusted release sources without integrity
  verification.

## Result normalization

Upload SARIF where supported. Preserve package URL/PURL, file/module, rule,
advisory, dependency path, artifact digest and tool provenance. Do not merge a
code weakness and a component CVE merely because titles are similar.

