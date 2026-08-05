#!/usr/bin/env node
// Repository task interface (backlog E0-001).
// Contract: docs/02-architecture/03-monorepo-module-boundaries.md, "Build orchestration".

import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkArchitecture } from "./architecture-check.mjs";
import { checkContracts } from "./contracts-check.mjs";
import { checkDocumentation } from "./docs-check.mjs";
import { evaluatePrerequisites, validateManifest } from "./prerequisites.mjs";
import { parseJson } from "./schema.mjs";
import { checkExposure } from "./topology.mjs";
import { checkWorkflows } from "./workflows.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const EXIT_SUCCESS = 0;
const EXIT_TASK_FAILED = 1;
const EXIT_INVALID_INVOCATION = 2;

const HELP_ALIASES = new Set(["--help", "-h", "help"]);

const tasks = new Map([
  [
    "help",
    {
      phase: "Phase 0",
      summary: "List every repository task.",
      run: printHelp,
    },
  ],
  [
    "check:foundation",
    {
      phase: "Phase 0",
      summary: "Run the repository foundation acceptance tests.",
      run: checkFoundation,
    },
  ],
  [
    "check:prerequisites",
    {
      phase: "Phase 0",
      summary: "Verify local toolchains against the version manifest.",
      run: checkPrerequisites,
    },
  ],
  [
    "check:docs",
    {
      phase: "Phase 0",
      summary: "Validate documentation links, fences and the ADR index.",
      run: () =>
        report("Documentation", checkDocumentation(repositoryRoot).then(asProblems)),
    },
  ],
  [
    "check:contracts",
    {
      phase: "Phase 0",
      summary: "Compile every JSON Schema and validate every sample document.",
      run: () => report("Contracts", checkContracts(repositoryRoot).then(asProblems)),
    },
  ],
  [
    "check:architecture",
    {
      phase: "Phase 0",
      summary: "Enforce module boundaries and process-execution ownership.",
      run: () =>
        report(
          "Architecture",
          // The file count keeps a clean result from being mistaken for a check
          // that inspected nothing.
          checkArchitecture(repositoryRoot).then((result) => ({
            ...result,
            note: `across ${result.analyzed.length} source files`,
          })),
        ),
    },
  ],
  [
    "check:exposure",
    {
      phase: "Phase 0",
      summary: "Assert the lab topology keeps every target off the host network.",
      run: () =>
        report("Exposure", checkExposure(repositoryRoot), "images not yet pinned"),
    },
  ],
  [
    "check:workflows",
    {
      phase: "Phase 0",
      summary: "Enforce workflow permissions, action pinning and injection policy.",
      run: () =>
        report("Workflows", checkWorkflows(repositoryRoot), "actions not yet pinned"),
    },
  ],
  [
    "check:orchestrator",
    {
      phase: "Phase 1",
      summary: "Run the Python orchestrator suite against the shared vectors.",
      run: checkOrchestrator,
    },
  ],
  [
    "check:all",
    {
      phase: "Phase 0",
      summary: "Run every check in bootstrap order and stop at the first failure.",
      run: checkAll,
    },
  ],
]);

const BOOTSTRAP_ORDER = [
  "check:prerequisites",
  "check:docs",
  "check:contracts",
  "check:architecture",
  "check:exposure",
  "check:workflows",
  "check:foundation",
  "check:orchestrator",
];

function asProblems(problems) {
  return { problems };
}

// One reporter for every check, so the output shape and the exit-code meaning
// do not drift between them.
async function report(label, pending, deferredLabel = "pending") {
  let result;

  try {
    result = await pending;
  } catch (error) {
    process.stderr.write(`${label} check could not run: ${error.message}\n`);
    return EXIT_TASK_FAILED;
  }

  const deferred = result.deferred ?? [];

  if (deferred.length > 0) {
    const lines = [`${deferredLabel} (${deferred.length}):`];

    for (const entry of deferred) {
      lines.push(`  ${entry.id} blocked by ${entry.blockedBy}`);
    }

    process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (result.problems.length > 0) {
    process.stderr.write(`${label} problems (${result.problems.length}):\n`);

    for (const problem of result.problems) {
      process.stderr.write(`  ${problem}\n`);
    }

    return EXIT_TASK_FAILED;
  }

  process.stdout.write(
    `${label}: no problems found${result.note === undefined ? "" : ` ${result.note}`}.\n`,
  );
  return EXIT_SUCCESS;
}

// The one documented bootstrap command. Stops at the first failing check so the
// first real problem stays at the end of the output.
async function checkAll() {
  for (const name of BOOTSTRAP_ORDER) {
    process.stdout.write(`\n== ${name} ==\n`);
    const code = await tasks.get(name).run();

    if (code !== EXIT_SUCCESS) {
      process.stderr.write(`\nBootstrap stopped at ${name}.\n`);
      return code;
    }
  }

  process.stdout.write(`\nAll ${BOOTSTRAP_ORDER.length} checks passed.\n`);
  return EXIT_SUCCESS;
}

function printHelp() {
  const nameWidth = Math.max(...[...tasks.keys()].map((name) => name.length));
  const phaseWidth = Math.max(...[...tasks.values()].map((t) => t.phase.length));

  const lines = [
    "Security Lab repository task interface",
    "",
    "Usage: node tools/repo.mjs <task>",
    "",
    "Tasks:",
  ];

  for (const [name, task] of tasks) {
    lines.push(
      `  ${name.padEnd(nameWidth)}  ${task.phase.padEnd(phaseWidth)}  ${task.summary}`,
    );
  }

  lines.push(
    "",
    `Exit codes: ${EXIT_SUCCESS} success, ${EXIT_TASK_FAILED} task failed, ${EXIT_INVALID_INVOCATION} invalid invocation.`,
  );

  process.stdout.write(`${lines.join("\n")}\n`);
  return EXIT_SUCCESS;
}

async function collectTestFiles(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
    recursive: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

// An inherited NODE_TEST_CONTEXT makes a nested `node --test` skip every file
// and still exit 0, which would report a green check that ran nothing. A missing
// result must never read as a pass, so the child starts without those variables.
function testRunnerEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.NODE_TEST_WORKER_ID;
  return environment;
}

async function checkFoundation() {
  const suiteDirectory = path.join(repositoryRoot, "tests", "foundation");
  let testFiles;

  try {
    testFiles = await collectTestFiles(suiteDirectory);
  } catch (error) {
    process.stderr.write(
      `Foundation suite is unreadable at tests/foundation: ${error.code ?? "unknown error"}\n`,
    );
    return EXIT_TASK_FAILED;
  }

  // A missing result is a failure, never a pass
  // (docs/05-devsecops/02-pipeline-jobs.md, "Failure semantics").
  if (testFiles.length === 0) {
    process.stderr.write("Foundation suite contains no test files.\n");
    return EXIT_TASK_FAILED;
  }

  const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: testRunnerEnvironment(),
  });

  if (result.error) {
    process.stderr.write(`Foundation suite failed to start: ${result.error.message}\n`);
    return EXIT_TASK_FAILED;
  }

  return result.status === EXIT_SUCCESS ? EXIT_SUCCESS : EXIT_TASK_FAILED;
}

