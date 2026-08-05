"""Idempotent operations for the run plane (backlog E1-005).

`04-orchestrator-spec.md` gives the `runs` module "run state machine and
idempotent operations". Retrying a start after a timeout must not begin a second
run, and that is the easy half.

The hard half is what happens when the same key arrives with a *different*
request. Storing only the key means a caller that reuses one — through a bug, or
deliberately — receives the result of an operation it did not ask for. Current
guidance is unambiguous: store a fingerprint of the request beside the key and
**refuse** a mismatch rather than serving the cached answer, because serving it
is how a payload manipulation succeeds quietly.

So a key here binds to exactly one request. The fingerprint is a digest over the
same canonical form the scope digest and the audit chain use
([ADR-011](../../../adrs/011-canonical-scope-serialization.md)), so two
descriptions of one request agree byte for byte across languages.

Records are retained for a bounded window and no longer. An unbounded store is
a leak in a service meant to run for the length of an engagement, and a record
kept forever answers a key reused years later with a stale result. The bound is
derived rather than picked: see `RETENTION_SECONDS`.

Standard library only.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Final, Mapping

__all__ = [
    "IdempotencyConflict",
    "IdempotencyStore",
    "MAXIMUM_RUN_DURATION_SECONDS",
    "OperationState",
    "RETENTION_SECONDS",
    "request_fingerprint",
]

_KEY: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{7,63}$")

# The ceiling the scope contract puts on max_duration_seconds. A run cannot last
# longer than this, so a retry arriving later than this plus the operation's own
# window is not a retry of anything live.
MAXIMUM_RUN_DURATION_SECONDS: Final = 3600

# Retention has to outlive every moment a legitimate retry could still arrive
# for an operation that is still meaningful. A record that expires while its run
# is alive lets a repeated start begin a second one, which is the failure the
# key exists to prevent — the same shape as the replay cache invariant in
# ADR-012, derived from the contract rather than chosen.
RETENTION_SECONDS: Final = 2 * MAXIMUM_RUN_DURATION_SECONDS


class OperationState(Enum):
    """A key is claimed before the work runs, so a concurrent retry sees it."""

    PENDING = "pending"
    COMPLETED = "completed"


class IdempotencyConflict(Exception):
    """A key was reused in a way that cannot be answered safely."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def request_fingerprint(request: Mapping[str, Any]) -> str:
    """Digest the request in the canonical form, so key order cannot change it."""
    canonical = json.dumps(
        request, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")

    return hashlib.sha256(canonical).hexdigest()


@dataclass
class _Record:
    fingerprint: str
    state: OperationState
    claimed_at: datetime
    result: Any = None


@dataclass
class IdempotencyStore:
    """Keys claimed by this service, each bound to one request, each expiring."""

    ttl_seconds: int = RETENTION_SECONDS
    _records: dict[str, _Record] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Asserted rather than commented, because a shorter retention silently
        # reopens the duplicate-start it exists to close.
        if self.ttl_seconds < MAXIMUM_RUN_DURATION_SECONDS:
            raise IdempotencyConflict(
                f"retention of {self.ttl_seconds}s is shorter than the "
                f"{MAXIMUM_RUN_DURATION_SECONDS}s a run may last, so a key could "
                "expire while its operation is still alive",
            )

    def _evict(self, now: datetime) -> None:
        horizon = now - timedelta(seconds=self.ttl_seconds)
        self._records = {
            key: record
            for key, record in self._records.items()
            if record.claimed_at >= horizon
        }

    def claim(
        self, key: str, request: Mapping[str, Any], now: datetime
    ) -> tuple[bool, Any]:
        """Claim ``key`` for ``request``.

        Returns ``(True, None)`` when the caller should do the work, and
        ``(False, result)`` when a completed identical request already has an
        answer.

        Raises when the key cannot be answered safely: reused with a different
        request, or claimed and still in flight.
        """
        if not _KEY.fullmatch(key):
            # Eight characters minimum. A key short enough to collide by
            # accident makes every guarantee below coincidental.
            raise IdempotencyConflict(f"idempotency key {key!r} is not well formed")

        self._evict(now)

        fingerprint = request_fingerprint(request)
        existing = self._records.get(key)

        if existing is None:
            self._records[key] = _Record(fingerprint, OperationState.PENDING, now)
            return True, None

        if existing.fingerprint != fingerprint:
            # The whole point. Returning the stored result here would answer a
            # request nobody made.
            raise IdempotencyConflict(
                f"idempotency key {key} was already used for a different request; "
                "a key binds to exactly one request",
            )

        if existing.state is OperationState.PENDING:
            # An identical request is already running. Answering "done" would be
            # a lie and running it again would defeat the key.
            raise IdempotencyConflict(
                f"idempotency key {key} is still in flight; retry once it completes",
            )

        return False, existing.result

    def complete(self, key: str, result: Any) -> None:
        record = self._records.get(key)

        if record is None:
            raise IdempotencyConflict(f"idempotency key {key} was never claimed")

        if record.state is OperationState.COMPLETED:
            raise IdempotencyConflict(f"idempotency key {key} is already completed")

        record.state = OperationState.COMPLETED
        record.result = result

    def release(self, key: str) -> None:
        """Drop a claim whose work failed, so an honest retry can proceed.

        Only a pending claim is released. A completed one is the answer, and
        deleting it would let the same key run twice.
        """
        record = self._records.get(key)

        if record is not None and record.state is OperationState.PENDING:
            del self._records[key]

    def state(self, key: str) -> OperationState | None:
        record = self._records.get(key)
        return None if record is None else record.state

    def __len__(self) -> int:
        return len(self._records)
