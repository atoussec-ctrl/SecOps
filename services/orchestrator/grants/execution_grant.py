"""Execution grant issuance, verification and replay protection (E1-004).

The contract and its constants come from
[ADR-012](../../../adrs/012-execution-grants.md). This is the verifier the
threat model's TM-S-001 asks for: signed, short-lived, audience-bound,
nonce-protected and tied to an immutable scope snapshot.

Verification order is deliberate and is itself a security property.

1. **Key**, then **signature**. Everything after this reads fields, and reading
   fields from a document nobody signed is how a forged grant gets to influence
   a decision.
2. **Window**, using a clock supplied by the caller rather than read here, so a
   test can describe an instant instead of waiting for one.
3. **Audience**, **run** and **scope**: the bindings that stop a valid grant
   being moved somewhere it was not issued for.
4. **Revocation**, last. Checking it earlier would let an unsigned document
   probe which runs exist.
5. **Nonce**, last of all, because consuming it is the only step with a side
   effect. A grant refused for any earlier reason must not burn its nonce, or a
   verifier could be made to invalidate grants it never accepted.

Standard library only. `hmac` and `hashlib` are enough for a symmetric grant
between two processes in one private environment, and `hmac.compare_digest` is
what keeps the comparison constant-time.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Final, Mapping

__all__ = [
    "CLOCK_SKEW_SECONDS",
    "GrantRefused",
    "MAXIMUM_LIFETIME_SECONDS",
    "REPLAY_CACHE_TTL_SECONDS",
    "ReplayCache",
    "canonical_bytes",
    "issue_grant",
    "sign_grant",
    "verify_grant",
]

# ADR-012. A grant authorises one run between two machines on a private
# network, so no human latency has to be tolerated.
MAXIMUM_LIFETIME_SECONDS: Final = 300
CLOCK_SKEW_SECONDS: Final = 30

# The one arithmetic relationship in the design that is silent when wrong. A
# cache entry must outlive every moment its grant could still be accepted, or a
# grant inside its own window has no replay record and can be presented twice.
REPLAY_CACHE_TTL_SECONDS: Final = MAXIMUM_LIFETIME_SECONDS + 2 * CLOCK_SKEW_SECONDS

_SIGNED_FIELDS: Final = (
    "grant_version",
    "grant_id",
    "nonce",
    "key_id",
    "scope_hash",
    "audience",
    "run_id",
    "pinned_addresses",
    "issued_at",
    "expires_at",
    "profile",
)


# The contract in packages/contracts/security/execution-grant.schema.json,
# restated in the language that actually runs.
#
# A JSON Schema constrains documents that are validated against it. Nothing
# validates a grant on the runtime path, so without this table the schema's
# guarantees hold only for documents that happened to pass through a validator
# — and a signature says who wrote a document, never that it is well formed. A
# grant naming a destructive profile, or pinning a hostname instead of a
# resolved address, verified cleanly before this existed.
#
# tests/foundation/execution-grant-differential.test.mjs asserts this table and
# the schema accept exactly the same documents, so the restatement cannot drift.
_FIELD_PATTERNS: Final = {
    "grant_version": re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$"),
    "grant_id": re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$"),
    "nonce": re.compile(r"^[0-9a-f]{32,64}$"),
    "key_id": re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$"),
    "scope_hash": re.compile(r"^[0-9a-f]{64}$"),
    "audience": re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$"),
    "run_id": re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$"),
    "issued_at": re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"),
    "expires_at": re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"),
    "signature": re.compile(r"^[0-9a-f]{64,128}$"),
}

_ADDRESS: Final = re.compile(r"^[0-9a-f.:]+$")
_PROFILES: Final = frozenset({"passive", "bounded-active"})
_MAXIMUM_PINNED_ADDRESSES: Final = 16
_MAXIMUM_ADDRESS_LENGTH: Final = 45


def _assert_contract_shape(grant: Mapping[str, object]) -> None:
    """Refuse a grant the contract could not express, signed or not."""
    for name, pattern in _FIELD_PATTERNS.items():
        value = grant.get(name)

        if not isinstance(value, str) or not pattern.fullmatch(value):
            raise GrantRefused(f"{name} does not satisfy the grant contract: {value!r}")

    if grant.get("profile") not in _PROFILES:
        raise GrantRefused(
            f"profile {grant.get('profile')!r} is not one the contract allows; "
            "destructive tooling has no representation here",
        )

    addresses = grant.get("pinned_addresses")

    if not isinstance(addresses, (list, tuple)) or not addresses:
        raise GrantRefused("a grant that pins no address authorises no destination")

    if len(addresses) > _MAXIMUM_PINNED_ADDRESSES:
        raise GrantRefused(f"more than {_MAXIMUM_PINNED_ADDRESSES} pinned addresses")

    if len(set(addresses)) != len(addresses):
        raise GrantRefused("pinned addresses must be unique")

    for address in addresses:
        if (
            not isinstance(address, str)
            or len(address) > _MAXIMUM_ADDRESS_LENGTH
            or not _ADDRESS.fullmatch(address)
        ):
            # A name here would be resolved again at connect time, which is the
            # gap E1-002 exists to close.
            raise GrantRefused(
                f"pinned address {address!r} is not a resolved literal",
            )

    unknown = set(grant) - set(_SIGNED_FIELDS) - {"signature"}

    if unknown:
        raise GrantRefused(f"unknown grant fields: {', '.join(sorted(unknown))}")


class GrantRefused(Exception):
    """A grant was refused. The reason is meant to reach an audit record."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _parse_timestamp(value: str, label: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
    except (TypeError, ValueError) as error:
        raise GrantRefused(f"{label} is not a UTC timestamp: {value!r}") from error


