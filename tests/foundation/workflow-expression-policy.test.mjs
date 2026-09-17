import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseJson, validate } from "../../tools/schema.mjs";
import { checkWorkflowPolicy, renderWorkflow } from "../../tools/workflows.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const schema = parseJson(
  await readFile(path.join(root, "packages", "contracts", "ci", "workflow-set.schema.json"), "utf8"),
);
const SHA = "b".repeat(40);
const manifest = {
  entries: {},
  actions: {
    checkout: { status: "pinned", repository: "actions/checkout", commitSha: SHA },
    attest: { status: "pinned", repository: "actions/attest", commitSha: SHA },
  },
};

function descriptor() {
  return {
    workflow_set_version: "1.1.0",
    workflows: {
      release: {
        name: "Supply chain smoke",
        triggers: { workflow_dispatch: true },
        permissions: { contents: "read" },
        jobs: {
          release: {
            name: "Build and attest",
            runs_on: "ubuntu-latest",
            permissions: {
              contents: "read",
              packages: "write",
              "id-token": "write",
              attestations: "write",
            },
            timeout_minutes: 30,
            steps: [
              { name: "Checkout", kind: "action", action_ref: "checkout" },
              {
                name: "Resolve digest",
                id: "push",
                kind: "run",
                command: "echo digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa >> $GITHUB_OUTPUT",
              },
              {
                name: "Attest",
                kind: "action",
                action_ref: "attest",
                with: {
                  "subject-name": "ghcr.io/atoussec-ctrl/fixture",
                  "subject-digest": { expression: "steps.push.outputs.digest" },
                  "push-to-registry": "true",
                },
              },
            ],
          },
        },
      },
    },
  };
}

test("E0-007 typed immutable metadata and prior-step outputs validate", () => {
  const value = descriptor();
  value.workflows.release.jobs.release.steps[2].with.actor = { expression: "github.actor" };
  value.workflows.release.jobs.release.steps[2].with.token = { expression: "secrets.GITHUB_TOKEN" };
  assert.deepEqual(validate(schema, value), []);
  assert.deepEqual(checkWorkflowPolicy(value, manifest), []);
});

test("E0-007 untrusted event payload expressions are not representable", () => {
  const value = descriptor();
  value.workflows.release.jobs.release.steps[2].with.bad = {
    expression: "github.event.pull_request.title",
  };
  assert.ok(validate(schema, value).length > 0);
});

test("E0-007 an output cannot be referenced before its producer", () => {
  const value = descriptor();
  value.workflows.release.jobs.release.steps.reverse();
  const problems = checkWorkflowPolicy(value, manifest);
  assert.ok(problems.some((problem) => /references step "push" before that step is defined/.test(problem)));
});

test("E0-007 duplicate step ids fail closed", () => {
  const value = descriptor();
  value.workflows.release.jobs.release.steps[0].id = "push";
  const problems = checkWorkflowPolicy(value, manifest);
  assert.ok(problems.some((problem) => /duplicate step id "push"/.test(problem)));
});

test("E0-007 merge queue candidates cannot receive writable release permissions", () => {
  const value = descriptor();
  value.workflows.release.triggers = {
    merge_group: { branches: ["main"] },
  };
  const problems = checkWorkflowPolicy(value, manifest);
  for (const scope of ["packages", "id-token", "attestations"]) {
    assert.ok(
      problems.some(
        (problem) =>
          problem.includes(`permission "${scope}" is write`) &&
          problem.includes("pull-request or merge-group workflow"),
      ),
      `expected ${scope} write to be refused for merge_group`,
    );
  }
});

test("E0-007 typed expressions render while raw shell interpolation stays absent", () => {
  const rendered = renderWorkflow(
    descriptor().workflows.release,
    manifest,
    ".github/workflow-set.json",
  );
  assert.match(rendered, /^ {8}id: push$/m);
  assert.match(rendered, /subject-digest: \$\{\{ steps\.push\.outputs\.digest \}\}/);
  assert.doesNotMatch(rendered, /github\.event/);
});
