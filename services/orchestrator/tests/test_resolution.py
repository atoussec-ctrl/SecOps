"""DNS pinning and redirect revalidation (E1-002).

The resolver is injected, so every answer here is described rather than looked
up. That is what lets a rebinding domain be tested at all: a real resolver
cannot be asked to change its mind between two calls.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from scope.resolution import (  # noqa: E402
    PinnedTarget,
    ResolutionRefused,
    assert_pinned,
    resolve_and_pin,
    resolve_url_and_pin,
    revalidate_redirect,
)


def fixed(*addresses: str):
    """A resolver that always answers the same way."""
    return lambda _hostname: list(addresses)


def rebinding(*rounds: list[str]):
    """A resolver whose answer changes between calls.

    This is the attack in one object: the first answer passes validation and a
    later one points somewhere else.
    """
    remaining = list(rounds)

    def resolve(_hostname: str) -> list[str]:
        return remaining.pop(0) if len(remaining) > 1 else remaining[0]

    return resolve


class Pinning(unittest.TestCase):
    def test_a_safe_name_is_pinned_to_its_answer(self) -> None:
        pinned = resolve_and_pin("web.lab.test", fixed("192.168.56.20"), port=8081)

        self.assertEqual(pinned.hostname, "web.lab.test")
        self.assertEqual(pinned.addresses, ("192.168.56.20",))
        self.assertEqual(pinned.port, 8081)

    def test_an_ip_literal_needs_no_resolver(self) -> None:
        def explode(_hostname: str):
            raise AssertionError("an IP literal must not be looked up")

        pinned = resolve_and_pin("127.0.0.1", explode)

        self.assertEqual(pinned.addresses, ("127.0.0.1",))

    def test_a_name_the_scope_could_not_contain_is_refused(self) -> None:
        for target in ("example.com", "web.lab.test.", "HTTP://LOCALHOST/", "8.8.8.8"):
            with self.subTest(target=target), self.assertRaises(ResolutionRefused):
                resolve_and_pin(target, fixed("127.0.0.1"))

    def test_an_empty_answer_is_refused(self) -> None:
        # A missing result is never a pass. A name that resolves to nothing has
        # given no permission to connect anywhere.
        with self.assertRaises(ResolutionRefused) as raised:
            resolve_and_pin("web.lab.test", fixed())

        self.assertIn("no address", raised.exception.reason)

    def test_a_public_answer_is_refused(self) -> None:
        with self.assertRaises(ResolutionRefused) as raised:
            resolve_and_pin("web.lab.test", fixed("8.8.8.8"))

        self.assertIn("8.8.8.8", raised.exception.reason)
        self.assertIn("public", raised.exception.reason)

    def test_the_metadata_endpoint_is_refused(self) -> None:
        with self.assertRaises(ResolutionRefused) as raised:
            resolve_and_pin("web.lab.test", fixed("169.254.169.254"))

        self.assertIn("link-local", raised.exception.reason)

    def test_every_answer_is_checked_not_only_the_first(self) -> None:
        # A client may pick any record, so one denied address poisons the set.
        with self.assertRaises(ResolutionRefused) as raised:
            resolve_and_pin("web.lab.test", fixed("127.0.0.1", "8.8.8.8"))

        self.assertIn("8.8.8.8", raised.exception.reason)

    def test_ipv6_loopback_may_be_connected_to(self) -> None:
        # The scope record cannot name ::1, but localhost resolves to it on most
        # machines and it is a safe destination. What a scope may contain and
        # what a resolved answer may be are different questions.
        pinned = resolve_and_pin("localhost", fixed("127.0.0.1", "::1"))

        self.assertEqual(pinned.addresses, ("127.0.0.1", "::1"))

    def test_a_unique_local_answer_is_refused(self) -> None:
        with self.assertRaises(ResolutionRefused):
            resolve_and_pin("web.lab.test", fixed("fd00::1"))


class TimeOfCheckToTimeOfUse(unittest.TestCase):
    """The bug this module exists to close."""

    def test_the_pin_holds_when_the_answer_changes(self) -> None:
        resolver = rebinding(["192.168.56.20"], ["169.254.169.254"])

        pinned = resolve_and_pin("web.lab.test", resolver)
        self.assertEqual(pinned.addresses, ("192.168.56.20",))

        # The name now points at the metadata endpoint. Nothing about the pin
        # changes, because the pin is not the name.
        self.assertEqual(resolver("web.lab.test"), ["169.254.169.254"])
        self.assertEqual(pinned.addresses, ("192.168.56.20",))

        with self.assertRaises(ResolutionRefused):
            assert_pinned(pinned, "169.254.169.254")

    def test_connecting_outside_the_pin_is_refused(self) -> None:
        pinned = resolve_and_pin("web.lab.test", fixed("192.168.56.20"))

        assert_pinned(pinned, "192.168.56.20")

        for address in ("192.168.56.21", "127.0.0.1", "8.8.8.8"):
            with self.subTest(address=address), self.assertRaises(ResolutionRefused):
                assert_pinned(pinned, address)

    def test_a_pin_cannot_be_edited(self) -> None:
        pinned = resolve_and_pin("web.lab.test", fixed("192.168.56.20"))

        with self.assertRaises(Exception):
            pinned.addresses = ("169.254.169.254",)  # type: ignore[misc]


class RedirectRevalidation(unittest.TestCase):
    def test_a_redirect_is_validated_again(self) -> None:
        pinned = resolve_url_and_pin(
            "http://web.lab.test:8081/", fixed("192.168.56.20")
        )

        for location in (
            "http://example.com/",
            "http://169.254.169.254/latest/meta-data/",
            "ftp://web.lab.test/",
            "http://web.lab.test\n/",
        ):
            with self.subTest(location=location), self.assertRaises(ResolutionRefused):
                revalidate_redirect(pinned, location, fixed("192.168.56.20"))

    def test_a_redirect_to_a_safe_host_is_pinned_afresh(self) -> None:
        pinned = resolve_url_and_pin(
            "http://web.lab.test:8081/", fixed("192.168.56.20")
        )
        next_pin = revalidate_redirect(
            pinned, "http://api.lab.test:8081/v1", fixed("192.168.56.21")
        )

        self.assertEqual(next_pin.hostname, "api.lab.test")
        self.assertEqual(next_pin.addresses, ("192.168.56.21",))

    def test_the_same_name_answering_differently_is_refused(self) -> None:
        # The redirect host matches, so a cache that trusted the name would
        # reuse the old pin. The answer moved, which is the rebinding signal.
        pinned = resolve_url_and_pin(
            "http://web.lab.test:8081/", fixed("192.168.56.20")
        )

        with self.assertRaises(ResolutionRefused) as raised:
            revalidate_redirect(
                pinned, "http://web.lab.test:8081/next", fixed("192.168.56.21")
            )

        self.assertIn("answered differently", raised.exception.reason)

    def test_a_redirect_to_a_public_answer_is_refused_even_for_a_lab_name(self) -> None:
        pinned = resolve_url_and_pin(
            "http://web.lab.test:8081/", fixed("192.168.56.20")
        )

        with self.assertRaises(ResolutionRefused):
            revalidate_redirect(pinned, "http://api.lab.test/", fixed("93.184.216.34"))


class RefusalCarriesEvidence(unittest.TestCase):
    def test_every_refusal_states_a_reason(self) -> None:
        # The reason reaches an audit record, so an empty one would leave an
        # operator with a denial and no way to act on it.
        for call in (
            lambda: resolve_and_pin("example.com", fixed("127.0.0.1")),
            lambda: resolve_and_pin("web.lab.test", fixed()),
            lambda: resolve_and_pin("web.lab.test", fixed("8.8.8.8")),
            lambda: assert_pinned(PinnedTarget("h", ("127.0.0.1",)), "8.8.8.8"),
        ):
            with self.subTest(call=call):
                with self.assertRaises(ResolutionRefused) as raised:
                    call()

                self.assertGreater(len(raised.exception.reason), 20)


if __name__ == "__main__":
    unittest.main()
