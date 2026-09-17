"""Fail-closed completeness evaluation for external scanner receipts."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable

NON_SCANNER_CAPABILITIES = frozenset({"inventory"})


def _parse_time(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None


def evaluate_assessment_completeness(
    plan: dict[str, Any],
    runs: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Return complete only when every planned scanner capability has valid evidence.

    This function intentionally does not decide vulnerability risk. It decides
    whether the required evidence exists and belongs to the exact assessment and
    project profile. A later policy engine may evaluate findings only after this
    result is complete.
    """

    problems: list[str] = []
    assessment_id = plan.get("assessment_id")
    project_digest = plan.get("project_profile_digest")
    planned = set(plan.get("capabilities", []))
    scanner_required = planned - NON_SCANNER_CAPABILITIES
    seen_capabilities: set[str] = set()
    seen_run_ids: set[str] = set()
    run_count = 0

    for run in runs:
        run_count += 1
        run_id = run.get("run_id", "<missing>")
        capability = run.get("capability")

        if run_id in seen_run_ids:
            problems.append(f"duplicate scanner run id: {run_id}")
        seen_run_ids.add(run_id)

        if run.get("assessment_id") != assessment_id:
            problems.append(f"{run_id}: assessment id does not match the plan")
        if run.get("project_profile_digest") != project_digest:
            problems.append(f"{run_id}: project profile digest does not match the plan")
        if capability not in scanner_required:
            problems.append(f"{run_id}: capability {capability!r} is not authorized by the plan")
        else:
            seen_capabilities.add(capability)

        if run.get("status") != "complete":
            problems.append(f"{run_id}: scanner status is not complete")
        if run.get("exit_code") != 0:
            problems.append(f"{run_id}: scanner exit code is not zero")

        errors = run.get("errors")
        if not isinstance(errors, list) or errors:
            problems.append(f"{run_id}: scanner reported errors or an invalid error list")

        output = run.get("output")
        if not isinstance(output, dict):
            problems.append(f"{run_id}: scanner output receipt is missing")
        else:
            if not isinstance(output.get("digest"), str) or len(output["digest"]) != 64:
                problems.append(f"{run_id}: scanner output digest is missing or malformed")
            if not isinstance(output.get("size_bytes"), int) or output["size_bytes"] <= 0:
                problems.append(f"{run_id}: scanner output is empty")
            if not isinstance(output.get("findings_count"), int) or output["findings_count"] < 0:
                problems.append(f"{run_id}: findings count is invalid")

        timing = run.get("timing")
        if not isinstance(timing, dict):
            problems.append(f"{run_id}: timing receipt is missing")
        else:
            started = _parse_time(timing.get("started_at"))
            finished = _parse_time(timing.get("finished_at"))
            if started is None or finished is None or finished < started:
                problems.append(f"{run_id}: scanner timing is invalid")

    for capability in sorted(scanner_required - seen_capabilities):
        problems.append(f"missing scanner result for capability: {capability}")

    return {
        "status": "complete" if not problems else "incomplete",
        "assessment_id": assessment_id,
        "project_profile_digest": project_digest,
        "required_scanner_capabilities": sorted(scanner_required),
        "received_runs": run_count,
        "problems": sorted(problems),
    }
