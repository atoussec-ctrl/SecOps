import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = path.join(root, "infra", "onprem", "scripts", "node-preflight.sh");

test("on-prem node preflight is read-only and checks the selected host invariants", async () => {
  const script = await readFile(scriptPath, "utf8");

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
