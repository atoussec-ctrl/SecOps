#!/usr/bin/env bash
# Read-only preflight for an RKE2/Cilium Linux node.
# It changes no host configuration and prints no secret material.
set -uo pipefail

failures=0
warnings=0

pass() { printf 'PASS %s\n' "$*"; }
fail() { printf 'FAIL %s\n' "$*" >&2; failures=$((failures + 1)); }
warn() { printf 'WARN %s\n' "$*" >&2; warnings=$((warnings + 1)); }

printf 'SecOps RKE2 node preflight\n'
printf 'host=%s\n' "$(hostname 2>/dev/null || printf unknown)"

host_name="$(hostname 2>/dev/null || true)"
case "$host_name" in
  ""|localhost|localhost.localdomain)
    fail "hostname must be unique and must not be localhost"
    ;;
  *)
    pass "hostname is non-default: $host_name"
    ;;
esac

kernel="$(uname -r 2>/dev/null || true)"
major="${kernel%%.*}"
remainder="${kernel#*.}"
minor="${remainder%%.*}"
if [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] && (( major > 5 || (major == 5 && minor >= 10) )); then
  pass "kernel >= 5.10: $kernel"
else
  fail "kernel must be >= 5.10 for the selected Cilium baseline; found $kernel"
fi

if [[ -r /sys/fs/cgroup/cgroup.controllers ]]; then
  pass "cgroup v2 is active"
else
  fail "cgroup v2 is required by the Kubernetes 1.36 baseline"
fi

if command -v swapon >/dev/null 2>&1; then
  if [[ -z "$(swapon --show --noheadings 2>/dev/null)" ]]; then
    pass "swap is disabled"
  else
    fail "swap is enabled; baseline requires swap disabled unless kubelet swap is explicitly designed"
  fi
else
  warn "swapon command not found; verify swap state through the OS build controls"
fi

if command -v timedatectl >/dev/null 2>&1; then
  ntp="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || true)"
  if [[ "$ntp" == "yes" ]]; then
    pass "time synchronization reports healthy"
  else
    fail "time synchronization is not confirmed"
  fi
else
  warn "timedatectl not found; verify the approved NTP client separately"
fi

if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet NetworkManager 2>/dev/null; then
    warn "NetworkManager is active; verify it is configured not to interfere with CNI-managed interfaces"
  else
    pass "NetworkManager is not active or not installed"
  fi
else
  fail "systemd/systemctl is required by the selected RKE2 installation method"
fi

if command -v ip >/dev/null 2>&1; then
  default_routes="$(ip -4 route show default 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$default_routes" =~ ^[0-9]+$ ]] && (( default_routes >= 1 )); then
    pass "IPv4 default route exists"
  else
    warn "no IPv4 default route found; valid for isolated hosts only if internal routes cover all dependencies"
  fi
else
  fail "iproute2 'ip' command is required for network diagnostics"
fi

if [[ -n "${RKE2_REGISTRATION_ENDPOINT:-}" ]]; then
  endpoint_host="${RKE2_REGISTRATION_ENDPOINT%:*}"
  endpoint_port="${RKE2_REGISTRATION_ENDPOINT##*:}"
  if command -v nc >/dev/null 2>&1; then
    if nc -z -w 3 "$endpoint_host" "$endpoint_port" >/dev/null 2>&1; then
      pass "registration endpoint is reachable at ${RKE2_REGISTRATION_ENDPOINT}"
    else
      fail "registration endpoint is not reachable at ${RKE2_REGISTRATION_ENDPOINT}"
    fi
  else
    warn "nc is not installed; registration endpoint reachability was not tested"
  fi
fi

printf 'SUMMARY failures=%d warnings=%d\n' "$failures" "$warnings"
if (( failures > 0 )); then
  exit 1
fi
