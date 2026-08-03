import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseJson, validate } from "../../tools/schema.mjs";
import {
  WORKFLOW_DIRECTORY,
  checkWorkflowPolicy,
  checkWorkflows,
  deferredActions,
  renderWorkflow,
  resolveAction,
} from "../../tools/workflows.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const DESCRIPTOR_PATH = ".github/workflow-set.json";

async function readRepositoryJson(...segments) {
  return parseJson(await readFile(path.join(repositoryRoot, ...segments), "utf8"));
}

const schema = await readRepositoryJson(
  "packages",
  "contracts",
  "ci",
  "workflow-set.schema.json",
);
const repositoryDescriptor = await readRepositoryJson(".github", "workflow-set.json");
const repositoryManifest = await readRepositoryJson("version-manifest.json");

const SHA = "b".repeat(40);

const PINNED_MANIFEST = {
  entries: { node: { status: "pinned", version: "24.18.1" } },
  actions: {
    actionsCheckout: {
      status: "pinned",
      repository: "actions/checkout",
      commitSha: SHA,
    },
  },
};

function fixtureDescriptor() {
  return {
    workflow_set_version: "1.0.0",
    workflows: {
      pr: {
        name: "Pull request",
        triggers: { pull_request: { branches: ["main"] } },
        permissions: { contents: "read" },
        jobs: {
          checks: {
            name: "Repository checks",
            runs_on: "ubuntu-latest",
            permissions: { contents: "read" },
            timeout_minutes: 15,
            steps: [
              {
                name: "Check out the repository",
                kind: "action",
                action_ref: "actionsCheckout",
                with: { "node-version": "24.18.1" },
              },
              {
                name: "Run the foundation suite",
                kind: "run",
                command: "node tools/repo.mjs check:foundation",
              },
            ],
          },
        },
      },
    },
  };
}

function mutated(mutate) {
  const descriptor = fixtureDescriptor();
  mutate(descriptor);
  return descriptor;
}

test("E0-007 the repository workflow descriptor satisfies its contract", () => {
  assert.deepEqual(validate(schema, repositoryDescriptor), []);
});

test("E0-007 the repository workflow descriptor satisfies the policy", () => {
  assert.deepEqual(checkWorkflowPolicy(repositoryDescriptor, repositoryManifest), []);
});

// pull_request_target runs with repository secrets against untrusted code, and
// the protected-policy question is still open.
test("E0-007 the pull_request_target trigger is not expressible", () => {
  const descriptor = mutated((d) => {
    d.workflows.pr.triggers.pull_request_target = { branches: ["main"] };
  });

  assert.ok(validate(schema, descriptor).length > 0);
});

test("E0-007 an unknown permission scope is not expressible", () => {
  const descriptor = mutated((d) => {
    d.workflows.pr.permissions.administration = "write";
  });

  assert.ok(validate(schema, descriptor).length > 0);
});

test("E0-007 an unbounded job is not expressible", () => {
  const descriptor = mutated((d) => {
    delete d.workflows.pr.jobs.checks.timeout_minutes;
  });

  assert.ok(validate(schema, descriptor).length > 0);
});

test("E0-007 a write permission at workflow level is rejected", () => {
  const descriptor = mutated((d) => {
    d.workflows.pr.permissions.contents = "write";
  });

  const problems = checkWorkflowPolicy(descriptor, PINNED_MANIFEST);

  assert.ok(problems.some((problem) => /the default token is read-only/.test(problem)));
});

test("E0-007 a write permission in a pull-request job is rejected", () => {
  const descriptor = mutated((d) => {
    d.workflows.pr.jobs.checks.permissions["pull-requests"] = "write";
  });

  const problems = checkWorkflowPolicy(descriptor, PINNED_MANIFEST);

  assert.ok(
    problems.some((problem) => /is write in a pull-request workflow/.test(problem)),
  );
});

