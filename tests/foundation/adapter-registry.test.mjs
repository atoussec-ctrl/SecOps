// The adapter registry contract (backlog E1-007).
//
// The Python loader is tested against its own behaviour in
// services/orchestrator/tests/test_adapter_registry.py. These are the
// assertions that need the rest of the repository beside the registry: the
// vocabularies it must share with the scope record and the grant, and the fact
// that every image it names exists in the version manifest.

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

const schema = await readContract("adapter-registry.schema.json");
const registry = await readContract("samples", "adapter-registry", "lab.json");
const scopeSchema = await readContract("scope-record.schema.json");
const grantSchema = await readContract("execution-grant.schema.json");
const manifest = parseJson(
  await readFile(path.join(repositoryRoot, "version-manifest.json"), "utf8"),
);

test("E1-007 the sample registry satisfies its contract", () => {
  assert.deepEqual(validate(schema, registry), []);
});

// Three documents decide what an adapter may do, and a value permitted by only
// two of them would be a way around the third.
test("E1-007 the profile vocabulary matches the scope and the grant", () => {
  const adapter = [...schema.$defs.adapter.properties.profile.enum].sort();

  assert.deepEqual(
    adapter,
    [...scopeSchema.properties.allowed_profiles.items.enum].sort(),
  );
  assert.deepEqual(adapter, [...grantSchema.properties.profile.enum].sort());
});

test("E1-007 every image an adapter names exists in the version manifest", () => {
  for (const adapter of registry.adapters) {
    if (adapter.image_ref === undefined) {
      continue;
    }

    const entry = manifest.entries[adapter.image_ref];

    assert.ok(entry, `${adapter.adapter_id} names unknown image ${adapter.image_ref}`);
    assert.equal(entry.category, "image", adapter.image_ref);
  }
});

// An unpinned image is deferred with a blocking task, never treated as absent.
test("E1-007 an image that is not yet pinned names the task that must pin it", () => {
  for (const adapter of registry.adapters) {
    if (adapter.image_ref === undefined) {
      continue;
    }

    const entry = manifest.entries[adapter.image_ref];

    if (entry.status !== "pinned") {
      assert.match(entry.blockedBy, /^E\d-\d{3}$/, adapter.image_ref);
    }
  }
});

// docs/03-applications/04-orchestrator-spec.md: fixed entrypoint, typed
// argument array, never a shell.
test("E1-007 no entrypoint or argument can carry a shell metacharacter", () => {
  const entrypoint = new RegExp(schema.$defs.adapter.properties.entrypoint.pattern);
  const value = new RegExp(schema.$defs.argument.properties.value.pattern);

  assert.equal(entrypoint.test("/zap/zap-baseline.py"), true);
  assert.equal(entrypoint.test("/bin/sh -c"), false);

  for (const hostile of ["a;b", "a|b", "a&b", "$(id)", "`id`", "a>b", "a b", 'a"b', "a'b"]) {
    assert.equal(value.test(hostile), false, hostile);
  }

  for (const adapter of registry.adapters) {
    assert.match(adapter.entrypoint, entrypoint, adapter.adapter_id);

    for (const argument of adapter.arguments) {
      assert.match(argument.value, value, `${adapter.adapter_id}: ${argument.value}`);
    }
  }
});

test("E1-007 an argument cannot be supplied by an operator", () => {
  // The kinds are what the orchestrator fills in. There is no free-text kind,
  // so there is no place for a value a caller chose.
  assert.deepEqual(
    [...schema.$defs.argument.properties.kind.enum].sort(),
    ["budget", "literal", "output-path", "target"],
  );
});

test("E1-007 the registry declares at least one adapter that needs no image", () => {
  // A synthetic adapter is what makes the run plane exercisable before any
  // image digest is pinned, and every image in this repository is still
  // unselected.
  const synthetic = registry.adapters.filter((adapter) => adapter.kind === "synthetic");

  assert.ok(synthetic.length >= 1, "no synthetic adapter");

  for (const adapter of synthetic) {
    assert.equal(adapter.image_ref, undefined, adapter.adapter_id);
  }
});

test("E1-007 every adapter declares what it can produce", () => {
  assert.equal(schema.$defs.adapter.properties.artifacts.minItems, 1);

  for (const adapter of registry.adapters) {
    assert.ok(adapter.artifacts.length >= 1, adapter.adapter_id);
  }
});

test("E1-007 adapter identifiers are unique and namespaced", () => {
  const ids = registry.adapters.map((adapter) => adapter.adapter_id);

  assert.equal(new Set(ids).size, ids.length, "duplicate adapter id");

  for (const id of ids) {
    assert.match(id, /^adapter\./, id);
  }
});
