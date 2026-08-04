"""The Python half of the address policy, held to the shared vectors (E1-001).

The vectors under ``packages/contracts/security/samples/address-policy/`` are
the definition. The JSON Schema patterns in the scope contract are tested
against them by ``tests/foundation/address-policy.test.mjs``; this module is
tested against the same file. If the two implementations disagree, one of them
is wrong and the vector says which.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from scope.address_policy import (  # noqa: E402
    MINIMUM_IPV4_PREFIX,
    classify,
    is_scope_eligible,
)

VECTOR_DIRECTORY = (
    REPOSITORY_ROOT / "packages" / "contracts" / "security" / "samples" / "address-policy"
)


def load_vectors() -> list[dict]:
    vectors: list[dict] = []
    for path in sorted(VECTOR_DIRECTORY.glob("*.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        for vector in document["vectors"]:
            vector["_source"] = path.name
            vectors.append(vector)
    return vectors


VECTORS = load_vectors()


class VectorConformance(unittest.TestCase):
    def test_vectors_were_found(self) -> None:
        # A conformance suite that loads nothing passes everything, which is the
        # failure mode this whole repository is built to refuse.
        self.assertGreaterEqual(len(VECTORS), 60, f"only {len(VECTORS)} vectors loaded")
        self.assertEqual(
            {vector["_source"] for vector in VECTORS},
            {"ipv4-and-host-vectors.json", "ipv6-vectors.json"},
            "a vector file stopped being loaded",
        )

    def test_classification_matches_every_vector(self) -> None:
        for vector in VECTORS:
            with self.subTest(input=vector["input"], kind=vector["kind"]):
                self.assertEqual(
                    classify(vector["input"], vector["kind"]),
                    vector["classification"],
                    vector["rationale"],
                )

    def test_eligibility_matches_every_vector(self) -> None:
        for vector in VECTORS:
            with self.subTest(input=vector["input"], kind=vector["kind"]):
                self.assertEqual(
                    is_scope_eligible(vector["input"], vector["kind"]),
                    vector["in_scope_eligible"],
                    vector["rationale"],
                )


class StandardLibraryIsNotThePolicy(unittest.TestCase):
    """``ipaddress.is_private`` is not a safety test, and this records why.

    Using it as one is the obvious mistake, it reads as correct, and it admits
    the single address the threat model cares most about.
    """

    def test_is_private_would_admit_denied_addresses(self) -> None:
        import ipaddress

        trapped = [
            ("169.254.169.254", "link-local", "the cloud metadata endpoint"),
            ("192.0.2.1", "documentation", "TEST-NET-1"),
            ("198.51.100.1", "documentation", "TEST-NET-2"),
            ("203.0.113.1", "documentation", "TEST-NET-3"),
            ("198.18.0.1", "benchmarking", "RFC 2544 benchmarking"),
            ("240.0.0.1", "reserved", "reserved for future use"),
            ("0.1.2.3", "unspecified", "this network"),
            ("255.255.255.255", "broadcast", "limited broadcast"),
        ]

        for value, expected, why in trapped:
            with self.subTest(value=value):
                self.assertTrue(
                    ipaddress.ip_address(value).is_private,
                    f"{value} is no longer is_private; this trap needs rewriting",
                )
                self.assertEqual(classify(value, "ipv4"), expected, why)
                self.assertFalse(is_scope_eligible(value, "ipv4"), why)

    def test_is_private_would_also_deny_nothing_useful(self) -> None:
        import ipaddress

        # The inverse error: carrier-grade NAT is not is_private, so a policy
        # written as "deny anything not private" would not catch it either.
        self.assertFalse(ipaddress.ip_address("100.64.0.1").is_private)
        self.assertEqual(classify("100.64.0.1", "ipv4"), "carrier-grade-nat")
        self.assertFalse(is_scope_eligible("100.64.0.1", "ipv4"))


class AlternateSpellings(unittest.TestCase):
    def test_one_address_written_four_ways_classifies_alike_or_is_refused(self) -> None:
        self.assertEqual(classify("127.0.0.1", "ipv4"), "loopback")

        for spelling in ("127.000.000.001", "2130706433", "0x7f.0.0.1", "127.0.0.1 "):
            with self.subTest(spelling=spelling):
                self.assertEqual(classify(spelling, "ipv4"), "malformed")
                self.assertFalse(is_scope_eligible(spelling, "ipv4"))

    def test_an_ipv4_address_wearing_ipv6_is_never_eligible(self) -> None:
        for value in (
            "::ffff:127.0.0.1",
            "::ffff:8.8.8.8",
            "::ffff:192.168.56.10",
            "64:ff9b::8.8.8.8",
        ):
            with self.subTest(value=value):
                self.assertEqual(classify(value, "ipv6"), "ipv4-mapped")
                self.assertFalse(is_scope_eligible(value, "ipv6"))

    def test_userinfo_cannot_disguise_a_public_host(self) -> None:
        self.assertEqual(classify("http://localhost@example.com/", "url"), "malformed")
        self.assertFalse(is_scope_eligible("http://localhost@example.com/", "url"))


class PolicyBoundaries(unittest.TestCase):
    def test_the_private_ranges_are_bounded_on_both_sides(self) -> None:
        for value, expected in (
            ("172.15.255.255", "public"),
            ("172.16.0.0", "private"),
            ("172.31.255.255", "private"),
            ("172.32.0.0", "public"),
            ("192.167.255.255", "public"),
            ("192.168.0.0", "private"),
            ("192.169.0.0", "public"),
            ("9.255.255.255", "public"),
            ("10.0.0.0", "private"),
            ("11.0.0.0", "public"),
        ):
            with self.subTest(value=value):
                self.assertEqual(classify(value, "ipv4"), expected)

    def test_a_prefix_below_the_minimum_is_refused(self) -> None:
        self.assertEqual(classify("10.0.0.0/8", "ipv4-cidr"), "private")
        self.assertTrue(is_scope_eligible("10.0.0.0/8", "ipv4-cidr"))

        # A shorter prefix is well formed and still private by classification.
        # The prefix minimum is an eligibility rule, so the refusal happens
        # there rather than by pretending the notation is broken.
        wide = f"10.0.0.0/{MINIMUM_IPV4_PREFIX - 1}"
        self.assertEqual(classify(wide, "ipv4-cidr"), "private")
        self.assertFalse(is_scope_eligible(wide, "ipv4-cidr"))

    def test_an_absolute_name_is_classified_but_not_eligible(self) -> None:
        # The two implementations must agree on forms one of them cannot write
        # down. A trailing dot is a legal absolute name and the scope pattern
        # has no way to express it.
        self.assertEqual(classify("web.lab.test.", "hostname"), "reserved-domain")
        self.assertFalse(is_scope_eligible("web.lab.test.", "hostname"))
        self.assertTrue(is_scope_eligible("web.lab.test", "hostname"))

    def test_a_cidr_with_host_bits_set_is_refused(self) -> None:
        self.assertEqual(classify("192.168.56.20/24", "ipv4-cidr"), "malformed")

    def test_an_unknown_kind_raises_rather_than_defaulting(self) -> None:
        with self.assertRaises(ValueError):
            classify("127.0.0.1", "ipv5")


if __name__ == "__main__":
    unittest.main()
