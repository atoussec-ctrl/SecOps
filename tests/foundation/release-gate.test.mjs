import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateReleaseEvidence } from "../../tools/release-gate.mjs";
import { parseJson, validate } from "../../tools/schema.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function json(...segments) {
  return parseJson(await readFile(path.join(root, ...segments), "utf8"));
}

const clean = await json(
  "packages",
  "contracts",
  "ci",
  "samples",
  "release-gate-input",
  "pass.json",
);
const policy = await json("security", "policies", "gates", "vulnerability-gates.json");
const receiptSchema = await json(
  "packages",
  "contracts",
  "ci",
  "release-gate-receipt.schema.json",
);

function mutated(mutate) {
  const value = structuredClone(clean);
  mutate(value.signals);
  return value;
}

test("release gate promotes only a fully verified immutable artifact", () => {
  const receipt = evaluateReleaseEvidence(clean, policy);
  assert.equal(receipt.decision, "promote");
  assert.deepEqual(receipt.reasons, []);
  assert.equal(receipt.artifact.digest, clean.artifact.digest);
  assert.equal(receipt.evidence.sbom_digest, clean.evidence.sbom_digest);
  assert.equal(receipt.evidence.signature_verified, true);
  assert.equal(receipt.evidence.provenance_verified, true);
  assert.deepEqual(validate(receiptSchema, receipt), []);
});

test("every configured hard gate blocks promotion", () => {
  const cases = [
    ["malware_detected", (s) => (s.malware_detected = true)],
    ["secret_detected", (s) => (s.secret_detected = true)],
    ["invalid_signature", (s) => (s.signature_valid = false)],
    ["invalid_provenance", (s) => (s.provenance_valid = false)],
    ["missing_sbom", (s) => (s.sbom_present = false)],
    ["cisa_kev_affected", (s) => (s.cisa_kev_affected = 1)],
    ["critical_reachable", (s) => (s.critical_reachable = 1)],
    ["unsigned_image", (s) => (s.unsigned_image = true)],
  ];

  for (const [reason, mutate] of cases) {
    const receipt = evaluateReleaseEvidence(mutated(mutate), policy);
    assert.equal(receipt.decision, "block", reason);
    assert.ok(receipt.reasons.includes(reason), reason);
    assert.deepEqual(validate(receiptSchema, receipt), []);
  }
});

test("high reachable vulnerability blocks at the configured EPSS threshold", () => {
  const below = evaluateReleaseEvidence(
    mutated((s) => {
      s.high_reachable_count = 1;
      s.high_reachable_max_epss = policy.risk_gates.high.minimum_epss - 0.01;
    }),
    policy,
  );
  const threshold = evaluateReleaseEvidence(
    mutated((s) => {
      s.high_reachable_count = 1;
      s.high_reachable_max_epss = policy.risk_gates.high.minimum_epss;
    }),
    policy,
  );

  assert.equal(below.decision, "promote");
  assert.equal(threshold.decision, "block");
  assert.ok(threshold.reasons.includes("high_reachable_epss"));
});

test("unknown hard gates fail closed instead of being ignored", () => {
  const changed = structuredClone(policy);
  changed.hard_gates.future_gate = "block";
  assert.throws(() => evaluateReleaseEvidence(clean, changed), /unsupported hard gate: future_gate/);
});

test("release receipt is detached from mutable caller objects", () => {
  const input = structuredClone(clean);
  const receipt = evaluateReleaseEvidence(input, policy);
  input.artifact.digest = `sha256:${"f".repeat(64)}`;
  input.source.commit = "f".repeat(40);
  assert.equal(receipt.artifact.digest, clean.artifact.digest);
  assert.equal(receipt.source.commit, clean.source.commit);
});
