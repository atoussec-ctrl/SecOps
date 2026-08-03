import assert from "node:assert/strict";
import test from "node:test";

import {
  MANIFEST_VERSION,
  defaultProbe,
  evaluatePrerequisites,
  runVersionCommand,
  validateManifest,
} from "../../tools/prerequisites.mjs";

const KNOWN_OUTCOMES = new Set([
  "found",
  "absent",
  "unreadable",
  "timeout",
  "no-probe",
]);

function manifestWith(entries, activePhase = 0) {
  return {
    manifestVersion: MANIFEST_VERSION,
    activePhase,
    entries,
    actions: {},
  };
}

const pinnedNode = {
  category: "runtime",
  purpose: "JavaScript runtime",
  requiredFromPhase: 0,
  status: "pinned",
  version: "24.18.1",
};

function probeReturning(outcome) {
  return () => outcome;
}

test("E0-002 a pinned prerequisite at the matching version is satisfied", () => {
  const report = evaluatePrerequisites(
    manifestWith({ node: pinnedNode }),
    probeReturning({ outcome: "found", version: "24.18.1" }),
  );

  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.satisfied, [{ id: "node", version: "24.18.1" }]);
});

test("E0-002 a version mismatch is a failure", () => {
  const report = evaluatePrerequisites(
    manifestWith({ node: pinnedNode }),
    probeReturning({ outcome: "found", version: "22.0.0" }),
  );

  assert.equal(report.satisfied.length, 0);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0].reason, /expected 24\.18\.1.*found 22\.0\.0/);
});

test("E0-002 an absent prerequisite is a failure", () => {
  const report = evaluatePrerequisites(
    manifestWith({ node: pinnedNode }),
    probeReturning({ outcome: "absent" }),
  );

  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0].reason, /not installed/);
});

// A Microsoft Store Python stub resolves on PATH and exits without printing a
// version. Presence is not evidence, so an unreadable probe must fail closed.
test("E0-002 an unreadable version output is a failure, not a pass", () => {
  const report = evaluatePrerequisites(
    manifestWith({ node: pinnedNode }),
    probeReturning({ outcome: "unreadable" }),
  );

  assert.equal(report.satisfied.length, 0);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0].reason, /not recognized/);
});

test("E0-002 a prerequisite with no verification probe is a failure", () => {
  const report = evaluatePrerequisites(
    manifestWith({ node: pinnedNode }),
    probeReturning({ outcome: "no-probe" }),
  );

  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0].reason, /no verification probe/);
});

test("E0-002 an unrecognized probe outcome is a failure", () => {
  const report = evaluatePrerequisites(
    manifestWith({ node: pinnedNode }),
    probeReturning({ outcome: "surprise" }),
  );

  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0].reason, /unrecognized probe outcome/);
});

test("E0-002 an unselected prerequisite required now is a failure", () => {
  const report = evaluatePrerequisites(
    manifestWith({
      python: {
        category: "runtime",
        purpose: "Orchestrator runtime",
        requiredFromPhase: 0,
        status: "unselected",
        blockedBy: "E1-001",
        reason: "package manager undecided",
      },
    }),
    probeReturning({ outcome: "found", version: "1.0.0" }),
  );

  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0].reason, /not selected/);
  assert.match(report.failures[0].reason, /E1-001/);
});

test("E0-002 a prerequisite for a later phase is deferred, not failed", () => {
  const report = evaluatePrerequisites(
    manifestWith({
      java: {
        category: "runtime",
        purpose: "Java API lab runtime",
        requiredFromPhase: 3,
        status: "unselected",
        blockedBy: "E3-001",
        reason: "LTS release not yet selected",
      },
    }),
    () => assert.fail("a deferred prerequisite must not be probed"),
  );

  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.satisfied, []);
  assert.equal(report.deferred.length, 1);
  assert.equal(report.deferred[0].id, "java");
});

