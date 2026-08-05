"""The run state machine and the properties that keep it honest (E1-005)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from runs.state_machine import Run, RunRefused, load_lifecycle  # noqa: E402

LIFECYCLE = load_lifecycle()
TERMINAL = {e["state"] for e in LIFECYCLE["states"] if e["terminal"]}
EVERYTHING = {
    "scope-record", "scope-approval", "exposure-assertion", "pinned-addresses",
    "execution-grant", "operator-identity", "kill-authority", "adapter-exit",
    "ingestion-receipt", "teardown-complete", "refusal-reason",
}


def a_run(state: str = "") -> Run:
    return Run(run_id="run.0001", state=state)


def drive(run: Run, *path: str) -> Run:
    for step in path:
        run.advance(step, satisfied=EVERYTHING)
    return run


class TheTable(unittest.TestCase):
    def test_a_run_starts_in_the_declared_initial_state(self) -> None:
        self.assertEqual(a_run().state, LIFECYCLE["initial_state"])

    def test_every_state_is_reachable_from_the_initial_one(self) -> None:
        reached = {LIFECYCLE["initial_state"]}
        changed = True

        while changed:
            changed = False
            for transition in LIFECYCLE["transitions"]:
                if transition["from"] in reached and transition["to"] not in reached:
                    reached.add(transition["to"])
                    changed = True

        declared = {entry["state"] for entry in LIFECYCLE["states"]}
        self.assertEqual(declared - reached, set(), "unreachable states")

    def test_a_terminal_state_has_no_exit(self) -> None:
        # The difference from the finding lifecycle, where terminal means a
        # resting place that new evidence can leave. A run that finished is
        # finished.
        for transition in LIFECYCLE["transitions"]:
            self.assertNotIn(
                transition["from"], TERMINAL,
                f"{transition['from']} is terminal but leaves to {transition['to']}",
            )

    def test_every_non_terminal_state_has_a_way_out(self) -> None:
        origins = {t["from"] for t in LIFECYCLE["transitions"]}

        for entry in LIFECYCLE["states"]:
            if not entry["terminal"]:
                self.assertIn(entry["state"], origins, f"{entry['state']} strands")

    def test_no_transition_is_unconditional(self) -> None:
        for transition in LIFECYCLE["transitions"]:
            self.assertTrue(
                transition["requires"],
                f"{transition['from']} -> {transition['to']} requires nothing",
            )


class OnlyCompletedMeansSuccess(unittest.TestCase):
    """04-orchestrator-spec.md: an exit code of zero is insufficient."""

    def test_completed_demands_an_ingestion_receipt(self) -> None:
        run = drive(a_run(), "validating", "ready", "running", "finalizing")

        with self.assertRaises(RunRefused) as raised:
            run.advance("completed", satisfied=EVERYTHING - {"ingestion-receipt"})

        self.assertIn("ingestion-receipt", raised.exception.reason)
        self.assertEqual(run.state, "finalizing", "a refused transition moved the run")

    def test_a_clean_exit_without_a_receipt_ends_incomplete(self) -> None:
        run = drive(a_run(), "validating", "ready", "running", "finalizing", "incomplete")

        self.assertFalse(run.succeeded)

    def test_only_completed_reports_success(self) -> None:
        for state in TERMINAL:
            with self.subTest(state=state):
                self.assertEqual(a_run(state).succeeded, state == "completed")

    def test_the_only_route_into_completed_is_from_finalizing(self) -> None:
        routes = [t["from"] for t in LIFECYCLE["transitions"] if t["to"] == "completed"]

        self.assertEqual(routes, ["finalizing"])


class KillDuringEveryRunState(unittest.TestCase):
    """04-orchestrator-spec.md lists this among its safety tests.

    The state diagram in the same document allows only Running -> Cancelling,
    which would leave a paused run unkillable. Conflict 18 records the
    disagreement; the stricter reading is applied here.
    """

    def test_a_kill_works_from_every_non_terminal_state(self) -> None:
        for entry in LIFECYCLE["states"]:
            if entry["terminal"]:
                continue

            with self.subTest(state=entry["state"]):
                run = a_run(entry["state"])
                run.kill(satisfied=EVERYTHING)

                self.assertIn(run.state, {"cancelling", "cancelled", "incomplete"})

    def test_a_paused_run_can_be_killed_without_resuming(self) -> None:
        # The case the diagram alone would forbid.
        run = drive(a_run(), "validating", "ready", "running", "paused")
        run.kill(satisfied=EVERYTHING)

        self.assertEqual(run.state, "cancelling")

    def test_killing_during_finalizing_ends_incomplete_not_cancelled(self) -> None:
        # Execution is already over, so what is lost is the acknowledgement.
        run = drive(a_run(), "validating", "ready", "running", "finalizing")
        run.kill(satisfied=EVERYTHING)

        self.assertEqual(run.state, "incomplete")
        self.assertFalse(run.succeeded)

    def test_a_kill_needs_authority(self) -> None:
        run = drive(a_run(), "validating", "ready", "running")

        with self.assertRaises(RunRefused) as raised:
            run.kill(satisfied=EVERYTHING - {"kill-authority"})

        self.assertIn("kill-authority", raised.exception.reason)

    def test_a_kill_is_idempotent_toward_its_goal(self) -> None:
        # An operator who presses it twice, or presses it on a run already
        # stopping, has got what they asked for. Raising there would punish
        # using a safety control under pressure.
        run = drive(a_run(), "validating", "ready", "running")

        run.kill(satisfied=EVERYTHING)
        self.assertEqual(run.state, "cancelling")

        run.kill(satisfied=EVERYTHING)
        self.assertEqual(run.state, "cancelling")

    def test_killing_an_already_stopped_run_is_accepted_quietly(self) -> None:
        for state in ("rejected", "cancelled", "incomplete"):
            with self.subTest(state=state):
                run = a_run(state)
                run.kill(satisfied=EVERYTHING)
                self.assertEqual(run.state, state)

    def test_killing_a_completed_run_says_so(self) -> None:
        # The one case where silence would mislead: the work finished, and the
        # operator needs to know stopping it is no longer possible.
        with self.assertRaises(RunRefused) as raised:
            a_run("completed").kill(satisfied=EVERYTHING)

        self.assertIn("already completed", raised.exception.reason)


class RefusedTransitions(unittest.TestCase):
    def test_an_undeclared_transition_is_refused(self) -> None:
        with self.assertRaises(RunRefused) as raised:
            a_run().advance("running", satisfied=EVERYTHING)

        self.assertIn("cannot go from draft to running", raised.exception.reason)

    def test_a_terminal_run_cannot_move(self) -> None:
        for state in TERMINAL:
            with self.subTest(state=state):
                with self.assertRaises(RunRefused) as raised:
                    a_run(state).advance("running", satisfied=EVERYTHING)

                self.assertIn("terminal", raised.exception.reason)

    def test_a_cancelled_run_can_never_become_completed(self) -> None:
        run = drive(a_run(), "validating", "ready", "running", "cancelling", "cancelled")

        with self.assertRaises(RunRefused):
            run.advance("completed", satisfied=EVERYTHING)

        self.assertFalse(run.succeeded)

    def test_starting_needs_a_grant(self) -> None:
        run = drive(a_run(), "validating", "ready")

        with self.assertRaises(RunRefused) as raised:
            run.advance("running", satisfied=EVERYTHING - {"execution-grant"})

        self.assertIn("execution-grant", raised.exception.reason)

    def test_resuming_needs_a_fresh_grant(self) -> None:
        # The grant that started the run has expired: the maximum lifetime is
        # five minutes and a pause is longer than that by intent.
        run = drive(a_run(), "validating", "ready", "running", "paused")

        with self.assertRaises(RunRefused) as raised:
            run.advance("running", satisfied=EVERYTHING - {"execution-grant"})

        self.assertIn("execution-grant", raised.exception.reason)

    def test_a_refused_transition_leaves_the_state_untouched(self) -> None:
        run = drive(a_run(), "validating", "ready")

        with self.assertRaises(RunRefused):
            run.advance("completed", satisfied=EVERYTHING)

        self.assertEqual(run.state, "ready")


class LoadingTheMachine(unittest.TestCase):
    def test_an_empty_lifecycle_is_refused_rather_than_permitting_nothing(self) -> None:
        # A machine that loaded nothing permits nothing, which reads as very
        # strict rather than as broken.
        import json
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump({"initial_state": "draft", "states": [], "transitions": []}, handle)
            path = Path(handle.name)

        try:
            with self.assertRaises(RunRefused):
                load_lifecycle(path)
        finally:
            path.unlink()


if __name__ == "__main__":
    unittest.main()
