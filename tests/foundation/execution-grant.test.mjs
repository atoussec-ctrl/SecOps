// The grant contract, and its agreement with the documents it references
// (backlog E1-004, ADR-012).
//
// The Python verifier is tested against its own behaviour in
// services/orchestrator/tests/test_execution_grant.py. These are the assertions
// that need the other side of the repository: the schema shape, and the fact
// that the worked sample points at a scope record and pinned addresses that
// actually exist.

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

const schema = await readContract("execution-grant.schema.json");
const scopeSchema = await readContract("scope-record.schema.json");
const grant = await readContract("samples", "execution-grant", "passive-run.json");
const scope = await readContract(
  "samples",
  "scope-record",
  "lab-private-network.json",
);

test("E1-004 the sample grant satisfies its contract", () => {
  assert.deepEqual(validate(schema, grant), []);
});

// A grant references a scope by digest and never restates it. That only helps
// if the digest names a scope that exists, so the sample is tied to one here
// rather than carrying a plausible-looking hash.
test("E1-004 the sample grant references a scope record that exists", () => {
  assert.equal(grant.scope_hash, scope.approval.scope_hash);
});

test("E1-004 every pinned address is a target of that scope", () => {
  const targets = new Set(scope.targets.ipv4);

  for (const address of grant.pinned_addresses) {
    assert.ok(targets.has(address), `${address} is not a target of the scope`);
  }
});

// docs/04-security/01-threat-model.md TM-S-001 lists what a grant must carry.
// Dropping one of these means editing a test that cites the requirement.
test("E1-004 the contract requires everything TM-S-001 asks for", () => {
  for (const field of [
    "signature",
    "expires_at",
    "audience",
    "nonce",
    "scope_hash",
    "key_id",
    "run_id",
  ]) {
    assert.ok(schema.required.includes(field), `${field} is not required`);
  }
});

// The scope contract admits only passive and bounded-active. A grant that could
// authorise a third profile would be a way around that, so the two vocabularies
// are asserted equal rather than merely similar.
test("E1-004 a grant cannot authorise a profile the scope cannot", () => {
  assert.deepEqual(
    [...schema.properties.profile.enum].sort(),
    [...scopeSchema.properties.allowed_profiles.items.enum].sort(),
  );
});

test("E1-004 a grant cannot be written without a destination", () => {
  assert.equal(schema.properties.pinned_addresses.minItems, 1);
});

// A name here would have to be resolved again at connect time, which is exactly
// the time-of-check to time-of-use gap E1-002 exists to close.
test("E1-004 a pinned address cannot be a hostname", () => {
  const pattern = new RegExp(schema.$defs.address.pattern);

  assert.equal(pattern.test("192.168.56.10"), true);
  assert.equal(pattern.test("::1"), true);
  assert.equal(pattern.test("web.lab.test"), false);
  assert.equal(pattern.test("localhost"), false);
});

test("E1-004 a grant timestamp cannot carry an offset", () => {
  const pattern = new RegExp(schema.$defs.timestamp.pattern);

  assert.equal(pattern.test("2026-08-05T12:00:00Z"), true);
  assert.equal(pattern.test("2026-08-05T12:00:00+00:00"), false);
});
