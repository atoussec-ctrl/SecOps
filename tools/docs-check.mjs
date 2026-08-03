// Documentation validation (backlog E0-003).
//
// The specification tells agents to follow links between normative documents,
// so a broken link is a defect in the specification itself, not cosmetic.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const FENCE = /^\s*```/;
const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);

export async function collectMarkdownFiles(root) {
  const found = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(absolute);
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        found.push(absolute);
      }
    }
  }

  await walk(root);
  return found.sort();
}

// Anchors and external schemes are out of scope: only repository-relative
// targets can be verified locally.
export function extractLocalLinks(markdown) {
  const links = [];

  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    const target = match[1].trim().split(/\s+/)[0];

    if (target.length === 0 || target.startsWith("#") || EXTERNAL_SCHEME.test(target)) {
      continue;
    }

    links.push(target.split("#")[0]);
  }

  return links.filter((target) => target.length > 0);
}

export function hasBalancedFences(markdown) {
  const fences = markdown.split("\n").filter((line) => FENCE.test(line));
  return fences.length % 2 === 0;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function checkAdrIndex(root, problems) {
  const adrDirectory = path.join(root, "adrs");
  const indexPath = path.join(adrDirectory, "000-index.md");

  if (!(await exists(indexPath))) {
    problems.push("adrs/000-index.md is missing");
    return;
  }

  const index = await readFile(indexPath, "utf8");
  const linked = new Set(extractLocalLinks(index).map((link) => path.basename(link)));
  const entries = await readdir(adrDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "000-index.md") {
      continue;
    }

    if (!linked.has(entry.name)) {
      problems.push(`adrs/000-index.md does not list ${entry.name}`);
    }
  }
}

export async function checkDocumentation(root) {
  const problems = [];
  const files = await collectMarkdownFiles(root);

  for (const file of files) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const contents = await readFile(file, "utf8");

    if (!hasBalancedFences(contents)) {
      problems.push(`${relative}: unbalanced code fence`);
    }

    for (const link of extractLocalLinks(contents)) {
      const resolved = path.resolve(path.dirname(file), link);

      if (!(await exists(resolved))) {
        problems.push(`${relative}: link "${link}" does not resolve`);
      }
    }
  }

  await checkAdrIndex(root, problems);
  return problems.sort();
}
