import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const nodePreflight = path.join(root, "infra", "onprem", "scripts", "node-preflight.sh");
const clusterReadiness = path.join(root, "infra", "onprem", "scripts", "cluster-readiness.sh");

test("on-prem node preflight is read-only and checks the selected host invariants", async () => {
  const script = await readFile(nodePreflight, "utf8");

  for (const required of [
    "kernel >= 5.10",
    "cgroup v2 is active",
    "swap is disabled",
    "time synchronization reports healthy",
    "NetworkManager is active",
    "RKE2_REGISTRATION_ENDPOINT",
  ]) {
    assert.ok(script.includes(required), `preflight misses ${required}`);
  }

  for (const forbidden of [
    "swapoff",
    "systemctl stop",
    "systemctl disable",
    "rm -rf",
    "iptables -F",
    "nft flush",
    "curl |",
    "wget |",
  ]) {
    assert.ok(!script.includes(forbidden), `preflight must remain read-only: ${forbidden}`);
  }
});

test("on-prem cluster readiness is observational and checks the trust boundary", async () => {
  const script = await readFile(clusterReadiness, "utf8");

  for (const required of [
    "Kubernetes API readyz",
    "kube-proxy DaemonSet is absent",
    "Cilium status is healthy",
    "Pod Security Restricted",
    "default-deny-all",
    "allow-dns-egress",
    "no active Cilium BGP cluster configuration",
  ]) {
    assert.ok(script.includes(required), `cluster readiness misses ${required}`);
  }

  for (const forbidden of [
    "kubectl apply",
    "kubectl delete",
    "kubectl patch",
    "kubectl edit",
    "kubectl create",
    "helm install",
    "helm upgrade",
    "systemctl stop",
    "rm -rf",
  ]) {
    assert.ok(!script.includes(forbidden), `cluster readiness must remain observational: ${forbidden}`);
  }
});

test("on-prem operational scripts have valid Bash syntax", () => {
  for (const scriptPath of [nodePreflight, clusterReadiness]) {
    const result = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${scriptPath}\n${result.stdout}\n${result.stderr}`);
  }
});
