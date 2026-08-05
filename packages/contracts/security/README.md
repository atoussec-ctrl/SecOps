# Security contracts

Language-neutral JSON Schemas for the safety-critical documents, with sample
documents that are validated on every run of `node tools/repo.mjs check:contracts`.

## Layout

| Path | Content |
| --- | --- |
| `scope-record.schema.json` | Authorization boundary for an engagement (E0-004) |
| `samples/scope-record/` | Safe scope templates, validated against the schema above |
| `address-policy.schema.json` | Conformance vectors for the special-range policy (E1-001) |
| `samples/address-policy/ipv4-and-host-vectors.json` | 47 IPv4, CIDR, hostname and URL vectors |
| `samples/address-policy/ipv6-vectors.json` | 21 IPv6 vectors, none of them scope-eligible |
| `canonical-form.schema.json` | Conformance vectors for the scope digest serialization (E1-003) |
| `samples/canonical-form/` | Canonical string and SHA-256 for each value shape |

Samples live in a directory named after their schema. That convention is what
lets the contract check pair a document with the contract it must satisfy
instead of guessing.

## What the scope contract enforces

The address and hostname patterns admit only loopback, RFC 1918 private space
and RFC 2606 reserved domains, so a public target cannot be written down at all.
Alternate encodings of a private address, such as zero-padded or decimal forms,
are rejected as well.

**The scope record is IPv4-only by construction.** There is no `ipv6` target
field, `targets` rejects unknown properties, and the URL pattern admits no
bracketed host, so an IPv6 destination cannot be authorized in any spelling.
That absence does the work a runtime check would otherwise have to do, and
because an absence is easy to erase by accident, a test asserts it: every IPv6
vector is checked against all four scope patterns and must be rejected by each.

An IPv6 destination can therefore only arrive at runtime, through DNS resolution
or a redirect, which is where `samples/address-policy/ipv6-vectors.json` applies.
The case worth knowing is **IPv4-mapped IPv6**: `::ffff:8.8.8.8` is a public
address that an implementation reading only the IPv4 text form never sees.
`::ffff:192.168.56.10` is the subtler one — unwrapping the mapping and then
trusting the result admits a private address by a spelling the signed scope
never authorized.

Beyond addresses, the schema makes several rules structural rather than advisory:

- `allowed_profiles` accepts only `passive` and `bounded-active`. There is no
  value that authorizes destructive tooling.
- every budget has an upper bound, so an excessive configuration value cannot be
  approved;
- `data_handling.synthetic_data_only` must be `true`;
- `approval.scope_hash` must be a full SHA-256 digest;
- unknown properties are rejected everywhere.

## What the second implementation found

`services/orchestrator/scope/address_policy.py` is tested against these same
vectors. Writing it exposed two places where the two languages would have
disagreed, and both are now vectors rather than opinions.

**A trailing dot.** `web.lab.test.` is a legal absolute name and safe to reach,
so the Python classifier calls it `reserved-domain`. The scope pattern admits no
trailing dot, so it could never appear in a signed scope. Classification and
eligibility are therefore not the same question, and the runtime now refuses the
absolute form even though it classifies as safe — otherwise it would admit a
spelling the signed scope never contained.

**A prefix minimum.** `0.0.0.0/0` is perfectly well formed; what is wrong with
it is that it covers every address. Calling it malformed would hide that, so it
classifies as `unspecified` and the prefix minimum applies at eligibility.

## Differential conformance

Agreeing on stated vectors is weaker than it looks. `address-policy-differential`
mutates every vector into the shapes that historically defeat URL and host
filters — whitespace and control characters at both edges and spliced into the
middle, case folding of the whole input and of the authority alone, a trailing
dot — and requires both implementations to reach the same verdict on all 690.

The assertion that matters is stated on its own: **the runtime must never admit
what the contract rejects.** A runtime stricter than the contract is a usability
problem; a runtime looser than the contract is an authorisation boundary with a
hole in it.

It found three, and the first is a live CVE class:

**Normalise-then-trust.** `urlsplit` follows the WHATWG rule and silently removes
ASCII tab, carriage return, newline and leading C0 controls *before* parsing, so
it answers about a string the caller never supplied. `http://local\nhost:8081/`
became a loopback URL and was judged eligible while the contract rejected the
literal. That is the mechanism behind CVE-2022-0391 and CVE-2023-24329 in Python
itself, and behind CVE-2026-44889 in WebOb, where `/\tattacker.com` survived a
filter and reappeared as `//attacker.com`. Both parsers now refuse a control
character or space before parsing rather than after.

**A port classified by its host.** `urlsplit.hostname` tolerates what
`urlsplit.port` refuses, so `http://localhost:99999/` classified as loopback —
and the URL pattern agreed, because it allowed five digits. Both were wrong in
the same direction, which is why the vectors could not catch it. The pattern now
expresses the real range and the runtime reads the port.

**Case folding.** A scheme and a host are case-insensitive, so `urlsplit`
lowercases them and reported `http://LOCALHOST/` as loopback. The scope patterns
are lowercase-only, so that spelling cannot appear in a signed scope. Case
folding belongs to whoever canonicalises a target before signing, not to the
check that reads the signature.

There is also a hazard worth stating for anyone writing a third implementation.
Python's `ipaddress.ip_address("169.254.169.254").is_private` returns **`True`**
— the cloud metadata endpoint, the one address the threat model most wants
denied. It is also `True` for the documentation TEST-NETs, the benchmarking
range, `240.0.0.0/4`, `0.0.0.0/8` and the broadcast address, and **`False`** for
carrier-grade NAT. `is_private` is not a safety test in any direction.
Eligibility comes from an explicit allowlist of four ranges, and a test asserts
the trap still exists so the reasoning is not lost.

## Limits of this contract

Schema validation is a static check on a document. It is not the Scope Guard.
Canonicalizing a requested target, resolving and pinning DNS answers,
revalidating redirects and rejecting addresses that only resolve into private
space at runtime are separate obligations, specified in
[the orchestrator specification](../../../docs/03-applications/04-orchestrator-spec.md)
and scheduled as E1-001 through E1-004.

## Cross-language agreement

Two of these contracts exist because one rule has to hold in two languages.

The scope schema decides which targets may be written down; the Python
orchestrator decides the same question at runtime. `address-policy` is the
shared table both are tested against, and a test asserts that every vector
agrees with the pattern the scope schema already enforces.

A scope is approved once and referenced by digest afterwards, so the approving
side and the verifying side must agree byte for byte on what was approved.
`canonical-form` fixes that serialization, and `tools/scope-hash.mjs` implements
it. The `scope_hash` in each sample is a real digest over that form, verified on
every run, not a placeholder.

Two details decide whether a second implementation agrees, and both are covered
by rejected vectors rather than left to be discovered:

- **Serialize with `ensure_ascii=False`.** Non-ASCII text is emitted literally.
  Python's default would escape it to `\uXXXX` and change the digest.
- **Object keys are ASCII only.** Sorting by UTF-16 code unit and by code point
  disagree above the basic multilingual plane, so the character set is
  restricted rather than the ordering assumed.

What a static contract cannot cover stays with the runtime work: resolving and
pinning DNS answers, detecting answer drift and rebinding, and revalidating
redirects are E1-002.
