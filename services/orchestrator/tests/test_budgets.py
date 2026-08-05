"""Run budgets, and the ways a limit stops being one (E1-005)."""

from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from runs.budgets import BudgetExceeded, RunBudget, budgets_from_scope  # noqa: E402

AT = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)

LIMITS = {
    "max_requests_per_second": 5,
    "max_concurrency": 2,
    "max_duration_seconds": 60,
    "max_response_bytes": 1000,
    "max_test_records": 10,
}


def a_budget(**overrides) -> RunBudget:
    return RunBudget(limits={**LIMITS, **overrides}, started_at=AT)


class ReadingTheScope(unittest.TestCase):
    def test_the_sample_scope_declares_every_budget(self) -> None:
        scope = json.loads(
            (
                REPOSITORY_ROOT
                / "packages"
                / "contracts"
                / "security"
                / "samples"
                / "scope-record"
                / "lab-private-network.json"
            ).read_text(encoding="utf-8")
        )

        limits = budgets_from_scope(scope)

        self.assertEqual(sorted(limits), sorted(LIMITS))
        for value in limits.values():
            self.assertGreater(value, 0)

    def test_a_scope_without_budgets_is_refused_rather_than_defaulted(self) -> None:
        # A default budget is a budget nobody approved.
        for scope in ({}, {"budgets": {}}, {"budgets": {"max_concurrency": 2}}):
            with self.subTest(scope=scope), self.assertRaises(BudgetExceeded):
                budgets_from_scope(scope)

    def test_a_budget_that_is_not_a_positive_integer_is_refused(self) -> None:
        for bad in (0, -1, "5", 1.5, True, None):
            with self.subTest(bad=bad), self.assertRaises(BudgetExceeded):
                budgets_from_scope({"budgets": {**LIMITS, "max_concurrency": bad}})


class RequestsPerSecond(unittest.TestCase):
    def test_requests_are_paid_for_before_they_are_issued(self) -> None:
        budget = a_budget()

        for _ in range(5):
            budget.reserve_request(AT)

        with self.assertRaises(BudgetExceeded) as raised:
            budget.reserve_request(AT)

        self.assertIn("requests per second", raised.exception.reason)

    def test_the_allowance_refreshes_each_second(self) -> None:
        budget = a_budget()

        for _ in range(5):
            budget.reserve_request(AT)

        budget.reserve_request(AT + timedelta(seconds=1))

    def test_a_request_that_never_returns_still_costs(self) -> None:
        # The reason charging happens on issue. A scanner exhausting a target is
        # precisely the one whose responses stop arriving, so a budget charged
        # on completion would never fire.
        budget = a_budget()

        for _ in range(5):
            budget.reserve_request(AT)  # none of these completes

        with self.assertRaises(BudgetExceeded):
            budget.reserve_request(AT)


class Concurrency(unittest.TestCase):
    def test_a_slot_is_taken_before_the_adapter_starts(self) -> None:
        budget = a_budget()

        budget.acquire_slot(AT)
        budget.acquire_slot(AT)

        with self.assertRaises(BudgetExceeded) as raised:
            budget.acquire_slot(AT)

        self.assertIn("concurrency", raised.exception.reason)

    def test_releasing_a_slot_frees_it(self) -> None:
        budget = a_budget()

        budget.acquire_slot(AT)
        budget.acquire_slot(AT)
        budget.release_slot()
        budget.acquire_slot(AT)

    def test_a_double_release_cannot_create_capacity(self) -> None:
        # Otherwise a buggy adapter manufactures concurrency the scope never
        # granted, by releasing more often than it acquires.
        budget = a_budget()

        budget.acquire_slot(AT)
        budget.release_slot()
        budget.release_slot()
        budget.release_slot()

        budget.acquire_slot(AT)
        budget.acquire_slot(AT)

        with self.assertRaises(BudgetExceeded):
            budget.acquire_slot(AT)


