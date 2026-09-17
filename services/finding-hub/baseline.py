"""Baseline comparison for canonical finding fingerprints.

Absence in one scan is not called "fixed" here. A missing occurrence only means
"not observed" until the Finding Hub's independent retest workflow verifies the
remediation against the intended artifact.
"""

from __future__ import annotations

from typing import Any, Iterable

HEX = set("0123456789abcdef")
BASELINE_STATES = frozenset({"open", "verified"})


class BaselineError(ValueError):
    """Baseline input is ambiguous or invalid."""


def _fingerprint(value: Any) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(character not in HEX for character in value):
        raise BaselineError("fingerprint must be a 64-character lowercase hexadecimal value")
    return value


def compare_baseline(
    current_fingerprints: Iterable[str],
    baseline_records: Iterable[dict[str, Any]],
) -> dict[str, list[str]]:
    """Classify current findings against a previous reviewed baseline.

    Baseline records use state=open for previously active findings and
    state=verified for findings independently verified as remediated.
    """

    current = {_fingerprint(value) for value in current_fingerprints}
    baseline: dict[str, str] = {}

    for record in baseline_records:
        if not isinstance(record, dict):
            raise BaselineError("baseline record must be an object")
        fingerprint = _fingerprint(record.get("fingerprint"))
        state = record.get("state")
        if state not in BASELINE_STATES:
            raise BaselineError("baseline state must be open or verified")
        if fingerprint in baseline:
            raise BaselineError(f"duplicate baseline fingerprint: {fingerprint}")
        baseline[fingerprint] = state

    baseline_keys = set(baseline)
    new = sorted(current - baseline_keys)
    existing = sorted(
        fingerprint for fingerprint in current if baseline.get(fingerprint) == "open"
    )
    regressions = sorted(
        fingerprint for fingerprint in current if baseline.get(fingerprint) == "verified"
    )
    not_observed = sorted(
        fingerprint
        for fingerprint, state in baseline.items()
        if state == "open" and fingerprint not in current
    )
    verified_absent = sorted(
        fingerprint
        for fingerprint, state in baseline.items()
        if state == "verified" and fingerprint not in current
    )

    return {
        "new": new,
        "existing": existing,
        "regressions": regressions,
        "not_observed": not_observed,
        "verified_absent": verified_absent,
    }
