"""Execution grants, replay protection and the window arithmetic (E1-004).

The clock is supplied rather than read, so every instant here is described. A
test that had to wait five minutes to prove expiry would not be run.
"""

from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from grants.execution_grant import (  # noqa: E402
    CLOCK_SKEW_SECONDS,
    MAXIMUM_LIFETIME_SECONDS,
    REPLAY_CACHE_TTL_SECONDS,
    GrantRefused,
    ReplayCache,
    issue_grant,
    sign_grant,
    verify_grant,
)

KEY = b"a-symmetric-key-for-one-environment"
OTHER_KEY = b"a-different-key-entirely-not-trusted"
TRUSTED = {"key.2026.08": KEY}
SCOPE_HASH = "b" * 64
AT = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)


def a_grant(**overrides):
    arguments = {
        "grant_id": "grant.0001",
        "nonce": "a" * 32,
        "key_id": "key.2026.08",
        "key": KEY,
        "scope_hash": SCOPE_HASH,
        "audience": "adapter.zap",
        "run_id": "run.0001",
        "pinned_addresses": ("192.168.56.20",),
        "issued_at": AT,
        "lifetime_seconds": 120,
        "profile": "passive",
    }
    arguments.update(overrides)
    return issue_grant(**arguments)


def accept(grant, *, cache=None, at=None, **overrides):
    """Verify and commit, which is what a caller actually does."""
    cache = cache if cache is not None else ReplayCache()
    now = at or AT + timedelta(seconds=10)
    nonce = verify(grant, cache=cache, at=now, **overrides)
    cache.consume(nonce, now)
    return nonce


def verify(grant, *, cache=None, at=None, **overrides):
    arguments = {
        "trusted_keys": TRUSTED,
        "audience": "adapter.zap",
        "run_id": "run.0001",
        "scope_hash": SCOPE_HASH,
        "now": at or AT + timedelta(seconds=10),
        "replay_cache": cache if cache is not None else ReplayCache(),
    }
    arguments.update(overrides)
    return verify_grant(grant, **arguments)


class HappyPath(unittest.TestCase):
    def test_a_freshly_issued_grant_verifies(self) -> None:
        verify(a_grant())

    def test_the_grant_satisfies_its_contract(self) -> None:
        schema = json.loads(
            (
                REPOSITORY_ROOT
                / "packages"
                / "contracts"
                / "security"
                / "execution-grant.schema.json"
            ).read_text(encoding="utf-8")
        )
        grant = a_grant()

        self.assertEqual(sorted(grant), sorted(schema["required"]))
        for name in schema["required"]:
            self.assertIn(name, grant)


class Signature(unittest.TestCase):
    def test_an_edited_field_breaks_the_signature(self) -> None:
        # Every signed field, not a representative one: a field left out of the
        # canonical form would be editable without detection.
        for name, value in (
            ("scope_hash", "c" * 64),
            ("audience", "adapter.other"),
            ("run_id", "run.0002"),
            ("expires_at", "2026-08-05T13:00:00Z"),
            ("issued_at", "2026-08-05T11:00:00Z"),
            ("profile", "bounded-active"),
            ("nonce", "b" * 32),
            ("pinned_addresses", ["169.254.169.254"]),
            ("grant_id", "grant.0002"),
            ("key_id", "key.other"),
            ("grant_version", "9.9.9"),
        ):
            with self.subTest(field=name):
                tampered = dict(a_grant())
                tampered[name] = value

                with self.assertRaises(GrantRefused):
                    verify(tampered)

    def test_a_grant_signed_by_an_untrusted_key_is_refused(self) -> None:
        grant = a_grant()
        grant["signature"] = sign_grant(grant, OTHER_KEY)

        with self.assertRaises(GrantRefused) as raised:
            verify(grant)

        self.assertIn("signature", raised.exception.reason)

    def test_an_unknown_key_id_is_refused_rather_than_defaulted(self) -> None:
        grant = a_grant(key_id="key.2027.01")

        with self.assertRaises(GrantRefused) as raised:
            verify(grant)

        self.assertIn("not trusted", raised.exception.reason)

    def test_rotation_keeps_grants_in_flight_valid(self) -> None:
        # The old key still verifies while the new one signs, which is what
        # overlap rotation means.
        old = a_grant(key_id="key.2026.08")
        new = a_grant(key_id="key.2026.09", key=OTHER_KEY, nonce="c" * 32)
        both = {"key.2026.08": KEY, "key.2026.09": OTHER_KEY}

        verify(old, trusted_keys=both)
        verify(new, trusted_keys=both)


