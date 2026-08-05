// Repository-wide invariants that are cheap to hold and expensive to lose.

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "__pycache__"]);
const TEXT_EXTENSIONS = new Set([".md", ".json", ".mjs", ".py", ".yml", ".yaml"]);

function relative(file) {
  return path.relative(repositoryRoot, file).split(path.sep).join("/");
}

async function readTextFiles() {
  const entries = await readdir(repositoryRoot, {
    withFileTypes: true,
    recursive: true,
  });

  const files = entries
    .filter((entry) => entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter(
      (file) =>
        !relative(file)
          .split("/")
          .some((segment) => SKIPPED_DIRECTORIES.has(segment)),
    )
    .sort();

  return Promise.all(
    files.map(async (file) => ({ file, contents: await readFile(file, "utf8") })),
  );
}

const files = await readTextFiles();

test("the file sweep found the repository", () => {
  // A sweep that matches nothing passes every assertion below it, which is the
  // shape of every false green this repository has hit.
  assert.ok(files.length > 100, `only ${files.length} text files found`);
});

// Mixed line endings turn a one-line edit into a whole-file diff, and make any
// multi-line search anchor — the mutant catalogue uses several — depend on which
// machine wrote the file. Three files authored on Windows drifted to CRLF in an
// otherwise LF repository before this test existed.
test("every text file uses LF line endings", () => {
  const offenders = files
    .filter(({ contents }) => contents.includes("\r\n"))
    .map(({ file }) => relative(file));

  assert.deepEqual(offenders, []);
});

test("every text file ends with a newline", () => {
  const offenders = files
    .filter(({ contents }) => contents.length > 0 && !contents.endsWith("\n"))
    .map(({ file }) => relative(file));

  assert.deepEqual(offenders, []);
});
