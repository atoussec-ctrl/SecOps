// CI workflow policy and rendering (backlog E0-007).
//
// Workflow files are generated from .github/workflow-set.json for the same
// reason the lab Compose file is generated from a descriptor: permissions,
// action pinning and shell injection are safety properties, and checking them
// on hand-written YAML would need a YAML parser whose gaps become unchecked
// configuration. See adrs/010-generated-ci-workflows.md.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseJson, validate } from "./schema.mjs";

export const WORKFLOW_DIRECTORY = path.join(".github", "workflows");

const COMMIT_SHA = /^[0-9a-f]{40}$/;

// GitHub evaluates ${{ }} before the shell sees the script, so a value taken
// from a pull request title or branch name becomes command injection
// (docs/05-devsecops/04-static-supply-chain.md, workflow layer).
const WORKFLOW_EXPRESSION = /\$\{\{/;

// Setup-action inputs that name a runtime, mapped to the manifest entry that
// pins it. Adding a runtime to CI means adding it here, so an unpinned one
// cannot be installed by a workflow that looks ordinary.
const RUNTIME_INPUTS = [
  ["node-version", "node"],
  ["python-version", "python"],
];

const GENERATED_HEADER = (descriptorPath) => [
  `# Generated from ${descriptorPath} by tools/workflows.mjs.`,
  "# Do not edit by hand: `node tools/repo.mjs check:workflows` fails when this",
  "# file differs from the descriptor it is rendered from.",
];

export function resolveAction(actionRef, manifest) {
  const action = manifest.actions?.[actionRef];

  if (action === undefined) {
    return { state: "unknown" };
  }

  if (action.status !== "pinned") {
    return { state: "deferred", blockedBy: action.blockedBy };
  }

  if (typeof action.repository !== "string" || !COMMIT_SHA.test(`${action.commitSha}`)) {
    return { state: "unpinned" };
  }

  return { state: "resolved", uses: `${action.repository}@${action.commitSha}` };
}

function grantsWrite(permissions) {
  return Object.entries(permissions ?? {})
    .filter(([, level]) => level === "write")
    .map(([scope]) => scope)
    .sort();
}

function problemsForStep(workflowId, jobId, step, manifest) {
  const problems = [];
  const label = `${workflowId}/${jobId}/"${step.name}"`;

  if (step.kind === "action") {
    if (typeof step.action_ref !== "string") {
      problems.push(`${label}: an action step needs an action_ref`);
    } else {
      const resolved = resolveAction(step.action_ref, manifest);

      if (resolved.state === "unknown") {
        problems.push(
          `${label}: action "${step.action_ref}" is not listed in the version manifest`,
        );
      } else if (resolved.state === "unpinned") {
        problems.push(
          `${label}: action "${step.action_ref}" is not pinned to a repository and 40-character commit SHA`,
        );
      }
    }

    if (step.command !== undefined) {
      problems.push(`${label}: an action step must not also declare a command`);
    }
  }

  if (step.kind === "run") {
    if (typeof step.command !== "string") {
      problems.push(`${label}: a run step needs a command`);
    } else if (WORKFLOW_EXPRESSION.test(step.command)) {
      problems.push(`${label}: a run command must not interpolate a workflow expression`);
    }

    if (step.action_ref !== undefined) {
      problems.push(`${label}: a run step must not also declare an action_ref`);
    }
  }

  for (const [key, value] of Object.entries(step.with ?? {})) {
    if (WORKFLOW_EXPRESSION.test(value)) {
      problems.push(`${label}: input "${key}" must not interpolate a workflow expression`);
    }
  }

  // One source of truth for every runtime version: the version manifest. A
  // workflow that installs a runtime the manifest does not pin would test a
  // different repository from the one a developer runs locally.
  for (const [input, entryName] of RUNTIME_INPUTS) {
    const requested = step.with?.[input];
    const pinned = manifest.entries?.[entryName];

    if (requested === undefined || pinned === undefined) {
      continue;
    }

    if (requested !== pinned.version) {
      problems.push(
        `${label}: ${input} "${requested}" does not match the pinned ${pinned.version}`,
      );
    }
  }

  return problems;
}

export function checkWorkflowPolicy(descriptor, manifest) {
  const problems = [];
  const workflows = Object.entries(descriptor.workflows);

  if (workflows.length === 0) {
    problems.push("workflow set declares no workflows");
  }

  for (const [workflowId, workflow] of workflows) {
    const triggeredByPullRequest = workflow.triggers.pull_request !== undefined;

    if (Object.keys(workflow.triggers).length === 0) {
      problems.push(`${workflowId}: declares no trigger`);
    }

    for (const scope of grantsWrite(workflow.permissions)) {
      problems.push(
        `${workflowId}: workflow-level permission "${scope}" is write; the default token is read-only`,
      );
    }

    const jobs = Object.entries(workflow.jobs);

    if (jobs.length === 0) {
      problems.push(`${workflowId}: declares no jobs`);
    }

    for (const [jobId, job] of jobs) {
      // An untrusted pull request must never run with a writable token.
      if (triggeredByPullRequest) {
        for (const scope of grantsWrite(job.permissions)) {
          problems.push(
            `${workflowId}/${jobId}: permission "${scope}" is write in a pull-request workflow`,
          );
        }
      }

      for (const step of job.steps) {
        problems.push(...problemsForStep(workflowId, jobId, step, manifest));
      }
    }
  }

  return problems.sort();
}

export function deferredActions(descriptor, manifest) {
  const deferred = new Map();

  for (const workflow of Object.values(descriptor.workflows)) {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.kind !== "action" || typeof step.action_ref !== "string") {
          continue;
        }

        const resolved = resolveAction(step.action_ref, manifest);

        if (resolved.state === "deferred") {
          deferred.set(step.action_ref, resolved.blockedBy);
        }
      }
    }
  }

  return [...deferred]
    .map(([id, blockedBy]) => ({ id, blockedBy }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function renderPermissions(permissions, indent) {
  const lines = [`${indent}permissions:`];

  for (const [scope, level] of Object.entries(permissions)) {
    lines.push(`${indent}  ${scope}: ${level}`);
  }

  return lines;
}

export function renderWorkflow(workflow, manifest, descriptorPath) {
  const lines = [
    ...GENERATED_HEADER(descriptorPath),
    `name: ${workflow.name}`,
    "",
    "on:",
  ];

  for (const [trigger, value] of Object.entries(workflow.triggers)) {
    if (trigger === "workflow_dispatch") {
      lines.push("  workflow_dispatch:");
      continue;
    }

    lines.push(`  ${trigger}:`, "    branches:");

    for (const branch of value.branches) {
      lines.push(`      - ${branch}`);
    }
  }

  lines.push("", ...renderPermissions(workflow.permissions, ""), "", "jobs:");

  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    lines.push(
      `  ${jobId}:`,
      `    name: ${job.name}`,
      `    runs-on: ${job.runs_on}`,
      `    timeout-minutes: ${job.timeout_minutes}`,
      ...renderPermissions(job.permissions, "    "),
      "    steps:",
    );

    for (const step of job.steps) {
      lines.push(`      - name: ${step.name}`);

      if (step.kind === "action") {
        const resolved = resolveAction(step.action_ref, manifest);

        if (resolved.state !== "resolved") {
          throw new Error(
            `cannot render step "${step.name}": action "${step.action_ref}" is ${resolved.state}`,
          );
        }

        lines.push(`        uses: ${resolved.uses}`);

        if (step.with !== undefined) {
          lines.push("        with:");

          for (const [key, value] of Object.entries(step.with)) {
            lines.push(`          ${key}: "${value}"`);
          }
        }
      } else {
        lines.push(`        run: ${step.command}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

async function listRenderedWorkflows(root) {
  try {
    const entries = await readdir(path.join(root, WORKFLOW_DIRECTORY), {
      withFileTypes: true,
    });

    return entries
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function checkWorkflows(root) {
  const descriptorPath = path.join(".github", "workflow-set.json");
  let descriptor;
  let schema;
  let manifest;

  try {
    descriptor = parseJson(await readFile(path.join(root, descriptorPath), "utf8"));
    schema = parseJson(
      await readFile(
        path.join(root, "packages", "contracts", "ci", "workflow-set.schema.json"),
        "utf8",
      ),
    );
    manifest = parseJson(await readFile(path.join(root, "version-manifest.json"), "utf8"));
  } catch (error) {
    return { problems: [`workflow inputs are unusable: ${error.message}`], deferred: [] };
  }

  const schemaProblems = validate(schema, descriptor).map(
    (error) => `workflow-set.json: ${error.path} ${error.message}`,
  );

  if (schemaProblems.length > 0) {
    return { problems: schemaProblems.sort(), deferred: [] };
  }

  const problems = checkWorkflowPolicy(descriptor, manifest);
  const deferred = deferredActions(descriptor, manifest);
  const rendered = await listRenderedWorkflows(root);

  if (deferred.length > 0) {
    // Until every action is pinned no workflow can be generated, so any file
    // present in .github/workflows did not come from this descriptor.
    for (const file of rendered) {
      problems.push(
        `${WORKFLOW_DIRECTORY}/${file} exists but cannot be generated yet, so it is unverified`,
      );
    }

    return { problems: problems.sort(), deferred };
  }

  const expected = Object.keys(descriptor.workflows)
    .map((id) => `${id}.yml`)
    .sort();

  for (const file of rendered) {
    if (!expected.includes(file)) {
      problems.push(`${WORKFLOW_DIRECTORY}/${file} is not generated from the descriptor`);
    }
  }

  if (problems.length === 0) {
    for (const [id, workflow] of Object.entries(descriptor.workflows)) {
      const target = path.join(root, WORKFLOW_DIRECTORY, `${id}.yml`);
      const wanted = renderWorkflow(workflow, manifest, descriptorPath.replaceAll("\\", "/"));
      const actual = await readFile(target, "utf8").then(
        (contents) => contents,
        () => null,
      );

      if (actual === null) {
        problems.push(`${WORKFLOW_DIRECTORY}/${id}.yml is missing`);
      } else if (actual !== wanted) {
        problems.push(
          `${WORKFLOW_DIRECTORY}/${id}.yml does not match the descriptor it is rendered from`,
        );
      }
    }
  }

  return { problems: problems.sort(), deferred };
}
