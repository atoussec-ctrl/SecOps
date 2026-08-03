import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkArchitecture,
  declaredModules,
  extractImportSpecifiers,
  findProcessExecution,
  moduleOf,
} from "../../tools/architecture-check.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

async function createModuleTree(files) {
  const root = await mkdtemp(path.join(tmpdir(), "security-lab-e0-006-"));

  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  }

  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("E0-006 the repository satisfies its own module boundaries", async () => {
  const report = await checkArchitecture(repositoryRoot);

  assert.deepEqual(report.problems, []);
});

// Guards against a checker that reports success because it matched no files.
test("E0-006 the checker actually analyses repository sources", async () => {
  const report = await checkArchitecture(repositoryRoot);

  assert.ok(report.analyzed.length >= 10, `analysed only ${report.analyzed.length} files`);
  assert.ok(report.analyzed.includes("tools/repo.mjs"));
  assert.ok(report.analyzed.some((file) => file.startsWith("tests/foundation/")));
});

// Ties the enforced graph to the normative layout table, so a module added to
// the documentation cannot stay unenforced.
test("E0-006 every documented module is declared in the dependency graph", async () => {
  const document = await readFile(
    path.join(repositoryRoot, "docs", "02-architecture", "03-monorepo-module-boundaries.md"),
    "utf8",
  );

  const documented = [...document.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)]
    .map((match) => match[1])
    .filter((entry) => entry !== "docs");
  const declared = new Set(declaredModules());

  assert.ok(documented.length >= 15, `found ${documented.length} documented modules`);

  for (const module of documented) {
    assert.ok(declared.has(module), `module "${module}" is documented but not enforced`);
  }
});

test("E0-006 a secure target importing the insecure target is reported as such", async (t) => {
  const tree = await createModuleTree({
    "apps/web-lab-secure/src/checkout.ts":
      'import { seed } from "../../web-lab-insecure/src/seed.ts";\n',
    "apps/web-lab-insecure/src/seed.ts": "export const seed = 1;\n",
  });
  t.after(tree.cleanup);

  const report = await checkArchitecture(tree.root);

  assert.equal(report.problems.length, 1);
  assert.match(
    report.problems[0],
    /secure module "apps\/web-lab-secure" imports insecure module "apps\/web-lab-insecure"/,
  );
});

test("E0-006 one application may not import another", async (t) => {
  const tree = await createModuleTree({
    "apps/console-web/src/app.ts": 'import x from "../../mobile-lab/src/thing.ts";\n',
    "apps/mobile-lab/src/thing.ts": "export default 1;\n",
  });
  t.after(tree.cleanup);

  const report = await checkArchitecture(tree.root);

  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0], /must not import "apps\/mobile-lab"/);
});

test("E0-006 a shared package may not depend on an application", async (t) => {
  const tree = await createModuleTree({
    "packages/ts-domain/src/index.ts": 'export { x } from "../../../apps/console-web/src/x.ts";\n',
    "apps/console-web/src/x.ts": "export const x = 1;\n",
  });
  t.after(tree.cleanup);

  const report = await checkArchitecture(tree.root);

  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0], /"packages\/ts-domain" must not import "apps\/console-web"/);
});

test("E0-006 a declared dependency edge is allowed", async (t) => {
  const tree = await createModuleTree({
    "apps/web-lab-secure/src/app.ts":
      'import { Money } from "../../../packages/ts-domain/src/money.ts";\n',
    "packages/ts-domain/src/money.ts": "export const Money = 1;\n",
  });
  t.after(tree.cleanup);

  assert.deepEqual((await checkArchitecture(tree.root)).problems, []);
});

test("E0-006 imports inside a module are not treated as edges", async (t) => {
  const tree = await createModuleTree({
    "apps/web-lab-secure/src/app.ts": 'import { helper } from "./helper.ts";\n',
    "apps/web-lab-secure/src/helper.ts": "export const helper = 1;\n",
  });
  t.after(tree.cleanup);

  assert.deepEqual((await checkArchitecture(tree.root)).problems, []);
});

test("E0-006 process execution outside orchestrator adapters is reported", async (t) => {
  const tree = await createModuleTree({
    "apps/web-lab-secure/src/run.ts":
      'import { spawnSync } from "node:child_process";\nspawnSync("nmap", []);\n',
  });
  t.after(tree.cleanup);

  const report = await checkArchitecture(tree.root);

  assert.ok(report.problems.some((problem) => /must not start a process/.test(problem)));
  assert.ok(
    report.problems.some((problem) => /scanner execution belongs to orchestrator adapters/.test(problem)),
  );
});

test("E0-006 the orchestrator may start processes", async (t) => {
  const tree = await createModuleTree({
    "services/orchestrator/adapters/zap.py":
      "import subprocess\nsubprocess.run(['zap-baseline'], check=True)\n",
  });
  t.after(tree.cleanup);

  assert.deepEqual((await checkArchitecture(tree.root)).problems, []);
});

test("E0-006 process execution is detected across languages", () => {
  assert.deepEqual(findProcessExecution("subprocess.run(['ls'])"), ["python subprocess"]);
  assert.deepEqual(findProcessExecution("os.system('ls')"), ["os.system"]);
  assert.deepEqual(findProcessExecution("Runtime.getRuntime().exec(cmd)"), [
    "exec",
    "Runtime.exec",
  ]);
  assert.deepEqual(findProcessExecution("new ProcessBuilder(cmd)"), ["ProcessBuilder"]);
  assert.deepEqual(findProcessExecution("const a = 1;"), []);
});

test("E0-006 every import form is recognised", () => {
  const source = [
    'import a from "./a.ts";',
    'import { b } from "./b.ts";',
    'import * as c from "./c.ts";',
    'import "./side-effect.ts";',
    'export { d } from "./d.ts";',
    'const e = require("./e.js");',
    'const f = await import("./f.js");',
  ].join("\n");

  assert.deepEqual(extractImportSpecifiers(source), [
    "./a.ts",
    "./b.ts",
    "./c.ts",
    "./d.ts",
    "./e.js",
    "./f.js",
    "./side-effect.ts",
  ]);
});

test("E0-006 a file is attributed to its most specific module", () => {
  assert.equal(moduleOf("tests/foundation/x.test.mjs"), "tests/foundation");
  assert.equal(moduleOf("tests/capstone/x.test.mjs"), "tests/capstone");
  assert.equal(moduleOf("tools/repo.mjs"), "tools");
  assert.equal(moduleOf("docs/00-overview/01-vision-goals.md"), null);
  assert.equal(moduleOf("apps/web-lab-secure"), "apps/web-lab-secure");
});

test("E0-006 files outside any declared module are ignored", async (t) => {
  const tree = await createModuleTree({
    "scripts/local.js": 'require("../apps/web-lab-insecure/src/seed.ts");\n',
  });
  t.after(tree.cleanup);

  const report = await checkArchitecture(tree.root);

  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.analyzed, []);
});
