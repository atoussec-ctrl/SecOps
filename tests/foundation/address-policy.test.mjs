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
const ipv6Vectors = await readContract("samples", "address-policy", "ipv6-vectors.json");
const allVectors = [...vectors.vectors, ...ipv6Vectors.vectors];

// The scope contract decides what may be written down; these vectors state why.
// If the two disagree, one of them is wrong.
const PATTERN_FOR_KIND = {
  ipv4: scopeSchema.$defs.private_ipv4.pattern,
  "ipv4-cidr": scopeSchema.$defs.private_cidr.pattern,
  hostname: scopeSchema.$defs.lab_hostname.pattern,
  url: scopeSchema.$defs.lab_url.pattern,
};

test("E1-001 the vector files satisfy their contract", () => {
  assert.deepEqual(validate(policySchema, vectors), []);
  assert.deepEqual(validate(policySchema, ipv6Vectors), []);
});

test("E1-001 the vectors cover every address kind and both verdicts", () => {
  const kinds = new Set(allVectors.map((vector) => vector.kind));

  assert.deepEqual(
    [...kinds].sort(),
    ["hostname", "ipv4", "ipv4-cidr", "ipv6", "ipv6-cidr", "url"],
  );
  assert.ok(allVectors.some((vector) => vector.in_scope_eligible));
  assert.ok(allVectors.some((vector) => !vector.in_scope_eligible));
  assert.ok(allVectors.length >= 60, `only ${allVectors.length} vectors`);
});

// A classification nobody exercises is a word in an enum, not a rule. Adding one
// without a vector leaves an implementer guessing what it means.
test("E1-001 every declared classification has a vector", () => {
  const exercised = new Set(allVectors.map((vector) => vector.classification));

  for (const classification of policySchema.$defs.vector.properties.classification
    .enum) {
    assert.ok(exercised.has(classification), `${classification} has no vector`);
  }
});

test("E1-001 every vector agrees with the scope contract", () => {
  for (const vector of allVectors) {
    if (PATTERN_FOR_KIND[vector.kind] === undefined) {
      continue;
    }

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

// docs/03-applications/04-orchestrator-spec.md, "Safety tests": public IPv4/IPv6
// rejection, and rejection of encoded or alternate address representations.
//
// The scope record answers the first half by construction: it has no IPv6 target
// field and none of its four patterns accepts an IPv6 literal, so an IPv6
// destination cannot be authorized at all. That absence is load-bearing and
// nothing else guards it — widening one pattern to accept a bracketed host would
// otherwise pass every test in this repository.
test("E1-001 the scope contract cannot express an IPv6 target", () => {
  assert.equal(
    scopeSchema.properties.targets.properties.ipv6,
    undefined,
    "targets gained an ipv6 field",
  );
  assert.equal(scopeSchema.properties.targets.additionalProperties, false);

  for (const vector of ipv6Vectors.vectors) {
    for (const [kind, source] of Object.entries(PATTERN_FOR_KIND)) {
      assert.equal(
        new RegExp(source).test(vector.input),
        false,
        `the scope ${kind} pattern accepts the IPv6 vector "${vector.input}"`,
      );
    }
  }
});

// An implementation reading only the IPv4 text form never sees these, which is
// what makes them the useful case rather than the exotic one.
test("E1-001 an IPv4 address written as IPv6 is never eligible", () => {
  const mapped = ipv6Vectors.vectors.filter(
    (vector) => vector.classification === "ipv4-mapped",
  );

  assert.ok(mapped.length >= 4, `only ${mapped.length} ipv4-mapped vectors`);

  for (const vector of mapped) {
    assert.equal(vector.in_scope_eligible, false, vector.input);
  }

  // The private one matters most: an implementation that unwraps the mapping and
  // then trusts the result would let 192.168.56.10 in by a spelling the signed
  // scope never authorized.
  assert.ok(
    mapped.some((vector) => vector.input === "::ffff:192.168.56.10"),
    "the mapped-private case must be stated",
  );
});

test("E1-001 no IPv6 vector is scope-eligible", () => {
  for (const vector of ipv6Vectors.vectors) {
    assert.equal(vector.in_scope_eligible, false, vector.input);
  }
});

test("E1-001 no eligible vector is classified as a denied range", () => {
  // Reserved is not the same as available. A range the registry has set aside
  // for documentation, benchmarking, carrier NAT or future use is assigned to
  // nobody, so it cannot be an owned lab target either. ipv4-mapped is denied
  // as a spelling: the IPv4 form is what a scope authorizes.
  const denied = new Set([
    "public",
    "link-local",
    "multicast",
    "broadcast",
    "unspecified",
    "carrier-grade-nat",
    "documentation",
    "benchmarking",
    "reserved",
    "ipv4-mapped",
    "malformed",
  ]);

  for (const vector of allVectors) {
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
  const metadata = allVectors.find((vector) => vector.input === "169.254.169.254");

  assert.ok(metadata, "the metadata endpoint must be an explicit vector");
  assert.equal(metadata.in_scope_eligible, false);
  assert.equal(metadata.classification, "link-local");
});

test("E1-001 vector inputs are unique", () => {
  const inputs = allVectors.map((vector) => `${vector.kind}:${vector.input}`);

  assert.equal(new Set(inputs).size, inputs.length, "duplicate vector input");
});
