import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const taskInterface = path.join(repositoryRoot, "tools", "repo.mjs");

function runTaskInterface(args, entry = taskInterface) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

// Isolated copy of the task interface, so the fail-closed paths can be observed
// without disturbing the real foundation suite.
async function createDetachedTaskInterface(suite) {
  const root = await mkdtemp(path.join(tmpdir(), "security-lab-e0-001-"));
  const suiteDirectory = path.join(root, "tests", "foundation");

  await cp(path.join(repositoryRoot, "tools"), path.join(root, "tools"), {
    recursive: true,
  });

  if (suite !== "absent") {
    await mkdir(suiteDirectory, { recursive: true });
  }

  if (suite === "failing" || suite === "passing") {
    await writeFile(
      path.join(suiteDirectory, "detached.test.mjs"),
      [
        'import assert from "node:assert/strict";',
        'import test from "node:test";',
        `test("detached", () => assert.equal(1, ${suite === "passing" ? "1" : "2"}));`,
        "",
      ].join("\n"),
      "utf8",
    );
  }

  return {
    entry: path.join(root, "tools", "repo.mjs"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function createDetachedManifest(contents) {
  const root = await mkdtemp(path.join(tmpdir(), "security-lab-e0-002-"));

  await cp(path.join(repositoryRoot, "tools"), path.join(root, "tools"), {
    recursive: true,
  });

  if (contents !== null) {
    await writeFile(path.join(root, "version-manifest.json"), contents, "utf8");
  }

  return {
    entry: path.join(root, "tools", "repo.mjs"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("E0-001 task interface defaults to help", () => {
  const result = runTaskInterface([]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check:foundation/);
  assert.match(result.stdout, /Phase 0/);
});

test("E0-001 task interface accepts the conventional help flags", () => {
  const expected = runTaskInterface(["help"]).stdout;

  for (const flag of ["--help", "-h"]) {
    const result = runTaskInterface([flag]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected, `${flag} must print the task list`);
  }
});

test("E0-002 help lists the prerequisite check", () => {
  const result = runTaskInterface(["help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check:prerequisites/);
});

test("E0-003 help lists the documentation and contract checks", () => {
  const result = runTaskInterface(["help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check:docs/);
  assert.match(result.stdout, /check:contracts/);
});

test("E0-003 the documentation and contract checks pass on this repository", () => {
  for (const task of ["check:docs", "check:contracts"]) {
    const result = runTaskInterface([task]);

    assert.equal(result.status, 0, `${task}: ${result.stderr}`);
    assert.match(result.stdout, /no problems found/);
  }
});

// check:all runs check:foundation, so executing it from inside the foundation
// suite would recurse. Its composition is covered by the individual checks.
test("Phase 0 help lists the aggregate bootstrap check", () => {
  const result = runTaskInterface(["help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check:all/);
  assert.match(result.stdout, /bootstrap order/);
});

// The orchestrator suite is the first check that leaves Node. It is also the
// first that can silently run nothing: `unittest discover` exits 0 when it
// finds no test, so a wrong path would report a pass over an empty suite.
test("E1-001 help lists the orchestrator check and it runs real tests", () => {
  assert.match(runTaskInterface(["help"]).stdout, /check:orchestrator/);

  const result = runTaskInterface(["check:orchestrator"]);

  assert.equal(result.status, 0, result.stderr);

  // unittest writes its summary to stderr. Both halves matter: OK alone would
  // also be printed for zero tests.
  const output = `${result.stdout}${result.stderr}`;
  const ran = output.match(/Ran (\d+) tests?/);

  assert.ok(ran, `no test count in the orchestrator output:\n${output}`);
  assert.ok(
    Number(ran[1]) >= 10,
    `the orchestrator suite ran only ${ran[1]} tests`,
  );
  assert.match(output, /\nOK/);
});

// A Python this machine does not have must fail the check, never skip it.
test("E1-001 a missing interpreter fails the orchestrator check", () => {
  const result = spawnSync(process.execPath, [taskInterface, "check:orchestrator"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, PYTHON: "python-that-is-not-installed" },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed to start/);
});

test("E0-007 help lists the workflow check and it passes on this repository", () => {
  assert.match(runTaskInterface(["help"]).stdout, /check:workflows/);

  const result = runTaskInterface(["check:workflows"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Workflows: no problems found/);

  // A pass means one of two things and the output must distinguish them: every
  // action is pinned and each workflow file matches what its descriptor
  // renders, or nothing could be generated yet and the check says so. Silence
  // would let an unpinned action read as a verified workflow.
  const deferred = /actions not yet pinned/.test(result.stdout);
  const rendered = existsSync(
    path.join(repositoryRoot, ".github", "workflows", "pr.yml"),
  );

  assert.notEqual(
    deferred,
    rendered,
    `expected either deferred actions or a rendered workflow, got deferred=${deferred} rendered=${rendered}`,
  );
});

test("E0-006 help lists the architecture check and it passes on this repository", () => {
  assert.match(runTaskInterface(["help"]).stdout, /check:architecture/);

  const result = runTaskInterface(["check:architecture"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no problems found across \d+ source files/);
});

test("E0-005 help lists the exposure check and it passes on this repository", () => {
  assert.match(runTaskInterface(["help"]).stdout, /check:exposure/);

  const result = runTaskInterface(["check:exposure"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Exposure: no problems found/);
});

test("E0-002 prerequisite check reports satisfied and deferred toolchains", () => {
  const result = runTaskInterface(["check:prerequisites"]);

  assert.match(result.stdout, /^Prerequisites for phase \d+$/m);
  assert.match(result.stdout, /^Satisfied \(\d+\):$/m);
  assert.match(result.stdout, /^Deferred \(\d+\):$/m);

  // The verdict depends on the workstation, but a non-zero exit must always say
  // what is unmet rather than fail silently.
  if (result.status !== 0) {
    assert.match(result.stderr, /^Unmet \(\d+\):$/m);
  }
});

test("E0-002 prerequisite check fails closed when the manifest is missing", async (t) => {
  const detached = await createDetachedManifest(null);
  t.after(detached.cleanup);

  const result = runTaskInterface(["check:prerequisites"], detached.entry);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unusable/);
});

test("E0-002 prerequisite check fails closed on malformed manifest JSON", async (t) => {
  const detached = await createDetachedManifest("{ this is not json");
  t.after(detached.cleanup);

  const result = runTaskInterface(["check:prerequisites"], detached.entry);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unusable/);
});

test("E0-002 prerequisite check fails closed on an invalid manifest", async (t) => {
  const detached = await createDetachedManifest(
    JSON.stringify({ manifestVersion: 99, activePhase: 0, entries: {}, actions: {} }),
  );
  t.after(detached.cleanup);

  const result = runTaskInterface(["check:prerequisites"], detached.entry);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid/);
  assert.match(result.stderr, /manifestVersion/);
});

test("E0-002 prerequisite check reports an unselected requirement as unmet", async (t) => {
  const detached = await createDetachedManifest(
    JSON.stringify({
      manifestVersion: 1,
      activePhase: 0,
      entries: {
        python: {
          category: "runtime",
          purpose: "Orchestrator runtime",
          requiredFromPhase: 0,
          status: "unselected",
          blockedBy: "E1-001",
          reason: "not installed",
        },
      },
      actions: {},
    }),
  );
  t.after(detached.cleanup);

  const result = runTaskInterface(["check:prerequisites"], detached.entry);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /python: not selected; blocked by E1-001/);
});

test("E0-001 task interface documents its exit-code contract", () => {
  const result = runTaskInterface(["help"]);

  assert.match(result.stdout, /0 success/);
  assert.match(result.stdout, /1 task failed/);
  assert.match(result.stdout, /2 invalid invocation/);
});

test("E0-001 task interface rejects more than one task name", () => {
  const result = runTaskInterface(["help", "check:foundation"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /exactly one task name/);
});

test("E0-001 task interface neutralizes control characters in a rejected task name", () => {
  const result = runTaskInterface(["check:foundation\nUnknown repository task: forged"]);
  const reportedLines = result.stderr.trimEnd().split("\n");

  assert.equal(result.status, 2);
  assert.equal(
    reportedLines[0],
    "Unknown repository task: check:foundation?Unknown?repository?task:?forged",
  );
  // The injected text must not be able to forge a second diagnostic line.
  assert.equal(reportedLines.length, 2);
  assert.match(reportedLines[1], /node tools\/repo\.mjs help/);
});

test("E0-001 task interface bounds the length of a rejected task name", () => {
  const result = runTaskInterface(["x".repeat(200)]);

  assert.equal(result.status, 2);
  assert.equal(result.stderr.split("\n")[0], `Unknown repository task: ${"x".repeat(64)}`);
});

test("E0-001 foundation check fails closed when the suite holds no tests", async (t) => {
  const detached = await createDetachedTaskInterface("empty");
  t.after(detached.cleanup);

  const result = runTaskInterface(["check:foundation"], detached.entry);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no test files/);
});

test("E0-001 foundation check fails closed when the suite is absent", async (t) => {
  const detached = await createDetachedTaskInterface("absent");
  t.after(detached.cleanup);

  const result = runTaskInterface(["check:foundation"], detached.entry);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unreadable/);
});

test("E0-001 foundation check reports a failing suite as failed", async (t) => {
  const detached = await createDetachedTaskInterface("failing");
  t.after(detached.cleanup);

  const result = runTaskInterface(["check:foundation"], detached.entry);

  assert.equal(result.status, 1);
});

// A nested `node --test` that inherits NODE_TEST_CONTEXT skips every file and
// exits 0. The check must not turn that empty run into a pass.
test("E0-001 foundation check ignores an inherited test-runner context", async (t) => {
  const detached = await createDetachedTaskInterface("failing");
  t.after(detached.cleanup);

  const result = spawnSync(process.execPath, [detached.entry, "check:foundation"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, NODE_TEST_CONTEXT: "child-v8" },
  });

  assert.equal(result.status, 1);
});

test("E0-001 foundation check reports a passing suite as successful", async (t) => {
  const detached = await createDetachedTaskInterface("passing");
  t.after(detached.cleanup);

  const result = runTaskInterface(["check:foundation"], detached.entry);

  assert.equal(result.status, 0, result.stderr);
});
