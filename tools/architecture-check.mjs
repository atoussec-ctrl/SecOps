// Architecture fitness functions (backlog E0-006).
//
// Enforces the prohibited dependency edges of
// docs/02-architecture/03-monorepo-module-boundaries.md and the fitness
// functions of docs/02-architecture/07-architecture-quality.md that are not
// already covered by the contract and exposure checks.
//
// Dependencies are default deny: an edge that is not listed is a violation, so
// a new module or a new coupling has to be declared deliberately.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".kt",
  ".swift",
]);

const GRAPH_EXTENSIONS = new Set([".mjs", ".cjs", ".js", ".jsx", ".ts", ".tsx"]);

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build"]);

// Module identity, allowed outbound edges, and whether the module is permitted
// to start an operating-system process.
const MODULES = {
  "apps/console-web": { allow: ["packages/contracts", "packages/ts-domain"] },
  "apps/web-lab-insecure": { allow: ["packages/contracts", "packages/ts-domain"] },
  "apps/web-lab-secure": { allow: ["packages/contracts", "packages/ts-domain"] },
  "apps/api-java-lab": { allow: ["packages/contracts"] },
  "apps/mobile-lab": { allow: ["packages/contracts", "packages/ts-domain"] },
  // Scanner execution exists only in orchestrator infrastructure adapters
  // (module rule 5).
  "services/orchestrator": { allow: ["packages/contracts"], mayExecuteProcesses: true },
  "services/finding-hub": { allow: ["packages/contracts"] },
  "services/report-generator": { allow: ["packages/contracts", "packages/ts-domain"] },
  "packages/contracts": { allow: [] },
  "packages/ts-domain": { allow: [] },
  "security/rules": { allow: [] },
  "security/profiles": { allow: [] },
  "infra/compose": { allow: [] },
  "infra/terraform": { allow: [] },
  "tests/capstone": { allow: ["packages/contracts"] },
  // Repository tooling and its tests are not product modules. They run the
  // checks themselves, so they start processes by design.
  tools: { allow: [], mayExecuteProcesses: true },
  "tests/foundation": { allow: ["tools"], mayExecuteProcesses: true },
};

const MODULE_PATHS = Object.keys(MODULES).sort((a, b) => b.length - a.length);

const IMPORT_PATTERNS = [
  /\bimport\s+[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
  /\bexport\s+[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

const PROCESS_EXECUTION_PATTERNS = [
  { name: "node:child_process", pattern: /["']node:child_process["']|["']child_process["']/ },
  { name: "spawn", pattern: /\bspawn(Sync)?\s*\(/ },
  { name: "exec", pattern: /\bexec(File)?(Sync)?\s*\(/ },
  { name: "python subprocess", pattern: /\bsubprocess\.(run|Popen|call|check_output)\s*\(/ },
  { name: "os.system", pattern: /\bos\.(system|popen)\s*\(/ },
  { name: "Runtime.exec", pattern: /Runtime\.getRuntime\(\)\s*\.\s*exec\s*\(/ },
  { name: "ProcessBuilder", pattern: /\bnew\s+ProcessBuilder\s*\(/ },
];

export function moduleOf(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");

  return (
    MODULE_PATHS.find(
      (module) => normalized === module || normalized.startsWith(`${module}/`),
    ) ?? null
  );
}

export function extractImportSpecifiers(source) {
  const specifiers = new Set();

  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers].sort();
}

export function findProcessExecution(source) {
  return PROCESS_EXECUTION_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
    ({ name }) => name,
  );
}

async function collectSourceFiles(root) {
  const found = [];

  async function walk(directory) {
    let entries;

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(absolute);
        }
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        found.push(absolute);
      }
    }
  }

  await walk(root);
  return found.sort();
}

function edgeProblem(fromModule, toModule, relativePath, specifier) {
  if (toModule === null || toModule === fromModule) {
    return null;
  }

  if (MODULES[fromModule].allow.includes(toModule)) {
    return null;
  }

  // Rule 4 is an unconditional gate failure, so it is named explicitly rather
  // than folded into the generic message
  // (docs/05-devsecops/03-security-gates.md).
  if (toModule === "apps/web-lab-insecure") {
    return `${relativePath}: secure module "${fromModule}" imports insecure module "${toModule}" via "${specifier}"`;
  }

  return `${relativePath}: "${fromModule}" must not import "${toModule}" via "${specifier}"`;
}

export async function checkArchitecture(root) {
  const problems = [];
  const files = await collectSourceFiles(root);
  const analyzed = [];

  for (const file of files) {
    const relativePath = path.relative(root, file).replaceAll("\\", "/");
    const fromModule = moduleOf(relativePath);

    if (fromModule === null) {
      continue;
    }

    analyzed.push(relativePath);
    const source = await readFile(file, "utf8");

    if (!MODULES[fromModule].mayExecuteProcesses) {
      for (const api of findProcessExecution(source)) {
        problems.push(
          `${relativePath}: "${fromModule}" must not start a process (${api}); scanner execution belongs to orchestrator adapters`,
        );
      }
    }

    if (!GRAPH_EXTENSIONS.has(path.extname(file))) {
      continue;
    }

    for (const specifier of extractImportSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        continue;
      }

      const target = path
        .relative(root, path.resolve(path.dirname(file), specifier))
        .replaceAll("\\", "/");
      const problem = edgeProblem(fromModule, moduleOf(target), relativePath, specifier);

      if (problem !== null) {
        problems.push(problem);
      }
    }
  }

  return { problems: problems.sort(), analyzed };
}

export function declaredModules() {
  return Object.keys(MODULES).sort();
}