def canonical_bytes(grant: Mapping[str, object]) -> bytes:
    """Serialise the signed fields the way ADR-011 defines.

    Keys sorted, no insignificant whitespace, non-ASCII emitted literally. The
    signature is excluded because it is computed over this.
    """
    missing = [name for name in _SIGNED_FIELDS if name not in grant]

    if missing:
        raise GrantRefused(f"grant is missing signed fields: {', '.join(missing)}")

    payload = {name: grant[name] for name in _SIGNED_FIELDS}

    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def sign_grant(grant: Mapping[str, object], key: bytes) -> str:
    return hmac.new(key, canonical_bytes(grant), hashlib.sha256).hexdigest()


def issue_grant(
    *,
    grant_id: str,
    nonce: str,
    key_id: str,
    key: bytes,
    scope_hash: str,
    audience: str,
    run_id: str,
    pinned_addresses: tuple[str, ...],
    issued_at: datetime,
    lifetime_seconds: int,
    profile: str,
) -> dict[str, object]:
    """Build and sign a grant, refusing anything the contract cannot express."""
    if lifetime_seconds <= 0:
        raise GrantRefused("a grant with no lifetime authorises nothing")

    if lifetime_seconds > MAXIMUM_LIFETIME_SECONDS:
        raise GrantRefused(
            f"lifetime {lifetime_seconds}s exceeds the {MAXIMUM_LIFETIME_SECONDS}s maximum",
        )

    if not pinned_addresses:
        raise GrantRefused("a grant that pins no address authorises no destination")

    issued = issued_at.astimezone(timezone.utc).replace(microsecond=0)

    grant: dict[str, object] = {
        "grant_version": "1.0.0",
        "grant_id": grant_id,
        "nonce": nonce,
        "key_id": key_id,
        "scope_hash": scope_hash,
        "audience": audience,
        "run_id": run_id,
        "pinned_addresses": list(pinned_addresses),
        "issued_at": issued.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": (issued + timedelta(seconds=lifetime_seconds)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        "profile": profile,
    }

    grant["signature"] = sign_grant(grant, key)

    # Checked here rather than trusted to the caller: an issuer that can mint a
    # document the contract rejects makes the contract advisory.
    _assert_contract_shape(grant)

    return grant