class Window(unittest.TestCase):
    def test_a_grant_longer_than_the_maximum_cannot_be_issued(self) -> None:
        with self.assertRaises(GrantRefused):
            a_grant(lifetime_seconds=MAXIMUM_LIFETIME_SECONDS + 1)

    def test_a_grant_with_no_lifetime_cannot_be_issued(self) -> None:
        for lifetime in (0, -1):
            with self.subTest(lifetime=lifetime), self.assertRaises(GrantRefused):
                a_grant(lifetime_seconds=lifetime)

    def test_an_expired_grant_is_refused(self) -> None:
        grant = a_grant(lifetime_seconds=120)
        past_the_edge = AT + timedelta(seconds=120 + CLOCK_SKEW_SECONDS + 1)

        with self.assertRaises(GrantRefused) as raised:
            verify(grant, at=past_the_edge)

        self.assertIn("expired", raised.exception.reason)

    def test_skew_is_tolerated_on_both_edges(self) -> None:
        grant = a_grant(lifetime_seconds=120)

        verify(grant, at=AT - timedelta(seconds=CLOCK_SKEW_SECONDS))
        verify(grant, at=AT + timedelta(seconds=120 + CLOCK_SKEW_SECONDS), cache=ReplayCache())

    def test_a_grant_from_further_ahead_than_skew_is_refused(self) -> None:
        grant = a_grant()

        with self.assertRaises(GrantRefused) as raised:
            verify(grant, at=AT - timedelta(seconds=CLOCK_SKEW_SECONDS + 1))

        self.assertIn("not valid yet", raised.exception.reason)

    def test_a_stretched_window_is_refused_even_when_signed(self) -> None:
        # Signed by a trusted key, so only the arithmetic catches it.
        grant = a_grant()
        grant["expires_at"] = "2026-08-05T14:00:00Z"
        grant["signature"] = sign_grant(grant, KEY)

        with self.assertRaises(GrantRefused) as raised:
            verify(grant)

        self.assertIn("maximum", raised.exception.reason)

    def test_an_inverted_window_is_refused(self) -> None:
        grant = a_grant()
        grant["expires_at"] = grant["issued_at"]
        grant["signature"] = sign_grant(grant, KEY)

        with self.assertRaises(GrantRefused):
            verify(grant)


