import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function text(relative) {
  return readFile(path.join(root, relative), "utf8");
}

async function json(relative) {
  return JSON.parse(await text(relative));
}

function minor(version) {
  const match = /^v?1\.(\d+)\./.exec(version);
  assert.ok(match, `expected a Kubernetes 1.x version, got ${version}`);
  return Number(match[1]);
}

test("on-prem RKE2 and Cilium pins stay inside the guaranteed compatibility window", async () => {
  const versions = await json("infra/onprem/platform-versions.json");
  const rke2 = versions.platform.rke2;
  const cilium = versions.platform.cilium;

  assert.equal(rke2.version, "v1.36.4+rke2r1");
  assert.equal(cilium.version, "1.20.2");
  assert.ok(minor(rke2.kubernetes) >= Number(cilium.supportedKubernetesMin.split(".")[1]));
  assert.ok(minor(rke2.kubernetes) <= Number(cilium.supportedKubernetesMax.split(".")[1]));
  assert.equal(cilium.installationMode, "external-helm");
});

test("on-prem inventory describes an HA cluster without embedding credentials", async () => {
  const inventory = await json("infra/onprem/inventory.example.json");

  assert.equal(inventory.loadBalancers.length, 2);
  assert.ok(inventory.controlPlane.length >= 3);
  assert.equal(inventory.controlPlane.length % 2, 1, "etcd server count must be odd");
  assert.ok(inventory.workers.length >= 3);

  const addresses = [
    inventory.network.api.vip,
    ...inventory.loadBalancers.map((entry) => entry.address),
    ...inventory.controlPlane.map((entry) => entry.address),
    ...inventory.workers.map((entry) => entry.address),
  ];
  assert.equal(new Set(addresses).size, addresses.length, "infrastructure IPs must be unique");

  for (const value of Object.values(inventory.secrets)) {
    assert.match(value, /^FROM_VAULT/);
  }
  assert.equal(inventory.network.bgp.enabled, false, "BGP must require an explicit reviewed enablement");
});

test("RKE2 server templates enable the security and external-CNI invariants", async () => {
  for (const relative of [
    "infra/onprem/rke2/server-bootstrap.yaml.example",
    "infra/onprem/rke2/server-join.yaml.example",
  ]) {
    const config = await text(relative);
    for (const required of [
      'profile: "cis"',
      "secrets-encryption: true",
      'audit-policy-file: "/etc/rancher/rke2/audit-policy.yaml"',
      'pod-security-admission-config-file: "/etc/rancher/rke2/pod-security-admission.yaml"',
      "cni: none",
      "disable-kube-proxy: true",
      "ingress-controller: none",
      'cluster-cidr: "10.120.0.0/16"',
      'service-cidr: "10.121.0.0/16"',
    ]) {
      assert.ok(config.includes(required), `${relative} misses ${required}`);
    }
    assert.ok(!config.includes("password:"));
    assert.ok(config.includes('token: "REPLACE_FROM_VAULT"'));
  }
});

test("Cilium baseline is kube-proxy-free, tunneled and opt-in for LoadBalancer allocation", async () => {
  const values = await text("infra/onprem/cilium/values.yaml");
  for (const required of [
    "mode: kubernetes",
    "kubeProxyReplacement: true",
    'k8sServiceHost: "127.0.0.1"',
    'k8sServicePort: "6443"',
    "routingMode: tunnel",
    "tunnelProtocol: vxlan",
    "defaultLBServiceIPAM: none",
    "replicas: 2",
  ]) {
    assert.ok(values.includes(required), `Cilium baseline misses ${required}`);
  }

  const pool = await text("infra/onprem/cilium/loadbalancer-pool.example.yaml");
  assert.ok(pool.includes("kind: CiliumLoadBalancerIPPool"));
  assert.ok(pool.includes('start: "10.20.50.100"'));
  assert.ok(pool.includes('stop: "10.20.50.199"'));
  assert.ok(pool.includes("serviceSelector:"));
});

test("audit policy keeps Secret bodies out of logs and forbids RequestResponse", async () => {
  const audit = await text("infra/onprem/rke2/audit-policy.yaml");
  const secretRule = audit.indexOf("          - secrets");
  const genericRequestRule = audit.indexOf("  - level: Request\n");

  assert.ok(secretRule >= 0, "Secret-specific audit rule is required");
  assert.ok(genericRequestRule > secretRule, "Secret Metadata rule must match before generic Request rule");
  assert.ok(!audit.includes("RequestResponse"), "RequestResponse can persist sensitive response bodies");
});

test("Pod Security and application networking start fail-closed", async () => {
  const psa = await text("infra/onprem/rke2/pod-security-admission.yaml");
  assert.ok(psa.includes("enforce: baseline"));
  assert.ok(psa.includes("audit: restricted"));
  assert.ok(psa.includes("warn: restricted"));
  assert.ok(psa.includes("    - kube-system"));

  const deny = await text("infra/onprem/policies/app-default-deny.yaml");
  assert.ok(deny.includes("kind: NetworkPolicy"));
  assert.ok(deny.includes("podSelector: {}"));
  assert.ok(deny.includes("    - Ingress"));
  assert.ok(deny.includes("    - Egress"));
});

test("the external load balancer owns both RKE2 fixed endpoints", async () => {
  const haproxy = await text("infra/onprem/loadbalancer/haproxy.cfg.example");
  for (const endpoint of ["10.20.0.10:6443", "10.20.0.10:9345"]) {
    assert.ok(haproxy.includes(endpoint), `HAProxy misses ${endpoint}`);
  }
  for (const address of ["10.20.0.11", "10.20.0.12", "10.20.0.13"]) {
    assert.ok(haproxy.includes(address), `HAProxy misses control-plane peer ${address}`);
  }

  const keepalived = await text("infra/onprem/loadbalancer/keepalived.conf.example");
  assert.ok(keepalived.includes("10.20.0.10/24"));
  assert.ok(keepalived.includes("REPLACE_WITH_VAULT_MANAGED_VALUE"));
});
