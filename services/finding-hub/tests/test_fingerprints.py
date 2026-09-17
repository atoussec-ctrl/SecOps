from __future__ import annotations

import copy
import unittest

from fingerprints import FingerprintError, fingerprint_occurrence


def occurrence() -> dict:
    return {
        "source": {
            "tool_name": "semgrep",
            "tool_version": "1.0.0",
            "rule_id": "typescript.raw-html",
            "rule_family": "web.raw-html",
        },
        "asset": {"asset_id": "repo-site-unifique"},
        "location": {
            "kind": "source-file",
            "path": "src/components/Card.tsx",
            "start_line": 42,
        },
        "message": "raw HTML sink",
        "mappings": {"cwe": ["CWE-79"]},
        "fingerprint_inputs": {
            "strategy": "repository-rule-location",
            "normalized_key": "dangerouslySetInnerHTML:Card:body",
        },
        "first_observed_at": "2026-09-17T10:00:00Z",
        "last_observed_at": "2026-09-17T10:00:00Z",
    }


class CanonicalFingerprintTests(unittest.TestCase):
    def test_ignores_volatile_message_line_and_timestamps(self) -> None:
        first = occurrence()
        second = copy.deepcopy(first)
        second["message"] = "scanner wording changed completely"
        second["location"]["start_line"] = 900
        second["first_observed_at"] = "2026-10-01T00:00:00Z"
        second["last_observed_at"] = "2026-10-01T00:00:01Z"

        self.assertEqual(fingerprint_occurrence(first), fingerprint_occurrence(second))

    def test_semantic_location_change_changes_identity(self) -> None:
        first = occurrence()
        second = copy.deepcopy(first)
        second["fingerprint_inputs"]["normalized_key"] = "dangerouslySetInnerHTML:OtherCard:body"
        self.assertNotEqual(
            fingerprint_occurrence(first)["value"],
            fingerprint_occurrence(second)["value"],
        )

    def test_repository_path_escape_is_rejected(self) -> None:
        item = occurrence()
        item["location"]["path"] = "../outside.ts"
        with self.assertRaises(FingerprintError):
            fingerprint_occurrence(item)

    def test_package_vulnerability_is_bound_to_artifact_component_and_cve(self) -> None:
        item = {
            "source": {"tool_name": "trivy", "rule_id": "CVE-2026-12345"},
            "asset": {
                "asset_id": "image-api",
                "artifact_digest": "sha256:" + "a" * 64,
            },
            "location": {
                "kind": "component",
                "package_url": "pkg:npm/example@1.0.0",
            },
            "mappings": {"cve": ["CVE-2026-12345"]},
            "fingerprint_inputs": {"strategy": "artifact-package-vulnerability"},
        }
        first = fingerprint_occurrence(item)
        changed = copy.deepcopy(item)
        changed["asset"]["artifact_digest"] = "sha256:" + "b" * 64
        self.assertNotEqual(first["value"], fingerprint_occurrence(changed)["value"])

    def test_tool_fingerprint_fallback_requires_tool_fingerprint(self) -> None:
        item = occurrence()
        item["fingerprint_inputs"] = {"strategy": "tool-fingerprint"}
        with self.assertRaises(FingerprintError):
            fingerprint_occurrence(item)


if __name__ == "__main__":
    unittest.main()
