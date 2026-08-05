"""The audit chain, and the tampering it is meant to locate (E1-005, ADR-013)."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from audit.chain import (  # noqa: E402
    GENESIS_DIGEST,
    AuditChain,
    AuditRefused,
    chain_digest,
    verify_chain,
)

KEY = b"an-audit-chaining-key-not-the-grant-key"
AT = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)


def a_chain(count: int = 3) -> AuditChain:
    chain = AuditChain(key=KEY, actor="orchestrator.control")

    for index in range(count):
        chain.append(
            entry_id=f"entry.{index:04d}",
            action="grant.refused",
            outcome="refused",
            subject=f"run.{index:04d}",
            facts=[{"name": "reason", "type": "reason_code", "value": "nonce_reused"}],
            occurred_at=AT + timedelta(seconds=index),
        )

    return chain


class Appending(unittest.TestCase):
    def test_the_first_entry_chains_from_genesis(self) -> None:
        chain = a_chain(1)

        self.assertEqual(chain.entries[0]["previous_digest"], GENESIS_DIGEST)
        self.assertEqual(chain.entries[0]["sequence"], 1)

    def test_each_entry_chains_from_the_one_before(self) -> None:
        chain = a_chain(5)

        for previous, entry in zip(chain.entries, chain.entries[1:]):
            self.assertEqual(entry["previous_digest"], previous["entry_digest"])
            self.assertEqual(entry["sequence"], previous["sequence"] + 1)

    def test_an_empty_chain_heads_at_genesis(self) -> None:
        self.assertEqual(AuditChain(key=KEY, actor="orchestrator.control").head_digest,
                         GENESIS_DIGEST)

    def test_a_complete_chain_verifies(self) -> None:
        chain = a_chain(4)
        verify_chain(chain.entries, KEY, expected_head=chain.head_digest)


class Tampering(unittest.TestCase):
    def test_an_edited_entry_is_located(self) -> None:
        chain = a_chain(4)
        chain.entries[1]["subject"] = "run.9999"

        with self.assertRaises(AuditRefused) as raised:
            verify_chain(chain.entries, KEY)

        self.assertIn("entry.0001", raised.exception.reason)
        self.assertIn("altered", raised.exception.reason)

    def test_a_removed_entry_is_detected(self) -> None:
        chain = a_chain(4)
        del chain.entries[1]

        with self.assertRaises(AuditRefused) as raised:
            verify_chain(chain.entries, KEY)

        self.assertIn("missing or reordered", raised.exception.reason)

    def test_reordered_entries_are_detected(self) -> None:
        chain = a_chain(4)
        chain.entries[1], chain.entries[2] = chain.entries[2], chain.entries[1]

        with self.assertRaises(AuditRefused):
            verify_chain(chain.entries, KEY)

    def test_a_re_signed_edit_still_breaks_the_next_link(self) -> None:
        # The interesting case. An attacker who holds the key can re-digest the
        # entry they edited; the entry after it still chains from the old value.
        chain = a_chain(4)
        chain.entries[1]["subject"] = "run.9999"
        chain.entries[1]["entry_digest"] = chain_digest(chain.entries[1], KEY)

        with self.assertRaises(AuditRefused) as raised:
            verify_chain(chain.entries, KEY)

        self.assertIn("does not chain from", raised.exception.reason)

    def test_a_chain_re_signed_end_to_end_is_not_detected_without_an_anchor(self) -> None:
        # Stated as a limit rather than left implied. Someone holding the key
        # can rebuild the whole chain, which is why the key is not the grant key
        # and why anchoring exists.
        chain = a_chain(4)
        chain.entries[1]["subject"] = "run.9999"
        previous = GENESIS_DIGEST

        for entry in chain.entries:
            entry["previous_digest"] = previous
            entry["entry_digest"] = chain_digest(entry, KEY)
            previous = entry["entry_digest"]

        verify_chain(chain.entries, KEY)

        with self.assertRaises(AuditRefused):
            verify_chain(chain.entries, KEY, expected_head="e" * 64)

    def test_a_foreign_key_does_not_verify(self) -> None:
        with self.assertRaises(AuditRefused):
            verify_chain(a_chain(3).entries, b"a-different-key")


class Truncation(unittest.TestCase):
    def test_a_truncated_chain_verifies_on_its_own(self) -> None:
        # The property that makes the anchor necessary. This is not a defect
        # being tolerated; it is a limit of hash chains, asserted so nobody
        # mistakes verification for completeness.
        chain = a_chain(5)
        head = chain.head_digest

        truncated = chain.entries[:3]
        verify_chain(truncated, KEY)

        with self.assertRaises(AuditRefused) as raised:
            verify_chain(truncated, KEY, expected_head=head)

        self.assertIn("removed from the end", raised.exception.reason)


class WhatCannotBeWritten(unittest.TestCase):
    def test_an_entry_with_no_facts_is_refused(self) -> None:
        with self.assertRaises(AuditRefused) as raised:
            a_chain(0).append(
                entry_id="entry.0000",
                action="grant.refused",
                outcome="refused",
                subject="run.0000",
                facts=[],
                occurred_at=AT,
            )

        self.assertIn("at least one fact", raised.exception.reason)

    def test_a_fact_cannot_carry_free_text_or_bytes(self) -> None:
        for fact_type in ("text", "string", "blob", "binary", "json"):
            with self.subTest(type=fact_type), self.assertRaises(AuditRefused):
                a_chain(0).append(
                    entry_id="entry.0000",
                    action="grant.refused",
                    outcome="refused",
                    subject="run.0000",
                    facts=[{"name": "body", "type": fact_type, "value": "x"}],
                    occurred_at=AT,
                )

    def test_a_fact_value_is_length_bounded(self) -> None:
        with self.assertRaises(AuditRefused):
            a_chain(0).append(
                entry_id="entry.0000",
                action="grant.refused",
                outcome="refused",
                subject="run.0000",
                facts=[{"name": "reason", "type": "reason_code", "value": "x" * 201}],
                occurred_at=AT,
            )

    def test_an_undeclared_action_is_refused(self) -> None:
        with self.assertRaises(AuditRefused) as raised:
            a_chain(0).append(
                entry_id="entry.0000",
                action="grant.quietly_ignored",
                outcome="allowed",
                subject="run.0000",
                facts=[{"name": "reason", "type": "reason_code", "value": "ok"}],
                occurred_at=AT,
            )

        self.assertIn("declared action", raised.exception.reason)

    def test_a_refused_entry_never_enters_the_chain(self) -> None:
        chain = a_chain(2)
        head = chain.head_digest

        with self.assertRaises(AuditRefused):
            chain.append(
                entry_id="entry.0002",
                action="grant.refused",
                outcome="refused",
                subject="run.0002",
                facts=[],
                occurred_at=AT,
            )

        self.assertEqual(len(chain), 2)
        self.assertEqual(chain.head_digest, head)
        verify_chain(chain.entries, KEY, expected_head=head)


if __name__ == "__main__":
    unittest.main()
