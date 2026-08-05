# Open Specification Conflicts

[`01-operating-manual.md`](01-operating-manual.md) requires that a conflict
between two normative documents is described with identifiers and referred for a
decision or a proposed ADR, and that the less restrictive reading is never taken
silently. This register holds the conflicts found so far.

Each entry names the blocking backlog task. Until an entry is resolved, the
implementing agent applies the **stricter** reading and records the choice.

## Status

Sixteen entries are open. Entry 12 has a **proposed** ADR ([ADR-012](../../adrs/012-execution-grants.md))
and entries 4 and 12 are partially addressed. None has an *accepted* ADR, so
every entry still applies the stricter reading until reviewed.

## Gate and pipeline semantics

1. **Required-tool errors are inconsistent.** A missing result or scanner crash
   is always a failure (`05-devsecops/02-pipeline-jobs.md:75-80`), yet PR tool
   warnings are only "visible" (`05-devsecops/03-security-gates.md:30`) and
   MobSF runs only "where support exists" (`05-devsecops/05-dynamic-mobile.md:60-66`).
   Proposal: declare required and applicable tools per workflow and demand a
   validated `not-applicable` receipt instead of absent output.
   Blocks: E0-007, E5-005.

2. **New untriaged High findings have no explicit block.** Confirmed High
   blocks and untriaged Critical blocks, but untriaged High is unlisted
   (`03-security-gates.md:25-31`), so a new High can pass before confirmation.
   Blocks: E5-005.

3. **Release acceptance policy is incomplete.** Accepted risk appears shippable
   until expiry, but the maximum acceptable severity, the required approver and
   whether Critical/High may ship are unspecified. Only safety failures are
   categorically non-acceptable (`04-security/07-vulnerability-management.md:64-68`).
   Blocks: E5-006.

4. **Coverage and deadline thresholds are missing.** Coverage "blocks" with no
   stated threshold, tool-warning triage has no deadline, and kill-switch
   latency and exposure detection are measured without objectives
   (`03-security-gates.md:23-31`; `05-devsecops/08-observability.md:25-42`).
   The root README states 95% line, statement, function and branch coverage,
   which should be cited as the gate value.
   Measurement note: no coverage gate is wired into `check:all`, because doing
   so would fix the undecided threshold silently. Two measurement hazards are
   recorded for whoever decides it. Passing a *directory* to
   `node --test --experimental-test-coverage` yields a report naming zero files
   and an aggregate of 100%, so the gate must pass an explicit file list and
   refuse a report that covers nothing. And a module exercised through
   subprocess execution is understated, because V8 coverage in the parent
   cannot attribute a child's run — `tools/repo.mjs` measures 73.99% line while
   its behavior is fully tested.
   Partially addressed: the **mutation** half of this entry no longer needs a
   decision. `02-tdd-coverage-mutation.md` states ≥80% for security-critical
   modules, which is a number, so `check:mutation` enforces it against a
   catalogue whose schema refuses a threshold below the standard. The coverage
   percentage and the triage deadlines are still undecided.
   Blocks: E0-003, E0-007.

5. **Provenance timing is inconsistent.** Stage 4 creates provisional
   provenance and Stage 7 creates final provenance
   (`02-pipeline-jobs.md:40-46,66-73`), while the build-integrity diagram shows
   provenance only after the policy gate
   (`05-devsecops/06-sbom-signing-provenance.md:18-32`). Separate build
   provenance from gate/release attestation and state which is signed.
   Blocks: E5-007.

6. **Signing trust fallback is undefined.** Keyless OIDC is preferred "when
   available" (`06-sbom-signing-provenance.md:43-49`) with no alternative key
   custody, rotation, revocation or trust root.
   Blocks: E5-007.

7. **"Hermetic and reproducible" is unverified.** The SBOM diagram calls for a
   hermetic reproducible build (`06-sbom-signing-provenance.md:18-24`) with no
   reproducibility comparison, build-time network isolation or permitted-material
   policy.
   Blocks: E5-004.

## Safety boundary definitions

8. **Protected policy independence is not designed.** Safety tests must operate
   independently of repository input (`05-devsecops/01-cicd-architecture.md:65-71`),
   but workflows and policy normally live in the repository and a pull request
   can change them. Proposal: protected reusable workflows and policy resolved
   from the base branch, and no privileged build of untrusted pull request code.
   Blocks: E0-007.

