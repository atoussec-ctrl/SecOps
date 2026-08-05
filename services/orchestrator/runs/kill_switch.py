"""The global kill and the adapter heartbeat (backlog E1-006).

`09-tool-safety-guardrails.md` asks for "heartbeat, cancellation and global kill
support", and `04-orchestrator-spec.md` lists "adapter heartbeat loss and
partial output" among the safety tests.

Two shapes here are chosen rather than inherited, and both are the fail-closed
reading of an underspecified requirement.

**A boolean cannot carry "cannot tell".** `is_revoked` returning `False` when
the switch is unreachable is indistinguishable from `False` meaning permitted,
and the caller proceeds. So the question is asked as `assert_permitted`, which
raises for a revoked run *and* for a switch that cannot answer. Conflict 19
records why: `08-observability.md` asks for an alert when the kill switch is
unavailable and never says whether work stops, and a run that cannot be stopped
is the definition of unsafe.

**Absence of a heartbeat is a stop signal, not a neutral state.** The classic
mistake is treating "has never beaten" as healthy because there is no previous
beat to compare against. Registration therefore records the moment as the first
beat, so an adapter that never reports goes stale on exactly the same schedule
as one that stopped reporting.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Final, Mapping

__all__ = [
    "HEARTBEAT_INTERVAL_SECONDS",
    "HEARTBEAT_TIMEOUT_SECONDS",
    "HeartbeatMonitor",
    "KillSwitch",
    "RunStopped",
    "SwitchUnavailable",
]

# An adapter reports this often while it works.
HEARTBEAT_INTERVAL_SECONDS: Final = 10

# And is presumed lost after this long without a report. Three intervals: one
# lost beat must not kill a healthy run, and a stale adapter has to be noticed
# well before its grant would have expired anyway, or the heartbeat adds
# nothing the grant window was not already doing.
HEARTBEAT_TIMEOUT_SECONDS: Final = 30

# The grant maximum from ADR-012. Kept here as the upper bound the timeout has
# to stay under, so the relationship is checked rather than remembered.
_GRANT_MAXIMUM_LIFETIME_SECONDS: Final = 300


class RunStopped(Exception):
    """A run may not proceed. The reason is meant to reach an audit record."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class SwitchUnavailable(RunStopped):
    """The kill switch could not be consulted.

    A subclass of `RunStopped` on purpose: every caller that stops for a
    revoked run also stops for a switch it cannot reach, and a caller that
    wants to tell them apart still can.
    """


@dataclass
class KillSwitch:
    """Which runs have been stopped, and whether that can be known at all."""

    available: bool = True
    _stopped: dict[str, str] = field(default_factory=dict)
    _everything: str | None = None

    def engage(self, run_id: str, *, reason: str) -> None:
        """Stop one run. Idempotent: pressing it twice is not an error."""
        if not reason:
            # A stop with no reason cannot be reviewed afterwards, and the audit
            # entry has nowhere to record why the work ended.
            raise RunStopped(f"stopping {run_id} needs a reason")

        self._stopped.setdefault(run_id, reason)

    def engage_globally(self, *, reason: str) -> None:
        """Stop everything, including runs that do not exist yet.

        A global kill that only covered known runs would let one started a
        moment later proceed, which is the case an operator is reaching for the
        switch to prevent.
        """
        if not reason:
            raise RunStopped("a global stop needs a reason")

        if self._everything is None:
            self._everything = reason

    def assert_permitted(self, run_id: str) -> None:
        """Raise unless ``run_id`` may proceed.

        There is no boolean here on purpose. `False` from an unreachable switch
        reads exactly like `False` from a healthy one, and the caller proceeds.
        """
        if not self.available:
            raise SwitchUnavailable(
                "the kill switch cannot be consulted, so no run may proceed",
            )

        if self._everything is not None:
            raise RunStopped(f"a global stop is in force: {self._everything}")

        if run_id in self._stopped:
            raise RunStopped(f"run {run_id} was stopped: {self._stopped[run_id]}")

    def reason_for(self, run_id: str) -> str | None:
        """Why a run was stopped, for the audit entry. Never used to decide."""
        return self._everything or self._stopped.get(run_id)


