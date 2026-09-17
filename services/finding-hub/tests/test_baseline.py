from __future__ import annotations

import unittest

from baseline import BaselineError, compare_baseline


class BaselineComparisonTests(unittest.TestCase):
    def test_classifies_new_existing_regression_and_absence(self) -> None:
        new = "1" * 64
        existing = "2" * 64
        regression = "3" * 64
        not_observed = "4" * 64
        verified_absent = "5" * 64

        result = compare_baseline(
            [new, existing, regression],
            [
                {"fingerprint": existing, "state": "open"},
                {"fingerprint": regression, "state": "verified"},
                {"fingerprint": not_observed, "state": "open"},
                {"fingerprint": verified_absent, "state": "verified"},
            ],
        )

        self.assertEqual([new], result["new"])
        self.assertEqual([existing], result["existing"])
        self.assertEqual([regression], result["regressions"])
        self.assertEqual([not_observed], result["not_observed"])
        self.assertEqual([verified_absent], result["verified_absent"])

    def test_absence_is_not_called_fixed(self) -> None:
        fingerprint = "a" * 64
        result = compare_baseline([], [{"fingerprint": fingerprint, "state": "open"}])
        self.assertEqual([fingerprint], result["not_observed"])
        self.assertNotIn("fixed", result)

    def test_duplicate_current_occurrences_collapse_to_one_finding_identity(self) -> None:
        fingerprint = "b" * 64
        result = compare_baseline([fingerprint, fingerprint], [])
        self.assertEqual([fingerprint], result["new"])

    def test_duplicate_baseline_is_rejected(self) -> None:
        fingerprint = "c" * 64
        with self.assertRaises(BaselineError):
            compare_baseline(
                [],
                [
                    {"fingerprint": fingerprint, "state": "open"},
                    {"fingerprint": fingerprint, "state": "verified"},
                ],
            )

    def test_invalid_fingerprint_and_state_are_rejected(self) -> None:
        with self.assertRaises(BaselineError):
            compare_baseline(["not-a-fingerprint"], [])
        with self.assertRaises(BaselineError):
            compare_baseline([], [{"fingerprint": "d" * 64, "state": "ignored"}])


if __name__ == "__main__":
    unittest.main()
