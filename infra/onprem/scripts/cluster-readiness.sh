#!/usr/bin/env bash
# Read-only acceptance probe for the secops-dev cluster foundation.
set -uo pipefail

failures=0
warnings=0
pass() { printf 'PASS %s\n' "$*"; }
fail() { printf 'FAIL %s\n' "$*" >&2; failures=$((failures + 1)); }
warn() { printf 'WARN %s\n' "$*" >&2; warnings=$((warnings + 1)); }

for command in kubectl cilium; do
  if command -v "$command" >/dev/null 2>&1; then
    pass "$command is installed"
  else
    fail "$command is required"
  fi
done

if (( failures > 0 )); then
  printf 'SUMMARY failures=%d warnings=%d\n' "$failures" "$warnings"
  exit 1
fi

if kubectl get --raw='/readyz' >/dev/null 2>&1; then
  pass "Kubernetes API readyz is healthy"
else
  fail "Kubernetes API readyz failed"
fi

mapfile -t node_lines < <(kubectl get nodes --no-headers 2>/dev/null || true)
if (( ${#node_lines[@]} >= 6 )); then
  pass "at least six Kubernetes nodes are registered"
else
  fail "expected at least six nodes for the DEV HA baseline; found ${#node_lines[@]}"
fi

not_ready=0
for line in "${node_lines[@]}"; do
  status="$(awk '{print $2}' <<<"$line")"
  if [[ "$status" != "Ready" ]]; then
    not_ready=$((not_ready + 1))
  fi
done
if (( not_ready == 0 && ${#node_lines[@]} > 0 )); then
  pass "all registered nodes report Ready"
else
  fail "$not_ready node(s) are not Ready"
fi

if kubectl -n kube-system get daemonset kube-proxy >/dev/null 2>&1; then
  fail "kube-proxy exists but this platform requires Cilium kube-proxy replacement"
else
  pass "kube-proxy DaemonSet is absent"
fi

if cilium status --wait --wait-duration 60s >/dev/null 2>&1; then
  pass "Cilium status is healthy"
else
  fail "Cilium status is not healthy"
fi

if kubectl get namespace app-dev >/dev/null 2>&1; then
  enforce="$(kubectl get namespace app-dev -o jsonpath='{.metadata.labels.pod-security\.kubernetes\.io/enforce}' 2>/dev/null || true)"
  if [[ "$enforce" == "restricted" ]]; then
    pass "app-dev enforces Pod Security Restricted"
  else
    fail "app-dev must enforce Pod Security Restricted; found '${enforce:-unset}'"
  fi

  for policy in default-deny-all allow-dns-egress; do
    if kubectl -n app-dev get networkpolicy "$policy" >/dev/null 2>&1; then
      pass "NetworkPolicy app-dev/$policy exists"
    else
      fail "NetworkPolicy app-dev/$policy is missing"
    fi
  done
else
  warn "app-dev namespace does not exist yet; application namespace policy checks were skipped"
fi

if kubectl get ciliumloadbalancerippools >/dev/null 2>&1; then
  pass "Cilium LB-IPAM CRD is queryable"
else
  fail "Cilium LB-IPAM CRD is not queryable"
fi

if kubectl get ciliumbgpclusterconfigs -o name 2>/dev/null | grep -q .; then
  fail "BGP cluster configuration exists before the network gate has been approved"
else
  pass "no active Cilium BGP cluster configuration is present"
fi

printf 'SUMMARY failures=%d warnings=%d\n' "$failures" "$warnings"
if (( failures > 0 )); then
  exit 1
fi
