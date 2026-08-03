import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseJson, validate } from "../../tools/schema.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const contractDirectory = path.join(repositoryRoot, "packages", "contracts", "security");

async function readContract(...segments) {
  return parseJson(await readFile(path.join(contractDirectory, ...segments), "utf8"));
}

const policySchema = await readContract("address-policy.schema.json");
const scopeSchema = await readContract("scope-record.schema.json");
const vectors = await readContract(
  "samples",
  "address-policy",
  "ipv4-and-host-vectors.json",
);

// The scope contract decides what may be written down; these vectors state why.
// If the two disagree, one of them is wrong.
const PATTERN_FOR_KIND = {
  ipv4: scopeSchema.$defs.private_ipv4.pattern,
  "ipv4-cidr": scopeSchema.$defs.private_cidr.pattern,
  hostname: scopeSchema.$defs.lab_hostname.pattern,
  url: scopeSchema.$defs.lab_url.pattern,
};

test("E1-001 the vector file satisfies its contract", () => {
  assert.deepEqual(validate(policySchema, vectors), []);
});

test("E1-001 the vectors cover every address kind and both verdicts", () => {
  const kinds = new Set(vectors.vectors.map((vector) => vector.kind));

  assert.deepEqual([...kinds].sort(), ["hostname", "ipv4", "ipv4-cidr", "url"]);
  assert.ok(vectors.vectors.some((vector) => vector.in_scope_eligible));
  assert.ok(vectors.vectors.some((vector) => !vector.in_scope_eligible));
  assert.ok(vectors.vectors.length >= 30, `only ${vectors.vectors.length} vectors`);
});

test("E1-001 every vector agrees with the scope contract", () => {
  for (const vector of vectors.vectors) {
    const pattern = new RegExp(PATTERN_FOR_KIND[vector.kind]);
    const accepted = pattern.test(vector.input);

    assert.equal(
      accepted,
      vector.in_scope_eligible,
      `"${vector.input}" (${vector.kind}): the scope contract ${
        accepted ? "accepts" : "rejects"
      } it, the policy says ${vector.in_scope_eligible ? "eligible" : "ineligible"}`,
    );
  }
});

test("E1-001 no eligible vector is classified as a denied range", () => {
  const denied = new Set([
    "public",
    "link-local",
    "multicast",
    "broadcast",
    "unspecified",
    "malformed",
  ]);

  for (const vector of vectors.vectors) {
    if (denied.has(vector.classification)) {
      assert.equal(
        vector.in_scope_eligible,
        false,
        `"${vector.input}" is classified ${vector.classification} but marked eligible`,
      );
    }
  }
});

test("E1-001 the cloud metadata address is present and denied", () => {
  const metadata = vectors.vectors.find((vector) => vector.input === "169.254.169.254");

  assert.ok(metadata, "the metadata endpoint must be an explicit vector");
  assert.equal(metadata.in_scope_eligible, false);
  assert.equal(metadata.classification, "link-local");
});

test("E1-001 vector inputs are unique", () => {
  const inputs = vectors.vectors.map((vector) => `${vector.kind}:${vector.input}`);

  assert.equal(new Set(inputs).size, inputs.length, "duplicate vector input");
});
