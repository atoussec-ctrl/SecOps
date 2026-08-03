import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const requiredModuleDirectories = [
  "apps/console-web",
  "apps/web-lab-insecure",
  "apps/web-lab-secure",
  "apps/api-java-lab",
  "apps/mobile-lab",
  "services/orchestrator",
  "services/finding-hub",
  "services/report-generator",
  "packages/contracts",
  "packages/ts-domain",
  "security/rules",
  "security/profiles",
  "infra/compose",
  "infra/terraform",
  "tests/capstone",
];

test("E0-001 creates every prescribed monorepo module boundary", async () => {
  for (const relativeDirectory of requiredModuleDirectories) {
    const metadata = await stat(path.join(repositoryRoot, relativeDirectory));
    assert.equal(
      metadata.isDirectory(),
      true,
      `${relativeDirectory} must be a directory`,
    );
  }
});

test("E0-001 keeps the insecure and secure Web targets physically separate", async () => {
  const insecureTarget = await realpath(
    path.join(repositoryRoot, "apps", "web-lab-insecure"),
  );
  const secureTarget = await realpath(
    path.join(repositoryRoot, "apps", "web-lab-secure"),
  );

  assert.notEqual(insecureTarget, secureTarget);
});

test("E0-001 exposes the stable repository task interface", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, "tools", "repo.mjs"), "help"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check:foundation/);
  assert.match(result.stdout, /Phase 0/);
});

test("E0-001 task interface fails closed for unknown tasks", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, "tools", "repo.mjs"), "not-a-real-task"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown repository task/);
});
