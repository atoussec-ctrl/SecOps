"""The run state machine, enforced from the contract (backlog E1-005).

The table lives in `packages/contracts/security/samples/run-lifecycle/`, not in
this file. A diagram cannot be executed and a second copy of the rules drifts
from the first, so the transitions are loaded and enforced rather than restated.

Two properties are worth naming because both are easy to lose.

**Only `completed` means success.** `04-orchestrator-spec.md` says an exit code
of zero is insufficient, so the transition into `completed` demands an
`ingestion-receipt` and nothing else opens that door. A run whose adapter exited
cleanly and whose results were never acknowledged ends `incomplete`, which is a
different word on purpose.

**A terminal state is a dead end.** Unlike the finding lifecycle, where a
terminal state is a resting place that new evidence can leave, a run that
finished is finished. Starting again means a new run with a new grant.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Iterable, Mapping

__all__ = ["Run", "RunRefused", "load_lifecycle"]

_LIFECYCLE: Final = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "contracts"
    / "security"
    / "samples"
    / "run-lifecycle"
    / "orchestrator.json"
)


class RunRefused(Exception):
    """A transition was refused. The reason is meant to reach an audit record."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def load_lifecycle(path: Path = _LIFECYCLE) -> Mapping[str, object]:
    lifecycle = json.loads(path.read_text(encoding="utf-8"))

    # A lifecycle that loaded nothing would permit nothing, which reads as a
    # very strict machine rather than as a broken one.
    if not lifecycle.get("transitions") or not lifecycle.get("states"):
        raise RunRefused(f"the run lifecycle at {path} declares no machine")

    return lifecycle


@dataclass
class Run:
    """One run, and the only thing that may change its state."""

    run_id: str
    lifecycle: Mapping[str, object] = field(default_factory=load_lifecycle)
    state: str = ""

    def __post_init__(self) -> None:
        if not self.state:
            self.state = str(self.lifecycle["initial_state"])

        self._terminal = {
            str(entry["state"])
            for entry in self.lifecycle["states"]  # type: ignore[index]
            if entry["terminal"]
        }

    def _transition(self, to: str) -> Mapping[str, object] | None:
        for candidate in self.lifecycle["transitions"]:  # type: ignore[index]
            if candidate["from"] == self.state and candidate["to"] == to:
                return candidate

        return None

    def permitted(self) -> list[str]:
        return sorted(
            str(candidate["to"])
            for candidate in self.lifecycle["transitions"]  # type: ignore[index]
            if candidate["from"] == self.state
        )

    def advance(self, to: str, *, satisfied: Iterable[str]) -> None:
        """Move to ``to`` or raise, leaving the run untouched on refusal."""
        if self.state in self._terminal:
            raise RunRefused(
                f"run {self.run_id} is {self.state}, which is terminal; "
                "starting again means a new run",
            )

        transition = self._transition(to)

        if transition is None:
            raise RunRefused(
                f"run {self.run_id} cannot go from {self.state} to {to}; "
                f"permitted: {', '.join(self.permitted()) or 'nothing'}",
            )

        required = set(transition["requires"])  # type: ignore[index]
        missing = sorted(required - set(satisfied))

        if missing:
            raise RunRefused(
                f"run {self.run_id} cannot go from {self.state} to {to} without "
                f"{', '.join(missing)}",
            )

        self.state = to

    def kill(self, *, satisfied: Iterable[str]) -> None:
        """Stop the run from wherever it is.

        `04-orchestrator-spec.md` requires a kill to work during every run
        state. From `finalizing` that means `incomplete` rather than
        `cancelling`: execution is already over, so what is lost is the
        acknowledgement, not the work.

        A kill is idempotent toward its goal. An operator who presses it twice,
        or presses it on a run that is already stopping, has got what they asked
        for; raising there would turn a safety control into something that
        punishes using it under pressure.

        The exception is a run that already **succeeded**. Stopping it is no
        longer possible and the operator needs to be told so rather than
        reassured.
        """
        if self.state == "completed":
            raise RunRefused(
                f"run {self.run_id} already completed; it cannot be stopped",
            )

        if self.state == "cancelling" or self.state in self._terminal:
            return

        target = "incomplete" if self.state == "finalizing" else "cancelling"

        self.advance(target, satisfied=satisfied)

    @property
    def succeeded(self) -> bool:
        """True only for `completed`.

        Written as an explicit comparison rather than "not failed", because
        every other terminal state is also an ending and none of them is
        success.
        """
        return self.state == "completed"
