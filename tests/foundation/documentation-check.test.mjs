import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkDocumentation,
  collectMarkdownFiles,
  extractLocalLinks,
  hasBalancedFences,
} from "../../tools/docs-check.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

async function createDocsTree(files) {
  const root = await mkdtemp(path.join(tmpdir(), "security-lab-e0-003-"));

  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  }

  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("E0-003 local links are extracted and external ones ignored", () => {
  const markdown = [
    "[relative](../02-architecture/01-system-context.md)",
    "[anchored](./guide.md#section)",
    "[external](https://example.test/page)",
    "[mail](mailto:someone@example.test)",
    "[anchor only](#heading)",
    "[titled](./other.md 'Title')",
  ].join("\n");

  assert.deepEqual(extractLocalLinks(markdown), [
    "../02-architecture/01-system-context.md",
    "./guide.md",
    "./other.md",
  ]);
});

test("E0-003 unbalanced code fences are detected", () => {
  assert.equal(hasBalancedFences("```mermaid\nflowchart TD\n```\n"), true);
  assert.equal(hasBalancedFences("```mermaid\nflowchart TD\n"), false);
});

// Guards against a checker that reports success because it inspected nothing.
test("E0-003 the checker actually reads the repository documentation", async () => {
  const files = await collectMarkdownFiles(repositoryRoot);

  assert.ok(files.length > 50, `expected the full document set, found ${files.length}`);
  assert.ok(files.some((file) => file.endsWith("01-operating-manual.md")));
});

test("E0-003 the repository documentation has no broken links", async () => {
  assert.deepEqual(await checkDocumentation(repositoryRoot), []);
});

test("E0-003 a broken relative link is reported", async (t) => {
  const tree = await createDocsTree({
    "adrs/000-index.md": "# Index\n",
    "docs/guide.md": "See [the plan](./missing-plan.md).\n",
  });
  t.after(tree.cleanup);

  const problems = await checkDocumentation(tree.root);

  assert.ok(problems.some((problem) => /docs\/guide\.md: link "\.\/missing-plan\.md"/.test(problem)));
});

test("E0-003 a resolvable relative link is accepted", async (t) => {
  const tree = await createDocsTree({
    "adrs/000-index.md": "# Index\n",
    "docs/guide.md": "See [the plan](./plan.md).\n",
    "docs/plan.md": "# Plan\n",
  });
  t.after(tree.cleanup);

  assert.deepEqual(await checkDocumentation(tree.root), []);
});

test("E0-003 an unbalanced fence in a document is reported", async (t) => {
  const tree = await createDocsTree({
    "adrs/000-index.md": "# Index\n",
    "docs/diagram.md": "```mermaid\nflowchart TD\n",
  });
  t.after(tree.cleanup);

  const problems = await checkDocumentation(tree.root);

  assert.ok(problems.some((problem) => /unbalanced code fence/.test(problem)));
});

test("E0-003 an ADR missing from the index is reported", async (t) => {
  const tree = await createDocsTree({
    "adrs/000-index.md": "# Index\n\n- [First](001-first.md)\n",
    "adrs/001-first.md": "# First\n",
    "adrs/002-second.md": "# Second\n",
  });
  t.after(tree.cleanup);

  const problems = await checkDocumentation(tree.root);

  assert.deepEqual(problems, ["adrs/000-index.md does not list 002-second.md"]);
});

test("E0-003 a missing ADR index is reported", async (t) => {
  const tree = await createDocsTree({ "docs/guide.md": "# Guide\n" });
  t.after(tree.cleanup);

  assert.deepEqual(await checkDocumentation(tree.root), [
    "adrs/000-index.md is missing",
  ]);
});
