// The run lifecycle contract (backlog E1-005).
//
// The Python machine is tested against its own behaviour in
// services/orchestrator/tests/test_state_machine.py. These are the assertions
// that need the specification beside the table: that the states and transitions
// are the ones docs/03-applications/04-orchestrator-spec.md draws, plus the one
// place this table is deliberately stricter than that diagram.

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

const contractDirectory = path.join(repositoryRoot, "packages", "contracts", "security");

async function readContract(...segments) {
  return parseJson(await readFile(path.join(contractDirectory, ...segments), "utf8"));
}

const schema = await readContract("run-lifecycle.schema.json");
const lifecycle = await readContract("samples", "run-lifecycle", "orchestrator.json");

const terminal = new Set(
  lifecycle.states.filter((entry) => entry.terminal).map((entry) => entry.state),
);

test("E1-005 the lifecycle satisfies its contract", () => {
  assert.deepEqual(validate(schema, lifecycle), []);
});

// The states the specification's diagram draws, lower-cased. Dropping one means
// editing a test that cites the source.
test("E1-005 the states are the ones the specification draws", () => {
  assert.deepEqual(
    lifecycle.states.map((entry) => entry.state).sort(),
    [
      "cancelled",
      "cancelling",
      "completed",
      "draft",
      "finalizing",
      "incomplete",
      "paused",
      "ready",
      "rejected",
      "running",
      "validating",
    ],
  );
});

test("E1-005 every transition the diagram draws is present", () => {
  const declared = new Set(
    lifecycle.transitions.map((transition) => `${transition.from}->${transition.to}`),
  );

  for (const edge of [
    "draft->validating",
    "validating->ready",
    "validating->rejected",
    "ready->running",
    "running->paused",
    "paused->running",
    "running->cancelling",
    "running->finalizing",
    "cancelling->cancelled",
    "finalizing->completed",
    "finalizing->incomplete",
  ]) {
    assert.ok(declared.has(edge), `${edge} is missing`);
  }
});

// docs/03-applications/04-orchestrator-spec.md lists "Kill during every run
// state" among its safety tests, while the diagram in the same document allows
// only running -> cancelling. Conflict 18 records the disagreement; this table
// applies the stricter reading, and the test names it so the extra edges are
// not mistaken for an accident.
test("E1-005 a kill is reachable from every non-terminal state", () => {
  const stopping = new Set(
    lifecycle.transitions
      .filter((transition) => transition.to === "cancelling")
      .map((transition) => transition.from),
  );

  for (const entry of lifecycle.states) {
    if (entry.terminal || entry.state === "cancelling") {
      continue;
    }

    // finalizing stops into incomplete instead: execution is already over, so
    // what a kill costs there is the acknowledgement, not the work.
    const reachable = stopping.has(entry.state) || entry.state === "finalizing";

    assert.ok(reachable, `${entry.state} cannot be stopped`);
  }
});

test("E1-005 a terminal state has no exit", () => {
  for (const transition of lifecycle.transitions) {
    assert.equal(
      terminal.has(transition.from),
      false,
      `${transition.from} is terminal but leaves to ${transition.to}`,
    );
  }
});

test("E1-005 every state is reachable from the initial one", () => {
  const reached = new Set([lifecycle.initial_state]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const transition of lifecycle.transitions) {
      if (reached.has(transition.from) && !reached.has(transition.to)) {
        reached.add(transition.to);
        changed = true;
      }
    }
  }

  for (const entry of lifecycle.states) {
    assert.ok(reached.has(entry.state), `${entry.state} is unreachable`);
  }
});

// "Only Completed represents acknowledged final result ingestion. Process exit
// code zero alone is insufficient."
test("E1-005 completed is reachable only with an ingestion receipt", () => {
  const into = lifecycle.transitions.filter(
    (transition) => transition.to === "completed",
  );

  assert.equal(into.length, 1, "more than one route into completed");
  assert.equal(into[0].from, "finalizing");
  assert.ok(into[0].requires.includes("ingestion-receipt"));
});

test("E1-005 starting or resuming a run demands a grant", () => {
  for (const transition of lifecycle.transitions.filter(
    (candidate) => candidate.to === "running",
  )) {
    assert.ok(
      transition.requires.includes("execution-grant"),
      `${transition.from} -> running without a grant`,
    );
  }
});

test("E1-005 no transition is unconditional", () => {
  assert.equal(schema.$defs.transition.properties.requires.minItems, 1);

  for (const transition of lifecycle.transitions) {
    assert.ok(
      transition.requires.length > 0,
      `${transition.from} -> ${transition.to} requires nothing`,
    );
  }
});

test("E1-005 every declared requirement is used by some transition", () => {
  const used = new Set(lifecycle.transitions.flatMap((t) => t.requires));

  for (const requirement of schema.$defs.requirement.enum) {
    assert.ok(used.has(requirement), `${requirement} is never required`);
  }
});
