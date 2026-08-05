// Differential conformance between the two address-policy implementations
// (backlog E1-001).
//
// The conformance vectors state what both sides must do for inputs someone
// thought of. This asserts they also agree on inputs nobody wrote down, by
// mutating every vector into the shapes that historically defeat URL and host
// filters and requiring the JSON Schema patterns and the Python classifier to
// reach the same verdict.
//
// The direction that matters is the runtime being more permissive than the
// signed contract: a destination the Scope Guard admits and the authorisation
// boundary never contained. Python's urlsplit removes ASCII tab, carriage
// return and newline before parsing, which is how CVE-2022-0391,
// CVE-2023-24329 and CVE-2026-44889 happened, so that shape is generated here
// rather than trusted to a comment.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseJson } from "../../tools/schema.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const contractDirectory = path.join(repositoryRoot, "packages", "contracts", "security");

async function readContract(...segments) {
  return parseJson(await readFile(path.join(contractDirectory, ...segments), "utf8"));
}

const scopeSchema = await readContract("scope-record.schema.json");
const vectors = await readContract(
  "samples",
  "address-policy",
  "ipv4-and-host-vectors.json",
);

const PATTERN_FOR_KIND = {
  ipv4: scopeSchema.$defs.private_ipv4.pattern,
  "ipv4-cidr": scopeSchema.$defs.private_cidr.pattern,
  hostname: scopeSchema.$defs.lab_hostname.pattern,
  url: scopeSchema.$defs.lab_url.pattern,
};

// Each mutation is a filter bypass that has worked somewhere. Applying them to
// a safe input is the interesting case: the result must stop being eligible.
const MUTATIONS = [
  ["raw", (input) => input],
  ["leading space", (input) => ` ${input}`],
  ["trailing space", (input) => `${input} `],
  ["leading tab", (input) => `\t${input}`],
  ["leading newline", (input) => `\n${input}`],
  ["trailing newline", (input) => `${input}\n`],
  ["trailing carriage return", (input) => `${input}\r`],
  // Injected in the middle rather than at an edge, where a trimming parser
  // cannot make the input look ordinary again by dropping a prefix.
  ["embedded tab", (input) => splice(input, "\t")],
  ["embedded newline", (input) => splice(input, "\n")],
  ["embedded carriage return", (input) => splice(input, "\r")],
  ["embedded null byte", (input) => splice(input, "\0")],
  ["uppercased", (input) => input.toUpperCase()],
  // Separate from the line above because a fully uppercased URL is already
  // caught by its scheme. Folding only the authority is the case that reaches
  // the host comparison, and it is also the realistic one.
  ["uppercased authority", uppercaseAuthority],
  ["trailing dot", (input) => `${input}.`],
];

function uppercaseAuthority(input) {
  const match = /^([a-z]+:\/\/)([^/?#]+)(.*)$/.exec(input);
  return match === null
    ? input.toUpperCase()
    : `${match[1]}${match[2].toUpperCase()}${match[3]}`;
}

function splice(input, character) {
  const at = Math.floor(input.length / 2);
  return `${input.slice(0, at)}${character}${input.slice(at)}`;
}

function buildCorpus() {
  const corpus = [];

  for (const vector of vectors.vectors) {
    if (PATTERN_FOR_KIND[vector.kind] === undefined) {
      continue;
    }

    for (const [mutation, apply] of MUTATIONS) {
      const input = apply(vector.input);

      // A mutation that changed nothing tests nothing, and asserting on it
      // would assert against the unmutated value.
      if (mutation !== "raw" && input === vector.input) {
        continue;
      }

      corpus.push({ input, kind: vector.kind, mutation });
    }
  }

  return corpus;
}

// One subprocess for the whole corpus. Inputs travel as JSON on stdin so no
// shell quoting is involved, which matters when the inputs are deliberately
// full of control characters.
const PYTHON_VERDICT = `
import json, sys
sys.path.insert(0, sys.argv[1])
from scope.address_policy import is_scope_eligible
cases = json.load(sys.stdin)
json.dump([is_scope_eligible(c["input"], c["kind"]) for c in cases], sys.stdout)
`;

function pythonVerdicts(corpus) {
  const result = spawnSync(
    process.env.PYTHON ?? "python3",
    ["-c", PYTHON_VERDICT, path.join(repositoryRoot, "services", "orchestrator")],
    { input: JSON.stringify(corpus), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

  assert.equal(result.status, 0, `python verdict run failed: ${result.stderr}`);

  return JSON.parse(result.stdout);
}

const corpus = buildCorpus();
const verdicts = pythonVerdicts(corpus);

test("E1-001 the corpus is large enough to be worth running", () => {
  assert.equal(verdicts.length, corpus.length);
  assert.ok(corpus.length >= 400, `only ${corpus.length} mutated inputs`);
});

test("E1-001 both implementations agree on every mutated input", () => {
  const disagreements = [];

  for (const [index, entry] of corpus.entries()) {
    const accepted = new RegExp(PATTERN_FOR_KIND[entry.kind]).test(entry.input);

    if (accepted !== verdicts[index]) {
      disagreements.push(
        `${entry.kind} ${entry.mutation}: ${JSON.stringify(entry.input)} — ` +
          `contract ${accepted ? "accepts" : "rejects"}, runtime says ` +
          `${verdicts[index] ? "eligible" : "ineligible"}`,
      );
    }
  }

  assert.deepEqual(disagreements, [], disagreements.join("\n"));
});

// Stated separately because it is the failure that matters. A runtime stricter
// than the contract is a usability problem; a runtime looser than the contract
// is an authorisation boundary with a hole in it.
test("E1-001 the runtime never admits what the contract rejects", () => {
  const wider = corpus.filter(
    (entry, index) =>
      verdicts[index] && !new RegExp(PATTERN_FOR_KIND[entry.kind]).test(entry.input),
  );

  assert.deepEqual(
    wider.map((entry) => `${entry.mutation}: ${JSON.stringify(entry.input)}`),
    [],
  );
});

test("E1-001 no whitespace or control mutation of a safe input stays eligible", () => {
  const injected = new Set([
    "leading space",
    "trailing space",
    "leading tab",
    "leading newline",
    "trailing newline",
    "trailing carriage return",
    "embedded tab",
    "embedded newline",
    "embedded carriage return",
    "embedded null byte",
  ]);

  for (const [index, entry] of corpus.entries()) {
    if (!injected.has(entry.mutation)) {
      continue;
    }

    assert.equal(
      verdicts[index],
      false,
      `${entry.mutation} left ${JSON.stringify(entry.input)} eligible`,
    );
  }
});
