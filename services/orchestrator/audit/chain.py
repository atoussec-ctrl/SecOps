"""Tamper-evident audit chain (backlog E1-005, ADR-013).

Append-only is not tamper evident. Append-only describes an interface that
offers no delete; it says nothing about someone reaching past the interface to
the storage underneath, and the person who does that is exactly the one the
audit record would otherwise describe.

So each entry chains from the digest of the one before it. Editing, removing or
reordering an entry breaks verification at the following entry, which locates
the tampering rather than merely suspecting it.

What this does **not** prove is that the chain is complete. Removing the last n
entries leaves a chain that verifies perfectly. That is a property of hash
chains rather than an oversight here, and it is why ``head_digest`` exists: it
is meant to be anchored outside this store, so a truncated tail contradicts an
anchor somebody else holds.

Standard library only.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Final, Mapping, Sequence

__all__ = [
    "AuditChain",
    "AuditRefused",
    "GENESIS_DIGEST",
    "chain_digest",
    "verify_chain",
]

# The chain has to start somewhere, and the start has to be a value nobody can
# claim was a real entry.
GENESIS_DIGEST: Final = "0" * 64

_ACTIONS: Final = frozenset(
    {
        "grant.issued",
        "grant.refused",
        "grant.verified",
        "address.refused",
        "resolution.pinned",
        "resolution.refused",
        "run.started",
        "run.cancelled",
        "run.killed",
        "scope.approved",
        "scope.refused",
        "adapter.invoked",
        "adapter.refused",
    }
)

_OUTCOMES: Final = frozenset({"allowed", "refused"})
_FACT_TYPES: Final = frozenset(
    {
        "identifier",
        "timestamp",
        "integer",
        "boolean",
        "enum_value",
        "digest",
        "label",
        "reason_code",
    }
)

_IDENTIFIER: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$")
_TIMESTAMP: Final = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_DIGEST: Final = re.compile(r"^[0-9a-f]{64}$")
_FACT_NAME: Final = re.compile(r"^[a-z][a-z0-9_]{1,40}$")

_MAXIMUM_FACTS: Final = 20
_MAXIMUM_FACT_LENGTH: Final = 200

# Everything except the entry's own digest, which is computed over these.
_CHAINED_FIELDS: Final = (
    "entry_version",
    "sequence",
    "entry_id",
    "occurred_at",
    "actor",
    "action",
    "outcome",
    "subject",
    "facts",
    "previous_digest",
)


class AuditRefused(Exception):
    """An entry was refused. Refusing to write is safer than writing something
    that cannot later be believed."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _assert_entry_shape(entry: Mapping[str, object]) -> None:
    """The contract restated where it runs.

    Same reasoning as the grant verifier: a JSON Schema constrains documents
    that are validated against it, and nothing validates an entry on the write
    path.
    """
    missing = [name for name in (*_CHAINED_FIELDS, "entry_digest") if name not in entry]

    if missing:
        raise AuditRefused(f"entry is missing fields: {', '.join(missing)}")

    for name, pattern in (
        ("entry_id", _IDENTIFIER),
        ("actor", _IDENTIFIER),
        ("subject", _IDENTIFIER),
        ("occurred_at", _TIMESTAMP),
        ("previous_digest", _DIGEST),
        ("entry_digest", _DIGEST),
    ):
        value = entry.get(name)

        if not isinstance(value, str) or not pattern.fullmatch(value):
            raise AuditRefused(f"{name} does not satisfy the audit contract: {value!r}")

    if entry.get("action") not in _ACTIONS:
        raise AuditRefused(f"action {entry.get('action')!r} is not a declared action")

    if entry.get("outcome") not in _OUTCOMES:
        raise AuditRefused(f"outcome {entry.get('outcome')!r} is not allowed or refused")

    sequence = entry.get("sequence")

    if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 1:
        raise AuditRefused(f"sequence must be a positive integer, got {sequence!r}")

    facts = entry.get("facts")

    if not isinstance(facts, (list, tuple)) or not facts:
        # An entry with no facts records that something happened and not what,
        # which is a decision nobody can review.
        raise AuditRefused("an entry must record at least one fact")

    if len(facts) > _MAXIMUM_FACTS:
        raise AuditRefused(f"more than {_MAXIMUM_FACTS} facts")

    for fact in facts:
        if not isinstance(fact, Mapping) or set(fact) != {"name", "type", "value"}:
            raise AuditRefused(f"malformed fact: {fact!r}")

        if not isinstance(fact["name"], str) or not _FACT_NAME.fullmatch(fact["name"]):
            raise AuditRefused(f"fact name {fact['name']!r} is not permitted")

        if fact["type"] not in _FACT_TYPES:
            # There is no free-text or binary type. Audit is never deleted, so a
            # store that is never deleted must never receive anything that would
            # eventually have to be.
            raise AuditRefused(
                f"fact type {fact['type']!r} is not one the contract allows",
            )

        value = fact["value"]

        if not isinstance(value, str) or not 1 <= len(value) <= _MAXIMUM_FACT_LENGTH:
            raise AuditRefused(
                f"fact {fact['name']} value must be 1 to {_MAXIMUM_FACT_LENGTH} characters",
            )