class Replay(unittest.TestCase):
    def test_a_grant_is_single_use(self) -> None:
        # Single use is a property of acceptance, not of verification.
        # Verification has no side effect on purpose, so a grant that is checked
        # and then not accepted stays presentable.
        cache = ReplayCache()
        grant = a_grant()

        accept(grant, cache=cache)

        with self.assertRaises(GrantRefused) as raised:
            accept(grant, cache=cache)

        self.assertIn("already been used", raised.exception.reason)

    def test_verification_alone_does_not_consume_the_nonce(self) -> None:
        cache = ReplayCache()
        grant = a_grant()

        verify(grant, cache=cache)
        verify(grant, cache=cache)

        self.assertEqual(len(cache), 0)
        accept(grant, cache=cache)

    def test_the_cache_outlives_every_moment_a_grant_is_acceptable(self) -> None:
        # The invariant from ADR-012, stated as arithmetic rather than trusted
        # to a comment.
        self.assertGreaterEqual(
            REPLAY_CACHE_TTL_SECONDS,
            MAXIMUM_LIFETIME_SECONDS + 2 * CLOCK_SKEW_SECONDS,
        )

    def test_a_cache_too_short_to_cover_the_window_is_refused(self) -> None:
        with self.assertRaises(GrantRefused) as raised:
            ReplayCache(ttl_seconds=REPLAY_CACHE_TTL_SECONDS - 1)

        self.assertIn("outlive", raised.exception.reason)

    def test_a_replay_at_the_last_acceptable_instant_is_still_caught(self) -> None:
        # The moment the invariant exists for: the grant is still inside its
        # window at the far edge of skew, so its nonce must still be cached.
        cache = ReplayCache()
        grant = a_grant(lifetime_seconds=MAXIMUM_LIFETIME_SECONDS)
        last = AT + timedelta(seconds=MAXIMUM_LIFETIME_SECONDS + CLOCK_SKEW_SECONDS)

        accept(grant, cache=cache, at=AT - timedelta(seconds=CLOCK_SKEW_SECONDS))

        with self.assertRaises(GrantRefused) as raised:
            accept(grant, cache=cache, at=last)

        self.assertIn("already been used", raised.exception.reason)

    def test_the_cache_does_not_grow_without_bound(self) -> None:
        cache = ReplayCache()

        for index in range(50):
            cache.consume(f"{index:032x}", AT + timedelta(seconds=index))

        self.assertEqual(len(cache), 50)

        # Far enough ahead that every entry is outside the window.
        cache.consume("f" * 32, AT + timedelta(seconds=REPLAY_CACHE_TTL_SECONDS + 100))
        self.assertEqual(len(cache), 1)

    def test_a_refused_grant_does_not_burn_its_nonce(self) -> None:
        # Otherwise a verifier could be made to invalidate grants it never
        # accepted, by presenting them to the wrong audience first.
        cache = ReplayCache()
        grant = a_grant()

        with self.assertRaises(GrantRefused):
            verify(grant, cache=cache, audience="adapter.other")

        self.assertEqual(len(cache), 0)
        verify(grant, cache=cache)


class Binding(unittest.TestCase):
    def test_a_grant_cannot_move_to_another_adapter(self) -> None:
        with self.assertRaises(GrantRefused) as raised:
            verify(a_grant(), audience="adapter.nmap")

        self.assertIn("audience", raised.exception.reason)

    def test_a_grant_cannot_move_to_another_run(self) -> None:
        with self.assertRaises(GrantRefused) as raised:
            verify(a_grant(), run_id="run.0002")

        self.assertIn("run", raised.exception.reason)

    def test_a_grant_cannot_claim_another_scope_snapshot(self) -> None:
        with self.assertRaises(GrantRefused) as raised:
            verify(a_grant(), scope_hash="d" * 64)

        self.assertIn("scope", raised.exception.reason)

    def test_a_grant_that_pins_no_address_cannot_be_issued(self) -> None:
        with self.assertRaises(GrantRefused):
            a_grant(pinned_addresses=())


class Revocation(unittest.TestCase):
    def test_a_revoked_run_refuses_its_grants(self) -> None:
        with self.assertRaises(GrantRefused) as raised:
            verify(a_grant(), revoked_runs=frozenset({"run.0001"}))

        self.assertIn("revoked", raised.exception.reason)

    def test_revocation_is_checked_after_the_signature(self) -> None:
        # An unsigned document must not be able to learn which runs exist.
        grant = a_grant()
        grant["signature"] = "0" * 64

        with self.assertRaises(GrantRefused) as raised:
            verify(grant, revoked_runs=frozenset({"run.0001"}))

        self.assertIn("signature", raised.exception.reason)
        self.assertNotIn("revoked", raised.exception.reason)

    def test_a_revoked_grant_does_not_burn_its_nonce(self) -> None:
        cache = ReplayCache()

        with self.assertRaises(GrantRefused):
            verify(a_grant(), cache=cache, revoked_runs=frozenset({"run.0001"}))

        self.assertEqual(len(cache), 0)


if __name__ == "__main__":
    unittest.main()