9. **PR active-profile terminology is unclear.** CI architecture allows
   "passive or narrowly targeted" testing (`01-cicd-architecture.md:30-35`)
   while tool policy defines only passive, bounded active and destructive
   (`04-security/09-tool-safety-guardrails.md:36-43`). Authorization and
   contract regression requests are active traffic.
   Blocks: E0-007, E2-013.

10. **"Unrestricted egress" has no testable definition.** It is an
    unconditional gate, yet required internal endpoints, DNS, registry pulls and
    Finding Hub traffic are not enumerated. Per-service allowlists and both
    IPv4 and IPv6 exposure tests are needed.
    Blocks: E0-005.

11. **"Public owned target" is ambiguous.** The Rules of Engagement permit
    explicitly authorized owned assets, while adapter policy rejects all public
    addresses and public Internet scanning
    (`04-security/02-rules-of-engagement.md:3-8,24-34`;
    `09-tool-safety-guardrails.md:24-34`). Proposal: treat this product as
    private-lab-only and make any public mode a separate threat model and
    product approval.
    Blocks: E0-004, E1-001.

12. **Runtime grants are underspecified.** The threat model requires signed,
    short-lived, audience-bound, nonce-protected, replay-resistant grants tied
    to an immutable scope snapshot (`04-security/01-threat-model.md:57-71`), but
    no grant contract, clock-skew rule, signer trust, revocation or key
    lifecycle is defined.
    Addressed by [ADR-012](../../adrs/012-execution-grants.md), status
    **Proposed**, which defines the grant contract, a 300-second maximum
    lifetime, 30-second clock skew, the replay-cache window invariant, overlap
    key rotation and revocation by run. E1-004 is built against it. The ADR
    needs review and acceptance; until then the implementation stands on a
    proposal, which the operating manual permits and silent choice does not.
    Blocks: nothing further.

13. **External scanners and advisory feeds need approval boundaries.**
    Uploading private code is prohibited unless approved
    (`09-tool-safety-guardrails.md:44-54`), while CodeQL and CVE/KEV/EPSS
    processing are expected. Local versus hosted execution, approved data flows,
    feed provenance and cache freshness must be stated.
    Blocks: E5-001, E5-003.

## Evidence and audit

14. **Raw-result lifecycle is unclear.** Evidence may hold an immutable
    raw-result reference (`04-security/08-evidence-privacy.md:11-19`) while
    sensitive raw material is forbidden and bytes must be deleted after expiry
    (`:21-29,56-62`). Specify whether unredacted output may exist temporarily in
    quarantine, its encryption, access rules and maximum lifetime, and how a
    reference behaves after deletion.
    Blocks: E1-009.

15. **Audit integrity and retention are incomplete.** "Append-only"
    (`05-devsecops/08-observability.md:70-74`) does not specify tamper evidence,
    authorized writers and readers, time source, backup or retention, nor
    segregation from deletable evidence and secrets.
    Blocks: E1-005, E5-011.

16. **Mobile reset timing differs.** The mobile catalog resets after the
    capstone (`04-security/06-mobile-security-test-catalog.md:45-51`) while
    dynamic CI reverts during teardown (`05-devsecops/05-dynamic-mobile.md:68-79`).
    Apply the stricter per-run reset until decided.
    Blocks: E4-010.

## Version and toolchain policy

17. **The version policy treats host tools and artifact inputs identically.**
    `07-assumptions-version-policy.md` requires every entry pinned to an exact
    version with no ranges, which is right for anything that ends up in an
    artifact — a container image digest, an action commit SHA, a dependency
    lockfile. It is wrong for a host tool that only has to be present and
    recent enough: the pinned `containerRuntime` is whatever the developer's
    workstation reports, so asserting it on any other machine fails on a
    version difference that changes nothing about the build. A GitHub-hosted
    runner carrying Docker 28.0.4 against a manifest pinned at 29.6.2 is the
    observed case.
    Proposal: separate the two categories. An artifact input stays exactly
    pinned; a host tool declares a minimum and the probe reports anything
    below it. Until this is decided, the exact pin stands and host toolchain
    verification runs only where the manifest describes the machine, which is
    local development.
    Blocks: E0-002, E0-007.
