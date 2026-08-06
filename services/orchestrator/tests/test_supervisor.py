"""The sweep that stops runs which stopped reporting (E1-006)."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from audit.chain import AuditChain, AuditRefused, verify_chain  # noqa: E402
from runs.kill_switch import (  # noqa: E402
    HEARTBEAT_TIMEOUT_SECONDS,
    HeartbeatMonitor,
    KillSwitch,
    RunStopped,
)
from runs.state_machine import Run  # noqa: E402
from runs.supervisor import Supervisor  # noqa: E402

AUDIT_KEY = b"an-audit-chaining-key"
AT = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)
LATE = AT + timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS + 1)
EVERYTHING = {
    "scope-record", "scope-approval", "exposure-assertion", "pinned-addresses",
    "execution-grant", "operator-identity", "kill-authority", "adapter-exit",
    "ingestion-receipt", "teardown-complete", "refusal-reason",
}


class BrokenStore(AuditChain):
    def append(self, **_kwargs):  # type: ignore[override]
        raise AuditRefused("the audit store is unavailable")


def a_running_run(run_id: str) -> Run:
    run = Run(run_id=run_id)
    for step in ("validating", "ready", "running"):
        run.advance(step, satisfied=EVERYTHING)
    return run


def a_supervisor(chain: AuditChain | None = None) -> Supervisor:
    # `chain or default` would be wrong: AuditChain defines __len__, so an empty
    # chain is falsy and a deliberately broken store would be silently replaced
    # by a working one. That is exactly what happened when this was written.
    if chain is None:
        chain = AuditChain(key=AUDIT_KEY, actor="orchestrator.control")

    return Supervisor(
        chain=chain,
        switch=KillSwitch(),
        monitor=HeartbeatMonitor(),
    )


class Sweeping(unittest.TestCase):
    def test_a_silent_run_is_stopped_recorded_and_forgotten(self) -> None:
        supervisor = a_supervisor()
        run = a_running_run("run.0001")
        supervisor.watch(run, AT)

        report = supervisor.sweep(LATE)

        self.assertEqual(report.stopped, ("run.0001",))
        self.assertEqual(run.state, "cancelling")
        self.assertEqual(len(supervisor.chain), 1)
        self.assertEqual(supervisor.chain.entries[0]["action"], "run.killed")
        self.assertEqual(supervisor.watching(), {}, "the monitor kept watching")

    def test_a_reporting_run_is_left_alone(self) -> None:
        supervisor = a_supervisor()
        run = a_running_run("run.0001")
        supervisor.watch(run, AT)
        supervisor.monitor.beat("run.0001", AT + timedelta(seconds=20))

        report = supervisor.sweep(AT + timedelta(seconds=25))

        self.assertFalse(report)
        self.assertEqual(run.state, "running")

    def test_the_sweep_closes_the_monitor_leak(self) -> None:
        # The monitor grows for as long as runs are registered and never
        # forgotten. Forgetting belongs here: whoever kills a stale run is who
        # knows it has ended.
        supervisor = a_supervisor()

        for index in range(20):
            supervisor.watch(a_running_run(f"run.{index:04d}"), AT)

        self.assertEqual(len(supervisor.watching()), 20)

        supervisor.sweep(LATE)

        self.assertEqual(supervisor.watching(), {})

    def test_the_chain_still_verifies_after_a_sweep(self) -> None:
        supervisor = a_supervisor()
        for index in range(3):
            supervisor.watch(a_running_run(f"run.{index:04d}"), AT)

        supervisor.sweep(LATE)

        verify_chain(
            supervisor.chain.entries, AUDIT_KEY, expected_head=supervisor.chain.head_digest
        )


class TheRegistryIsBounded(unittest.TestCase):
    """The first version cleared the monitor and kept every Run object, which
    moved the leak rather than closing it."""

    def test_a_run_that_ended_normally_is_reaped(self) -> None:
        supervisor = a_supervisor()
        run = a_running_run("run.0001")
        supervisor.watch(run, AT)

        for step in ("finalizing", "completed"):
            run.advance(step, satisfied=EVERYTHING)

        supervisor.sweep(AT + timedelta(seconds=5))

        self.assertEqual(supervisor.tracked(), 0)
        self.assertEqual(supervisor.watching(), {})

    def test_a_swept_run_is_held_until_teardown_finishes(self) -> None:
        # A swept run sits in `cancelling`, which is not terminal: teardown has
        # not happened yet, and dropping it there would lose the thing that
        # still has work to do.
        supervisor = a_supervisor()
        run = a_running_run("run.0001")
        supervisor.watch(run, AT)

        supervisor.sweep(LATE)

        self.assertEqual(run.state, "cancelling")
        self.assertEqual(supervisor.tracked(), 1)

        run.advance("cancelled", satisfied=EVERYTHING)
        supervisor.sweep(LATE + timedelta(seconds=1))

        self.assertEqual(supervisor.tracked(), 0)

    def test_many_finished_runs_do_not_accumulate(self) -> None:
        supervisor = a_supervisor()

        for index in range(200):
            run = a_running_run(f"run.{index:04d}")
            supervisor.watch(run, AT)
            for step in ("finalizing", "completed"):
                run.advance(step, satisfied=EVERYTHING)

        supervisor.sweep(AT + timedelta(seconds=5))

        self.assertEqual(supervisor.tracked(), 0)

    def test_a_live_run_is_not_reaped(self) -> None:
        supervisor = a_supervisor()
        run = a_running_run("run.0001")
        supervisor.watch(run, AT)

        supervisor.sweep(AT + timedelta(seconds=5))

        self.assertEqual(supervisor.tracked(), 1)
        self.assertEqual(run.state, "running")


class OneBrokenRunDoesNotStopTheSweep(unittest.TestCase):
    def test_a_run_that_cannot_move_is_reported_and_the_rest_still_stop(self) -> None:
        # A sweep that gave up half-way would leave exactly the runs it had not
        # reached still going.
        supervisor = a_supervisor()
        supervisor.watch(a_running_run("run.0001"), AT)
        supervisor.watch(a_running_run("run.0002"), AT)

        # Watched but never registered as a run.
        supervisor.monitor.register("run.ghost", AT)

        report = supervisor.sweep(LATE)

        self.assertEqual(report.stopped, ("run.0001", "run.0002"))
        self.assertEqual(len(report.unstoppable), 1)
        self.assertIn("run.ghost", report.unstoppable[0])

    def test_a_run_the_switch_stopped_is_still_refused_afterwards(self) -> None:
        # The switch is engaged before the state machine moves, so a run whose
        # move fails is refused by every other caller anyway.
        supervisor = a_supervisor()
        supervisor.monitor.register("run.ghost", AT)

        supervisor.sweep(LATE)

        with self.assertRaises(RunStopped):
            supervisor.switch.assert_permitted("run.ghost")


class TheAsymmetry(unittest.TestCase):
    """Elsewhere a decision that cannot be recorded does not take effect. A kill
    is the opposite case: it is not privileged execution, it is the cessation of
    it, so refusing to stop a run because the stop could not be written down
    would cause the outcome the audit requirement exists to prevent."""

    def test_a_broken_audit_store_does_not_prevent_the_stop(self) -> None:
        supervisor = a_supervisor(BrokenStore(key=AUDIT_KEY, actor="orchestrator.control"))
        run = a_running_run("run.0001")
        supervisor.watch(run, AT)

        report = supervisor.sweep(LATE)

        self.assertEqual(report.stopped, ("run.0001",))
        self.assertEqual(run.state, "cancelling", "the run kept running")

    def test_the_failure_to_record_is_reported_not_swallowed(self) -> None:
        supervisor = a_supervisor(BrokenStore(key=AUDIT_KEY, actor="orchestrator.control"))
        supervisor.watch(a_running_run("run.0001"), AT)

        report = supervisor.sweep(LATE)

        self.assertEqual(len(report.unrecorded), 1)
        self.assertIn("unavailable", report.unrecorded[0])

    def test_every_run_stops_even_when_none_can_be_recorded(self) -> None:
        supervisor = a_supervisor(BrokenStore(key=AUDIT_KEY, actor="orchestrator.control"))
        runs = [a_running_run(f"run.{index:04d}") for index in range(5)]
        for run in runs:
            supervisor.watch(run, AT)

        report = supervisor.sweep(LATE)

        self.assertEqual(len(report.stopped), 5)
        self.assertEqual(len(report.unrecorded), 5)
        for run in runs:
            self.assertEqual(run.state, "cancelling")


class BothQuestionsInOnePlace(unittest.TestCase):
    def test_a_permitted_run_passes_both_checks(self) -> None:
        supervisor = a_supervisor()
        supervisor.watch(a_running_run("run.0001"), AT)

        supervisor.assert_permitted("run.0001", AT + timedelta(seconds=5))

    def test_a_stopped_run_is_refused(self) -> None:
        supervisor = a_supervisor()
        supervisor.watch(a_running_run("run.0001"), AT)
        supervisor.switch.engage("run.0001", reason="operator requested")

        with self.assertRaises(RunStopped):
            supervisor.assert_permitted("run.0001", AT + timedelta(seconds=5))

    def test_a_silent_run_is_refused_before_any_sweep_runs(self) -> None:
        # Neither question can be forgotten, because both are asked here.
        supervisor = a_supervisor()
        supervisor.watch(a_running_run("run.0001"), AT)

        with self.assertRaises(RunStopped) as raised:
            supervisor.assert_permitted("run.0001", LATE)

        self.assertIn("has not reported", raised.exception.reason)

    def test_an_unavailable_switch_refuses_before_the_heartbeat_is_consulted(self) -> None:
        supervisor = a_supervisor()
        supervisor.watch(a_running_run("run.0001"), AT)
        supervisor.switch.available = False

        with self.assertRaises(RunStopped) as raised:
            supervisor.assert_permitted("run.0001", AT + timedelta(seconds=5))

        self.assertIn("cannot be consulted", raised.exception.reason)


if __name__ == "__main__":
    unittest.main()