// The classic GitHub Actions injection: a pull request title reaching the shell.
test("E0-007 a workflow expression in a run command is rejected", () => {
  const descriptor = mutated((d) => {
    d.workflows.pr.jobs.checks.steps[1].command =
      "echo ${{ github.event.pull_request.title }}";
  });

  const problems = checkWorkflowPolicy(descriptor, PINNED_MANIFEST);

  assert.ok(
    problems.some((problem) => /must not interpolate a workflow expression/.test(problem)),
  );
});

test("E0-007 a workflow expression in an action input is rejected", () => {
  const descriptor = mutated((d) => {
    d.workflows.pr.jobs.checks.steps[0].with = { ref: "${{ github.head_ref }}" };
  });

  const problems = checkWorkflowPolicy(descriptor, PINNED_MANIFEST);

  assert.ok(problems.some((problem) => /input "ref"/.test(problem)));
});

test("E0-007 a malformed step is rejected", () => {
  const cases = [
    [
      (d) => {
        delete d.workflows.pr.jobs.checks.steps[0].action_ref;
      },
      /an action step needs an action_ref/,
    ],
    [
      (d) => {
        delete d.workflows.pr.jobs.checks.steps[1].command;
      },
      /a run step needs a command/,
    ],
    [
      (d) => {
        d.workflows.pr.jobs.checks.steps[0].command = "echo hi";
      },
      /must not also declare a command/,
    ],
    [
      (d) => {
        d.workflows.pr.jobs.checks.steps[1].action_ref = "actionsCheckout";
      },
      /must not also declare an action_ref/,
    ],
  ];

  for (const [mutate, expected] of cases) {
    const problems = checkWorkflowPolicy(mutated(mutate), PINNED_MANIFEST);

    assert.ok(problems.some((problem) => expected.test(problem)), expected.source);
  }
});

test("E0-007 an action outside the version manifest is rejected", () => {
  const descriptor = mutated((d) => {
    d.workflows.pr.jobs.checks.steps[0].action_ref = "mysteryAction";
  });

  const problems = checkWorkflowPolicy(descriptor, PINNED_MANIFEST);

  assert.ok(problems.some((problem) => /not listed in the version manifest/.test(problem)));
});

test("E0-007 an action pinned to a tag is rejected", () => {
  const manifest = {
    entries: {},
    actions: {
      actionsCheckout: { status: "pinned", repository: "actions/checkout", commitSha: "v4" },
    },
  };

  assert.deepEqual(resolveAction("actionsCheckout", manifest), { state: "unpinned" });
  assert.ok(
    checkWorkflowPolicy(fixtureDescriptor(), manifest).some((problem) =>
      /not pinned to a repository and 40-character commit SHA/.test(problem),
    ),
  );
});

test("E0-007 a runtime version that disagrees with the manifest is rejected", () => {
  const descriptor = mutated((d) => {
    d.workflows.pr.jobs.checks.steps[0].with["node-version"] = "22.0.0";
  });

  const problems = checkWorkflowPolicy(descriptor, PINNED_MANIFEST);

  assert.ok(problems.some((problem) => /does not match the pinned 24\.18\.1/.test(problem)));
});

test("E0-007 an unpinned action is deferred rather than failed", () => {
  const manifest = {
    entries: {},
    actions: { actionsCheckout: { status: "unselected", blockedBy: "E0-007" } },
  };

  assert.deepEqual(checkWorkflowPolicy(fixtureDescriptor(), manifest), []);
  assert.deepEqual(deferredActions(fixtureDescriptor(), manifest), [
    { id: "actionsCheckout", blockedBy: "E0-007" },
  ]);
});

