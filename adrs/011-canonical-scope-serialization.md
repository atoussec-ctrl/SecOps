# ADR-011: Canonical Serialization for the Scope Digest

Status: Accepted

## Context

A scope record is approved once and referenced by digest from then on. The side
that approves and signs it and the side that verifies it at runtime must agree
byte for byte on what was approved, or the digest proves nothing.

Those sides are not the same language. The console and contracts are
TypeScript and JSON Schema, the orchestrator is Python. Ordinary JSON
serialization is not stable enough: object key order, whitespace and number
formatting all vary between writers, so the same record can produce different
digests without anyone changing it.

## Decision

The digest is computed over a canonical form defined in
`tools/scope-hash.mjs` and pinned by conformance vectors at
`packages/contracts/security/samples/canonical-form/`.

The form is narrower than JSON on purpose:

- object keys are sorted, so input order cannot change the digest;
- array order is preserved, because order is meaningful in a scope;
- there is no insignificant whitespace;
- only integers are representable. Floating point has no single textual form
  across languages, and a scope record has no use for one, so a non-integer
  number is an error rather than a value that encodes differently in Python;
- negative zero normalizes to zero.

`approval.scope_hash` is removed before hashing, since the digest cannot cover
the field that carries it. Everything else in the record is covered.

Any implementation of this form is tested against the same vector file.

## Consequences

- The sample scopes carry real digests that are verified on every run, so a
  scope edited without re-approval is detectable.
- A scope record can never contain a fractional number. If a future budget needs
  a fraction, it is expressed as an integer in smaller units, or the form
  changes deliberately with its vectors and a new `form_version`.
- The same canonical form is available for the execution grants of E1-004, which
  the threat model requires to be signed over an immutable scope snapshot.
- Adding a value type to the form is a breaking change for every existing
  digest and requires a version bump.

## Rejected alternatives

Plain `JSON.stringify` and its Python equivalent: key order and separator
defaults differ, so the digests silently disagree.

Full RFC 8785 JSON Canonicalization: its value is the number-formatting rules
for floating point, which this form does not need because it forbids floats
outright. Forbidding them is simpler to implement identically in both languages
and removes the failure mode rather than encoding around it.
