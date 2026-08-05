"""Recording a decision before it takes effect (backlog E1-005).

`04-orchestrator-spec.md`, "Safety tests", requires that **audit-store failure
blocks privileged execution**, and `08-observability.md` lists an unavailable
audit store among the conditions that stop work. Neither is satisfied by a
module that decides first and logs afterwards.

So the order here is: run the check, write the record, and only then let the
caller act. The interesting direction is an *allowed* decision whose record
cannot be written. The check passed, and the operation is still refused, because
a privileged action nobody can later account for is worse than one that did not
happen.

A refusal whose record fails is refused twice over, which needs no argument.
"""

from __future__ import annotations

from datetime import datetime
from typing import Callable, Mapping, Sequence, TypeVar

from .chain import AuditChain, AuditRefused

__all__ = ["UnrecordableDecision", "guard", "record"]

T = TypeVar("T")


class UnrecordableDecision(Exception):
    """A decision could not be written to the audit chain.

    Separate from `AuditRefused` so a caller can tell "the audit store rejected
    this entry" from "the operation itself was refused". Both stop the
    operation; only one of them means the store is broken.
    """

    def __init__(self, action: str, subject: str, reason: str) -> None:
        super().__init__(f"{action} on {subject} could not be recorded: {reason}")
        self.action = action
        self.subject = subject
        self.reason = reason


def record(
    chain: AuditChain,
    *,
    entry_id: str,
    action: str,
    outcome: str,
    subject: str,
    facts: Sequence[Mapping[str, str]],
    occurred_at: datetime,
) -> Mapping[str, object]:
    """Append one decision, converting a store failure into a distinct error."""
    try:
        return chain.append(
            entry_id=entry_id,
            action=action,
            outcome=outcome,
            subject=subject,
            facts=facts,
            occurred_at=occurred_at,
        )
    except AuditRefused as error:
        raise UnrecordableDecision(action, subject, error.reason) from error


def guard(
    chain: AuditChain,
    *,
    entry_id: str,
    action: str,
    subject: str,
    occurred_at: datetime,
    facts: Sequence[Mapping[str, str]],
    decision: Callable[[], T],
    refusal_reason_fact: str = "reason",
) -> T:
    """Run ``decision``, record what happened, and only then return its result.

    ``decision`` raises to refuse. The exception's ``reason`` attribute, which
    every refusal in this service carries, becomes a fact on the entry; the
    exception is re-raised once the refusal is on the record.

    An allowed decision whose entry cannot be written raises
    `UnrecordableDecision` instead of returning, so nothing acts on a permission
    that was never recorded.
    """
    try:
        result = decision()
    except Exception as refusal:  # noqa: BLE001 - re-raised below, never swallowed
        reason = getattr(refusal, "reason", type(refusal).__name__)

        # Best effort, and the refusal is raised either way. If the store is
        # broken, the operation was already being refused; losing that record is
        # worth reporting but not worth converting into a different failure.
        try:
            record(
                chain,
                entry_id=entry_id,
                action=action,
                outcome="refused",
                subject=subject,
                facts=[
                    *facts,
                    {
                        "name": refusal_reason_fact,
                        "type": "reason_code",
                        "value": _as_reason_code(reason),
                    },
                ],
                occurred_at=occurred_at,
            )
        except UnrecordableDecision:
            pass

        raise

    record(
        chain,
        entry_id=entry_id,
        action=action,
        outcome="allowed",
        subject=subject,
        facts=facts,
        occurred_at=occurred_at,
    )

    return result


def _as_reason_code(reason: str) -> str:
    """Reduce a refusal message to something the fact vocabulary accepts.

    Reasons are written for a person and can carry an address, an identifier or
    a quoted value. The audit contract bounds a fact at 200 characters and has
    no free-text type, so the message is truncated rather than allowed to become
    the free-text field the contract deliberately lacks.
    """
    return reason[:200] if reason else "unspecified"