def _canonical_bytes(entry: Mapping[str, object]) -> bytes:
    payload = {name: entry[name] for name in _CHAINED_FIELDS}

    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def chain_digest(entry: Mapping[str, object], key: bytes) -> str:
    """HMAC over the canonical entry and the digest it chains from.

    ``previous_digest`` is inside the canonical payload, so the link is part of
    what is signed rather than a field beside it.
    """
    return hmac.new(key, _canonical_bytes(entry), hashlib.sha256).hexdigest()


@dataclass
class AuditChain:
    """An append-only chain with one writer.

    The chaining key is not the grant key. A compromised grant key must not let
    its holder rewrite the record of what it did.
    """

    key: bytes
    actor: str
    entries: list[dict[str, object]] = field(default_factory=list)

    @property
    def head_digest(self) -> str:
        """The value to anchor outside this store.

        Chain verification proves nothing about completeness, so an anchor held
        by somebody else is what makes a truncated tail visible.
        """
        return self.entries[-1]["entry_digest"] if self.entries else GENESIS_DIGEST

    def append(
        self,
        *,
        entry_id: str,
        action: str,
        outcome: str,
        subject: str,
        facts: Sequence[Mapping[str, str]],
        occurred_at: datetime,
    ) -> dict[str, object]:
        entry: dict[str, object] = {
            "entry_version": "1.0.0",
            "sequence": len(self.entries) + 1,
            "entry_id": entry_id,
            "occurred_at": occurred_at.astimezone(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
            "actor": self.actor,
            "action": action,
            "outcome": outcome,
            "subject": subject,
            "facts": [dict(fact) for fact in facts],
            "previous_digest": self.head_digest,
        }

        entry["entry_digest"] = chain_digest(entry, self.key)

        # Checked after the digest so the refusal message describes a complete
        # entry, and before the append so a refused entry never enters the chain.
        _assert_entry_shape(entry)

        self.entries.append(entry)

        return entry

    def __len__(self) -> int:
        return len(self.entries)


def verify_chain(
    entries: Sequence[Mapping[str, object]],
    key: bytes,
    *,
    expected_head: str | None = None,
) -> None:
    """Raise on the first entry that does not verify.

    ``expected_head`` is the anchor. Passing it is what turns "the chain
    verifies" into "the chain verifies and is as long as it should be"; without
    it, a truncated chain passes.
    """
    previous = GENESIS_DIGEST

    for position, entry in enumerate(entries, start=1):
        _assert_entry_shape(entry)

        if entry["sequence"] != position:
            raise AuditRefused(
                f"entry {entry['entry_id']} claims sequence {entry['sequence']} "
                f"at position {position}: an entry is missing or reordered",
            )

        if entry["previous_digest"] != previous:
            raise AuditRefused(
                f"entry {entry['entry_id']} does not chain from the entry before it",
            )

        expected = chain_digest(entry, key)

        if not hmac.compare_digest(str(entry["entry_digest"]), expected):
            raise AuditRefused(f"entry {entry['entry_id']} has been altered")

        previous = str(entry["entry_digest"])

    if expected_head is not None and previous != expected_head:
        # The tail was removed. Every retained entry verified, which is exactly
        # why the anchor is not optional in practice.
        raise AuditRefused(
            "the chain verifies but does not reach the anchored head digest: "
            "entries have been removed from the end",
        )
