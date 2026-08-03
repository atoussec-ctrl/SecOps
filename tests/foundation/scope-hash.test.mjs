import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseJson, validate } from "../../tools/schema.mjs";
import {
  CanonicalFormError,
  canonicalize,
  scopeHash,
  scopeWithoutHash,
  verifyScopeHash,
} from "../../tools/scope-hash.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const contractDirectory = path.join(repositoryRoot, "packages", "contracts", "security");

async function readContract(...segments) {
  return parseJson(await readFile(path.join(contractDirectory, ...segments), "utf8"));
}

const vectorSchema = await readContract("canonical-form.schema.json");
const vectors = await readContract("samples", "canonical-form", "canonical-vectors.json");

test("E1-003 object keys are sorted and whitespace removed", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({ a: 2, b: 1 }), '{"a":2,"b":1}');
});

test("E1-003 key order in the input never changes the output", () => {
  const one = { engagement_id: "E", approval: { approver: "A", reference: "R" } };
  const other = { approval: { reference: "R", approver: "A" }, engagement_id: "E" };

  assert.equal(canonicalize(one), canonicalize(other));
});

test("E1-003 array order is preserved", () => {
  assert.equal(canonicalize([3, 1, 2]), "[3,1,2]");
  assert.notEqual(canonicalize([1, 2]), canonicalize([2, 1]));
});

test("E1-003 negative zero normalizes", () => {
  assert.equal(canonicalize(-0), "0");
  assert.equal(canonicalize(0), "0");
});

test("E1-003 a value the form cannot represent is an error", () => {
  for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e30, undefined]) {
    assert.throws(() => canonicalize(value), CanonicalFormError, `${value}`);
  }
});

test("E1-003 an unrepresentable value is reported with its location", () => {
  assert.throws(
    () => canonicalize({ budgets: { rate: 0.5 } }),
    (error) =>
      error instanceof CanonicalFormError && error.message.startsWith("/budgets/rate"),
  );
});

test("E1-003 the digest ignores the field that carries it", () => {
  const scope = {
    engagement_id: "ENG-2026-0001",
    approval: { approver: "A", scope_hash: "0".repeat(64) },
  };
  const tampered = structuredClone(scope);
  tampered.approval.scope_hash = "f".repeat(64);

  assert.equal(scopeHash(scope), scopeHash(tampered));
  assert.equal(scopeWithoutHash(scope).approval.scope_hash, undefined);
});

test("E1-003 the digest changes when anything else changes", () => {
  const scope = {
    engagement_id: "ENG-2026-0001",
    approval: { approver: "A", scope_hash: "0".repeat(64) },
    targets: { ports: [8081] },
  };
  const widened = structuredClone(scope);
  widened.targets.ports = [8081, 8082];

  assert.notEqual(scopeHash(scope), scopeHash(widened));
});

test("E1-003 a scope with no approval block still hashes", () => {
  assert.match(scopeHash({ engagement_id: "ENG-2026-0001" }), /^[0-9a-f]{64}$/);
});

test("E1-003 a non-object scope is rejected", () => {
  for (const value of [null, [], "scope", 7]) {
    assert.throws(() => scopeHash(value), CanonicalFormError);
  }
});

test("E1-003 the vector file satisfies its contract", () => {
  assert.deepEqual(validate(vectorSchema, vectors), []);
});

// The vectors are what a Python implementation is held to. Re-deriving them here
// also catches an accidental change to the canonical form.
test("E1-003 every accepted vector reproduces its canonical form and digest", () => {
  for (const vector of vectors.vectors) {
    const canonical = canonicalize(vector.value);

    assert.equal(canonical, vector.canonical, vector.name);
    assert.equal(
      createHash("sha256").update(canonical, "utf8").digest("hex"),
      vector.sha256,
      vector.name,
    );
  }
});

test("E1-003 every rejected vector is refused", () => {
  for (const vector of vectors.rejected) {
    assert.throws(
      () => canonicalize(JSON.parse(vector.value_json)),
      CanonicalFormError,
      vector.name,
    );
  }
});

test("E1-003 the sample scopes carry a correct digest", async () => {
  for (const name of ["lab-loopback.json", "lab-private-network.json"]) {
    const scope = await readContract("samples", "scope-record", name);
    const result = verifyScopeHash(scope);

    assert.equal(
      result.matches,
      true,
      `${name}: declared ${result.declared}, expected ${result.expected}`,
    );
  }
});

test("E1-003 a tampered sample scope fails verification", async () => {
  const scope = await readContract("samples", "scope-record", "lab-loopback.json");

  scope.targets.ports.push(9999);

  assert.equal(verifyScopeHash(scope).matches, false);
});
