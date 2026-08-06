"""The adapter registry, and the only way to build an invocation (E1-007).

`02-container-component.md` requires the registry to map a fixed adapter ID to
an immutable container digest and a typed command, and `04-orchestrator-spec.md`
adds a fixed entrypoint, a typed argument array and no user input through a
shell.

The table lives in `packages/contracts/security/samples/adapter-registry/` and
is loaded rather than restated, like the run lifecycle.

### Why an invocation is built here and nowhere else

`build_invocation` is the only function that produces an argument vector, and it
takes a pinned target, an output path and approved budgets — not a command. A
caller has nothing to concatenate, because there is no parameter that would let
it.

Three things it refuses, each of which a caller could otherwise do by accident:

- an adapter that is not registered, so a run cannot name a tool nobody
  reviewed;
- a target that is not one of the addresses the grant pinned, so an invocation
  cannot reach somewhere the resolution never authorised;
- a profile the scope did not allow, so a bounded-active adapter cannot run
  under a passive authorisation.

Standard library only, and nothing here executes anything. Producing the vector
and running it are separate on purpose: the architecture check enforces that
only the orchestrator spawns a process, and this module is not where that
happens.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Mapping, Sequence

__all__ = [
    "Adapter",
    "AdapterRefused",
    "Invocation",
    "build_invocation",
    "load_registry",
]

_REGISTRY: Final = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "contracts"
    / "security"
    / "samples"
    / "adapter-registry"
    / "lab.json"
)

# The same refusal the contract expresses, restated where it runs. A JSON Schema
# constrains documents that are validated against it, and nothing validates the
# registry on the invocation path.
_SHELL_METACHARACTER: Final = re.compile(r"""[\s;&|`$<>(){}\\"']""")

_ARGUMENT_KINDS: Final = frozenset({"literal", "target", "output-path", "budget"})
_PROFILES: Final = frozenset({"passive", "bounded-active"})


class AdapterRefused(Exception):
    """An adapter may not be invoked. The reason is meant to reach an audit record."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Adapter:
    adapter_id: str
    kind: str
    profile: str
    entrypoint: str
    arguments: tuple[Mapping[str, str], ...]
    artifacts: tuple[str, ...]
    image_ref: str | None = None


@dataclass(frozen=True)
class Invocation:
    """A fixed entrypoint and a typed vector. There is no command string here,
    and no method that produces one."""

    adapter_id: str
    entrypoint: str
    argv: tuple[str, ...]
    image_ref: str | None


def load_registry(path: Path = _REGISTRY) -> dict[str, Adapter]:
    document = json.loads(path.read_text(encoding="utf-8"))
    adapters: dict[str, Adapter] = {}

    if not document.get("adapters"):
        # A registry that loaded nothing permits nothing, which reads as a very
        # strict registry rather than as a broken one.
        raise AdapterRefused(f"the adapter registry at {path} declares no adapters")

    for entry in document["adapters"]:
        adapter = _assert_shape(entry)

        if adapter.adapter_id in adapters:
            raise AdapterRefused(f"adapter {adapter.adapter_id} is declared twice")

        adapters[adapter.adapter_id] = adapter

    return adapters


def _assert_shape(entry: Mapping[str, object]) -> Adapter:
    for name in ("adapter_id", "kind", "profile", "entrypoint", "description"):
        if not isinstance(entry.get(name), str) or not entry[name]:
            raise AdapterRefused(f"adapter entry is missing {name}")

    adapter_id = str(entry["adapter_id"])
    kind = str(entry["kind"])

    if kind not in ("container", "synthetic"):
        raise AdapterRefused(f"{adapter_id} declares an unknown kind {kind!r}")

    if entry["profile"] not in _PROFILES:
        raise AdapterRefused(
            f"{adapter_id} declares profile {entry['profile']!r}; destructive "
            "tooling has no representation here",
        )

    if _SHELL_METACHARACTER.search(str(entry["entrypoint"])):
        raise AdapterRefused(
            f"{adapter_id} has an entrypoint containing whitespace or a shell "
            "metacharacter, which is the beginning of a command line",
        )

    image_ref = entry.get("image_ref")

    # JSON Schema cannot say "required here and forbidden there" without
    # conditional keywords the validator does not implement, so the rule lives
    # in one place: a container adapter names a pinned image and a synthetic one
    # has nothing to pin.
    if kind == "container" and not isinstance(image_ref, str):
        raise AdapterRefused(f"{adapter_id} is a container adapter with no image_ref")

    if kind == "synthetic" and image_ref is not None:
        raise AdapterRefused(
            f"{adapter_id} is synthetic and names an image; it runs in process "
            "and reaches no network",
        )

    arguments = entry.get("arguments")

    if not isinstance(arguments, list):
        raise AdapterRefused(f"{adapter_id} declares no argument vector")

    for argument in arguments:
        if not isinstance(argument, Mapping) or set(argument) != {"kind", "value"}:
            raise AdapterRefused(f"{adapter_id} has a malformed argument: {argument!r}")

        if argument["kind"] not in _ARGUMENT_KINDS:
            raise AdapterRefused(
                f"{adapter_id} has an argument of unknown kind {argument['kind']!r}",
            )

        if _SHELL_METACHARACTER.search(str(argument["value"])):
            raise AdapterRefused(
                f"{adapter_id} has an argument containing whitespace or a shell "
                f"metacharacter: {argument['value']!r}",
            )

    artifacts = entry.get("artifacts")

    if not isinstance(artifacts, list) or not artifacts:
        raise AdapterRefused(
            f"{adapter_id} declares no artifact, so it produces nothing anyone "
            "can ingest",
        )

    return Adapter(
        adapter_id=adapter_id,
        kind=kind,
        profile=str(entry["profile"]),
        entrypoint=str(entry["entrypoint"]),
        arguments=tuple(dict(argument) for argument in arguments),
        artifacts=tuple(str(artifact) for artifact in artifacts),
        image_ref=image_ref if isinstance(image_ref, str) else None,
    )


def build_invocation(
    adapter_id: str,
    *,
    registry: Mapping[str, Adapter],
    target: str,
    pinned_addresses: Sequence[str],
    output_path: str,
    budgets: Mapping[str, int],
    allowed_profiles: Sequence[str],
) -> Invocation:
    """Produce the argument vector for one adapter, or refuse.

    Every substitution comes from something already authorised: the target from
    the addresses resolution pinned, the budgets from the signed scope. Nothing
    a caller supplies is concatenated into a string.
    """
    adapter = registry.get(adapter_id)

    if adapter is None:
        raise AdapterRefused(
            f"{adapter_id} is not a registered adapter; a run cannot name a tool "
            "nobody reviewed",
        )

    if adapter.profile not in allowed_profiles:
        raise AdapterRefused(
            f"{adapter_id} is {adapter.profile} and the scope allows "
            f"{', '.join(allowed_profiles)}",
        )

    if target not in pinned_addresses:
        # The address was resolved and pinned by E1-002. Anything else reaches
        # somewhere the resolution never authorised.
        raise AdapterRefused(
            f"{target} is not among the addresses pinned for this run "
            f"({', '.join(pinned_addresses)})",
        )

    for value in (target, output_path):
        if _SHELL_METACHARACTER.search(value):
            raise AdapterRefused(f"refusing a substitution containing a metacharacter: {value!r}")

    argv: list[str] = []

    for argument in adapter.arguments:
        kind, value = argument["kind"], argument["value"]

        if kind == "literal":
            argv.append(value)
        elif kind == "target":
            argv.extend((value, target))
        elif kind == "output-path":
            argv.extend((value, output_path))
        elif kind == "budget":
            if "max_duration_seconds" not in budgets:
                raise AdapterRefused(
                    f"{adapter_id} takes a budget argument and none was approved",
                )
            argv.extend((value, str(budgets["max_duration_seconds"])))

    return Invocation(
        adapter_id=adapter.adapter_id,
        entrypoint=adapter.entrypoint,
        argv=tuple(argv),
        image_ref=adapter.image_ref,
    )
