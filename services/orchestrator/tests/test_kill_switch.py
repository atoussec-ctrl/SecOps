"""The global kill and the adapter heartbeat (E1-006)."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from runs.kill_switch import (  # noqa: E402
    HEARTBEAT_INTERVAL_SECONDS,
    HEARTBEAT_TIMEOUT_SECONDS,
    HeartbeatMonitor,
    KillSwitch,
    RunStopped,
    SwitchUnavailable,
)

AT = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)


class Stopping(unittest.TestCase):
    def test_a_run_proceeds_until_it_is_stopped(self) -> None:
        switch = KillSwitch()

        switch.assert_permitted("run.0001")

        switch.engage("run.0001", reason="operator requested")

        with self.assertRaises(RunStopped) as raised:
            switch.assert_permitted("run.0001")

        self.assertIn("operator requested", raised.exception.reason)

    def test_stopping_one_run_leaves_the_others_alone(self) -> None:
        switch = KillSwitch()
        switch.engage("run.0001", reason="operator requested")

        switch.assert_permitted("run.0002")

    def test_pressing_it_twice_is_not_an_error(self) -> None:
        switch = KillSwitch()

        switch.engage("run.0001", reason="operator requested")
        switch.engage("run.0001", reason="operator requested again")

        # The first reason stands: it is what actually stopped the run.
        self.assertEqual(switch.reason_for("run.0001"), "operator requested")

    def test_a_stop_without_a_reason_is_refused(self) -> None:
        # A stop nobody can review afterwards, and an audit entry with nowhere
        # to record why the work ended.
        with self.assertRaises(RunStopped):
            KillSwitch().engage("run.0001", reason="")


class GlobalKill(unittest.TestCase):
    def test_a_global_stop_covers_every_run(self) -> None:
        switch = KillSwitch()
        switch.engage_globally(reason="lab exposure detected")

        for run_id in ("run.0001", "run.0002", "run.9999"):
            with self.subTest(run_id=run_id), self.assertRaises(RunStopped) as raised:
                switch.assert_permitted(run_id)

            self.assertIn("global stop", raised.exception.reason)

    def test_a_global_stop_covers_runs_that_do_not_exist_yet(self) -> None:
        # The case an operator reaches for the switch to prevent. A global kill
        # that only covered known runs would let one started a moment later
        # proceed.
        switch = KillSwitch()
        switch.engage_globally(reason="lab exposure detected")

        with self.assertRaises(RunStopped):
            switch.assert_permitted("run.started.after.the.kill")

    def test_a_global_stop_without_a_reason_is_refused(self) -> None:
        with self.assertRaises(RunStopped):
            KillSwitch().engage_globally(reason="")


class TheSwitchItselfFailing(unittest.TestCase):
    """Conflict 19. The specification asks for an alert and does not say whether
    work stops, and a run that cannot be stopped is the definition of unsafe."""

    def test_an_unreachable_switch_stops_every_run(self) -> None:
        switch = KillSwitch(available=False)

        with self.assertRaises(SwitchUnavailable) as raised:
            switch.assert_permitted("run.0001")

        self.assertIn("cannot be consulted", raised.exception.reason)

    def test_unavailability_is_a_kind_of_stop(self) -> None:
        # A caller that stops for a revoked run stops for an unreachable switch
        # too, without having to know about both.
        switch = KillSwitch(available=False)

        with self.assertRaises(RunStopped):
            switch.assert_permitted("run.0001")

    def test_there_is_no_boolean_that_could_read_as_permitted(self) -> None:
        # False from an unreachable switch reads exactly like False from a
        # healthy one, and the caller proceeds. So the question is not asked
        # that way.
        self.assertFalse(hasattr(KillSwitch(), "is_revoked"))


class Heartbeats(unittest.TestCase):
    def test_a_reporting_run_stays_alive(self) -> None:
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)

        for tick in range(1, 10):
            moment = AT + timedelta(seconds=tick * HEARTBEAT_INTERVAL_SECONDS)
            monitor.beat("run.0001", moment)
            monitor.assert_alive("run.0001", moment)

    def test_one_lost_beat_does_not_stop_a_healthy_run(self) -> None:
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)

        monitor.assert_alive(
            "run.0001", AT + timedelta(seconds=2 * HEARTBEAT_INTERVAL_SECONDS)
        )

    def test_silence_past_the_timeout_stops_the_run(self) -> None:
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)

        with self.assertRaises(RunStopped) as raised:
            monitor.assert_alive(
                "run.0001", AT + timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS + 1)
            )

        self.assertIn("has not reported", raised.exception.reason)

    def test_an_adapter_that_never_reports_goes_stale_on_schedule(self) -> None:
        # The mistake this guards: treating "has never beaten" as healthy
        # because there is no previous beat to compare against. Registration is
        # itself the first beat.
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)

        with self.assertRaises(RunStopped):
            monitor.assert_alive(
                "run.0001", AT + timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS + 1)
            )

    def test_an_unwatched_run_is_not_assumed_alive(self) -> None:
        with self.assertRaises(RunStopped) as raised:
            HeartbeatMonitor().assert_alive("run.0001", AT)

        self.assertIn("not being watched", raised.exception.reason)

    def test_a_beat_out_of_order_is_refused(self) -> None:
        # A beat from before the last one is a clock problem or a replayed
        # message, and accepting it would extend the window backwards.
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)
        monitor.beat("run.0001", AT + timedelta(seconds=5))

        with self.assertRaises(RunStopped) as raised:
            monitor.beat("run.0001", AT + timedelta(seconds=1))

        self.assertIn("out of order", raised.exception.reason)

    def test_a_beat_for_an_unwatched_run_is_refused(self) -> None:
        with self.assertRaises(RunStopped):
            HeartbeatMonitor().beat("run.0001", AT)

    def test_a_sweep_finds_every_stale_run_at_once(self) -> None:
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)
        monitor.register("run.0002", AT)
        monitor.register("run.0003", AT)

        monitor.beat("run.0002", AT + timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS))

        stale = monitor.stale(AT + timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS + 1))

        self.assertEqual(stale, ["run.0001", "run.0003"])

    def test_a_finished_run_stops_being_watched(self) -> None:
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)
        monitor.forget("run.0001")

        self.assertEqual(monitor.watching(), {})
        self.assertEqual(monitor.stale(AT + timedelta(days=1)), [])


class StalenessLatches(unittest.TestCase):
    """The race this closes: a sweep sees a run stale, and before it acts the
    adapter reports again. Without a latch the kill never happens, and an
    intermittently silent adapter evades the control for as long as it likes."""

    def test_a_late_report_does_not_revive_a_stale_run(self) -> None:
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)
        late = AT + timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS + 1)

        self.assertEqual(monitor.stale(late), ["run.0001"])

        with self.assertRaises(RunStopped) as raised:
            monitor.beat("run.0001", late)

        self.assertIn("does not revive", raised.exception.reason)
        self.assertEqual(monitor.stale(late), ["run.0001"])

    def test_a_beat_after_the_timeout_latches_even_without_a_sweep(self) -> None:
        # The sweep may not have run yet. The breach is visible here first.
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)

        with self.assertRaises(RunStopped) as raised:
            monitor.beat("run.0001", AT + timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS + 1))

        self.assertIn("reported after its", raised.exception.reason)
        self.assertTrue(monitor.missed("run.0001"))

    def test_an_intermittently_silent_adapter_cannot_evade_the_control(self) -> None:
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)
        moment = AT

        for _ in range(3):
            moment += timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS + 1)
            with self.assertRaises(RunStopped):
                monitor.beat("run.0001", moment)

        self.assertEqual(monitor.stale(moment), ["run.0001"])

    def test_a_healthy_run_is_never_latched(self) -> None:
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)

        for tick in range(1, 20):
            monitor.beat("run.0001", AT + timedelta(seconds=tick * HEARTBEAT_INTERVAL_SECONDS))

        self.assertFalse(monitor.missed("run.0001"))
        self.assertEqual(monitor.stale(AT + timedelta(seconds=19 * HEARTBEAT_INTERVAL_SECONDS)), [])

    def test_only_forgetting_clears_a_latch(self) -> None:
        # A run that ended has been accounted for; one that merely started
        # reporting again has not.
        monitor = HeartbeatMonitor()
        monitor.register("run.0001", AT)
        monitor.stale(AT + timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS + 1))

        self.assertTrue(monitor.missed("run.0001"))

        monitor.forget("run.0001")

        self.assertFalse(monitor.missed("run.0001"))
        self.assertEqual(monitor.stale(AT + timedelta(days=1)), [])


class TheTimeoutIsBounded(unittest.TestCase):
    def test_a_timeout_under_two_intervals_is_refused(self) -> None:
        # One lost beat would stop a healthy run.
        with self.assertRaises(RunStopped) as raised:
            HeartbeatMonitor(timeout_seconds=2 * HEARTBEAT_INTERVAL_SECONDS - 1)

        self.assertIn("one lost beat", raised.exception.reason)

    def test_a_timeout_past_the_grant_maximum_is_refused(self) -> None:
        # A lost adapter would outlive its own authorisation before anyone
        # noticed, so the heartbeat would add nothing the grant window was not
        # already doing.
        with self.assertRaises(RunStopped) as raised:
            HeartbeatMonitor(timeout_seconds=300)

        self.assertIn("grant maximum", raised.exception.reason)

    def test_the_default_sits_inside_both_bounds(self) -> None:
        self.assertGreaterEqual(HEARTBEAT_TIMEOUT_SECONDS, 2 * HEARTBEAT_INTERVAL_SECONDS)
        self.assertLess(HEARTBEAT_TIMEOUT_SECONDS, 300)


if __name__ == "__main__":
    unittest.main()
