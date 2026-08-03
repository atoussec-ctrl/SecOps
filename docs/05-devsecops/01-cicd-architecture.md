# CI/CD Architecture

## Objectives

- Fast feedback at pull request time.
- Deeper verification on protected branches and schedules.
- Dynamic tests against the exact immutable candidate.
- Progressive gates based on new verified risk, not raw scanner volume.
- Strong separation between insecure lab artifacts and secure releases.
- Complete SBOM, digest, signature, provenance and decision evidence.

## Pipeline topology

```mermaid
flowchart TD
    PR["Pull request"] --> Q["Quality and tests"]
    Q --> ST["SAST, secrets, SCA, IaC"]
    ST --> BUILD["Build immutable artifacts"]
    BUILD --> SBOM["SBOM and image scan"]
    SBOM --> EPHEM["Ephemeral private environment"]
    EPHEM --> DYN["DAST, API fuzz and Mobile analysis"]
    DYN --> NORM["Normalize SARIF/findings"]
    NORM --> GATE["Policy and human-visible decision"]
    GATE --> SIGN["Sign and attest secure artifacts"]
    SIGN --> REL["Approved release channel"]
```

## Workflow classes

| Workflow | Trigger | Purpose | Active tests |
| --- | --- | --- | --- |
| PR | Pull request | Fast correctness and shift-left security | Passive/targeted only |
| Main | Merge to protected branch | Full build and integration | Bounded ephemeral |
| Nightly | Schedule/manual | Authenticated DAST, fuzzing, Mobile and deep scans | Yes, isolated lab |
| Release | Signed tag/manual approval | Verify exact secure artifacts and provenance | Bounded retest |

## Trust and permissions

- Default workflow token permissions are read-only.
- Jobs request only required permissions.
- Untrusted pull requests never receive secrets or signing identity.
- Third-party actions are pinned to immutable commits.
- Release uses protected environments and OIDC where external identity is
  required.
- Build and sign jobs are separated; signing consumes immutable digests.
- Scanner jobs cannot publish artifacts.

## Artifact flow

```mermaid
sequenceDiagram
    participant B as Build
    participant R as Internal registry
    participant T as Test environment
    participant G as Gate
    participant S as Signer
    B->>R: Push candidate by digest
    R-->>T: Pull exact digest
    T-->>G: Results + tested digest
    G->>G: Verify all result digests match
    G-->>S: Approved secure digest only
    S->>R: Signature + provenance
```

## Insecure artifact control

- Insecure artifacts use an internal lab-only namespace.
- They are short-lived and never signed with release identity.
- Policy rejects public registry destinations.
- A release manifest cannot reference an insecure module or artifact label.
- Protected CI tests validate these properties independent of repository input.

## Result handling

All tools produce machine-readable output. The consolidation job validates and
uploads results to Finding Hub. A top-level successful job does not imply every
result was accepted; per-tool receipts and ingestion errors are checked.

