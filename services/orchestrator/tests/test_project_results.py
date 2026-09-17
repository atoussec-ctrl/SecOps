"""Tests for fail-closed scanner result aggregation."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "orchestrator"))

from projects.results import evaluate_assessment_completeness  # noqa: E402


PLAN = {
    "assessment_id": "ASM-2026-0001",
    "project_profile_digest": "a" * 64,
    "capabilities": ["inventory", "sast", "secrets"],
}


def run_receipt(capability: str, run_id: str) -> dict:
    return {
        "run_id": run_id,
        "assessment_id": "ASM-2026-0001",
        "project_profile_digest": "a" * 64,
        "capability": capability,
        "status": "complete",
        "exit_code": 0,
        "output": {
            "format": "sarif",
            "digest": "b" * 64,
            "size_bytes": 32,
            "findings_count": 0,
        },
        "errors": [],
        "timing": {
            "started_at": "2026-09-17T12:00:00Z",
            "finished_at": "2026-09-17T12:00:01Z",
        },
    }


class AssessmentCompleteness(unittest.TestCase):
    def test_all_required_scanners_complete(self) -> None:
        result = evaluate_assessment_completeness(
            PLAN,
            [run_receipt("sast", "RUN-2026-000001"), run_receipt("secrets", "RUN-2026-000002")],
        )
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["problems"], [])

    def test_missing_scanner_is_incomplete_not_zero_findings(self) -> None:
        result = evaluate_assessment_completeness(
            PLAN,
            [run_receipt("sast", "RUN-2026-000001")],
        )
        self.assertEqual(result["status"], "incomplete")
        self.assertIn("missing scanner result for capability: secrets", result["problems"])

    def test_failed_process_is_incomplete(self) -> None:
        receipt = run_receipt("sast", "RUN-2026-000001")
        receipt["status"] = "failed"
        receipt["exit_code"] = 2
        result = evaluate_assessment_completeness(
            {**PLAN, "capabilities": ["inventory", "sast"]},
            [receipt],
        )
        self.assertEqual(result["status"], "incomplete")
        self.assertTrue(any("status is not complete" in problem for problem in result["problems"]))
        self.assertTrue(any("exit code is not zero" in problem for problem in result["problems"]))

    def test_wrong_project_digest_is_incomplete(self) -> None:
        receipt = run_receipt("sast", "RUN-2026-000001")
        receipt["project_profile_digest"] = "c" * 64
        result = evaluate_assessment_completeness(
            {**PLAN, "capabilities": ["inventory", "sast"]},
            [receipt],
        )
        self.assertEqual(result["status"], "incomplete")
        self.assertTrue(any("project profile digest" in problem for problem in result["problems"]))

    def test_unplanned_scanner_does_not_gain_authority(self) -> None:
        receipt = run_receipt("sca", "RUN-2026-000001")
        result = evaluate_assessment_completeness(
            {**PLAN, "capabilities": ["inventory"]},
            [receipt],
        )
        self.assertEqual(result["status"], "incomplete")
        self.assertTrue(any("not authorized" in problem for problem in result["problems"]))

    def test_empty_output_is_incomplete(self) -> None:
        receipt = run_receipt("sast", "RUN-2026-000001")
        receipt["output"]["size_bytes"] = 0
        result = evaluate_assessment_completeness(
            {**PLAN, "capabilities": ["inventory", "sast"]},
            [receipt],
        )
        self.assertEqual(result["status"], "incomplete")
        self.assertTrue(any("output is empty" in problem for problem in result["problems"]))

    def test_duplicate_run_id_is_incomplete(self) -> None:
        first = run_receipt("sast", "RUN-2026-000001")
        second = run_receipt("secrets", "RUN-2026-000001")
        result = evaluate_assessment_completeness(PLAN, [first, second])
        self.assertEqual(result["status"], "incomplete")
        self.assertTrue(any("duplicate scanner run id" in problem for problem in result["problems"]))


if __name__ == "__main__":
    unittest.main()
