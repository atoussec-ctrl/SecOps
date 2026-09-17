"""Deterministic, read-only discovery for external project snapshots.

Version 1 deliberately performs no package installation, build, script execution,
network access or symlink traversal. It inspects repository files as data and
returns the language-neutral project profile contract.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Iterable

PROFILE_VERSION = "1.0.0"
MAX_FILES = 20_000
MAX_MANIFEST_BYTES = 1_048_576
MAX_EVIDENCE_PER_COMPONENT = 50

SKIP_DIRECTORIES = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".idea",
        ".vscode",
        ".venv",
        "venv",
        "node_modules",
        "vendor",
        "dist",
        "build",
        ".next",
        "coverage",
        "target",
        "bin",
        "obj",
    }
)

PROJECT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$")
GIT_SHA = re.compile(r"^[0-9a-f]{40}$")

JS_FRAMEWORKS = {
    "react": "react",
    "next": "next",
    "vue": "vue",
    "nuxt": "nuxt",
    "svelte": "svelte",
    "@angular/core": "angular",
    "express": "express",
    "@nestjs/core": "nestjs",
}
JS_BUILD_SYSTEMS = {
    "vite": "vite",
    "webpack": "webpack",
    "rollup": "rollup",
    "parcel": "parcel",
    "next": "next",
    "@angular/cli": "angular-cli",
}
JS_TEST_FRAMEWORKS = {
    "jest": "jest",
    "vitest": "vitest",
    "@playwright/test": "playwright",
    "cypress": "cypress",
    "mocha": "mocha",
}


class ProjectDiscoveryError(ValueError):
    """The project cannot be represented safely and reproducibly."""


def _component(name: str, evidence: Iterable[str], version: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "name": name,
        "evidence": sorted(set(evidence))[:MAX_EVIDENCE_PER_COMPONENT],
    }
    if version:
        result["version"] = version[:100]
    return result


def _merge_component(
    collection: dict[str, dict[str, Any]],
    name: str,
    evidence: str,
    version: str | None = None,
) -> None:
    current = collection.get(name)
    if current is None:
        collection[name] = _component(name, [evidence], version)
        return

    paths = set(current["evidence"])
    paths.add(evidence)
    current["evidence"] = sorted(paths)[:MAX_EVIDENCE_PER_COMPONENT]
    if version and "version" not in current:
        current["version"] = version[:100]


def _relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def _walk_files(root: Path) -> list[Path]:
    discovered: list[Path] = []

    def on_error(error: OSError) -> None:
        raise ProjectDiscoveryError(f"source tree is unreadable: {error}") from error

    for current, directories, filenames in os.walk(root, topdown=True, followlinks=False, onerror=on_error):
        current_path = Path(current)
        directories[:] = sorted(
            directory
            for directory in directories
            if directory not in SKIP_DIRECTORIES
            and not (current_path / directory).is_symlink()
        )

        for filename in sorted(filenames):
            candidate = current_path / filename
            if candidate.is_symlink():
                continue
            discovered.append(candidate)
            if len(discovered) > MAX_FILES:
                raise ProjectDiscoveryError(
                    f"project contains more than the discovery limit of {MAX_FILES} files"
                )

    return discovered


def _read_json(path: Path) -> dict[str, Any]:
    try:
        size = path.stat().st_size
    except OSError as error:
        raise ProjectDiscoveryError(f"cannot stat manifest {path.name}: {error}") from error

    if size > MAX_MANIFEST_BYTES:
        raise ProjectDiscoveryError(
            f"manifest {path.name} exceeds {MAX_MANIFEST_BYTES} bytes"
        )

    try:
        parsed = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ProjectDiscoveryError(f"manifest {path.name} is unreadable JSON: {error}") from error

    if not isinstance(parsed, dict):
        raise ProjectDiscoveryError(f"manifest {path.name} must contain a JSON object")
    return parsed


def _dependencies(package: dict[str, Any]) -> dict[str, str]:
    dependencies: dict[str, str] = {}
    for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        value = package.get(key, {})
        if isinstance(value, dict):
            for name, version in value.items():
                if isinstance(name, str) and isinstance(version, str):
                    dependencies[name] = version
    return dependencies


def _canonical_fingerprint(profile_without_fingerprint: dict[str, Any]) -> str:
    encoded = json.dumps(
        profile_without_fingerprint,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _validate_snapshot(snapshot: dict[str, Any]) -> None:
    required = {"provider", "owner", "repository", "commit_sha", "branch", "dirty"}
    missing = sorted(required - set(snapshot))
    if missing:
        raise ProjectDiscoveryError(f"snapshot is missing: {', '.join(missing)}")
    if snapshot["provider"] != "github":
        raise ProjectDiscoveryError("version 1 supports only provider=github")
    if snapshot["dirty"] is not False:
        raise ProjectDiscoveryError("version 1 requires a clean Git snapshot")
    if not isinstance(snapshot["commit_sha"], str) or not GIT_SHA.fullmatch(snapshot["commit_sha"]):
        raise ProjectDiscoveryError("snapshot commit_sha must be a 40-character lowercase Git SHA")
    for key in ("owner", "repository", "branch"):
        if not isinstance(snapshot[key], str) or not snapshot[key]:
            raise ProjectDiscoveryError(f"snapshot {key} must be a non-empty string")


def discover_project(
    project_root: str | os.PathLike[str],
    *,
    project_id: str,
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Inspect an external source tree without executing or modifying it."""

    if not PROJECT_ID.fullmatch(project_id):
        raise ProjectDiscoveryError("project_id does not satisfy the project profile contract")
    _validate_snapshot(snapshot)

    declared_root = Path(project_root).expanduser()
    if declared_root.is_symlink():
        raise ProjectDiscoveryError("project root may not be a symlink in version 1")

    try:
        root = declared_root.resolve(strict=True)
    except OSError as error:
        raise ProjectDiscoveryError(f"project root is unavailable: {error}") from error
    if not root.is_dir():
        raise ProjectDiscoveryError("project root must be a directory")

    files = _walk_files(root)
    relative_paths = {_relative(root, path): path for path in files}

    groups: dict[str, dict[str, dict[str, Any]]] = {
        "languages": {},
        "frameworks": {},
        "package_managers": {},
        "build_systems": {},
        "test_frameworks": {},
        "ci_systems": {},
        "containers": {},
        "iac": {},
        "api_contracts": {},
        "workspaces": {},
    }

    def add(group: str, name: str, evidence: str, version: str | None = None) -> None:
        _merge_component(groups[group], name, evidence, version)

    # File-extension language evidence. Evidence is intentionally bounded.
    extension_languages = {
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".mjs": "javascript",
        ".cjs": "javascript",
        ".php": "php",
        ".py": "python",
        ".java": "java",
        ".kt": "kotlin",
        ".cs": "csharp",
        ".go": "go",
        ".rs": "rust",
    }
    for relative, path in sorted(relative_paths.items()):
        language = extension_languages.get(path.suffix.lower())
        if language:
            add("languages", language, relative)

    package_jsons = [
        (relative, path)
        for relative, path in sorted(relative_paths.items())
        if path.name == "package.json"
    ]
    for relative, path in package_jsons:
        package = _read_json(path)
        dependencies = _dependencies(package)
        if "typescript" in dependencies or any(
            name in relative_paths for name in ("tsconfig.json", "tsconfig.base.json")
        ):
            add("languages", "typescript", relative, dependencies.get("typescript"))
        else:
            add("languages", "javascript", relative)

        for dependency, framework in JS_FRAMEWORKS.items():
            if dependency in dependencies:
                add("frameworks", framework, relative, dependencies[dependency])
        for dependency, builder in JS_BUILD_SYSTEMS.items():
            if dependency in dependencies:
                add("build_systems", builder, relative, dependencies[dependency])
        for dependency, framework in JS_TEST_FRAMEWORKS.items():
            if dependency in dependencies:
                add("test_frameworks", framework, relative, dependencies[dependency])

        if "workspaces" in package:
            add("workspaces", "javascript-workspace", relative)

    filename_rules = {
        "package-lock.json": ("package_managers", "npm"),
        "npm-shrinkwrap.json": ("package_managers", "npm"),
        "pnpm-lock.yaml": ("package_managers", "pnpm"),
        "yarn.lock": ("package_managers", "yarn"),
        "composer.lock": ("package_managers", "composer"),
        "composer.json": ("languages", "php"),
        "pyproject.toml": ("languages", "python"),
        "poetry.lock": ("package_managers", "poetry"),
        "uv.lock": ("package_managers", "uv"),
        "requirements.txt": ("package_managers", "pip"),
        "Pipfile.lock": ("package_managers", "pipenv"),
        "pom.xml": ("build_systems", "maven"),
        "build.gradle": ("build_systems", "gradle"),
        "build.gradle.kts": ("build_systems", "gradle"),
        "go.mod": ("languages", "go"),
        "Cargo.toml": ("languages", "rust"),
        "pnpm-workspace.yaml": ("workspaces", "javascript-workspace"),
        "Chart.yaml": ("iac", "helm"),
        "kustomization.yaml": ("iac", "kustomize"),
        "kustomization.yml": ("iac", "kustomize"),
        "Jenkinsfile": ("ci_systems", "jenkins"),
        ".gitlab-ci.yml": ("ci_systems", "gitlab-ci"),
    }
    for relative, path in sorted(relative_paths.items()):
        rule = filename_rules.get(path.name)
        if rule:
            add(rule[0], rule[1], relative)
        if path.name in {"pom.xml", "build.gradle", "build.gradle.kts"}:
            add("languages", "java", relative)
        if path.suffix.lower() == ".csproj":
            add("languages", "csharp", relative)
            add("build_systems", "dotnet", relative)
        if path.suffix.lower() == ".tf":
            add("iac", "terraform", relative)
        if path.name == "Dockerfile" or path.name.startswith("Dockerfile."):
            add("containers", "dockerfile", relative)
        lower_name = path.name.lower()
        if lower_name in {"compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"}:
            add("containers", "compose", relative)
        if relative.startswith(".github/workflows/") and path.suffix.lower() in {".yml", ".yaml"}:
            add("ci_systems", "github-actions", relative)
        if path.suffix.lower() == ".graphql" or lower_name in {"schema.graphql", "schema.gql"}:
            add("api_contracts", "graphql", relative)
        if path.suffix.lower() in {".json", ".yaml", ".yml"} and (
            "openapi" in lower_name or "swagger" in lower_name
        ):
            add("api_contracts", "openapi", relative)

    discovery = {
        group: [groups[group][name] for name in sorted(groups[group])]
        for group in (
            "languages",
            "frameworks",
            "package_managers",
            "build_systems",
            "test_frameworks",
            "ci_systems",
            "containers",
            "iac",
            "api_contracts",
            "workspaces",
        )
    }

    profile: dict[str, Any] = {
        "profile_version": PROFILE_VERSION,
        "project_id": project_id,
        "snapshot": dict(snapshot),
        "source": {
            "project_root": ".",
            "access": "read-only",
            "follow_symlinks": False,
            "allow_outside_root": False,
        },
        "discovery": discovery,
    }
    profile["fingerprint"] = _canonical_fingerprint(profile)
    return profile