test("E0-002 the report is ordered deterministically", () => {
  const report = evaluatePrerequisites(
    manifestWith({
      npm: { ...pinnedNode, version: "11.16.0" },
      containerRuntime: { ...pinnedNode, version: "29.6.2" },
      node: pinnedNode,
    }),
    (id) =>
      ({
        node: { outcome: "found", version: "24.18.1" },
        npm: { outcome: "found", version: "11.16.0" },
        containerRuntime: { outcome: "found", version: "29.6.2" },
      })[id],
  );

  assert.deepEqual(
    report.satisfied.map((entry) => entry.id),
    ["containerRuntime", "node", "npm"],
  );
});

test("E0-002 the version probe reads a version from a real command", () => {
  const result = runVersionCommand(
    process.execPath,
    ["--version"],
    /^v(\d+\.\d+\.\d+)$/,
  );

  assert.equal(result.outcome, "found");
  assert.equal(result.version, process.versions.node);
});

test("E0-002 the version probe treats a missing command as absent", () => {
  const result = runVersionCommand("security-lab-no-such-binary", [], /^(.+)$/);

  assert.equal(result.outcome, "absent");
});

test("E0-002 the version probe treats a failing command as absent", () => {
  const result = runVersionCommand(
    process.execPath,
    ["-e", "process.exit(3)"],
    /^(.+)$/,
  );

  assert.equal(result.outcome, "absent");
});

// The Microsoft Store Python stub exits cleanly while printing nothing useful.
test("E0-002 the version probe treats unexpected output as unreadable", () => {
  const result = runVersionCommand(
    process.execPath,
    ["-e", "console.log('open the store')"],
    /^v(\d+\.\d+\.\d+)$/,
  );

  assert.equal(result.outcome, "unreadable");
});

// A container runtime that never answers is a real failure mode; the check must
// give up rather than hang the bootstrap.
test("E0-002 the version probe gives up on a command that will not finish", () => {
  const result = runVersionCommand(
    process.execPath,
    ["-e", "setTimeout(() => {}, 30000)"],
    /^(.+)$/,
    { timeoutMs: 250 },
  );

  assert.equal(result.outcome, "timeout");
});

test("E0-002 an unfinished version check is a failure", () => {
  const report = evaluatePrerequisites(
    manifestWith({ node: pinnedNode }),
    probeReturning({ outcome: "timeout" }),
  );

  assert.equal(report.satisfied.length, 0);
  assert.match(report.failures[0].reason, /did not complete/);
});

test("E0-002 the default probe resolves the running Node runtime", () => {
  const result = defaultProbe("node");

  assert.equal(result.outcome, "found");
  assert.equal(result.version, process.versions.node);
});

test("E0-002 the default probe resolves the bundled package manager", () => {
  const result = defaultProbe("npm");

  assert.ok(KNOWN_OUTCOMES.has(result.outcome));
  if (result.outcome === "found") {
    assert.match(result.version, /^\d+\.\d+\.\d+$/);
  }
});

// Asserted by shape rather than by verdict: whether a container runtime is
// installed is a property of the workstation, not of this module.
test("E0-002 the default probe has a container runtime probe", () => {
  const result = defaultProbe("containerRuntime");

  assert.ok(KNOWN_OUTCOMES.has(result.outcome));
  assert.notEqual(result.outcome, "no-probe");
});

test("E0-002 the default probe reports an unknown tool as unprobeable", () => {
  assert.deepEqual(defaultProbe("not-a-known-tool"), { outcome: "no-probe" });
});

test("E0-002 manifest validation accepts a well-formed manifest", () => {
  assert.deepEqual(validateManifest(manifestWith({ node: pinnedNode })), []);
});

test("E0-002 manifest validation rejects a wrong manifest version", () => {
  const manifest = { ...manifestWith({ node: pinnedNode }), manifestVersion: 99 };

  assert.match(validateManifest(manifest).join("\n"), /manifestVersion/);
});

test("E0-002 manifest validation rejects a missing active phase", () => {
  const manifest = manifestWith({ node: pinnedNode });
  delete manifest.activePhase;

  assert.match(validateManifest(manifest).join("\n"), /activePhase/);
});

test("E0-002 manifest validation rejects an empty entry set", () => {
  assert.match(validateManifest(manifestWith({})).join("\n"), /at least one entry/);
});

