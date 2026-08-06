"""Stopping the runs that stopped reporting (backlog E1-006).

`HeartbeatMonitor.stale` names the runs that should be stopped and stops
nothing. This is what acts on that list: engage the kill switch, move the state
machine, write the audit entry, and stop watching.

### The asymmetry worth getting right

Everywhere else in this service, a decision that cannot be recorded does not
take effect — `04-orchestrator-spec.md` requires audit-store failure to block
privileged execution, and `audit.recorder.guard` enforces it.

**A kill is the opposite case.** It is not privileged execution; it is the
cessation of it. Refusing to stop a run because the stop could not be written
down would leave a run executing that nobody wanted executing, which is the
outcome the audit requirement exists to prevent rather than to cause.

So the stop happens first and the record is attempted after. A failed record is
raised to the caller once every run has been stopped, so an operator learns the
audit store is broken **and** the dangerous work has already ended.

### Forgetting is part of stopping

The monitor grows for as long as runs are registered and never forgotten. That
leak belongs here rather than in the monitor: whoever kills a stale run is who
knows it has ended.

The same applies to the supervisor's own registry, and the first version got it
wrong: it cleared the monitor and kept every `Run` object, which moved the leak
rather than closing it. A run that reached a terminal state is over however it
got there — swept, cancelled or completed normally — so every sweep reaps them
all, not only the ones it stopped itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Mapping

from audit.chain import AuditChain
from audit.recorder import UnrecordableDecision, record

from .kill_switch import HeartbeatMonitor, KillSwitch, RunStopped
from .state_machine import Run, RunRefused

__all__ = ["Supervisor", "SweepReport"]


@dataclass(frozen=True)
class SweepReport:
    """What one sweep did, in enough detail for an operator to act on."""

    stopped: tuple[str, ...] = ()
    unrecorded: tuple[str, ...] = ()
    unstoppable: tuple[str, ...] = ()

    def __bool__(self) -> bool:
        return bool(self.stopped or self.unrecorded or self.unstoppable)


@dataclass
class Supervisor:
    """Ties the heartbeat, the kill switch, the state machine and the audit."""

    chain: AuditChain
    switch: KillSwitch
    monitor: HeartbeatMonitor
    runs: dict[str, Run] = field(default_factory=dict)
    _sequence: int = 0

    def watch(self, run: Run, now: datetime) -> None:
        self.runs[run.run_id] = run
        self.monitor.register(run.run_id, now)

    def sweep(self, now: datetime) -> SweepReport:
        """Stop every run that has stopped reporting.

        Returns what happened rather than raising per run: one broken run must
        not prevent the next one being stopped, and a sweep that gave up
        half-way would leave exactly the runs it had not reached still going.
        """
        stopped: list[str] = []
        unrecorded: list[str] = []
        unstoppable: list[str] = []

        for run_id in self.monitor.stale(now):
            reason = f"no heartbeat within {self.monitor.timeout_seconds}s"

            try:
                self._stop(run_id, reason=reason, now=now)
            except RunRefused as refusal:
                # The state machine would not move. Recorded and reported: this
                # is a run that should have stopped and did not, which is the
                # thing an operator most needs to know.
                unstoppable.append(f"{run_id}: {refusal.reason}")
                continue

            stopped.append(run_id)

            try:
                self._record(run_id, reason=reason, now=now)
            except UnrecordableDecision as failure:
                # The run is already stopped. Reported, not raised here, so the
                # remaining stale runs are still dealt with.
                unrecorded.append(f"{run_id}: {failure.reason}")

            self.monitor.forget(run_id)

        # Runs that ended without the sweep's help are dropped here too. Most
        # runs finish normally, so reaping only what this sweep stopped would
        # leave the registry growing for the common case.
        self._reap()

        return SweepReport(tuple(stopped), tuple(unrecorded), tuple(unstoppable))

    def _reap(self) -> None:
        for run_id in [
            run_id for run_id, run in self.runs.items() if run.finished
        ]:
            del self.runs[run_id]
            self.monitor.forget(run_id)

    def _stop(self, run_id: str, *, reason: str, now: datetime) -> None:
        # The switch first, so a run stopped here is refused by every other
        # caller even if the state machine move fails below.
        self.switch.engage(run_id, reason=reason)

        run = self.runs.get(run_id)

        if run is None:
            # Watched but not registered as a run. The switch entry above still
            # stands, so nothing can proceed under that id.
            raise RunRefused(f"run {run_id} is watched but not known to the supervisor")

        run.kill(satisfied={"kill-authority", "refusal-reason"})

    def _record(self, run_id: str, *, reason: str, now: datetime) -> None:
        self._sequence += 1

        record(
            self.chain,
            entry_id=f"sweep.{self._sequence:06d}",
            action="run.killed",
            outcome="refused",
            subject=run_id,
            facts=[
                {"name": "reason", "type": "reason_code", "value": "heartbeat_lost"},
                {
                    "name": "timeout_seconds",
                    "type": "integer",
                    "value": str(self.monitor.timeout_seconds),
                },
                {"name": "detail", "type": "label", "value": reason},
            ],
            occurred_at=now,
        )

    def assert_permitted(self, run_id: str, now: datetime) -> None:
        """Everything a caller must check before letting a run continue.

        Both questions in one place so neither is forgotten: the switch may have
        stopped this run, and the adapter may have gone silent.
        """
        self.switch.assert_permitted(run_id)
        self.monitor.assert_alive(run_id, now)

    def watching(self) -> Mapping[str, datetime]:
        return self.monitor.watching()

    def tracked(self) -> int:
        """How many runs the supervisor still holds. Bounded by design."""
        return len(self.runs)
