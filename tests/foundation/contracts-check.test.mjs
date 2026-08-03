import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkContracts } from "../../tools/contracts-check.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const SIMPLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name: { type: "string" } },
};

async function createContractsTree(files) {
  const root = await mkdtemp(path.join(tmpdir(), "security-lab-e0-003c-"));

  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, "packages", "contracts", relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(
      absolute,
      typeof contents === "string" ? contents : JSON.stringify(contents),
      "utf8",
    );
  }

  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("E0-003 the repository contracts are valid", async () => {
  assert.deepEqual(await checkContracts(repositoryRoot), []);
});

test("E0-003 a valid schema with conforming samples passes", async (t) => {
  const tree = await createContractsTree({
    "thing.schema.json": SIMPLE_SCHEMA,
    "samples/thing/good.json": { name: "ok" },
  });
  t.after(tree.cleanup);

  assert.deepEqual(await checkContracts(tree.root), []);
});

test("E0-003 a schema using an unsupported keyword is reported", async (t) => {
  const tree = await createContractsTree({
    "thing.schema.json": { type: "object", oneOf: [] },
  });
  t.after(tree.cleanup);

  const problems = await checkContracts(tree.root);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /invalid schema.*oneOf/);
});

test("E0-003 an unparseable schema is reported", async (t) => {
  const tree = await createContractsTree({ "thing.schema.json": "{ broken" });
  t.after(tree.cleanup);

  const problems = await checkContracts(tree.root);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /unreadable/);
});

test("E0-003 a sample that violates its schema is reported with the failing path", async (t) => {
  const tree = await createContractsTree({
    "thing.schema.json": SIMPLE_SCHEMA,
    "samples/thing/bad.json": { name: 7 },
  });
  t.after(tree.cleanup);

  const problems = await checkContracts(tree.root);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /samples\/thing\/bad\.json: \/name expected string/);
});

test("E0-003 a sample group with no matching schema is reported", async (t) => {
  const tree = await createContractsTree({
    "samples/orphan/document.json": { name: "ok" },
  });
  t.after(tree.cleanup);

  const problems = await checkContracts(tree.root);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /no schema at/);
});

test("E0-003 a loose file in the samples directory is reported", async (t) => {
  const tree = await createContractsTree({
    "thing.schema.json": SIMPLE_SCHEMA,
    "samples/stray.json": { name: "ok" },
  });
  t.after(tree.cleanup);

  const problems = await checkContracts(tree.root);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /must sit in a directory named after their schema/);
});

test("E0-003 an empty sample group is reported", async (t) => {
  const tree = await createContractsTree({ "thing.schema.json": SIMPLE_SCHEMA });
  await mkdir(
    path.join(tree.root, "packages", "contracts", "samples", "thing"),
    { recursive: true },
  );
  t.after(tree.cleanup);

  const problems = await checkContracts(tree.root);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /contains no documents/);
});

test("E0-003 an unparseable sample is reported", async (t) => {
  const tree = await createContractsTree({
    "thing.schema.json": SIMPLE_SCHEMA,
    "samples/thing/broken.json": "{ not json",
  });
  t.after(tree.cleanup);

  const problems = await checkContracts(tree.root);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /broken\.json/);
});

test("E0-003 a missing contracts directory fails closed", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "security-lab-e0-003d-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.deepEqual(await checkContracts(root), ["packages/contracts is unreadable"]);
});
