"""Idempotent operations, and the reuse that must not be answered (E1-005)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from datetime import datetime, timedelta, timezone  # noqa: E402

from runs.idempotency import (  # noqa: E402
    MAXIMUM_RUN_DURATION_SECONDS,
    RETENTION_SECONDS,
    IdempotencyConflict,
    IdempotencyStore,
    OperationState,
    request_fingerprint,
)

KEY = "start-run-0001-a3f9"
REQUEST = {"run_id": "run.0001", "profile": "passive", "adapter_id": "adapter.zap"}
AT = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)


class Claiming(unittest.TestCase):
    def test_a_first_claim_asks_the_caller_to_do_the_work(self) -> None:
        store = IdempotencyStore()

        should_run, result = store.claim(KEY, REQUEST, AT)

        self.assertTrue(should_run)
        self.assertIsNone(result)
        self.assertIs(store.state(KEY), OperationState.PENDING)

    def test_a_repeat_of_a_completed_request_returns_the_stored_result(self) -> None:
        store = IdempotencyStore()
        store.claim(KEY, REQUEST, AT)
        store.complete(KEY, {"state": "Ready"})

        should_run, result = store.claim(KEY, REQUEST, AT)

        self.assertFalse(should_run)
        self.assertEqual(result, {"state": "Ready"})

    def test_key_order_does_not_change_the_fingerprint(self) -> None:
        reordered = dict(reversed(list(REQUEST.items())))

        self.assertEqual(request_fingerprint(REQUEST), request_fingerprint(reordered))

        store = IdempotencyStore()
        store.claim(KEY, REQUEST, AT)
        store.complete(KEY, "done")

        should_run, result = store.claim(KEY, reordered, AT)

        self.assertFalse(should_run)
        self.assertEqual(result, "done")


class ReuseWithADifferentRequest(unittest.TestCase):
    """The case the fingerprint exists for."""

    def test_the_same_key_with_a_different_request_is_refused(self) -> None:
        store = IdempotencyStore()
        store.claim(KEY, REQUEST, AT)
        store.complete(KEY, {"state": "Ready"})

        for changed in (
            {**REQUEST, "profile": "bounded-active"},
            {**REQUEST, "run_id": "run.0002"},
            {**REQUEST, "adapter_id": "adapter.nmap"},
            {**REQUEST, "extra": "field"},
        ):
            with self.subTest(changed=changed):
                with self.assertRaises(IdempotencyConflict) as raised:
                    store.claim(KEY, changed, AT)

                self.assertIn("different request", raised.exception.reason)

    def test_the_stored_result_is_never_served_to_a_different_request(self) -> None:
        # Serving it would answer a request nobody made, which is how a payload
        # substitution succeeds without anything looking wrong.
        store = IdempotencyStore()
        store.claim(KEY, REQUEST, AT)
        store.complete(KEY, {"state": "Ready", "run_id": "run.0001"})

        try:
            _, result = store.claim(KEY, {**REQUEST, "profile": "bounded-active"}, AT)
        except IdempotencyConflict:
            return

        self.fail(f"a substituted request received a stored result: {result}")


class InFlight(unittest.TestCase):
    def test_a_second_claim_while_pending_is_refused(self) -> None:
        store = IdempotencyStore()
        store.claim(KEY, REQUEST, AT)

        with self.assertRaises(IdempotencyConflict) as raised:
            store.claim(KEY, REQUEST, AT)

        self.assertIn("in flight", raised.exception.reason)

    def test_a_released_claim_can_be_retried(self) -> None:
        store = IdempotencyStore()
        store.claim(KEY, REQUEST, AT)
        store.release(KEY)

        should_run, _ = store.claim(KEY, REQUEST, AT)

        self.assertTrue(should_run)

    def test_a_completed_claim_is_not_released(self) -> None:
        # Releasing it would let one key run its operation twice.
        store = IdempotencyStore()
        store.claim(KEY, REQUEST, AT)
        store.complete(KEY, "done")
        store.release(KEY)

        should_run, result = store.claim(KEY, REQUEST, AT)

        self.assertFalse(should_run)
        self.assertEqual(result, "done")


class Completion(unittest.TestCase):
    def test_completing_an_unclaimed_key_is_refused(self) -> None:
        with self.assertRaises(IdempotencyConflict):
            IdempotencyStore().complete(KEY, "done")

    def test_completing_twice_is_refused(self) -> None:
        store = IdempotencyStore()
        store.claim(KEY, REQUEST, AT)
        store.complete(KEY, "done")

        with self.assertRaises(IdempotencyConflict):
            store.complete(KEY, "done again")


class KeyShape(unittest.TestCase):
    def test_a_key_too_short_to_be_unique_is_refused(self) -> None:
        # A key short enough to collide by accident makes every guarantee here
        # coincidental.
        for key in ("", "short", "a.b-c_1"):
            with self.subTest(key=key), self.assertRaises(IdempotencyConflict):
                IdempotencyStore().claim(key, REQUEST, AT)

    def test_a_key_with_unexpected_characters_is_refused(self) -> None:
        for key in ("has spaces here", "has/slash/init", "-leadingdash"):
            with self.subTest(key=key), self.assertRaises(IdempotencyConflict):
                IdempotencyStore().claim(key, REQUEST, AT)

    def test_a_well_formed_key_is_accepted(self) -> None:
        for key in ("start-run-0001-a3f9", "A" * 64, "abcdefgh"):
            with self.subTest(key=key):
                self.assertTrue(IdempotencyStore().claim(key, REQUEST, AT)[0])


class Retention(unittest.TestCase):
    """An unbounded store is a leak, and a record kept forever answers a key
    reused much later with a stale result."""

    def test_records_expire(self) -> None:
        store = IdempotencyStore()
        store.claim(KEY, REQUEST, AT)
        store.complete(KEY, "done")

        self.assertEqual(len(store), 1)

        later = AT + timedelta(seconds=RETENTION_SECONDS + 1)
        should_run, result = store.claim(KEY, REQUEST, later)

        self.assertTrue(should_run, "an expired key was answered from cache")
        self.assertIsNone(result)

    def test_the_store_does_not_grow_without_bound(self) -> None:
        store = IdempotencyStore()

        # Spread across five hours so most fall outside the retention window.
        # One second apart would place all of them inside it and the assertion
        # would prove nothing.
        for index in range(2000):
            key = f"operation-{index:012d}"
            store.claim(key, {"run_id": f"run.{index}"}, AT + timedelta(seconds=index * 10))
            store.complete(key, "done")

        self.assertLess(len(store), 2000, "the store retained everything")
        self.assertLessEqual(len(store), RETENTION_SECONDS // 10 + 1)

    def test_retention_outlives_the_longest_run_a_scope_may_authorise(self) -> None:
        # The invariant, stated as arithmetic. A record that expired while its
        # run was alive would let a repeated start begin a second one, which is
        # the failure the key exists to prevent.
        self.assertGreaterEqual(RETENTION_SECONDS, MAXIMUM_RUN_DURATION_SECONDS)

    def test_a_retention_shorter_than_a_run_is_refused(self) -> None:
        with self.assertRaises(IdempotencyConflict) as raised:
            IdempotencyStore(ttl_seconds=MAXIMUM_RUN_DURATION_SECONDS - 1)

        self.assertIn("still alive", raised.exception.reason)

    def test_a_key_still_inside_the_window_is_answered_from_cache(self) -> None:
        store = IdempotencyStore()
        store.claim(KEY, REQUEST, AT)
        store.complete(KEY, "done")

        should_run, result = store.claim(
            KEY, REQUEST, AT + timedelta(seconds=RETENTION_SECONDS - 1)
        )

        self.assertFalse(should_run)
        self.assertEqual(result, "done")


if __name__ == "__main__":
    unittest.main()
