# ADR-013: Tamper-Evident Audit Chain

Status: Proposed

Resolves the integrity half of conflict 15 in
[`08-specification-conflicts.md`](../docs/08-agent/08-specification-conflicts.md).
`08-observability.md` requires the audit store to be "append-only" and says
nothing about tamper evidence, authorized writers and readers, time source or
segregation from deletable evidence.

## Context

Every safety decision in the control plane already produces a reason built to be
audited: a refused grant, a denied address, a killed run. None of it is written
anywhere, and conflict 15 blocks E1-005 until it can be.

The gap in the specification is narrower than it first looks, and it is the
important part: **append-only is not tamper evident.** Append-only describes an
interface — nothing offers a delete. It says nothing about what happens when
someone reaches past the interface to the file or the table underneath. An
attacker who compromises the logging host is exactly the person who does that,
and the audit record is the thing that would otherwise describe them.

## Decision

### Entries are chained

Each entry carries the digest of the one before it:

```
entry_digest = HMAC-SHA256(key, canonical(entry without its own digest) || previous_digest)
```

The first entry chains from a fixed genesis value. Editing, removing or
reordering any entry breaks verification at the following entry, so tampering is
located rather than merely suspected.

The canonical form is the one from
[ADR-011](011-canonical-scope-serialization.md), already defined and already
tested across two languages, so a verifier written in TypeScript reaches the
same digest as the Python writer.

### What the chain does not prove

**Truncation of the tail is undetectable from the chain alone.** Removing the
last *n* entries leaves a chain that verifies perfectly. This is a property of
hash chains, not an oversight, and it is stated here so nobody mistakes chain
verification for completeness.

Two things narrow it, and both are recorded as required rather than assumed:

- every entry carries a monotonic `sequence`, so a gap between two retained
  entries is visible even though a missing tail is not;
- the head digest is **anchored** outside the store — written to the run record
  and to the engagement report — so a truncated tail contradicts an anchor
  somebody else holds.

Anchoring is what turns "the chain verifies" into "the chain verifies and is as
long as it should be". Without it, an attacker with write access to the store
simply keeps the prefix.

### Entries cannot carry evidence

Payload fields are declared by name and type, and the type vocabulary has no
free-text or binary member — the same restriction the event catalogue uses. An
audit entry that wanted to record a request body, a cookie or a token has no way
to express it.

This is deliberate and it is the reason audit and evidence are separate stores.
Evidence is redacted, retained for a bounded period and then deleted. Audit is
never deleted. A store that is never deleted must never receive anything that
would eventually have to be.

### Writers, readers and time

- One writer: the control plane. An adapter produces facts and never appends.
- The chaining key is held by the writer and by whoever verifies. It is not the
  grant key: a compromised grant key must not let its holder rewrite the record
  of what it did.
- The timestamp is supplied by the caller, from the same clock the grant window
  uses, and is a **claim inside the entry** rather than an ordering mechanism.
  `sequence` orders the chain. A clock that moves backwards produces a
  surprising timestamp, not a broken chain.

### Retention

Audit entries are retained for the life of the engagement and beyond it. They
are not covered by the evidence retention window in
`08-evidence-privacy.md`, which is what makes the no-evidence rule above load
bearing rather than stylistic.

## Consequences

Verification is O(n) over the chain and cheap: a digest per entry. A compliance
bundle can carry the entries, the head digest and the anchor, and be verified by
someone who was never trusted to write.

The cost is that the chaining key becomes a thing to hold. Losing it makes past
entries unverifiable — though still readable — and that is the failure mode a
runbook has to cover.

Key rotation is not solved here. Rotating mid-chain means either re-chaining
history, which defeats the purpose, or accepting a chain that verifies in
segments. Segmented verification is the intended answer and needs its own
decision before there is a second key.

## Alternatives considered

**A signature per entry instead of a chain.** It proves who wrote each entry and
proves nothing about the sequence: entries can still be removed or reordered
without detection. The chain is what makes order part of what is signed.

**A Merkle tree.** Better for proving membership to someone holding only a root,
which is a problem this product does not have. A linear chain matches a linear
append and is simpler to verify by hand.

**Trusting the database.** `INSERT`-only grants and no `DELETE` privilege are
worth having and are not evidence, because the threat model's compromised host
holds the credentials.
