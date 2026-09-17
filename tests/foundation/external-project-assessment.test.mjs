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

async function readRepositoryJson(...segments) {
  return parseJson(await readFile(path.join(repositoryRoot, ...segments), "utf8"));
}

const profileSchema = await readRepositoryJson(
  "packages",
  "contracts",
  "projects",
  "project-profile.schema.json",
);
const planSchema = await readRepositoryJson(
  "packages",
  "contracts",
  "projects",
  "external-assessment-plan.schema.json",
);
const profileSample = await readRepositoryJson(
  "packages",
  "contracts",
  "projects",
  "samples",
  "project-profile",
  "example-web.json",
);
const planSample = await readRepositoryJson(
  "packages",
  "contracts",
  "projects",
  "samples",
  "external-assessment-plan",
  "static-readonly.json",
);

function clone(value) {
  return structuredClone(value);
}

test("external project profile is valid and immutable", () => {
  assert.deepEqual(validate(profileSchema, profileSample), []);

  const dirty = clone(profileSample);
  dirty.snapshot.dirty = true;
  assert.ok(validate(profileSchema, dirty).length > 0);

  const writable = clone(profileSample);
  writable.source.access = "read-write";
  assert.ok(validate(profileSchema, writable).length > 0);
});

test("external project profile cannot escape through source traversal flags", () => {
  for (const field of ["follow_symlinks", "allow_outside_root"]) {
    const mutated = clone(profileSample);
    mutated.source[field] = true;
    assert.ok(validate(profileSchema, mutated).length > 0, field);
  }
});

test("static assessment cannot execute or install project code", () => {
  assert.deepEqual(validate(planSchema, planSample), []);

  for (const field of ["execute_project_scripts", "install_dependencies"]) {
    const mutated = clone(planSample);
    mutated.safety[field] = true;
    assert.ok(validate(planSchema, mutated).length > 0, field);
  }
});

test("static assessment has no target network access", () => {
  const mutated = clone(planSample);
  mutated.safety.network_access = "internet";
  assert.ok(validate(planSchema, mutated).length > 0);
});

test("static assessment cannot follow symlinks or escape project root", () => {
  for (const field of ["follow_symlinks", "allow_outside_root"]) {
    const mutated = clone(planSample);
    mutated.safety[field] = true;
    assert.ok(validate(planSchema, mutated).length > 0, field);
  }
});

test("secret values and raw evidence cannot be retained in v1", () => {
  const rawSecrets = clone(planSample);
  rawSecrets.outputs.include_raw_secret_values = true;
  assert.ok(validate(planSchema, rawSecrets).length > 0);

  const noRedaction = clone(planSample);
  noRedaction.outputs.redact_secrets = false;
  assert.ok(validate(planSchema, noRedaction).length > 0);

  const rawEvidence = clone(planSample);
  rawEvidence.outputs.retain_raw_evidence = true;
  assert.ok(validate(planSchema, rawEvidence).length > 0);
});

test("assessment capabilities are a closed vocabulary", () => {
  const mutated = clone(planSample);
  mutated.capabilities.push("arbitrary-command");
  assert.ok(validate(planSchema, mutated).length > 0);
});
