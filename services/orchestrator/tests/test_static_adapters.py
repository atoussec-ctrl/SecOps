from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from projects.static_adapters import (
    StaticAdapter,
    StaticAdapterRefused,
    build_static_invocation,
    load_static_registry,
)


class StaticAdapterRegistryTests(unittest.TestCase):
    def test_sample_registry_loads_builtin_inventory(self) -> None:
        registry = load_static_registry()
        adapter = registry["adapter.project.inventory"]
        self.assertEqual("inventory", adapter.capability)
        self.assertEqual("read-only", adapter.source_access)
        self.assertEqual("none", adapter.network_access)
        self.assertIsNone(adapter.image_ref)

    def test_paths_with_spaces_are_safe_argv_not_shell_strings(self) -> None:
        registry = load_static_registry()
        with tempfile.TemporaryDirectory(prefix="secops static adapter ") as temporary:
            base = Path(temporary)
            project = base / "project source"
            workspace = base / "workspace results"
            project.mkdir()
            workspace.mkdir()

            invocation = build_static_invocation(
                "adapter.project.inventory",
                registry=registry,
                authorized_capabilities=["inventory"],
                project_root=project,
                output_path=workspace / "inventory.json",
            )

            self.assertEqual("builtin.project-inventory", invocation.entrypoint)
            self.assertIn(str(project.resolve()), invocation.argv)
            self.assertIn(str((workspace / "inventory.json").resolve()), invocation.argv)
            self.assertEqual("none", invocation.network_access)

    def test_output_inside_source_tree_is_refused(self) -> None:
        registry = load_static_registry()
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary) / "project"
            project.mkdir()
            with self.assertRaises(StaticAdapterRefused):
                build_static_invocation(
                    "adapter.project.inventory",
                    registry=registry,
                    authorized_capabilities=["inventory"],
                    project_root=project,
                    output_path=project / "secops-output.json",
                )

    def test_capability_must_be_authorized_by_assessment(self) -> None:
        registry = load_static_registry()
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            project = base / "project"
            project.mkdir()
            with self.assertRaises(StaticAdapterRefused):
                build_static_invocation(
                    "adapter.project.inventory",
                    registry=registry,
                    authorized_capabilities=["sast"],
                    project_root=project,
                    output_path=base / "result.json",
                )

    def test_required_rules_path_cannot_be_implicitly_invented(self) -> None:
        adapter = StaticAdapter(
            adapter_id="adapter.semgrep.static",
            kind="container",
            capability="sast",
            source_access="read-only",
            network_access="none",
            entrypoint="semgrep",
            arguments=(
                {"kind": "rules-path", "value": "--config"},
                {"kind": "project-root", "value": "--scan"},
                {"kind": "output-path", "value": "--sarif-output"},
            ),
            artifacts=("sarif",),
            image_ref="semgrep",
        )
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            project = base / "project"
            project.mkdir()
            with self.assertRaises(StaticAdapterRefused):
                build_static_invocation(
                    adapter.adapter_id,
                    registry={adapter.adapter_id: adapter},
                    authorized_capabilities=["sast"],
                    project_root=project,
                    output_path=base / "result.sarif",
                )

    def test_registry_refuses_network_or_writable_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "registry.json"
            base = {
                "registry_version": "1.0.0",
                "adapters": [
                    {
                        "adapter_id": "adapter.bad.static",
                        "kind": "synthetic",
                        "capability": "inventory",
                        "source_access": "read-only",
                        "network_access": "internet",
                        "entrypoint": "builtin.bad",
                        "arguments": [],
                        "artifacts": ["inventory"],
                        "description": "An intentionally unsafe adapter fixture for refusal testing."
                    }
                ]
            }
            path.write_text(json.dumps(base), encoding="utf-8")
            with self.assertRaises(StaticAdapterRefused):
                load_static_registry(path)

            base["adapters"][0]["network_access"] = "none"
            base["adapters"][0]["source_access"] = "read-write"
            path.write_text(json.dumps(base), encoding="utf-8")
            with self.assertRaises(StaticAdapterRefused):
                load_static_registry(path)


if __name__ == "__main__":
    unittest.main()
