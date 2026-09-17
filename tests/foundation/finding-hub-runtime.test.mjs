import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const findingHubRoot = path.join(repositoryRoot, "services", "finding-hub");
const interpreter = process.env.PYTHON ?? "python3";

const findingHubArgs = [
  "-m",
  "unittest",
  "discover",
  "-s",
  "tests",
  "-v",
];

test("E1-010 Finding Hub fingerprint and baseline tests execute for real", () => {
  const result = spawnSync(interpreter, findingHubArgs, {
    cwd: findingHubRoot,
    encoding: "utf8",
    env: { ...process.env },
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const output = `${result.stdout}${result.stderr}`;
  const ran = output.match(/Ran (\d+) tests?/);

  assert.ok(ran, `no test count in Finding Hub output:\n${output}`);
  assert.ok(Number(ran[1]) >= 10, `Finding Hub ran only ${ran[1]} tests`);
  assert.match(output, /\nOK/);
});

test("E1-010 a missing Python interpreter cannot silently skip Finding Hub", () => {
  const result = spawnSync("python-that-is-not-installed", findingHubArgs, {
    cwd: findingHubRoot,
    encoding: "utf8",
  });

  assert.ok(result.error, "a missing interpreter must be distinguishable from a passing suite");
  assert.notEqual(result.status, 0);
});
