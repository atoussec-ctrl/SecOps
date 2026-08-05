"""Audit-store failure blocks privileged execution (E1-005).

`04-orchestrator-spec.md` lists that as a safety test. The direction that
matters is an *allowed* decision whose record cannot be written: the check
passed, and the operation must still be refused, because a privileged action
nobody can later account for is worse than one that did not happen.
"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from audit.chain import AuditChain, AuditRefused, verify_chain  # noqa: E402
from audit.recorder import UnrecordableDecision, guard, record  # noqa: E402

KEY = b"an-audit-chaining-key"
AT = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)
FACTS = [{"name": "audience", "type": "identifier", "value": "adapter.zap"}]


def a_chain() -> AuditChain:
    return AuditChain(key=KEY, actor="orchestrator.control")


class BrokenStore(AuditChain):
    """A store that refuses every append, which is what unavailable looks like
    from the caller's side."""

    def append(self, **_kwargs):  # type: ignore[override]
        raise AuditRefused("the audit store is unavailable")


class AllowedDecisions(unittest.TestCase):
    def test_an_allowed_decision_is_recorded_and_returned(self) -> None:
        chain = a_chain()

        result = guard(
            chain,
            entry_id="entry.0001",
            action="grant.verified",
            subject="grant.0001",
            occurred_at=AT,
            facts=FACTS,
            decision=lambda: "proceed",
        )

        self.assertEqual(result, "proceed")
        self.assertEqual(len(chain), 1)
        self.assertEqual(chain.entries[0]["outcome"], "allowed")

    def test_an_allowed_decision_that_cannot_be_recorded_is_refused(self) -> None:
        # The requirement, stated directly. The check passed; the operation does
        # not happen, because nothing may act on a permission that was never
        # written down.
        acted = []

        with self.assertRaises(UnrecordableDecision) as raised:
            guard(
                BrokenStore(key=KEY, actor="orchestrator.control"),
                entry_id="entry.0001",
                action="grant.verified",
                subject="grant.0001",
                occurred_at=AT,
                facts=FACTS,
                decision=lambda: acted.append("ran") or "proceed",
            )

        self.assertIn("unavailable", raised.exception.reason)
        self.assertEqual(raised.exception.action, "grant.verified")

    def test_the_caller_never_receives_a_result_it_cannot_account_for(self) -> None:
        # UnrecordableDecision is raised rather than returned, so there is no
        # code path where a caller holds a result and no record of it.
        try:
            guard(
                BrokenStore(key=KEY, actor="orchestrator.control"),
                entry_id="entry.0001",
                action="adapter.invoked",
                subject="run.0001",
                occurred_at=AT,
                facts=FACTS,
                decision=lambda: "a result",
            )
        except UnrecordableDecision:
            return

        self.fail("guard returned a result that was never recorded")


class RefusedDecisions(unittest.TestCase):
    def test_a_refusal_is_recorded_and_re_raised(self) -> None:
        chain = a_chain()

        class Refused(Exception):
            reason = "nonce has already been used"

        with self.assertRaises(Refused):
            guard(
                chain,
                entry_id="entry.0001",
                action="grant.refused",
                subject="grant.0001",
                occurred_at=AT,
                facts=FACTS,
                decision=_raise(Refused()),
            )

        self.assertEqual(len(chain), 1)
        self.assertEqual(chain.entries[0]["outcome"], "refused")

        reasons = [
            fact["value"]
            for fact in chain.entries[0]["facts"]
            if fact["name"] == "reason"
        ]
        self.assertEqual(reasons, ["nonce has already been used"])

    def test_a_refusal_survives_a_broken_store(self) -> None:
        # A refusal that cannot be recorded is still a refusal. Converting it
        # into a different error would hide why the operation stopped.
        class Refused(Exception):
            reason = "signature does not verify"

        with self.assertRaises(Refused):
            guard(
                BrokenStore(key=KEY, actor="orchestrator.control"),
                entry_id="entry.0001",
                action="grant.refused",
                subject="grant.0001",
                occurred_at=AT,
                facts=FACTS,
                decision=_raise(Refused()),
            )

    def test_a_long_reason_is_truncated_rather_than_widening_the_contract(self) -> None:
        # The fact vocabulary has no free-text type on purpose. A reason written
        # for a person must not become the field the contract deliberately lacks.
        chain = a_chain()

        class Refused(Exception):
            reason = "x" * 500

        with self.assertRaises(Refused):
            guard(
                chain,
                entry_id="entry.0001",
                action="address.refused",
                subject="run.0001",
                occurred_at=AT,
                facts=FACTS,
                decision=_raise(Refused()),
            )

        recorded = [f for f in chain.entries[0]["facts"] if f["name"] == "reason"][0]
        self.assertEqual(len(recorded["value"]), 200)

    def test_an_exception_without_a_reason_still_records_something(self) -> None:
        chain = a_chain()

        with self.assertRaises(ZeroDivisionError):
            guard(
                chain,
                entry_id="entry.0001",
                action="adapter.refused",
                subject="run.0001",
                occurred_at=AT,
                facts=FACTS,
                decision=_raise(ZeroDivisionError()),
            )

        recorded = [f for f in chain.entries[0]["facts"] if f["name"] == "reason"][0]
        self.assertEqual(recorded["value"], "ZeroDivisionError")


class TheChainStaysValid(unittest.TestCase):
    def test_a_mix_of_outcomes_still_verifies(self) -> None:
        chain = a_chain()

        class Refused(Exception):
            reason = "out of scope"

        guard(chain, entry_id="entry.0001", action="scope.approved", subject="eng.0001",
              occurred_at=AT, facts=FACTS, decision=lambda: None)

        with self.assertRaises(Refused):
            guard(chain, entry_id="entry.0002", action="address.refused",
                  subject="run.0001", occurred_at=AT, facts=FACTS,
                  decision=_raise(Refused()))

        guard(chain, entry_id="entry.0003", action="grant.issued", subject="grant.0001",
              occurred_at=AT, facts=FACTS, decision=lambda: None)

        self.assertEqual(len(chain), 3)
        verify_chain(chain.entries, KEY, expected_head=chain.head_digest)

    def test_record_reports_a_store_failure_distinctly(self) -> None:
        with self.assertRaises(UnrecordableDecision):
            record(
                BrokenStore(key=KEY, actor="orchestrator.control"),
                entry_id="entry.0001",
                action="run.started",
                outcome="allowed",
                subject="run.0001",
                facts=FACTS,
                occurred_at=AT,
            )


def _raise(error: Exception):
    def decision():
        raise error

    return decision


if __name__ == "__main__":
    unittest.main()