@dataclass
class HeartbeatMonitor:
    """When each run last reported, and when that stopped being recent enough."""

    timeout_seconds: int = HEARTBEAT_TIMEOUT_SECONDS
    _last_beat: dict[str, datetime] = field(default_factory=dict)

    # Runs observed past their timeout. Latched on purpose: a sweep that sees a
    # run stale and is beaten to the kill by a late report would never act, and
    # an adapter that is intermittently silent would evade the control for as
    # long as it liked. Breaching the timeout is the adapter's doing; whether
    # the run continues is the operator's, so only `forget` clears this.
    _missed: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        # Both bounds asserted rather than commented. A timeout under two
        # intervals kills a healthy run on one lost beat; a timeout over the
        # grant maximum detects nothing the grant window had not already ended.
        if self.timeout_seconds < 2 * HEARTBEAT_INTERVAL_SECONDS:
            raise RunStopped(
                f"a {self.timeout_seconds}s timeout is under two "
                f"{HEARTBEAT_INTERVAL_SECONDS}s intervals, so one lost beat "
                "would stop a healthy run",
            )

        if self.timeout_seconds >= _GRANT_MAXIMUM_LIFETIME_SECONDS:
            raise RunStopped(
                f"a {self.timeout_seconds}s timeout is not shorter than the "
                f"{_GRANT_MAXIMUM_LIFETIME_SECONDS}s grant maximum, so a lost "
                "adapter would outlive its own authorisation before being noticed",
            )

    def register(self, run_id: str, now: datetime) -> None:
        """Start watching a run, counting from this moment.

        Registration is itself the first beat. An adapter that never reports
        then goes stale on the same schedule as one that stopped reporting,
        instead of looking healthy because there is nothing to compare against.
        """
        self._last_beat[run_id] = now

    def beat(self, run_id: str, now: datetime) -> None:
        if run_id not in self._last_beat:
            raise RunStopped(f"run {run_id} is not being watched")

        if run_id in self._missed:
            raise RunStopped(
                f"run {run_id} already missed its heartbeat; a late report does "
                "not revive it",
            )

        # Detected here as well as in the sweep, because this is the earliest
        # moment the breach is visible and the sweep may not run before it.
        if (now - self._last_beat[run_id]).total_seconds() > self.timeout_seconds:
            self._missed.add(run_id)
            raise RunStopped(
                f"run {run_id} reported after its {self.timeout_seconds}s timeout",
            )

        if now < self._last_beat[run_id]:
            # A beat from before the last one is not a report, it is a clock
            # problem or a replayed message, and accepting it would extend the
            # window backwards.
            raise RunStopped(f"run {run_id} reported a heartbeat out of order")

        self._last_beat[run_id] = now

    def assert_alive(self, run_id: str, now: datetime) -> None:
        last = self._last_beat.get(run_id)

        if last is None:
            raise RunStopped(f"run {run_id} is not being watched")

        silent = (now - last).total_seconds()

        if silent > self.timeout_seconds or run_id in self._missed:
            self._missed.add(run_id)
            raise RunStopped(
                f"run {run_id} has not reported for {int(silent)}s, past its "
                f"{self.timeout_seconds}s heartbeat timeout",
            )

    def forget(self, run_id: str) -> None:
        """Stop watching a run that has ended.

        The only way a latched miss is cleared. A run that ended has been
        accounted for; one that merely started reporting again has not.
        """
        self._last_beat.pop(run_id, None)
        self._missed.discard(run_id)

    def stale(self, now: datetime) -> list[str]:
        """Every run that should be stopped, so a sweep can act on all of them."""
        horizon = now - timedelta(seconds=self.timeout_seconds)

        for run_id, last in self._last_beat.items():
            if last < horizon:
                self._missed.add(run_id)

        return sorted(self._missed)

    def watching(self) -> Mapping[str, datetime]:
        return dict(self._last_beat)

    def missed(self, run_id: str) -> bool:
        """Whether this run has ever been observed past its timeout."""
        return run_id in self._missed
