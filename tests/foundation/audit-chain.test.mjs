// The audit chain contract, and an independent verification of the sample
// (backlog E1-005, ADR-013).
//
// The Python writer is tested against its own behaviour in
// services/orchestrator/tests/test_audit_chain.py. The point of a chained
// export is that someone who was never trusted to write can verify it, so the
// digests are recomputed here from the sample alone, in the other language,
// using nothing the writer produced except the entries themselves.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseJson, validate } from "../../tools/schema.mjs";
import { canonicalize } from "../../tools/scope-hash.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const contractDirectory = path.join(repositoryRoot, "packages", "contracts", "security");

async function readContract(...segments) {
  return parseJson(await readFile(path.join(contractDirectory, ...segments), "utf8"));
}

const schema = await readContract("audit-chain.schema.json");
const sample = await readContract("samples", "audit-chain", "lab-engagement.json");

// The key the sample was written with. It is in the repository because the
// sample is documentation; a real chaining key is not a document.
const KEY = Buffer.from("documentation-key-not-a-real-secret", "utf8");
const GENESIS = "0".repeat(64);

const CHAINED_FIELDS = [
  "entry_version",
  "sequence",
  "entry_id",
  "occurred_at",
  "actor",
  "action",
  "outcome",
  "subject",
  "facts",
  "previous_digest",
];

// ADR-013 says the chain uses the ADR-011 canonical form, so this uses the
// repository canonicalizer rather than a hand-rolled serialisation. That makes
// the test check the claim as well as the digests: if the Python writer and the
// canonical form disagree, this is where it shows.
function entryDigest(entry) {
  const payload = Object.fromEntries(
    CHAINED_FIELDS.map((name) => [name, entry[name]]),
  );

  return createHmac("sha256", KEY).update(canonicalize(payload), "utf8").digest("hex");
}

test("E1-005 the sample chain satisfies its contract", () => {
  assert.deepEqual(validate(schema, sample), []);
});

test("E1-005 the chain verifies in the other language", () => {
  let previous = GENESIS;

  for (const [index, entry] of sample.entries.entries()) {
    assert.equal(entry.sequence, index + 1, `${entry.entry_id} is out of sequence`);
    assert.equal(entry.previous_digest, previous, `${entry.entry_id} does not chain`);
    assert.equal(entry.entry_digest, entryDigest(entry), `${entry.entry_id} is altered`);

    previous = entry.entry_digest;
  }

  assert.equal(sample.head_digest, previous, "the export does not reach its own head");
});

test("E1-005 editing any entry breaks verification at the next one", () => {
  const tampered = structuredClone(sample);
  tampered.entries[1].subject = "run.9999";

  assert.notEqual(tampered.entries[1].entry_digest, entryDigest(tampered.entries[1]));
});

// The property the anchor exists for, asserted rather than left in prose.
test("E1-005 a truncated export verifies on its own and fails against the anchor", () => {
  const truncated = sample.entries.slice(0, 2);
  let previous = GENESIS;

  for (const entry of truncated) {
    assert.equal(entry.previous_digest, previous);
    assert.equal(entry.entry_digest, entryDigest(entry));
    previous = entry.entry_digest;
  }

  assert.notEqual(previous, sample.head_digest);
});

test("E1-005 an audit fact cannot carry free text or bytes", () => {
  const safe = [
    "identifier",
    "timestamp",
    "integer",
    "boolean",
    "enum_value",
    "digest",
    "label",
    "reason_code",
  ];

  assert.deepEqual([...schema.$defs.fact.properties.type.enum].sort(), [...safe].sort());

  for (const entry of sample.entries) {
    for (const fact of entry.facts) {
      assert.ok(safe.includes(fact.type), `${entry.entry_id}.${fact.name}`);
      assert.doesNotMatch(
        fact.name,
        /(secret|token|password|cookie|authorization|body|raw)/,
        `${entry.entry_id}.${fact.name} looks like it carries sensitive material`,
      );
    }
  }
});

// docs/04-security/08-evidence-privacy.md deletes evidence bytes after expiry.
// Audit is never deleted, so the two stores must not share a vocabulary that
// would let deletable material into the permanent one.
test("E1-005 the audit vocabulary admits no field an evidence store would own", () => {
  assert.equal(schema.$defs.fact.properties.value.maxLength, 200);
  assert.equal(schema.$defs.entry.properties.facts.maxItems, 20);
});

test("E1-005 an entry records what happened, not merely that it did", () => {
  assert.equal(schema.$defs.entry.properties.facts.minItems, 1);

  for (const entry of sample.entries) {
    assert.ok(entry.facts.length >= 1, entry.entry_id);
  }
});

test("E1-005 the sample exercises both outcomes", () => {
  const outcomes = new Set(sample.entries.map((entry) => entry.outcome));

  assert.deepEqual([...outcomes].sort(), ["allowed", "refused"]);
});
