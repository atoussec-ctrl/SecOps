import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { MANIFEST_VERSION, validateManifest } from "../../tools/prerequisites.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function readManifest() {
  return readFile(path.join(repositoryRoot, "version-manifest.json"), "utf8").then(
    (contents) => JSON.parse(contents),
  );
}

// docs/00-overview/07-assumptions-version-policy.md, "Required version manifest fields".
const REQUIRED_FIELDS = {
  "Node, package manager and TypeScript": ["node", "npm", "typescript"],
  "Python and dependency manager": ["python", "pythonPackageManager"],
  "Java, build tool and Spring Boot": ["java", "javaBuildTool", "springBoot"],
  "React, React Native, Android and Apple toolchains": [
    "react",
    "reactNative",
    "androidGradlePlugin",
    "androidSdk",
    "xcode",
    "swift",
  ],
  "PostgreSQL and container runtime": ["postgresql", "containerRuntime"],
  "Scanner tools": ["codeql", "semgrep", "gitleaks", "trivy"],
  "SBOM, signing and provenance tools": [
    "sbomGenerator",
    "signer",
    "provenanceGenerator",
  ],
};

test("E0-002 version manifest is structurally valid", async () => {
  const manifest = await readManifest();

  assert.deepEqual(validateManifest(manifest), []);
  assert.equal(manifest.manifestVersion, MANIFEST_VERSION);
});

test("E0-002 version manifest covers every required policy field", async () => {
  const manifest = await readManifest();

  for (const [field, ids] of Object.entries(REQUIRED_FIELDS)) {
    for (const id of ids) {
      assert.ok(
        Object.hasOwn(manifest.entries, id),
        `${field}: manifest entry "${id}" is missing`,
      );
    }
  }

  assert.ok(
    Object.hasOwn(manifest, "actions"),
    "GitHub Actions pins must be represented",
  );
});

test("E0-002 pinned entries record an exact version", async () => {
  const manifest = await readManifest();

  for (const [id, entry] of Object.entries(manifest.entries)) {
    if (entry.status !== "pinned") {
      continue;
    }

    assert.match(
      entry.version,
      /^\d+\.\d+\.\d+$/,
      `${id} must pin an exact version, not a range`,
    );
  }
});

test("E0-002 unselected entries name the task that must decide them", async () => {
  const manifest = await readManifest();

  for (const [id, entry] of Object.entries(manifest.entries)) {
    if (entry.status !== "unselected") {
      continue;
    }

    assert.match(entry.blockedBy, /^E\d-\d{3}$/, `${id} must name a backlog task`);
    assert.ok(entry.reason.length > 0, `${id} must state why it is undecided`);
  }
});

test("E0-002 every prerequisite required by the active phase is pinned", async () => {
  const manifest = await readManifest();

  for (const [id, entry] of Object.entries(manifest.entries)) {
    if (entry.requiredFromPhase > manifest.activePhase) {
      continue;
    }

    assert.equal(
      entry.status,
      "pinned",
      `${id} is required by phase ${manifest.activePhase} and cannot stay unselected`,
    );
  }
});

test("E0-002 GitHub Actions are pinned to a full commit SHA", async () => {
  const manifest = await readManifest();

  for (const [name, action] of Object.entries(manifest.actions)) {
    if (action.status !== "pinned") {
      continue;
    }

    assert.match(
      action.commitSha,
      /^[0-9a-f]{40}$/,
      `${name} must be pinned to an immutable commit SHA, not a tag`,
    );
  }
});

test("E0-002 unselected actions name the task that must pin them", async () => {
  const manifest = await readManifest();

  for (const [name, action] of Object.entries(manifest.actions)) {
    if (action.status !== "unselected") {
      continue;
    }

    assert.match(action.blockedBy, /^E\d-\d{3}$/, `${name} must name a backlog task`);
    assert.ok(action.reason.length > 0, `${name} must state why it is unpinned`);
    assert.equal(action.commitSha, undefined, `${name} must not carry a partial pin`);
  }
});

test("E0-002 the Node engine pin agrees with the version manifest", async () => {
  const manifest = await readManifest();
  const packageManifest = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.equal(packageManifest.engines.node, manifest.entries.node.version);
  assert.equal(packageManifest.engines.npm, manifest.entries.npm.version);
  assert.equal(packageManifest.private, true, "the repository must not be publishable");
});
