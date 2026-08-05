// Differential conformance between the grant contract and the Python verifier
// (backlog E1-004).
//
// The JSON Schema constrains documents that are validated against it. Nothing
// validates a grant on the runtime path, so the verifier restates the contract
// in Python. Two statements of one rule drift, and the drift is silent: a
// verifier looser than the contract accepts a grant the contract forbids, and
// that is how a destructive profile pinned to a hostname verified cleanly
// before the restatement existed.
//
// So both are run over the same documents and required to agree. A signature
// says who wrote a document, never that it is well formed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseJson, validate } from "../../tools/schema.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const contractDirectory = path.join(repositoryRoot, "packages", "contracts", "security");

const schema = parseJson(
  await readFile(path.join(contractDirectory, "execution-grant.schema.json"), "utf8"),
);
const sample = parseJson(
  await readFile(
    path.join(contractDirectory, "samples", "execution-grant", "passive-run.json"),
    "utf8",
  ),
);

// Each case is one field bent in one direction. The valid ones matter as much
// as the invalid: a restatement that refuses everything would agree with
// nothing and pass a test that only looked for rejections.
function corpus() {
  const cases = [{ label: "the sample unchanged", grant: sample }];

  const bends = {
    profile: ["destructive", "aggressive", "", "PASSIVE", "bounded-active"],
    nonce: ["not-hexadecimal", "A".repeat(32), "a".repeat(31), "a".repeat(64), "a".repeat(65)],
    scope_hash: ["short", "b".repeat(63), "b".repeat(64), "B".repeat(64)],
    grant_id: ["ab", "a".repeat(64), "a".repeat(65), "-leading", "ok.id-1"],
    key_id: ["", "key.2026.09", "key with space"],
    audience: ["adapter.zap", "adapter zap", "a"],
    run_id: ["run.0002", "run/0002"],
    grant_version: ["1.0.0", "1.0", "v1.0.0"],
    issued_at: ["2026-08-05T12:00:00Z", "2026-08-05T12:00:00+00:00", "2026-08-05 12:00:00Z"],
    expires_at: ["2026-08-05T12:02:00Z", "not-a-time"],
    signature: ["0".repeat(64), "0".repeat(63), "0".repeat(128), "0".repeat(129), "Z".repeat(64)],
    pinned_addresses: [
      ["192.168.56.10"],
      ["web.lab.test"],
      ["localhost"],
      [],
      ["192.168.56.10", "192.168.56.10"],
      ["::1", "127.0.0.1"],
      [`${"9".repeat(46)}`],
    ],
  };

  for (const [field, values] of Object.entries(bends)) {
    for (const value of values) {
      cases.push({
        label: `${field} = ${JSON.stringify(value)}`,
        grant: { ...sample, [field]: value },
      });
    }
  }

  // Shape errors the field table has to notice too.
  const withExtra = { ...sample, extra_field: "x" };
  cases.push({ label: "an unknown field", grant: withExtra });

  for (const field of Object.keys(sample)) {
    const missing = { ...sample };
    delete missing[field];
    cases.push({ label: `${field} missing`, grant: missing });
  }

  return cases;
}

const PYTHON_VERDICT = `
import json, sys
sys.path.insert(0, sys.argv[1])
from grants.execution_grant import GrantRefused, _assert_contract_shape

def accepted(grant):
    try:
        _assert_contract_shape(grant)
        return True
    except GrantRefused:
        return False

json.dump([accepted(g) for g in json.load(sys.stdin)], sys.stdout)
`;

const cases = corpus();

const result = spawnSync(
  process.env.PYTHON ?? "python3",
  ["-c", PYTHON_VERDICT, path.join(repositoryRoot, "services", "orchestrator")],
  {
    input: JSON.stringify(cases.map((entry) => entry.grant)),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  },
);

assert.equal(result.status, 0, `python verdict run failed: ${result.stderr}`);

const pythonAccepts = JSON.parse(result.stdout);

test("E1-004 the corpus is large enough to be worth running", () => {
  assert.equal(pythonAccepts.length, cases.length);
  assert.ok(cases.length >= 50, `only ${cases.length} cases`);

  // Both verdicts must appear, or the comparison below is vacuous.
  assert.ok(pythonAccepts.some(Boolean));
  assert.ok(pythonAccepts.some((accepted) => !accepted));
});

test("E1-004 the contract and the verifier accept the same documents", () => {
  const disagreements = [];

  for (const [index, entry] of cases.entries()) {
    const schemaAccepts = validate(schema, entry.grant).length === 0;

    if (schemaAccepts !== pythonAccepts[index]) {
      disagreements.push(
        `${entry.label}: contract ${schemaAccepts ? "accepts" : "rejects"}, ` +
          `verifier ${pythonAccepts[index] ? "accepts" : "rejects"}`,
      );
    }
  }

  assert.deepEqual(disagreements, [], disagreements.join("\n"));
});

// Stated separately because it is the direction that matters. A verifier
// stricter than the contract refuses a legal grant, which is visible. A
// verifier looser than the contract accepts an illegal one, which is not.
test("E1-004 the verifier never accepts what the contract rejects", () => {
  const wider = cases.filter(
    (entry, index) => pythonAccepts[index] && validate(schema, entry.grant).length > 0,
  );

  assert.deepEqual(wider.map((entry) => entry.label), []);
});