// The orchestrator is Python and the scope contract is JSON Schema. Both are
// tested against the same conformance vectors, so this runs from the same task
// interface as the Node suite rather than from a separate command a reader has
// to know about.
async function checkOrchestrator() {
  const serviceRoot = path.join(repositoryRoot, "services", "orchestrator");
  const interpreter = process.env.PYTHON ?? "python3";

  const result = spawnSync(
    interpreter,
    ["-m", "unittest", "discover", "-s", "tests", "-t", ".", "-v"],
    { cwd: serviceRoot, stdio: "inherit", env: testRunnerEnvironment() },
  );

  // ENOENT here means the manifest promises a Python this machine does not
  // have. Reporting that as a pass is the failure this repository refuses.
  if (result.error) {
    process.stderr.write(
      `Orchestrator suite failed to start with "${interpreter}": ${result.error.message}\n`,
    );
    return EXIT_TASK_FAILED;
  }

  return result.status === EXIT_SUCCESS ? EXIT_SUCCESS : EXIT_TASK_FAILED;
}

async function checkPrerequisites() {
  const manifestPath = path.join(repositoryRoot, "version-manifest.json");
  let manifest;

  try {
    manifest = parseJson(await readFile(manifestPath, "utf8"));
  } catch (error) {
    process.stderr.write(`Version manifest is unusable: ${error.message}\n`);
    return EXIT_TASK_FAILED;
  }

  const problems = validateManifest(manifest);

  if (problems.length > 0) {
    process.stderr.write("Version manifest is invalid:\n");
    for (const problem of problems) {
      process.stderr.write(`  ${problem}\n`);
    }
    return EXIT_TASK_FAILED;
  }

  const report = evaluatePrerequisites(manifest);
  const lines = [`Prerequisites for phase ${manifest.activePhase}`, ""];

  lines.push(`Satisfied (${report.satisfied.length}):`);
  for (const entry of report.satisfied) {
    lines.push(`  ${entry.id} ${entry.version}`);
  }

  lines.push("", `Deferred (${report.deferred.length}):`);
  for (const entry of report.deferred) {
    lines.push(`  ${entry.id} from phase ${entry.requiredFromPhase}`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);

  if (report.failures.length > 0) {
    process.stderr.write(`\nUnmet (${report.failures.length}):\n`);
    for (const failure of report.failures) {
      process.stderr.write(`  ${failure.id}: ${failure.reason}\n`);
    }
    return EXIT_TASK_FAILED;
  }

  return EXIT_SUCCESS;
}

// Task names reach the log from the command line, so strip control characters
// and bound the length before echoing them
// (docs/04-security/03-secure-coding-standard.md, structured redacted logging).
function safeLabel(value) {
  return value.replaceAll(/[^\p{L}\p{N}:._-]/gu, "?").slice(0, 64);
}

function main(argv) {
  if (argv.length > 1) {
    process.stderr.write("Repository tasks accept exactly one task name.\n");
    return EXIT_INVALID_INVOCATION;
  }

  const requested = argv[0] ?? "help";
  const name = HELP_ALIASES.has(requested) ? "help" : requested;
  const task = tasks.get(name);

  if (task === undefined) {
    process.stderr.write(`Unknown repository task: ${safeLabel(requested)}\n`);
    process.stderr.write('Run "node tools/repo.mjs help" to list available tasks.\n');
    return EXIT_INVALID_INVOCATION;
  }

  return task.run();
}

// Setting exitCode rather than calling process.exit() lets Node flush stdout and
// stderr first. process.exit() abandons pending writes when the stream is a
// pipe, which silently truncates a task's report.
process.exitCode = await main(process.argv.slice(2));
