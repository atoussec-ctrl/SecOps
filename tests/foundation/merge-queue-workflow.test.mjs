import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseJson, validate } from "../../tools/schema.mjs";
import { renderWorkflow } from "../../tools/workflows.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readJson(...segments) {
  return parseJson(await readFile(path.join(root, ...segments), "utf8"));
}

const schema = await readJson("packages", "contracts", "ci", "workflow-set.schema.json");
const descriptor = await readJson(".github", "workflow-set.json");
const manifest = await readJson("version-manifest.json");

test("required PR checks also run for merge queue candidate commits", () => {
  assert.deepEqual(validate(schema, descriptor), []);
  assert.deepEqual(descriptor.workflows.pr.triggers.merge_group, { branches: ["main"] });

  const rendered = renderWorkflow(
    descriptor.workflows.pr,
    manifest,
    ".github/workflow-set.json",
  );

  assert.match(rendered, /^ {2}pull_request:$/m);
  assert.match(rendered, /^ {2}merge_group:$/m);
  assert.match(rendered, /^ {6}- main$/m);
  assert.doesNotMatch(rendered, /pull_request_target/);
});
