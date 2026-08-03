import assert from "node:assert/strict";
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

const contractDirectory = path.join(repositoryRoot, "packages", "contracts", "findings");

async function readContract(...segments) {
  return parseJson(await readFile(path.join(contractDirectory, ...segments), "utf8"));
}

const lifecycleSchema = await readContract("finding-lifecycle.schema.json");
const findingSchema = await readContract("finding.schema.json");
const occurrenceSchema = await readContract("occurrence.schema.json");

const lifecycle = await readContract("samples", "finding-lifecycle", "lifecycle.json");
const finding = await readContract("samples", "finding", "verified-sql-injection.json");
const occurrence = await readContract(
  "samples",
  "occurrence",
  "semgrep-sql-injection.json",
);

test("E1-010 the samples satisfy their contracts", () => {
  assert.deepEqual(validate(lifecycleSchema, lifecycle), []);
  assert.deepEqual(validate(findingSchema, finding), []);
  assert.deepEqual(validate(occurrenceSchema, occurrence), []);
});

// The state machine and the record that carries the state are separate
// contracts. If they drift, a finding can hold a state the lifecycle does not
// know how to leave.
test("E1-010 the lifecycle and the finding schema agree on the state set", () => {
  const declared = lifecycle.states.map((entry) => entry.state).sort();
  const accepted = [...findingSchema.properties.state.enum].sort();

  assert.deepEqual(declared, accepted);
});

test("E1-010 every transition names declared states", () => {
  const declared = new Set(lifecycle.states.map((entry) => entry.state));

  for (const transition of lifecycle.transitions) {
    assert.ok(declared.has(transition.from), `unknown from state ${transition.from}`);
    assert.ok(declared.has(transition.to), `unknown to state ${transition.to}`);
    assert.notEqual(transition.from, transition.to, "a transition must change state");
  }
});

test("E1-010 the initial state is declared and never a target", () => {
  const declared = new Set(lifecycle.states.map((entry) => entry.state));

  assert.ok(declared.has(lifecycle.initial_state));
  assert.equal(
    lifecycle.transitions.some((transition) => transition.to === lifecycle.initial_state),
    false,
    "nothing may return a finding to the initial state",
  );
});

test("E1-010 every state is reachable from the initial state", () => {
  const reached = new Set([lifecycle.initial_state]);
  let grew = true;

  while (grew) {
    grew = false;

    for (const transition of lifecycle.transitions) {
      if (reached.has(transition.from) && !reached.has(transition.to)) {
        reached.add(transition.to);
        grew = true;
      }
    }
  }

  for (const entry of lifecycle.states) {
    assert.ok(reached.has(entry.state), `${entry.state} is unreachable`);
  }
});

// A finding must be able to leave every non-terminal state, or it can strand.
test("E1-010 every non-terminal state has a way out", () => {
  for (const entry of lifecycle.states) {
    const outgoing = lifecycle.transitions.filter(
      (transition) => transition.from === entry.state,
    );

    if (entry.terminal) {
      continue;
    }

    assert.ok(outgoing.length > 0, `${entry.state} is not terminal but has no exit`);
  }
});

// docs/03-applications/05-finding-hub-spec.md, "Confirmation requirements".
test("E1-010 confirmation demands the full evidence set the specification lists", () => {
  const confirm = lifecycle.transitions.find(
    (transition) => transition.from === "triaged" && transition.to === "confirmed",
  );

  assert.ok(confirm, "there must be a transition into confirmed");
  assert.deepEqual([...confirm.requires].sort(), [
    "affected-component",
    "confidence",
    "primary-cwe-or-reason",
    "redacted-evidence",
    "remediation-direction",
    "reproducible-conditions",
    "reviewer-identity",
    "root-cause",
    "scoped-asset",
    "technical-impact",
  ]);
});

test("E1-010 verification requires an independent retest against a named artifact", () => {
  const verify = lifecycle.transitions.find((transition) => transition.to === "verified");

  assert.ok(verify.role.includes("independent-reviewer"));
  assert.ok(verify.requires.includes("independent-retest"));
  assert.ok(verify.requires.includes("candidate-artifact-digest"));
});

test("E1-010 risk acceptance requires a named owner and a future expiry", () => {
  const accept = lifecycle.transitions.find((transition) => transition.to === "risk-accepted");

  assert.deepEqual(accept.role, ["risk-owner"]);
  assert.ok(accept.requires.includes("risk-owner"));
  assert.ok(accept.requires.includes("future-expiry"));
});

// The sample is the worked example, so its history must be a legal path.
test("E1-010 the sample finding walked a legal path through the lifecycle", () => {
  const allowed = new Set(
    lifecycle.transitions.map((transition) => `${transition.from}->${transition.to}`),
  );

  assert.equal(finding.audit[0].to_state, lifecycle.initial_state);
  assert.equal(finding.audit[0].from_state, undefined);

  for (const entry of finding.audit.slice(1)) {
    assert.ok(
      allowed.has(`${entry.from_state}->${entry.to_state}`),
      `${entry.from_state} -> ${entry.to_state} is not an allowed transition`,
    );
  }

  const last = finding.audit.at(-1);
  assert.equal(last.to_state, finding.state, "the record must hold the state it ended in");
});

test("E1-010 the audit trail is chronological and links each step to the previous", () => {
  for (const [index, entry] of finding.audit.entries()) {
    if (index === 0) {
      continue;
    }

    assert.equal(entry.from_state, finding.audit[index - 1].to_state);
    assert.ok(
      Date.parse(entry.at) >= Date.parse(finding.audit[index - 1].at),
      "audit entries must not go backwards in time",
    );
  }
});

test("E1-010 a verified finding proves its original proof no longer succeeds", () => {
  assert.equal(finding.state, "verified");
  assert.equal(finding.retest.original_proof_succeeds, false);
  assert.match(finding.retest.artifact_digest, /^sha256:[0-9a-f]{64}$/);
});

test("E1-010 the finding references the occurrence it was raised from", () => {
  assert.ok(finding.occurrence_ids.includes(occurrence.occurrence_id));
  assert.ok(finding.affected.asset_ids.includes(occurrence.asset.asset_id));
  assert.ok(finding.mappings.primary_cwe === occurrence.mappings.cwe[0]);
});

// Severity is a tool signal and priority is a human decision; collapsing them
// is exactly what the vulnerability management specification forbids.
test("E1-010 tool severity and the priority decision are separate fields", () => {
  assert.ok(Object.hasOwn(occurrenceSchema.properties, "source_severity"));
  assert.equal(Object.hasOwn(findingSchema.properties, "severity"), false);
  assert.deepEqual(findingSchema.properties.priority.required, [
    "level",
    "rationale",
    "decided_by",
  ]);
});

test("E1-010 evidence is referenced, never inlined", () => {
  const properties = Object.keys(findingSchema.properties);

  assert.ok(properties.includes("evidence_ids"));
  assert.equal(
    properties.some((name) => /evidence_(bytes|content|data)/.test(name)),
    false,
  );
});
