# ADR-012: Execution Grant Contract, Skew and Replay Window

Status: Proposed

Resolves conflict 12 of
[`08-specification-conflicts.md`](../docs/08-agent/08-specification-conflicts.md).
The threat model requires signed, short-lived, audience-bound, nonce-protected,
replay-resistant grants tied to an immutable scope snapshot (TM-S-001), and no
grant contract, clock-skew rule, signer trust, revocation or key lifecycle was
defined. This proposes all five so E1-004 has something to be built against.

## Context

A grant is the object an adapter presents to prove it may act. Everything else
in the control plane — scope validation, address pinning, budgets — exists to
decide whether one is issued. If a grant can be forged, replayed or stretched,
none of that work matters.

Three facts constrain the design and make it narrower than a general-purpose
token:

- **It authorises one run against one pinned target.** There is no session, no
  refresh and no renewal. A grant that needs extending is a new decision.
- **Both ends are machines on a private network.** No human latency has to be
  tolerated, so the lifetime can be far shorter than the 5–15 minutes usual for
  interactive access tokens.
- **The scope snapshot it binds to is already immutable and addressable by
  digest** ([ADR-011](011-canonical-scope-serialization.md)).

## Decision

### The grant contract

A grant is a document under
`packages/contracts/security/execution-grant.schema.json`, serialised with the
ADR-011 canonical form and signed over those bytes. Required fields:

| Field | Purpose |
| --- | --- |
| `grant_id` | Identity, and the audit key. |
| `nonce` | Single-use value. The replay cache is keyed on it. |
| `scope_hash` | The immutable snapshot this grant authorises against. |
| `audience` | The adapter identity permitted to present it. |
| `run_id` | The single run it belongs to. |
| `pinned_addresses` | The exact addresses resolution authorised (E1-002). |
| `issued_at`, `expires_at` | The window, both absolute. |
| `profile` | `passive` or `bounded-active`. There is no third value. |
| `signature` | Over the canonical bytes of every field above. |

There is no `renew`, no `refresh_token` and no `scope` field carrying the scope
inline. A grant references a snapshot by digest and cannot restate it, so a
grant and the scope it claims to authorise cannot drift apart.

### Lifetime and clock skew

- **Maximum lifetime: 300 seconds.** The schema refuses a longer window, so an
  over-long grant is unrepresentable rather than merely discouraged.
- **Clock skew tolerance: 30 seconds**, applied to both edges.

Current guidance for signed tokens puts skew at 30–60 seconds and warns that
tolerance beyond five minutes accepts replays long after issuance. Both machines
here are on one private network, so 30 seconds is generous.

### The replay window invariant

A nonce is cached to make a grant single-use, and the cache entry must outlive
every moment the grant could still be accepted:

```
cache_ttl >= lifetime + 2 * skew
```

If the entry expires first, a grant that is still inside its acceptance window
has no replay record and can be presented again. This is the one arithmetic
relationship in the design that is easy to get wrong and silent when wrong, so
it is asserted rather than commented.

Bounding the cache at that value is also what keeps it bounded at all. Nonces
retained beyond the window cost storage and add nothing, because the grant is
already refused on expiry.

### Signer trust and key lifecycle

- One signing key per environment, held by the control plane and never by an
  adapter. An adapter verifies; it cannot issue.
- Keys carry a `key_id`, and a grant names the `key_id` that signed it, so
  rotation does not invalidate grants in flight.
- Rotation is by overlap: a new key is trusted for verification before it is
  used for signing, and the old key stops signing before it stops verifying.
- A verifier holds an explicit set of trusted `key_id` values. An unknown
  `key_id` is a refusal, never a fallback.

### Revocation

- The kill switch revokes by `run_id`, not by grant. A run is the unit an
  operator thinks in, and one run may hold several grants.
- Revocation is checked at presentation, after signature and window and before
  the action. Checking it first would let an unsigned document probe which runs
  exist.
- A revoked `run_id` stays revoked for the maximum grant lifetime plus skew,
  after which no grant naming it could still be valid.

## Consequences

A grant cannot outlive five minutes, cannot be presented twice, cannot be moved
to another adapter or run, and cannot claim a scope other than the one it
references by digest. Each of those is a schema constraint or an asserted
invariant rather than a rule in prose.

The cost is that a long adapter run must be re-granted. That is intended: a
scanner that has been executing for five minutes without checking back is
exactly the case the budgets and the kill switch exist to interrupt.

Clock correctness becomes a security dependency. A verifier whose clock is more
than 30 seconds out will refuse valid grants, which is the safe direction, but
it is an operational failure mode that belongs in the runbook.

## Alternatives considered

**JWT.** It would bring an algorithm field, and with it the confusion attacks
that field is famous for, plus a dependency in a module that is currently
standard library only. The grant is not interoperating with anything outside
this repository, so a canonical form that already exists and is already tested
across two languages is the smaller choice.

**No nonce, short lifetime only.** A five-minute window is a five-minute replay
window. The nonce is what makes the grant single-use, and the lifetime is what
bounds the cache.

**Revocation by grant.** More precise and worse: an operator hitting the kill
switch wants the run stopped, not one of its grants.
