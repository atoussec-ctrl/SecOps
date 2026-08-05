"""Verify, record, commit — and what goes wrong in any other order (E1-005)."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from audit.chain import AuditChain, AuditRefused, verify_chain  # noqa: E402
from audit.recorder import UnrecordableDecision  # noqa: E402
from grants.authorisation import authorise  # noqa: E402
from grants.execution_grant import (  # noqa: E402
    GrantRefused,
    ReplayCache,
    issue_grant,
)

GRANT_KEY = b"a-symmetric-key-for-one-environment"
AUDIT_KEY = b"a-different-key-for-the-audit-chain"
TRUSTED = {"key.2026.08": GRANT_KEY}
SCOPE_HASH = "b" * 64
AT = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)


def a_grant(**overrides):
    arguments = {
        "grant_id": "grant.0001",
        "nonce": "a" * 32,
        "key_id": "key.2026.08",
        "key": GRANT_KEY,
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


def a_chain() -> AuditChain:
    return AuditChain(key=AUDIT_KEY, actor="orchestrator.control")


def accept(grant, *, chain, cache, at=None, entry_id="entry.0001", **overrides):
    arguments = {
        "chain": chain,
        "entry_id": entry_id,
        "trusted_keys": TRUSTED,
        "audience": "adapter.zap",
        "run_id": "run.0001",
        "scope_hash": SCOPE_HASH,
        "now": at or AT + timedelta(seconds=10),
        "replay_cache": cache,
    }
    arguments.update(overrides)
    return authorise(grant, **arguments)


class BrokenStore(AuditChain):
    def append(self, **_kwargs):  # type: ignore[override]
        raise AuditRefused("the audit store is unavailable")


class HappyPath(unittest.TestCase):
    def test_an_accepted_grant_is_recorded_and_consumed(self) -> None:
        chain, cache = a_chain(), ReplayCache()

        accept(a_grant(), chain=chain, cache=cache)

        self.assertEqual(len(chain), 1)
        self.assertEqual(chain.entries[0]["action"], "grant.verified")
        self.assertEqual(chain.entries[0]["outcome"], "allowed")
        self.assertEqual(len(cache), 1)
        verify_chain(chain.entries, AUDIT_KEY, expected_head=chain.head_digest)

    def test_a_grant_cannot_be_accepted_twice(self) -> None:
        chain, cache = a_chain(), ReplayCache()

        accept(a_grant(), chain=chain, cache=cache)

        with self.assertRaises(GrantRefused) as raised:
            accept(a_grant(), chain=chain, cache=cache, entry_id="entry.0002")

        self.assertIn("already been used", raised.exception.reason)


class TheOrderingDefect(unittest.TestCase):
    """A flapping audit store must not destroy valid grants.

    Consuming the nonce during verification meant the check burned it, the
    record failed, the operation was refused, and the grant could never be
    presented again. An outage in the store that exists to describe work became
    a way to prevent it.
    """

    def test_a_store_failure_leaves_the_grant_presentable(self) -> None:
        cache = ReplayCache()
        grant = a_grant()

        with self.assertRaises(UnrecordableDecision):
            accept(grant, chain=BrokenStore(key=AUDIT_KEY, actor="orchestrator.control"),
                   cache=cache)

        self.assertEqual(len(cache), 0, "the nonce was consumed by a refused acceptance")

        # The store recovers and the same grant is accepted, which is the whole
        # point of checking without consuming.
        chain = a_chain()
        accept(grant, chain=chain, cache=cache)
        self.assertEqual(len(chain), 1)

    def test_the_nonce_is_consumed_only_after_the_record_exists(self) -> None:
        chain, cache = a_chain(), ReplayCache()

        accept(a_grant(), chain=chain, cache=cache)

        self.assertEqual(len(chain), 1)
        self.assertEqual(len(cache), 1)


class RefusalsAreRecorded(unittest.TestCase):
    def test_a_refused_grant_leaves_a_refusal_entry(self) -> None:
        chain, cache = a_chain(), ReplayCache()

        with self.assertRaises(GrantRefused):
            accept(a_grant(), chain=chain, cache=cache, audience="adapter.other")

        self.assertEqual(len(chain), 1)
        self.assertEqual(chain.entries[0]["outcome"], "refused")
        self.assertEqual(len(cache), 0)

    def test_a_refusal_records_why(self) -> None:
        chain, cache = a_chain(), ReplayCache()

        with self.assertRaises(GrantRefused):
            accept(a_grant(), chain=chain, cache=cache,
                   revoked_runs=frozenset({"run.0001"}))

        reasons = [f["value"] for f in chain.entries[0]["facts"] if f["name"] == "reason"]
        self.assertEqual(len(reasons), 1)
        self.assertIn("revoked", reasons[0])

    def test_every_refusal_reason_reaches_the_chain(self) -> None:
        for label, overrides in (
            ("wrong audience", {"audience": "adapter.other"}),
            ("wrong run", {"run_id": "run.0002"}),
            ("wrong scope", {"scope_hash": "c" * 64}),
            ("expired", {"at": AT + timedelta(seconds=1000)}),
            ("revoked", {"revoked_runs": frozenset({"run.0001"})}),
        ):
            with self.subTest(label=label):
                chain, cache = a_chain(), ReplayCache()

                with self.assertRaises(GrantRefused):
                    accept(a_grant(), chain=chain, cache=cache, **overrides)

                self.assertEqual(chain.entries[0]["outcome"], "refused")
                self.assertEqual(len(cache), 0, "a refused grant burned its nonce")


class TheChainStaysVerifiable(unittest.TestCase):
    def test_a_mix_of_acceptances_and_refusals_verifies(self) -> None:
        chain, cache = a_chain(), ReplayCache()

        accept(a_grant(), chain=chain, cache=cache, entry_id="entry.0001")

        with self.assertRaises(GrantRefused):
            accept(a_grant(nonce="b" * 32), chain=chain, cache=cache,
                   entry_id="entry.0002", audience="adapter.other")

        accept(a_grant(nonce="c" * 32, grant_id="grant.0002"), chain=chain,
               cache=cache, entry_id="entry.0003")

        self.assertEqual(len(chain), 3)
        self.assertEqual(len(cache), 2)
        verify_chain(chain.entries, AUDIT_KEY, expected_head=chain.head_digest)


if __name__ == "__main__":
    unittest.main()
