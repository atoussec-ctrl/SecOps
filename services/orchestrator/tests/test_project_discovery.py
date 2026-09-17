"""Acceptance tests for external project discovery."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from projects.discovery import ProjectDiscoveryError, discover_project  # noqa: E402


SNAPSHOT = {
    "provider": "github",
    "owner": "example-org",
    "repository": "example-web",
    "commit_sha": "1" * 40,
    "branch": "main",
    "dirty": False,
}


def write_fixture(root: Path) -> None:
    (root / ".github" / "workflows").mkdir(parents=True)
    (root / "infra").mkdir()
    (root / "src").mkdir()
    (root / "api").mkdir()

    (root / "package.json").write_text(
        json.dumps(
            {
                "private": True,
                "workspaces": ["packages/*"],
                "dependencies": {"react": "^19.0.0"},
                "devDependencies": {
                    "typescript": "^5.9.0",
                    "vite": "^7.0.0",
                    "vitest": "^3.0.0",
                },
            }
        ),
        encoding="utf-8",
    )
    (root / "package-lock.json").write_text("{}", encoding="utf-8")
    (root / "tsconfig.json").write_text("{}", encoding="utf-8")
    (root / "vite.config.ts").write_text("export default {}", encoding="utf-8")
    (root / "src" / "main.tsx").write_text("export {};", encoding="utf-8")
    (root / ".github" / "workflows" / "ci.yml").write_text("name: CI\n", encoding="utf-8")
    (root / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
    (root / "infra" / "main.tf").write_text("terraform {}\n", encoding="utf-8")
    (root / "api" / "openapi.yaml").write_text("openapi: 3.1.0\n", encoding="utf-8")


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def names(profile: dict, group: str) -> set[str]:
    return {entry["name"] for entry in profile["discovery"][group]}


class ExternalProjectDiscovery(unittest.TestCase):
    def test_discovers_web_stack_from_evidence_without_execution(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_fixture(root)

            profile = discover_project(root, project_id="example-web", snapshot=SNAPSHOT)

            self.assertEqual(profile["source"]["project_root"], ".")
            self.assertEqual(profile["source"]["access"], "read-only")
            self.assertIn("typescript", names(profile, "languages"))
            self.assertIn("react", names(profile, "frameworks"))
            self.assertIn("npm", names(profile, "package_managers"))
            self.assertIn("vite", names(profile, "build_systems"))
            self.assertIn("vitest", names(profile, "test_frameworks"))
            self.assertIn("github-actions", names(profile, "ci_systems"))
            self.assertIn("dockerfile", names(profile, "containers"))
            self.assertIn("terraform", names(profile, "iac"))
            self.assertIn("openapi", names(profile, "api_contracts"))
            self.assertIn("javascript-workspace", names(profile, "workspaces"))
            self.assertRegex(profile["fingerprint"], r"^[0-9a-f]{64}$")

    def test_discovery_does_not_modify_source_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_fixture(root)
            before = {
                path.relative_to(root).as_posix(): file_digest(path)
                for path in root.rglob("*")
                if path.is_file()
            }

            discover_project(root, project_id="example-web", snapshot=SNAPSHOT)

            after = {
                path.relative_to(root).as_posix(): file_digest(path)
                for path in root.rglob("*")
                if path.is_file()
            }
            self.assertEqual(before, after)

    def test_fingerprint_is_independent_of_host_root_path(self) -> None:
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            first_root = Path(first)
            second_root = Path(second)
            write_fixture(first_root)
            write_fixture(second_root)

            first_profile = discover_project(
                first_root, project_id="example-web", snapshot=SNAPSHOT
            )
            second_profile = discover_project(
                second_root, project_id="example-web", snapshot=SNAPSHOT
            )

            self.assertEqual(first_profile, second_profile)
            self.assertEqual(first_profile["fingerprint"], second_profile["fingerprint"])

    def test_dirty_snapshot_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            snapshot = dict(SNAPSHOT)
            snapshot["dirty"] = True
            with self.assertRaises(ProjectDiscoveryError):
                discover_project(directory, project_id="example-web", snapshot=snapshot)

    def test_project_root_symlink_is_rejected(self) -> None:
        if not hasattr(os, "symlink"):
            self.skipTest("symlink is unavailable")
        with tempfile.TemporaryDirectory() as parent:
            base = Path(parent)
            real = base / "real"
            real.mkdir()
            link = base / "link"
            try:
                link.symlink_to(real, target_is_directory=True)
            except OSError as error:
                self.skipTest(f"symlink creation is unavailable: {error}")
            with self.assertRaises(ProjectDiscoveryError):
                discover_project(link, project_id="example-web", snapshot=SNAPSHOT)

    def test_symlinked_content_outside_root_is_not_discovered(self) -> None:
        if not hasattr(os, "symlink"):
            self.skipTest("symlink is unavailable")
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            write_fixture(root)
            external = Path(outside) / "secret.py"
            external.write_text("print('outside')\n", encoding="utf-8")
            link = root / "outside.py"
            try:
                link.symlink_to(external)
            except OSError as error:
                self.skipTest(f"symlink creation is unavailable: {error}")

            profile = discover_project(root, project_id="example-web", snapshot=SNAPSHOT)
            python_evidence = [
                evidence
                for component in profile["discovery"]["languages"]
                if component["name"] == "python"
                for evidence in component["evidence"]
            ]
            self.assertNotIn("outside.py", python_evidence)

    def test_malformed_package_manifest_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text("{not-json", encoding="utf-8")
            with self.assertRaises(ProjectDiscoveryError):
                discover_project(root, project_id="example-web", snapshot=SNAPSHOT)


if __name__ == "__main__":
    unittest.main()
