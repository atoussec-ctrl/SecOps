// Version manifest validation and local prerequisite verification (backlog E0-002).
// Policy: docs/00-overview/07-assumptions-version-policy.md.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const MANIFEST_VERSION = 1;

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const BACKLOG_TASK = /^E\d-\d{3}$/;
const STATUSES = new Set(["pinned", "unselected"]);

// A probe must not be able to hang or flood the check. A broken container
// runtime that never answers `--version` is a real failure mode, and bounded
// resources are required of anything this project executes
// (docs/04-security/09-tool-safety-guardrails.md).
export const PROBE_TIMEOUT_MS = 10_000;
export const PROBE_MAX_OUTPUT_BYTES = 64 * 1024;

// Shared probe primitive: run a fixed command with fixed arguments and accept
// only a version that matches the expected pattern.
export function runVersionCommand(command, args, pattern, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs ?? PROBE_TIMEOUT_MS,
    maxBuffer: options.maxOutputBytes ?? PROBE_MAX_OUTPUT_BYTES,
  });

  // spawnSync reports both a timeout kill and an output-limit kill through
  // signal termination, so treat an unfinished command as its own outcome
  // rather than reporting the tool as missing.
  if (result.signal !== null && result.signal !== undefined) {
    return { outcome: "timeout" };
  }

  if (result.error !== undefined || result.status !== 0) {
    return { outcome: "absent" };
  }

  const match = pattern.exec(`${result.stdout}`.trim());

  return match === null
    ? { outcome: "unreadable" }
    : { outcome: "found", version: match[1] };
}

// npm ships as a .cmd shim on Windows, and Node refuses to spawn .cmd without a
// shell. Running its CLI through the current Node binary keeps the probe
// shell-free, so no argument can ever reach a command interpreter
// (docs/04-security/03-secure-coding-standard.md prohibits shell execution).
const NPM_CLI_LAYOUTS = [
  ["node_modules", "npm", "bin", "npm-cli.js"],
  ["..", "lib", "node_modules", "npm", "bin", "npm-cli.js"],
];

