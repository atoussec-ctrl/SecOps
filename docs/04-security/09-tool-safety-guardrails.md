# Tool Safety Guardrails

## Core rule

No security tool is executed directly from UI, user input or an AI-generated
shell command. Every tool runs through a reviewed adapter registered by ID and
pinned to an immutable version/digest.

## Adapter requirements

- Fixed executable and entrypoint.
- Typed configuration schema.
- No shell interpolation.
- Scope-validation grant required.
- DNS/address pinning and redirect validation.
- Passive/active classification.
- Rate, concurrency, request, duration, CPU, memory and output limits.
- Dry-run and explicit active confirmation.
- Heartbeat, cancellation and global kill support.
- Read-only root filesystem where supported.
- No Docker socket, host network or privileged mode.
- Normalized output plus original-result receipt.

## Network denylist independent of scope

Even if mistakenly supplied, adapters reject:

- public addresses unless a future explicitly authorized product mode is
  designed and approved;
- cloud metadata and link-local endpoints;
- host control plane and container-runtime endpoints;
- multicast/broadcast except an explicitly isolated wireless lab profile;
- excluded targets and ports;
- destinations resolved after grant issuance that were not pinned.

## Profile classes

| Class | Behavior | Confirmation |
| --- | --- | --- |
| Passive | Observe traffic/artifacts without attack payloads | Scope required |
| Bounded active | Inject approved payload classes with strict budgets | Explicit per run |
| Destructive/availability | Not implemented in core product | Separate disposable design and authorization required |

## Initial tool policy

| Tool family | Allowed use | Prohibited default |
| --- | --- | --- |
| ZAP/Burp/mitmproxy | Owned Web/API traffic and approved profiles | Arbitrary external proxying |
| Nmap/Wireshark | Private lab discovery and protocol observation | Public range discovery |
| Semgrep/CodeQL | Repository/static analysis | Uploading private code to unapproved service |
| Trivy/SCA | Repository, image, SBOM and IaC analysis | Automatic unsafe dependency changes |
| Schemathesis/fuzzers | Bounded contract tests on disposable API | Unbounded production fuzzing |
| MobSF/Frida | Owned lab artifacts/devices | Third-party app bypass activity |
| Metasploit/AD tools | Optional explicit isolated training profile | General network automation |

## Command injection defense

- Store allowable flags as code, not user text.
- Parse values into exact types and ranges.
- Reject newline, NUL and unexpected encoding forms.
- Use subprocess argument arrays and a minimal environment.
- Never expand globs, substitutions, variables or response files from user
  input unless the adapter explicitly owns and validates the file.

## Agent stop rule

An AI agent must stop and report when a desired capability requires broader
network authority, real credentials, public scanning, destructive behavior or a
new privileged tool. It may design the interface and tests but must not assume
authorization or bypass the guardrail.