test("E0-002 manifest validation rejects a non-object manifest", () => {
  for (const value of [null, [], "manifest", 7]) {
    assert.ok(
      validateManifest(value).length > 0,
      `${JSON.stringify(value)} must be rejected`,
    );
  }
});

test("E0-002 manifest validation rejects a version range on a pinned entry", () => {
  const manifest = manifestWith({ node: { ...pinnedNode, version: "^24.18.1" } });

  assert.match(validateManifest(manifest).join("\n"), /exact version/);
});

test("E0-002 manifest validation rejects an unknown status", () => {
  const manifest = manifestWith({ node: { ...pinnedNode, status: "probably-fine" } });

  assert.match(validateManifest(manifest).join("\n"), /status/);
});

test("E0-002 manifest validation rejects an unselected entry with no owner", () => {
  const manifest = manifestWith({
    python: {
      category: "runtime",
      purpose: "Orchestrator runtime",
      requiredFromPhase: 1,
      status: "unselected",
    },
  });

  assert.match(validateManifest(manifest).join("\n"), /blockedBy/);
});

test("E0-002 manifest validation rejects a missing required phase", () => {
  const manifest = manifestWith({ node: { ...pinnedNode, requiredFromPhase: "soon" } });

  assert.match(validateManifest(manifest).join("\n"), /requiredFromPhase/);
});

test("E0-002 manifest validation rejects an action pinned to a tag", () => {
  const manifest = manifestWith({ node: pinnedNode });
  manifest.actions = {
    checkout: { status: "pinned", repository: "actions/checkout", commitSha: "v4" },
  };

  assert.match(validateManifest(manifest).join("\n"), /commitSha/);
});

test("E0-002 manifest validation accepts an action pinned to a commit SHA", () => {
  const manifest = manifestWith({ node: pinnedNode });
  manifest.actions = {
    checkout: {
      status: "pinned",
      repository: "actions/checkout",
      commitSha: "a".repeat(40),
    },
  };

  assert.deepEqual(validateManifest(manifest), []);
});

test("E0-002 manifest validation rejects an action with no status", () => {
  const manifest = manifestWith({ node: pinnedNode });
  manifest.actions = { checkout: { repository: "actions/checkout" } };

  assert.match(validateManifest(manifest).join("\n"), /status/);
});

test("E0-002 manifest validation rejects an unselected action with no owner", () => {
  const manifest = manifestWith({ node: pinnedNode });
  manifest.actions = { checkout: { status: "unselected" } };
  const problems = validateManifest(manifest).join("\n");

  assert.match(problems, /blockedBy/);
  assert.match(problems, /reason/);
});

test("E0-002 manifest validation rejects a non-object entry", () => {
  const manifest = manifestWith({ node: "24.18.1" });

  assert.match(validateManifest(manifest).join("\n"), /entry must be a JSON object/);
});

test("E0-002 manifest validation rejects an entry with no category or purpose", () => {
  const manifest = manifestWith({
    node: { requiredFromPhase: 0, status: "pinned", version: "24.18.1" },
  });
  const problems = validateManifest(manifest).join("\n");

  assert.match(problems, /category must be a non-empty string/);
  assert.match(problems, /purpose must be a non-empty string/);
});

test("E0-002 manifest validation rejects a non-object entry set", () => {
  const manifest = { ...manifestWith({ node: pinnedNode }), entries: "everything" };

  assert.match(validateManifest(manifest).join("\n"), /entries must be a JSON object/);
});

test("E0-002 manifest validation rejects a non-object action set", () => {
  const manifest = { ...manifestWith({ node: pinnedNode }), actions: [] };

  assert.match(validateManifest(manifest).join("\n"), /actions must be a JSON object/);
});

test("E0-002 manifest validation rejects a non-object action", () => {
  const manifest = manifestWith({ node: pinnedNode });
  manifest.actions = { checkout: "actions/checkout@v4" };

  assert.match(validateManifest(manifest).join("\n"), /action must be a JSON object/);
});

test("E0-002 manifest validation reports every problem at once", () => {
  const manifest = {
    manifestVersion: 99,
    entries: {},
    actions: {},
  };

  assert.ok(validateManifest(manifest).length >= 3);
});
