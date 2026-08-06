"""The adapter registry and the invocation it is the only source of (E1-007)."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from adapters.registry import (  # noqa: E402
    AdapterRefused,
    build_invocation,
    load_registry,
)

REGISTRY = load_registry()
PINNED = ("192.168.56.10", "127.0.0.1")
BUDGETS = {"max_duration_seconds": 600, "max_concurrency": 2}


def invoke(adapter_id="adapter.synthetic.fixture", **overrides):
    arguments = {
        "registry": REGISTRY,
        "target": "192.168.56.10",
        "pinned_addresses": PINNED,
        "output_path": "/results/run-0001.sarif",
        "budgets": BUDGETS,
        "allowed_profiles": ["passive", "bounded-active"],
    }
    arguments.update(overrides)
    return build_invocation(adapter_id, **arguments)


class TheRegistry(unittest.TestCase):
    def test_it_loads_the_declared_adapters(self) -> None:
        self.assertIn("adapter.synthetic.fixture", REGISTRY)
        self.assertIn("adapter.zap.baseline", REGISTRY)

    def test_a_container_adapter_names_a_manifest_image_entry(self) -> None:
        manifest = json.loads(
            (REPOSITORY_ROOT / "version-manifest.json").read_text(encoding="utf-8")
        )

        for adapter in REGISTRY.values():
            if adapter.kind != "container":
                continue

            with self.subTest(adapter=adapter.adapter_id):
                self.assertIn(adapter.image_ref, manifest["entries"])
                self.assertEqual(
                    manifest["entries"][adapter.image_ref]["category"], "image"
                )

    def test_a_synthetic_adapter_names_no_image(self) -> None:
        self.assertIsNone(REGISTRY["adapter.synthetic.fixture"].image_ref)

    def test_every_adapter_declares_an_artifact(self) -> None:
        for adapter in REGISTRY.values():
            with self.subTest(adapter=adapter.adapter_id):
                self.assertTrue(adapter.artifacts)

    def test_an_empty_registry_is_refused_rather_than_permitting_nothing(self) -> None:
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump({"registry_version": "1.0.0", "adapters": []}, handle)
            path = Path(handle.name)

        try:
            with self.assertRaises(AdapterRefused):
                load_registry(path)
        finally:
            path.unlink()


class ShapesTheRegistryRefuses(unittest.TestCase):
    """The contract says these are impossible. The contract constrains documents
    validated against it, and nothing validates the registry on this path."""

    def _load(self, adapter):
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump({"registry_version": "1.0.0", "adapters": [adapter]}, handle)
            path = Path(handle.name)

        try:
            return load_registry(path)
        finally:
            path.unlink()

    def _adapter(self, **overrides):
        base = {
            "adapter_id": "adapter.test.one",
            "kind": "synthetic",
            "profile": "passive",
            "entrypoint": "orchestrator.adapters.synthetic",
            "arguments": [{"kind": "literal", "value": "--fixture"}],
            "artifacts": ["sarif"],
            "description": "A test adapter for the registry shape checks.",
        }
        base.update(overrides)
        return base

    def test_a_destructive_profile_is_refused(self) -> None:
        with self.assertRaises(AdapterRefused) as raised:
            self._load(self._adapter(profile="destructive"))

        self.assertIn("no representation", raised.exception.reason)

    def test_an_entrypoint_with_a_space_is_refused(self) -> None:
        # A space is the beginning of a command line.
        with self.assertRaises(AdapterRefused) as raised:
            self._load(self._adapter(entrypoint="/bin/sh -c"))

        self.assertIn("command line", raised.exception.reason)

    def test_an_argument_with_a_shell_metacharacter_is_refused(self) -> None:
        for value in ("--out;rm", "$(id)", "a|b", "`whoami`", "a&&b", "x>y"):
            with self.subTest(value=value), self.assertRaises(AdapterRefused):
                self._load(
                    self._adapter(arguments=[{"kind": "literal", "value": value}])
                )

    def test_a_container_adapter_without_an_image_is_refused(self) -> None:
        with self.assertRaises(AdapterRefused) as raised:
            self._load(self._adapter(kind="container"))

        self.assertIn("no image_ref", raised.exception.reason)

    def test_a_synthetic_adapter_with_an_image_is_refused(self) -> None:
        with self.assertRaises(AdapterRefused) as raised:
            self._load(self._adapter(image_ref="zapImage"))

        self.assertIn("reaches no network", raised.exception.reason)

    def test_an_adapter_with_no_artifact_is_refused(self) -> None:
        with self.assertRaises(AdapterRefused):
            self._load(self._adapter(artifacts=[]))

    def test_an_argument_of_unknown_kind_is_refused(self) -> None:
        with self.assertRaises(AdapterRefused):
            self._load(
                self._adapter(arguments=[{"kind": "operator-supplied", "value": "x"}])
            )

    def test_a_duplicate_adapter_id_is_refused(self) -> None:
        import tempfile

        adapter = self._adapter()
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(
                {"registry_version": "1.0.0", "adapters": [adapter, dict(adapter)]},
                handle,
            )
            path = Path(handle.name)

        try:
            with self.assertRaises(AdapterRefused) as raised:
                load_registry(path)
            self.assertIn("declared twice", raised.exception.reason)
        finally:
            path.unlink()


class BuildingAnInvocation(unittest.TestCase):
    def test_the_vector_is_typed_and_substituted_from_authorised_values(self) -> None:
        invocation = invoke()

        self.assertEqual(invocation.entrypoint, "orchestrator.adapters.synthetic")
        self.assertEqual(
            invocation.argv,
            (
                "--fixture",
                "deterministic",
                "--target",
                "192.168.56.10",
                "--out",
                "/results/run-0001.sarif",
            ),
        )

    def test_a_budget_argument_is_filled_from_the_approved_budget(self) -> None:
        invocation = invoke("adapter.zap.baseline")

        self.assertIn("--max-duration", invocation.argv)
        self.assertIn("600", invocation.argv)

    def test_there_is_no_command_string_anywhere(self) -> None:
        # A caller has nothing to concatenate because no parameter would let it.
        invocation = invoke()

        self.assertIsInstance(invocation.argv, tuple)
        for argument in invocation.argv:
            self.assertNotIn(" ", argument)


class RefusedInvocations(unittest.TestCase):
    def test_an_unregistered_adapter_is_refused(self) -> None:
        with self.assertRaises(AdapterRefused) as raised:
            invoke("adapter.nobody.reviewed")

        self.assertIn("not a registered adapter", raised.exception.reason)

    def test_a_target_outside_the_pin_is_refused(self) -> None:
        # The address was resolved and pinned by E1-002; anything else reaches
        # somewhere the resolution never authorised.
        for target in ("8.8.8.8", "169.254.169.254", "192.168.56.11"):
            with self.subTest(target=target), self.assertRaises(AdapterRefused) as raised:
                invoke(target=target)

            self.assertIn("not among the addresses pinned", raised.exception.reason)

    def test_an_adapter_outside_the_allowed_profiles_is_refused(self) -> None:
        # A bounded-active adapter cannot run under a passive authorisation.
        registry = dict(REGISTRY)
        with self.assertRaises(AdapterRefused) as raised:
            build_invocation(
                "adapter.zap.baseline",
                registry=registry,
                target="192.168.56.10",
                pinned_addresses=PINNED,
                output_path="/results/x.sarif",
                budgets=BUDGETS,
                allowed_profiles=["bounded-active"],
            )

        self.assertIn("the scope allows", raised.exception.reason)

    def test_a_substitution_with_a_metacharacter_is_refused(self) -> None:
        with self.assertRaises(AdapterRefused):
            invoke(
                pinned_addresses=("192.168.56.10; rm -rf /",),
                target="192.168.56.10; rm -rf /",
            )

    def test_a_budget_argument_without_an_approved_budget_is_refused(self) -> None:
        with self.assertRaises(AdapterRefused) as raised:
            invoke("adapter.zap.baseline", budgets={})

        self.assertIn("none was approved", raised.exception.reason)


class MembershipIsNotSubstringMatching(unittest.TestCase):
    """str satisfies Sequence[str], and `in` on a string matches fragments.

    Passing one pinned address as a string turned the pin check into a fragment
    match: the target 56.1 was authorised against a pin of 192.168.56.10.
    """

    def test_a_bare_string_of_pinned_addresses_is_refused(self) -> None:
        with self.assertRaises(AdapterRefused) as raised:
            invoke(target="56.1", pinned_addresses="192.168.56.10")

        self.assertIn("not a single string", raised.exception.reason)

    def test_a_bare_string_of_allowed_profiles_is_refused(self) -> None:
        with self.assertRaises(AdapterRefused) as raised:
            invoke(allowed_profiles="passive")

        self.assertIn("not a single string", raised.exception.reason)

    def test_a_fragment_of_a_pinned_address_is_never_authorised(self) -> None:
        for fragment in ("56.1", "192.168", "0.10", "1"):
            with self.subTest(fragment=fragment), self.assertRaises(AdapterRefused):
                invoke(target=fragment, pinned_addresses=["192.168.56.10"])

    def test_a_proper_sequence_still_works(self) -> None:
        for pinned in (["192.168.56.10"], ("192.168.56.10",), {"192.168.56.10"}):
            with self.subTest(pinned=type(pinned).__name__):
                invocation = invoke(target="192.168.56.10", pinned_addresses=pinned)
                self.assertIn("192.168.56.10", invocation.argv)


if __name__ == "__main__":
    unittest.main()
