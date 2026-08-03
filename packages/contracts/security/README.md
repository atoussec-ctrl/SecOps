# Security contracts

Language-neutral JSON Schemas for the safety-critical documents, with sample
documents that are validated on every run of `node tools/repo.mjs check:contracts`.

## Layout

| Path | Content |
| --- | --- |
| `scope-record.schema.json` | Authorization boundary for an engagement (E0-004) |
| `samples/scope-record/` | Safe scope templates, validated against the schema above |
| `address-policy.schema.json` | Conformance vectors for the special-range policy (E1-001) |
| `samples/address-policy/` | Which targets may appear in a scope record, and why |
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

Beyond addresses, the schema makes several rules structural rather than advisory:

- `allowed_profiles` accepts only `passive` and `bounded-active`. There is no
  value that authorizes destructive tooling.
- every budget has an upper bound, so an excessive configuration value cannot be
  approved;
- `data_handling.synthetic_data_only` must be `true`;
- `approval.scope_hash` must be a full SHA-256 digest;
- unknown properties are rejected everywhere.

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
