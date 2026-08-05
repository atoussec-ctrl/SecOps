"""Run budgets, charged before the work and never after (backlog E1-005).

The scope contract bounds every budget above, so an excessive value cannot be
authorised. Nothing enforced them during a run, which meant the bound existed
only on paper.

Two decisions carry most of the weight.

**Charge on issue, not on completion.** A request is paid for before it leaves,
and a concurrency slot is taken before the adapter starts. Charging on the
response means a request that hangs, times out or is never read costs nothing —
and the scanner that exhausts a target is precisely the one whose responses stop
arriving. Current rate-limiting guidance says the same thing: reserve capacity
at ingress rather than egress.

**Exceeding is a refusal, not a warning.** `TM-D-001` in the threat model asks
for request, CPU, memory, byte and duration budgets against a scanner
exhausting the host or the target. A budget that logs and continues is a
description of what happened, not a limit.

The clock is injected, so a duration test describes an instant rather than
waiting for one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Final, Mapping

__all__ = ["BudgetExceeded", "RunBudget", "budgets_from_scope"]

_REQUIRED: Final = (
    "max_requests_per_second",
    "max_concurrency",
    "max_duration_seconds",
    "max_response_bytes",
    "max_test_records",
)


class BudgetExceeded(Exception):
    """A budget stopped the work. The reason is meant to reach an audit record."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def budgets_from_scope(scope: Mapping[str, object]) -> Mapping[str, int]:
    """Read the budgets a signed scope authorised.

    Refuses a scope that declares none rather than defaulting. A default budget
    is a budget nobody approved, and the scope record makes every one of these
    required precisely so there is nothing to default to.
    """
    declared = scope.get("budgets")

    if not isinstance(declared, Mapping):
        raise BudgetExceeded("the scope record declares no budgets")

    missing = [name for name in _REQUIRED if name not in declared]

    if missing:
        raise BudgetExceeded(f"the scope omits budgets: {', '.join(missing)}")

    for name in _REQUIRED:
        value = declared[name]

        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            raise BudgetExceeded(f"budget {name} is not a positive integer: {value!r}")

    return {name: int(declared[name]) for name in _REQUIRED}


@dataclass
class RunBudget:
    """What one run may spend, and what it has spent.

    The limits are read once from the signed scope and never change. Raising a
    budget mid-run would mean spending authority the scope did not grant, so
    there is no method that does it.
    """

    limits: Mapping[str, int]
    started_at: datetime

    _requests_this_second: int = 0
    _second: datetime | None = None
    _in_flight: int = 0
    _bytes: int = 0
    _records: int = 0
    _spent: bool = field(default=False, init=False)

    def _refuse(self, reason: str) -> None:
        # Once a budget stops a run, the run is over. Letting it continue after
        # one refusal would make the limit a speed bump.
        self._spent = True
        raise BudgetExceeded(reason)

    def _assert_live(self, now: datetime) -> None:
        if self._spent:
            raise BudgetExceeded("this run has already exhausted a budget")

        elapsed = (now - self.started_at).total_seconds()

        # Wall time, so a paused run keeps spending it. A pause suspends the
        # adapter and not the engagement window an operator authorised.
        if elapsed > self.limits["max_duration_seconds"]:
            self._refuse(
                f"run exceeded its {self.limits['max_duration_seconds']}s duration "
                f"budget after {int(elapsed)}s",
            )

    def reserve_request(self, now: datetime) -> None:
        """Pay for one request before it is issued."""
        self._assert_live(now)

        second = now.replace(microsecond=0)

        if self._second != second:
            self._second = second
            self._requests_this_second = 0

        if self._requests_this_second >= self.limits["max_requests_per_second"]:
            self._refuse(
                f"run exceeded its {self.limits['max_requests_per_second']} "
                "requests per second budget",
            )

        self._requests_this_second += 1

    def acquire_slot(self, now: datetime) -> None:
        """Take a concurrency slot before an adapter starts."""
        self._assert_live(now)

        if self._in_flight >= self.limits["max_concurrency"]:
            self._refuse(
                f"run exceeded its {self.limits['max_concurrency']} concurrency budget",
            )

        self._in_flight += 1

    def release_slot(self) -> None:
        """Give a slot back. Never below zero: a double release would create
        capacity the scope never granted."""
        self._in_flight = max(0, self._in_flight - 1)

    def charge_bytes(self, count: int, now: datetime) -> None:
        """Count response bytes as they arrive, refusing at the bound.

        Charged incrementally rather than on completion, so a response that
        never finishes still cannot exceed the budget by arriving slowly.
        """
        self._assert_live(now)

        if count < 0:
            raise BudgetExceeded(f"a negative byte count is not a measurement: {count}")

        self._bytes += count

        if self._bytes > self.limits["max_response_bytes"]:
            self._refuse(
                f"run exceeded its {self.limits['max_response_bytes']} response byte "
                f"budget at {self._bytes} bytes",
            )

    def charge_records(self, count: int, now: datetime) -> None:
        self._assert_live(now)

        if count < 0:
            raise BudgetExceeded(f"a negative record count is not a measurement: {count}")

        self._records += count

        if self._records > self.limits["max_test_records"]:
            self._refuse(
                f"run exceeded its {self.limits['max_test_records']} test record budget",
            )

    @property
    def spent(self) -> bool:
        return self._spent

    def remaining_seconds(self, now: datetime) -> int:
        """Never negative, so a caller cannot read an overrun as spare time."""
        deadline = self.started_at + timedelta(seconds=self.limits["max_duration_seconds"])

        return max(0, int((deadline - now).total_seconds()))