class Duration(unittest.TestCase):
    def test_work_past_the_deadline_is_refused(self) -> None:
        budget = a_budget()

        budget.reserve_request(AT + timedelta(seconds=60))

        with self.assertRaises(BudgetExceeded) as raised:
            a_budget().reserve_request(AT + timedelta(seconds=61))

        self.assertIn("duration", raised.exception.reason)

    def test_a_pause_does_not_stop_the_clock(self) -> None:
        # The lifecycle says budgets keep accruing while paused, because the
        # engagement window an operator authorised is wall time.
        budget = a_budget()

        with self.assertRaises(BudgetExceeded):
            budget.reserve_request(AT + timedelta(seconds=120))

    def test_remaining_time_is_never_negative(self) -> None:
        budget = a_budget()

        self.assertEqual(budget.remaining_seconds(AT), 60)
        self.assertEqual(budget.remaining_seconds(AT + timedelta(seconds=59)), 1)
        self.assertEqual(budget.remaining_seconds(AT + timedelta(seconds=600)), 0)


class Bytes(unittest.TestCase):
    def test_bytes_are_charged_as_they_arrive(self) -> None:
        budget = a_budget()

        for _ in range(10):
            budget.charge_bytes(100, AT)

        with self.assertRaises(BudgetExceeded) as raised:
            budget.charge_bytes(1, AT)

        self.assertIn("response byte", raised.exception.reason)

    def test_a_slow_response_cannot_exceed_the_budget_by_arriving_late(self) -> None:
        budget = a_budget()

        with self.assertRaises(BudgetExceeded):
            for _ in range(1001):
                budget.charge_bytes(1, AT)

    def test_a_negative_count_is_not_a_measurement(self) -> None:
        # Otherwise a report of minus one thousand bytes buys back the budget.
        budget = a_budget()

        budget.charge_bytes(900, AT)

        with self.assertRaises(BudgetExceeded):
            budget.charge_bytes(-500, AT)


class Records(unittest.TestCase):
    def test_records_are_bounded(self) -> None:
        budget = a_budget()

        budget.charge_records(10, AT)

        with self.assertRaises(BudgetExceeded) as raised:
            a_budget().charge_records(11, AT)

        self.assertIn("test record", raised.exception.reason)

    def test_a_negative_record_count_is_refused(self) -> None:
        with self.assertRaises(BudgetExceeded):
            a_budget().charge_records(-1, AT)


class OnceSpentAlwaysSpent(unittest.TestCase):
    """A limit that only slows work down is not a limit."""

    def test_a_run_that_exceeded_a_budget_cannot_continue(self) -> None:
        budget = a_budget()

        with self.assertRaises(BudgetExceeded):
            budget.charge_records(11, AT)

        self.assertTrue(budget.spent)

        for attempt in (
            lambda: budget.reserve_request(AT),
            lambda: budget.acquire_slot(AT),
            lambda: budget.charge_bytes(1, AT),
            lambda: budget.charge_records(1, AT),
        ):
            with self.subTest(attempt=attempt), self.assertRaises(BudgetExceeded) as raised:
                attempt()

            self.assertIn("already exhausted", raised.exception.reason)

    def test_exceeding_one_budget_closes_all_of_them(self) -> None:
        budget = a_budget()

        with self.assertRaises(BudgetExceeded):
            budget.reserve_request(AT + timedelta(seconds=61))

        with self.assertRaises(BudgetExceeded):
            budget.charge_bytes(1, AT)


class NoWayToRaiseABudget(unittest.TestCase):
    def test_the_limits_come_from_the_scope_and_nothing_changes_them(self) -> None:
        # Raising a budget mid-run means spending authority the scope did not
        # grant, so there is no method that does it.
        budget = a_budget()

        self.assertFalse(
            [name for name in dir(budget) if name.startswith(("set_", "raise_", "grant_"))]
        )


if __name__ == "__main__":
    unittest.main()
