"""Accepting a grant: verify, record, then commit (backlog E1-005).

Three steps that have to happen in this order, and the order is not obvious
enough to leave to each caller.

1. **Verify.** No side effect. A grant that fails here has not been used and
   must remain presentable.
2. **Record.** `04-orchestrator-spec.md` requires audit-store failure to block
   privileged execution, so a decision that cannot be written does not take
   effect.
3. **Commit.** The nonce is consumed only once the acceptance is on the record.

Getting this backwards is not a style problem. Consuming the nonce during
verification meant a flapping audit store destroyed valid grants: the check
burned the nonce, the record failed, the operation was refused, and the grant
could never be presented again. An outage in the store that exists to describe
work became a way to prevent it.

.. note::

   Between step 1 and step 3 the nonce is unclaimed, so two concurrent
   acceptances of one grant could both verify. Nothing here is concurrent, and
   the durable implementation must close it properly: the audit append and the
   nonce consumption belong in one transaction, which is what
   [ADR-005](../../../adrs/005-postgresql-outbox.md) already chose PostgreSQL
   for. Recorded rather than hidden, because an in-memory store makes it
   unreachable and the durable one will not.
"""

from __future__ import annotations

from datetime import datetime
from typing import Mapping

from audit.chain import AuditChain
from audit.recorder import guard

from .execution_grant import ReplayCache, verify_grant

__all__ = ["authorise"]


def authorise(
    grant: Mapping[str, object],
    *,
    chain: AuditChain,
    entry_id: str,
    trusted_keys: Mapping[str, bytes],
    audience: str,
    run_id: str,
    scope_hash: str,
    now: datetime,
    replay_cache: ReplayCache,
    revoked_runs: frozenset[str] = frozenset(),
) -> None:
    """Accept ``grant`` or raise, leaving a record either way.

    Returns nothing: there is no result to hold, only permission to proceed,
    and permission that was not recorded is not permission.
    """
    facts = [
        {"name": "audience", "type": "identifier", "value": audience},
        {"name": "run_id", "type": "identifier", "value": run_id},
        {"name": "scope_hash", "type": "digest", "value": scope_hash},
    ]

    nonce = guard(
        chain,
        entry_id=entry_id,
        action="grant.verified",
        subject=str(grant.get("grant_id", "unknown.grant")),
        occurred_at=now,
        facts=facts,
        decision=lambda: verify_grant(
            grant,
            trusted_keys=trusted_keys,
            audience=audience,
            run_id=run_id,
            scope_hash=scope_hash,
            now=now,
            replay_cache=replay_cache,
            revoked_runs=revoked_runs,
        ),
    )

    # Only now. `guard` raised if the acceptance could not be written, so
    # reaching this line means the record exists.
    replay_cache.consume(nonce, now)
