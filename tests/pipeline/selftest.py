from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIGEST = re.compile(r"ghcr\.io/atoussec-ctrl/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}")


def text(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_manifest_baseline_structure() -> None:
    paths = sorted((ROOT / "infra" / "delivery").rglob("*.yaml"))
    paths += sorted((ROOT / "security" / "policies" / "kyverno").rglob("*.yaml"))
    assert paths, "expected delivery and admission manifests"
    for path in paths:
        contents = path.read_text(encoding="utf-8")
        assert "apiVersion:" in contents, f"missing apiVersion in {path}"
        assert "kind:" in contents, f"missing kind in {path}"
        assert "\t" not in contents, f"tabs are forbidden in YAML indentation: {path}"


def test_rollout_is_digest_pinned_and_hardened() -> None:
    rollout = text("infra/delivery/base/rollout.yaml")
    assert "kind: Rollout" in rollout
    assert DIGEST.search(rollout), "image must be pinned to a GHCR sha256 digest"
    for required in (
        "automountServiceAccountToken: false",
        "runAsNonRoot: true",
        "allowPrivilegeEscalation: false",
        "readOnlyRootFilesystem: true",
        "- ALL",
        "rollbackWindow:",
        "revisions: 3",
        "maxUnavailable: 0",
    ):
        assert required in rollout, f"missing rollout hardening invariant: {required}"
    weights = [int(value) for value in re.findall(r"setWeight:\s*(\d+)", rollout)]
    assert weights == [1, 5, 20, 50], weights


def test_analysis_requires_repeated_evidence() -> None:
    analysis = text("infra/delivery/base/analysis-template.yaml")
    assert analysis.count("provider:") >= 2
    assert analysis.count("prometheus:") >= 2
    counts = [int(value) for value in re.findall(r"^\s*count:\s*(\d+)\s*$", analysis, re.MULTILINE)]
    failure_limits = [
        int(value)
        for value in re.findall(r"^\s*failureLimit:\s*(\d+)\s*$", analysis, re.MULTILINE)
    ]
    assert len(counts) >= 2 and all(value >= 3 for value in counts)
    assert len(failure_limits) >= 2 and all(value >= 2 for value in failure_limits)


def test_argocd_is_pull_based_and_self_healing() -> None:
    manifests = [part.strip() for part in text("infra/delivery/argocd/applications.yaml").split("---")]
    assert len(manifests) == 3
    names = set()
    for manifest in manifests:
        match = re.search(r"^\s*name:\s*(app-(?:dev|homol|prod))\s*$", manifest, re.MULTILINE)
        assert match, "expected a dev, homol, or prod Argo CD application"
        names.add(match.group(1))
        assert "repoURL: https://github.com/atoussec-ctrl/SecOps.git" in manifest
        assert "project: secure-delivery" in manifest
        assert "targetRevision: main" in manifest
        assert "prune: true" in manifest
        assert "selfHeal: true" in manifest
    assert names == {"app-dev", "app-homol", "app-prod"}


def test_image_admission_is_fail_closed() -> None:
    policy = text("security/policies/kyverno/verify-images.yaml")
    for required in (
        "apiVersion: policies.kyverno.io/v1",
        "kind: ImageValidatingPolicy",
        "failurePolicy: Fail",
        'glob: "ghcr.io/atoussec-ctrl/*"',
        "validationActions:",
        "- Deny",
        'issuer: "https://token.actions.githubusercontent.com"',
        "atoussec-ctrl",
        "https://rekor.sigstore.dev",
    ):
        assert required in policy, f"missing image admission invariant: {required}"


def test_workload_policy_uses_current_kyverno_api() -> None:
    policy = text("security/policies/kyverno/workload-hardening.yaml")
    assert "apiVersion: policies.kyverno.io/v1" in policy
    assert "kind: ValidatingPolicy" in policy
    assert "failurePolicy: Fail" in policy
    assert "- Deny" in policy
    for namespace in ("app-dev", "app-homol", "app-prod"):
        assert namespace in policy
    for invariant in (
        "runAsNonRoot",
        "allowPrivilegeEscalation",
        "readOnlyRootFilesystem",
        "capabilities",
        "'ALL'",
    ):
        assert invariant in policy


def test_gate_policy_is_fail_closed_for_supply_chain() -> None:
    policy = json.loads(text("security/policies/gates/vulnerability-gates.json"))
    required = {
        "malware_detected",
        "secret_detected",
        "invalid_signature",
        "invalid_provenance",
        "missing_sbom",
        "cisa_kev_affected",
        "critical_reachable",
        "unsigned_image",
    }
    assert required <= set(policy["hard_gates"])
    assert all(policy["hard_gates"][name] == "block" for name in required)
    assert policy["exceptions"]["maximum_ttl_days"] <= 30
    assert policy["exceptions"]["expired_decision"] == "block"


def run() -> None:
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_") and callable(value)]
    failures = []
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as exc:
            failures.append((test.__name__, exc))
            print(f"FAIL {test.__name__}: {exc}")
    if failures:
        raise SystemExit(1)
    print(f"{len(tests)} pipeline policy tests passed")


if __name__ == "__main__":
    run()
