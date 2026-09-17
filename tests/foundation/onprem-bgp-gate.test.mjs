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

test("on-prem BGP stays disabled until an explicit network change enables it", async () => {
  const inventory = await json("infra/onprem/inventory.example.json");
  const values = await text("infra/onprem/cilium/values.yaml");
  const design = await text("infra/onprem/cilium/bgp-design.md");

  assert.equal(inventory.network.bgp.enabled, false);
  assert.match(values, /bgpControlPlane:\n  enabled: false/);
  assert.ok(design.includes("BGP is **not enabled"));
  assert.ok(design.includes("permit <APPROVED_LB_POOL>"));
  assert.ok(design.includes("deny any"));
});