@dataclass
class ReplayCache:
    """Nonces seen inside the window, and nothing older.

    Bounded on purpose: an entry outside the acceptance window cannot protect
    anything, because the grant naming it is already refused on expiry.
    """

    ttl_seconds: int = REPLAY_CACHE_TTL_SECONDS
    _seen: dict[str, datetime] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Stated as an assertion rather than a comment because a shorter TTL
        # silently reopens the replay window it exists to close.
        if self.ttl_seconds < MAXIMUM_LIFETIME_SECONDS + 2 * CLOCK_SKEW_SECONDS:
            raise GrantRefused(
                f"replay cache ttl {self.ttl_seconds}s is shorter than the window a "
                f"grant can be accepted in "
                f"({MAXIMUM_LIFETIME_SECONDS + 2 * CLOCK_SKEW_SECONDS}s), so a live "
                "grant could outlive its own replay record",
            )

    def _evict(self, now: datetime) -> None:
        # Inclusive on purpose. The widest gap between two acceptable
        # presentations of one grant is exactly lifetime + 2 * skew, which is
        # exactly the TTL, so an entry aged precisely that much is still the
        # entry that has to stop the replay. A strict comparison here drops it
        # one instant too early, and only at that instant.
        horizon = now - timedelta(seconds=self.ttl_seconds)
        self._seen = {
            nonce: seen for nonce, seen in self._seen.items() if seen >= horizon
        }

    def assert_unused(self, nonce: str, now: datetime) -> None:
        """Check without consuming.

        Verification uses this so a grant that is never accepted keeps its
        nonce. Burning it during a check that the caller then refuses to act on
        would let an audit-store outage permanently destroy valid grants.
        """
        self._evict(now)

        if nonce in self._seen:
            raise GrantRefused(f"nonce {nonce} has already been used")

    def consume(self, nonce: str, now: datetime) -> None:
        """Mark the nonce used. This is the commit, and it happens last."""
        self.assert_unused(nonce, now)
        self._seen[nonce] = now

    def __len__(self) -> int:
        return len(self._seen)


def verify_grant(
    grant: Mapping[str, object],
    *,
    trusted_keys: Mapping[str, bytes],
    audience: str,
    run_id: str,
    scope_hash: str,
    now: datetime,
    replay_cache: ReplayCache,
    revoked_runs: frozenset[str] = frozenset(),
) -> str:
    """Refuse unless every condition holds; return the nonce to be consumed.

    Verification has **no side effect**. The nonce is checked and not consumed,
    because a grant whose acceptance is then refused — by an audit-store failure,
    say — must remain presentable. Consuming during the check let a flapping
    store destroy valid grants permanently.

    `grants.authorisation.authorise` is the composition that gets the order
    right: verify, record, then consume.
    """
    key_id = grant.get("key_id")

    if not isinstance(key_id, str) or key_id not in trusted_keys:
        raise GrantRefused(f"key_id {key_id!r} is not trusted")

    presented = grant.get("signature")
    expected = sign_grant(grant, trusted_keys[key_id])

    if not isinstance(presented, str) or not hmac.compare_digest(presented, expected):
        raise GrantRefused("signature does not verify")

    # A signature says who wrote a document, never that it is well formed. A
    # grant naming a destructive profile, or pinning a hostname rather than a
    # resolved address, verified cleanly before this line existed.
    _assert_contract_shape(grant)

    issued = _parse_timestamp(str(grant.get("issued_at")), "issued_at")
    expires = _parse_timestamp(str(grant.get("expires_at")), "expires_at")

    if expires <= issued:
        raise GrantRefused("expires_at is not after issued_at")

    if (expires - issued).total_seconds() > MAXIMUM_LIFETIME_SECONDS:
        raise GrantRefused(
            f"lifetime exceeds the {MAXIMUM_LIFETIME_SECONDS}s maximum",
        )

    skew = timedelta(seconds=CLOCK_SKEW_SECONDS)

    if now < issued - skew:
        raise GrantRefused("grant is not valid yet")

    if now > expires + skew:
        raise GrantRefused("grant has expired")

    if grant.get("audience") != audience:
        raise GrantRefused(
            f"grant was issued for audience {grant.get('audience')!r}, presented as {audience!r}",
        )

    if grant.get("run_id") != run_id:
        raise GrantRefused(
            f"grant belongs to run {grant.get('run_id')!r}, presented for {run_id!r}",
        )

    if grant.get("scope_hash") != scope_hash:
        raise GrantRefused("grant references a different scope snapshot")

    if run_id in revoked_runs:
        raise GrantRefused(f"run {run_id} is revoked")

    # Last, and checked rather than consumed. A grant refused above must not
    # burn its nonce, or a verifier could be made to invalidate grants it never
    # accepted; and a grant whose acceptance is refused afterwards must stay
    # presentable, or an audit-store outage becomes a way to destroy valid work.
    nonce = str(grant.get("nonce"))
    replay_cache.assert_unused(nonce, now)

    return nonce