test("E0-007 deferred actions are reported in a stable order", () => {
  const descriptor = mutated((d) => {
    d.workflows.pr.jobs.checks.steps.push({
      name: "Set up the pinned Node runtime",
      kind: "action",
      action_ref: "actionsSetupNode",
    });
  });
  const manifest = {
    entries: {},
    actions: {
      actionsSetupNode: { status: "unselected", blockedBy: "E0-007" },
      actionsCheckout: { status: "unselected", blockedBy: "E0-007" },
    },
  };

  assert.deepEqual(deferredActions(descriptor, manifest), [
    { id: "actionsCheckout", blockedBy: "E0-007" },
    { id: "actionsSetupNode", blockedBy: "E0-007" },
  ]);
});

test("E0-007 an empty workflow set is rejected", () => {
  const problems = checkWorkflowPolicy(
    { workflow_set_version: "1.0.0", workflows: {} },
    PINNED_MANIFEST,
  );

  assert.deepEqual(problems, ["workflow set declares no workflows"]);
});

test("E0-007 a workflow with no trigger or no job is rejected", () => {
  const noTrigger = checkWorkflowPolicy(
    mutated((d) => {
      d.workflows.pr.triggers = {};
    }),
    PINNED_MANIFEST,
  );
  const noJobs = checkWorkflowPolicy(
    mutated((d) => {
      d.workflows.pr.jobs = {};
    }),
    PINNED_MANIFEST,
  );

  assert.ok(noTrigger.some((problem) => /declares no trigger/.test(problem)));
  assert.ok(noJobs.some((problem) => /declares no jobs/.test(problem)));
});

