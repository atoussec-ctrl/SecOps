"""Versioned canonical finding fingerprints.

A fingerprint represents finding identity, not a scanner message or a source
line. Volatile fields such as message text, timestamps and line numbers are
therefore intentionally excluded. The chosen strategy and its normalized key
must come from validated occurrence data.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

ALGORITHM_VERSION = "1.0.0"
HEX64 = set("0123456789abcdef")


class FingerprintError(ValueError):
    """An occurrence cannot produce a safe canonical identity."""


def _required_string(value: Any, label: str, maximum: int = 400) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise FingerprintError(f"{label} must be a non-empty string up to {maximum} characters")
    return value


def _safe_repository_path(value: Any) -> str:
    path = _required_string(value, "location.path")
    if "\\" in path or path.startswith("/") or "\x00" in path:
        raise FingerprintError("location.path must be repository-relative and forward-slashed")
    segments = path.split("/")
    if any(segment in {"", ".", ".."} for segment in segments):
        raise FingerprintError("location.path contains an unsafe path segment")
    return path


def _canonical_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def fingerprint_occurrence(occurrence: dict[str, Any]) -> dict[str, str]:
    """Return the versioned canonical fingerprint for a normalized occurrence."""

    if not isinstance(occurrence, dict):
        raise FingerprintError("occurrence must be an object")

    source = occurrence.get("source")
    asset = occurrence.get("asset")
    location = occurrence.get("location")
    inputs = occurrence.get("fingerprint_inputs")
    mappings = occurrence.get("mappings", {})
    if not all(isinstance(value, dict) for value in (source, asset, location, inputs, mappings)):
        raise FingerprintError("occurrence source, asset, location, fingerprint_inputs and mappings must be objects")

    strategy = _required_string(inputs.get("strategy"), "fingerprint_inputs.strategy", 100)
    asset_id = _required_string(asset.get("asset_id"), "asset.asset_id", 100)
    normalized_key = inputs.get("normalized_key")

    payload: dict[str, Any] = {
        "algorithm_version": ALGORITHM_VERSION,
        "strategy": strategy,
        "asset_id": asset_id,
    }

    if strategy == "repository-rule-location":
        rule_family = source.get("rule_family") or source.get("rule_id")
        payload.update(
            {
                "rule_family": _required_string(rule_family, "source rule family", 200),
                "path": _safe_repository_path(location.get("path")),
                "normalized_key": _required_string(normalized_key, "fingerprint_inputs.normalized_key"),
            }
        )
    elif strategy == "asset-operation-weakness":
        cwes = mappings.get("cwe", [])
        if not isinstance(cwes, list) or not cwes or not all(isinstance(item, str) for item in cwes):
            raise FingerprintError("asset-operation-weakness requires at least one CWE")
        payload.update(
            {
                "operation": _required_string(location.get("operation"), "location.operation", 200),
                "parameter": location.get("parameter") or "",
                "cwe": sorted(set(cwes)),
                "normalized_key": _required_string(normalized_key, "fingerprint_inputs.normalized_key"),
            }
        )
    elif strategy == "artifact-package-vulnerability":
        digest = _required_string(asset.get("artifact_digest"), "asset.artifact_digest", 80)
        if not digest.startswith("sha256:") or len(digest) != 71:
            raise FingerprintError("artifact-package-vulnerability requires a sha256 artifact digest")
        component = location.get("package_url") or location.get("component")
        cves = mappings.get("cve", [])
        if not isinstance(cves, list) or not cves or not all(isinstance(item, str) for item in cves):
            raise FingerprintError("artifact-package-vulnerability requires at least one CVE")
        payload.update(
            {
                "artifact_digest": digest,
                "component": _required_string(component, "package component"),
                "cve": sorted(set(cves)),
            }
        )
    elif strategy == "tool-fingerprint":
        payload.update(
            {
                "tool_name": _required_string(source.get("tool_name"), "source.tool_name", 100),
                "rule_id": _required_string(source.get("rule_id"), "source.rule_id", 200),
                "tool_fingerprint": _required_string(
                    inputs.get("tool_fingerprint"),
                    "fingerprint_inputs.tool_fingerprint",
                    200,
                ),
            }
        )
    else:
        raise FingerprintError(f"unsupported fingerprint strategy: {strategy}")

    return {
        "algorithm_version": ALGORITHM_VERSION,
        "value": _canonical_hash(payload),
    }