function resolveNpmCli() {
  const runtimeDirectory = path.dirname(process.execPath);

  for (const segments of NPM_CLI_LAYOUTS) {
    const candidate = path.join(runtimeDirectory, ...segments);

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// Probe commands and arguments are literals declared here. They are never read
// from the manifest and never interpolated
// (docs/04-security/09-tool-safety-guardrails.md, fixed and typed arguments).
const PROBES = new Map([
  ["node", () => runVersionCommand(process.execPath, ["--version"], /^v(\d+\.\d+\.\d+)$/)],
  [
    "npm",
    () => {
      const npmCli = resolveNpmCli();

      return npmCli === null
        ? { outcome: "absent" }
        : runVersionCommand(process.execPath, [npmCli, "--version"], /^(\d+\.\d+\.\d+)$/);
    },
  ],
  [
    "containerRuntime",
    () => runVersionCommand("docker", ["--version"], /^Docker version (\d+\.\d+\.\d+)/),
  ],
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validateEntry(id, entry) {
  if (!isPlainObject(entry)) {
    return [`${id}: entry must be a JSON object`];
  }

  const problems = [];

  for (const field of ["category", "purpose"]) {
    if (!isNonEmptyString(entry[field])) {
      problems.push(`${id}: ${field} must be a non-empty string`);
    }
  }

  if (!Number.isInteger(entry.requiredFromPhase) || entry.requiredFromPhase < 0) {
    problems.push(`${id}: requiredFromPhase must be a non-negative integer`);
  }

  if (!STATUSES.has(entry.status)) {
    problems.push(`${id}: status must be "pinned" or "unselected"`);
    return problems;
  }

  if (entry.status === "pinned") {
    if (!isNonEmptyString(entry.version) || !EXACT_VERSION.test(entry.version)) {
      problems.push(`${id}: a pinned entry needs an exact version, not a range`);
    }
    return problems;
  }

  if (!isNonEmptyString(entry.blockedBy) || !BACKLOG_TASK.test(entry.blockedBy)) {
    problems.push(`${id}: an unselected entry needs blockedBy to name a backlog task`);
  }

  if (!isNonEmptyString(entry.reason)) {
    problems.push(`${id}: an unselected entry needs a reason`);
  }

  return problems;
}

// A workflow action is pinned to an immutable commit SHA or is explicitly
// undecided. There is no third state in which a tag stands in for a pin.
function validateAction(name, action) {
  if (!isPlainObject(action)) {
    return [`${name}: action must be a JSON object`];
  }

  const problems = [];

  if (!STATUSES.has(action.status)) {
    return [`${name}: status must be "pinned" or "unselected"`];
  }

  if (action.status === "pinned") {
    if (!isNonEmptyString(action.repository)) {
      problems.push(`${name}: repository must be a non-empty string`);
    }

    if (!COMMIT_SHA.test(`${action.commitSha}`)) {
      problems.push(`${name}: commitSha must be a 40-character commit SHA, not a tag`);
    }

    return problems;
  }

  if (!isNonEmptyString(action.blockedBy) || !BACKLOG_TASK.test(action.blockedBy)) {
    problems.push(`${name}: an unselected action needs blockedBy to name a backlog task`);
  }

  if (!isNonEmptyString(action.reason)) {
    problems.push(`${name}: an unselected action needs a reason`);
  }

  return problems;
}

export function validateManifest(manifest) {
  if (!isPlainObject(manifest)) {
    return ["manifest must be a JSON object"];
  }

  const problems = [];

  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    problems.push(`manifestVersion must be ${MANIFEST_VERSION}`);
  }

  if (!Number.isInteger(manifest.activePhase) || manifest.activePhase < 0) {
    problems.push("activePhase must be a non-negative integer");
  }

  if (!isPlainObject(manifest.entries)) {
    problems.push("entries must be a JSON object");
  } else if (Object.keys(manifest.entries).length === 0) {
    problems.push("entries must contain at least one entry");
  } else {
    for (const [id, entry] of Object.entries(manifest.entries)) {
      problems.push(...validateEntry(id, entry));
    }
  }

  if (!isPlainObject(manifest.actions)) {
    problems.push("actions must be a JSON object");
  } else {
    for (const [name, action] of Object.entries(manifest.actions)) {
      problems.push(...validateAction(name, action));
    }
  }

  return problems;
}

// Presence on PATH is not evidence that a tool works: a Microsoft Store Python
// stub resolves and then exits without printing a version. Only a parsed
// version counts as found.
export function defaultProbe(id) {
  const probe = PROBES.get(id);

  return probe === undefined ? { outcome: "no-probe" } : probe();
}

export function evaluatePrerequisites(manifest, probe = defaultProbe) {
  const satisfied = [];
  const deferred = [];
  const failures = [];

  for (const id of Object.keys(manifest.entries).sort()) {
    const entry = manifest.entries[id];

    if (entry.requiredFromPhase > manifest.activePhase) {
      deferred.push({ id, requiredFromPhase: entry.requiredFromPhase });
      continue;
    }

    if (entry.status !== "pinned") {
      failures.push({ id, reason: `not selected; blocked by ${entry.blockedBy}` });
      continue;
    }

    const result = probe(id);

    switch (result.outcome) {
      case "found":
        if (result.version === entry.version) {
          satisfied.push({ id, version: result.version });
        } else {
          failures.push({
            id,
            reason: `expected ${entry.version}, found ${result.version}`,
          });
        }
        break;
      case "absent":
        failures.push({ id, reason: "not installed" });
        break;
      case "unreadable":
        failures.push({ id, reason: "version output not recognized" });
        break;
      case "timeout":
        failures.push({ id, reason: "version check did not complete" });
        break;
      case "no-probe":
        failures.push({ id, reason: "no verification probe defined" });
        break;
      default:
        failures.push({
          id,
          reason: `unrecognized probe outcome "${result.outcome}"`,
        });
    }
  }

  return { satisfied, deferred, failures };
}
