"""Typed invocations for static-readonly external project adapters.

This registry is intentionally separate from the network-target registry. Static
analysis receives an authorized source snapshot and controlled infrastructure
paths; it never receives a network target, an active profile or a command
string. This module builds argv only and does not execute processes.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Mapping, Sequence

__all__ = [
    "StaticAdapter",
    "StaticAdapterRefused",
    "StaticInvocation",
    "build_static_invocation",
    "load_static_registry",
]

_REGISTRY: Final = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "contracts"
    / "projects"
    / "samples"
    / "static-adapter-registry"
    / "static-readonly.json"
)

_ADAPTER_ID: Final = re.compile(
    r"^adapter\.[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$"
)
_ENTRYPOINT: Final = re.compile(r"^[a-zA-Z0-9._/-]+$")
_CONTROL: Final = re.compile(r"[\x00\r\n]")
_CAPABILITIES: Final = frozenset(
    {"inventory", "sast", "secrets", "sca", "iac", "workflow", "sbom"}
)
_ARGUMENT_KINDS: Final = frozenset(
    {"literal", "project-root", "output-path", "rules-path", "advisory-path"}
)
_ARTIFACTS: Final = frozenset(
    {"inventory", "sarif", "json-findings", "cyclonedx", "spdx", "log"}
)


class StaticAdapterRefused(ValueError):
    """The requested static adapter invocation is not authorized or well formed."""


@dataclass(frozen=True)
class StaticAdapter:
    adapter_id: str
    kind: str
    capability: str
    source_access: str
    network_access: str
    entrypoint: str
    arguments: tuple[Mapping[str, str], ...]
    artifacts: tuple[str, ...]
    image_ref: str | None = None


@dataclass(frozen=True)
class StaticInvocation:
    adapter_id: str
    capability: str
    entrypoint: str
    argv: tuple[str, ...]
    image_ref: str | None
    source_access: str
    network_access: str


def _assert_text(value: object, label: str, maximum: int = 500) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise StaticAdapterRefused(f"{label} must be a non-empty bounded string")
    if _CONTROL.search(value):
        raise StaticAdapterRefused(f"{label} contains a control character")
    return value


def _assert_shape(entry: Mapping[str, object]) -> StaticAdapter:
    adapter_id = _assert_text(entry.get("adapter_id"), "adapter_id", 120)
    if not _ADAPTER_ID.fullmatch(adapter_id):
        raise StaticAdapterRefused(f"invalid static adapter id: {adapter_id!r}")

    kind = _assert_text(entry.get("kind"), f"{adapter_id}.kind", 20)
    if kind not in {"container", "synthetic"}:
        raise StaticAdapterRefused(f"{adapter_id} declares unknown kind {kind!r}")

    capability = _assert_text(entry.get("capability"), f"{adapter_id}.capability", 30)
    if capability not in _CAPABILITIES:
        raise StaticAdapterRefused(f"{adapter_id} declares unknown capability {capability!r}")

    if entry.get("source_access") != "read-only":
        raise StaticAdapterRefused(f"{adapter_id} must use read-only source access")
    if entry.get("network_access") != "none":
        raise StaticAdapterRefused(f"{adapter_id} may not have network access")

    entrypoint = _assert_text(entry.get("entrypoint"), f"{adapter_id}.entrypoint", 120)
    if not _ENTRYPOINT.fullmatch(entrypoint):
        raise StaticAdapterRefused(f"{adapter_id} entrypoint is not a single executable identifier")

    image_ref = entry.get("image_ref")
    if kind == "container" and not isinstance(image_ref, str):
        raise StaticAdapterRefused(f"{adapter_id} container adapter requires image_ref")
    if kind == "synthetic" and image_ref is not None:
        raise StaticAdapterRefused(f"{adapter_id} synthetic adapter may not name an image")

    raw_arguments = entry.get("arguments")
    if not isinstance(raw_arguments, list):
        raise StaticAdapterRefused(f"{adapter_id} must declare an argument vector")

    arguments: list[Mapping[str, str]] = []
    for raw in raw_arguments:
        if not isinstance(raw, Mapping) or set(raw) != {"kind", "value"}:
            raise StaticAdapterRefused(f"{adapter_id} has a malformed argument")
        argument_kind = _assert_text(raw.get("kind"), f"{adapter_id}.argument.kind", 30)
        argument_value = _assert_text(raw.get("value"), f"{adapter_id}.argument.value", 200)
        if argument_kind not in _ARGUMENT_KINDS:
            raise StaticAdapterRefused(
                f"{adapter_id} has unknown argument kind {argument_kind!r}"
            )
        arguments.append({"kind": argument_kind, "value": argument_value})

    raw_artifacts = entry.get("artifacts")
    if not isinstance(raw_artifacts, list) or not raw_artifacts:
        raise StaticAdapterRefused(f"{adapter_id} must declare at least one artifact")
    artifacts: list[str] = []
    for raw in raw_artifacts:
        artifact = _assert_text(raw, f"{adapter_id}.artifact", 40)
        if artifact not in _ARTIFACTS:
            raise StaticAdapterRefused(f"{adapter_id} declares unknown artifact {artifact!r}")
        artifacts.append(artifact)

    return StaticAdapter(
        adapter_id=adapter_id,
        kind=kind,
        capability=capability,
        source_access="read-only",
        network_access="none",
        entrypoint=entrypoint,
        arguments=tuple(arguments),
        artifacts=tuple(artifacts),
        image_ref=image_ref if isinstance(image_ref, str) else None,
    )


def load_static_registry(path: Path = _REGISTRY) -> dict[str, StaticAdapter]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise StaticAdapterRefused(f"static adapter registry is unreadable: {error}") from error

    if not isinstance(document, dict) or not isinstance(document.get("adapters"), list):
        raise StaticAdapterRefused("static adapter registry must contain an adapters array")
    if not document["adapters"]:
        raise StaticAdapterRefused("static adapter registry declares no adapters")

    adapters: dict[str, StaticAdapter] = {}
    for raw in document["adapters"]:
        if not isinstance(raw, Mapping):
            raise StaticAdapterRefused("static adapter entry must be an object")
        adapter = _assert_shape(raw)
        if adapter.adapter_id in adapters:
            raise StaticAdapterRefused(f"static adapter {adapter.adapter_id} is declared twice")
        adapters[adapter.adapter_id] = adapter
    return adapters


def _path_text(value: str | Path, label: str, *, must_exist: bool) -> Path:
    raw = str(value)
    _assert_text(raw, label, 2000)
    path = Path(value).expanduser()
    try:
        return path.resolve(strict=must_exist)
    except OSError as error:
        raise StaticAdapterRefused(f"{label} cannot be resolved: {error}") from error


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def build_static_invocation(
    adapter_id: str,
    *,
    registry: Mapping[str, StaticAdapter],
    authorized_capabilities: Sequence[str],
    project_root: str | Path,
    output_path: str | Path,
    rules_path: str | Path | None = None,
    advisory_path: str | Path | None = None,
) -> StaticInvocation:
    """Build one approved argv without executing it or invoking a shell."""

    adapter = registry.get(adapter_id)
    if adapter is None:
        raise StaticAdapterRefused(f"{adapter_id} is not registered for static assessment")
    if adapter.capability not in set(authorized_capabilities):
        raise StaticAdapterRefused(
            f"{adapter_id} capability {adapter.capability!r} is not authorized by the assessment"
        )

    root = _path_text(project_root, "project_root", must_exist=True)
    if not root.is_dir():
        raise StaticAdapterRefused("project_root must be a directory")

    output = _path_text(output_path, "output_path", must_exist=False)
    if _is_within(output, root):
        raise StaticAdapterRefused("static adapter output may not be written inside project_root")

    resolved_rules = (
        _path_text(rules_path, "rules_path", must_exist=True) if rules_path is not None else None
    )
    resolved_advisory = (
        _path_text(advisory_path, "advisory_path", must_exist=True)
        if advisory_path is not None
        else None
    )

    values = {
        "project-root": str(root),
        "output-path": str(output),
        "rules-path": str(resolved_rules) if resolved_rules is not None else None,
        "advisory-path": str(resolved_advisory) if resolved_advisory is not None else None,
    }

    argv: list[str] = []
    for argument in adapter.arguments:
        kind = argument["kind"]
        flag = argument["value"]
        if kind == "literal":
            argv.append(flag)
            continue
        resolved = values[kind]
        if resolved is None:
            raise StaticAdapterRefused(
                f"{adapter_id} requires {kind} but the assessment supplied none"
            )
        argv.extend((flag, resolved))

    return StaticInvocation(
        adapter_id=adapter.adapter_id,
        capability=adapter.capability,
        entrypoint=adapter.entrypoint,
        argv=tuple(argv),
        image_ref=adapter.image_ref,
        source_access=adapter.source_access,
        network_access=adapter.network_access,
    )