test("E0-007 a manual trigger renders without branch filters", () => {
  const descriptor = mutated((d) => {
    d.workflows.pr.triggers = { workflow_dispatch: true };
  });

  const rendered = renderWorkflow(
    descriptor.workflows.pr,
    PINNED_MANIFEST,
    DESCRIPTOR_PATH,
  );

  assert.match(rendered, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(rendered, /branches:/);
});

test("E0-007 rendering emits pinned actions and minimal permissions", () => {
  const rendered = renderWorkflow(
    fixtureDescriptor().workflows.pr,
    PINNED_MANIFEST,
    DESCRIPTOR_PATH,
  );

  assert.match(rendered, /^name: Pull request$/m);
  assert.match(rendered, /^ {2}pull_request:$/m);
  assert.match(rendered, /^permissions:\n {2}contents: read$/m);
  assert.match(rendered, /^ {4}timeout-minutes: 15$/m);
  assert.match(rendered, new RegExp(`uses: actions/checkout@${SHA}`));
  assert.match(rendered, /run: node tools\/repo\.mjs check:foundation/);
  assert.doesNotMatch(rendered, /\$\{\{/);
  assert.doesNotMatch(rendered, /pull_request_target/);
});

test("E0-007 rendering refuses to emit an unpinned action", () => {
  const manifest = {
    entries: {},
    actions: { actionsCheckout: { status: "unselected", blockedBy: "E0-007" } },
  };

  assert.throws(
    () => renderWorkflow(fixtureDescriptor().workflows.pr, manifest, DESCRIPTOR_PATH),
    /cannot render step "Check out the repository".*deferred/,
  );
});

test("E0-007 rendering is deterministic", () => {
  const workflow = fixtureDescriptor().workflows.pr;

  assert.equal(
    renderWorkflow(workflow, PINNED_MANIFEST, DESCRIPTOR_PATH),
    renderWorkflow(workflow, PINNED_MANIFEST, DESCRIPTOR_PATH),
  );
});

async function createWorkflowTree(descriptor, manifest, workflowFiles = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "security-lab-e0-007-"));

  await mkdir(path.join(root, ".github"), { recursive: true });
  await mkdir(path.join(root, "packages", "contracts", "ci"), { recursive: true });

  await writeFile(
    path.join(root, ".github", "workflow-set.json"),
    JSON.stringify(descriptor),
    "utf8",
  );
  await writeFile(
    path.join(root, "packages", "contracts", "ci", "workflow-set.schema.json"),
    JSON.stringify(schema),
    "utf8",
  );
  await writeFile(path.join(root, "version-manifest.json"), JSON.stringify(manifest), "utf8");

  const entries = Object.entries(workflowFiles);

  if (entries.length > 0) {
    await mkdir(path.join(root, WORKFLOW_DIRECTORY), { recursive: true });

    for (const [name, contents] of entries) {
      await writeFile(path.join(root, WORKFLOW_DIRECTORY, name), contents, "utf8");
    }
  }

  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("E0-007 a generated workflow that matches the descriptor is accepted", async (t) => {
  const rendered = renderWorkflow(
    fixtureDescriptor().workflows.pr,
    PINNED_MANIFEST,
    DESCRIPTOR_PATH,
  );
  const tree = await createWorkflowTree(fixtureDescriptor(), PINNED_MANIFEST, {
    "pr.yml": rendered,
  });
  t.after(tree.cleanup);

  assert.deepEqual(await checkWorkflows(tree.root), { problems: [], deferred: [] });
});

test("E0-007 a hand-edited workflow is detected", async (t) => {
  const tampered = renderWorkflow(
    fixtureDescriptor().workflows.pr,
    PINNED_MANIFEST,
    DESCRIPTOR_PATH,
  ).replace("contents: read", "contents: write");
  const tree = await createWorkflowTree(fixtureDescriptor(), PINNED_MANIFEST, {
    "pr.yml": tampered,
  });
  t.after(tree.cleanup);

  const report = await checkWorkflows(tree.root);

  assert.ok(report.problems.some((problem) => /does not match the descriptor/.test(problem)));
});

test("E0-007 a missing generated workflow is reported", async (t) => {
  const tree = await createWorkflowTree(fixtureDescriptor(), PINNED_MANIFEST);
  t.after(tree.cleanup);

  const report = await checkWorkflows(tree.root);

  assert.ok(report.problems.some((problem) => /pr\.yml is missing/.test(problem)));
});

test("E0-007 a workflow file with no descriptor entry is reported", async (t) => {
  const rendered = renderWorkflow(
    fixtureDescriptor().workflows.pr,
    PINNED_MANIFEST,
    DESCRIPTOR_PATH,
  );
  const tree = await createWorkflowTree(fixtureDescriptor(), PINNED_MANIFEST, {
    "pr.yml": rendered,
    "smuggled.yml": "name: smuggled\n",
  });
  t.after(tree.cleanup);

  const report = await checkWorkflows(tree.root);

  assert.ok(
    report.problems.some((problem) => /smuggled\.yml is not generated/.test(problem)),
  );
});

test("E0-007 a workflow that cannot yet be generated is rejected as unverified", async (t) => {
  const manifest = {
    entries: {},
    actions: { actionsCheckout: { status: "unselected", blockedBy: "E0-007" } },
  };
  const tree = await createWorkflowTree(fixtureDescriptor(), manifest, {
    "pr.yml": "name: hand written\n",
  });
  t.after(tree.cleanup);

  const report = await checkWorkflows(tree.root);

  assert.ok(report.problems.some((problem) => /unverified/.test(problem)));
  assert.deepEqual(report.deferred, [{ id: "actionsCheckout", blockedBy: "E0-007" }]);
});

test("E0-007 the workflow check fails closed on an invalid descriptor", async (t) => {
  const tree = await createWorkflowTree(
    mutated((d) => {
      d.workflows.pr.jobs.checks.runs_on = "windows-latest";
    }),
    PINNED_MANIFEST,
  );
  t.after(tree.cleanup);

  const report = await checkWorkflows(tree.root);

  assert.ok(report.problems.some((problem) => /runs_on/.test(problem)));
});

test("E0-007 the workflow check fails closed on unreadable inputs", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "security-lab-e0-007b-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const report = await checkWorkflows(root);

  assert.ok(report.problems.some((problem) => /unusable/.test(problem)));
});
