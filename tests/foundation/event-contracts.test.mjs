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

const contractDirectory = path.join(repositoryRoot, "packages", "contracts", "events");

async function readContract(...segments) {
  return parseJson(await readFile(path.join(contractDirectory, ...segments), "utf8"));
}

const envelopeSchema = await readContract("event-envelope.schema.json");
const catalogSchema = await readContract("event-catalog.schema.json");
const catalog = await readContract("samples", "event-catalog", "catalog.json");
const sample = await readContract("samples", "event-envelope", "finding-confirmed.json");

// docs/07-data-api/04-event-contracts.md, "Mandatory events".
const MANDATORY = [
  "artifact.approved.v1",
  "engagement.activated.v1",
  "engagement.stopped.v1",
  "finding.confirmed.v1",
  "finding.created.v1",
  "ingestion.accepted.v1",
  "remediation.submitted.v1",
  "report.generated.v1",
  "retest.completed.v1",
  "risk_acceptance.expiring.v1",
  "run.budget_warning.v1",
  "run.cancelled.v1",
  "run.completed.v1",
  "run.started.v1",
];

test("E1-013 the samples satisfy their contracts", () => {
  assert.deepEqual(validate(catalogSchema, catalog), []);
  assert.deepEqual(validate(envelopeSchema, sample), []);
});

test("E1-013 the catalog carries exactly the mandatory events", () => {
  const declared = catalog.events.map((event) => event.event_type).sort();

  assert.deepEqual(declared, MANDATORY);
});

test("E1-013 every event type carries a major version", () => {
  for (const event of catalog.events) {
    assert.match(event.event_type, /\.v[1-9][0-9]*$/, event.event_type);
  }
});

test("E1-013 event types are unique", () => {
  const types = catalog.events.map((event) => event.event_type);

  assert.equal(new Set(types).size, types.length);
});

// A producer must never be listed among its own consumers, or the outbox relay
// would feed the service that emitted the event.
test("E1-013 no event is consumed by its own producer", () => {
  for (const event of catalog.events) {
    assert.equal(
      event.consumers.includes(event.producer),
      false,
      `${event.event_type} is consumed by its producer`,
    );
  }
});

// docs/07-data-api/04-event-contracts.md: "Ordering is guaranteed only per
// aggregate via version. Consumers detect gaps and rebuild from source."
// aggregate_version is therefore a single-writer counter. Two producers writing
// one aggregate type either collide on a version or leave gaps that a consumer
// reads as lost events and answers with a needless rebuild.
test("E1-013 each aggregate type has exactly one producer", () => {
  const producers = new Map();

  for (const event of catalog.events) {
    const known = producers.get(event.aggregate_type);

    if (known === undefined) {
      producers.set(event.aggregate_type, event.producer);
      continue;
    }

    assert.equal(
      event.producer,
      known,
      `aggregate ${event.aggregate_type} is written by both ${known} and ${event.producer}; ${event.event_type} needs its own aggregate`,
    );
  }
});

// The readable consequence of single-writer ownership: an event named for one
// aggregate but versioned against another is the shape the rule above forbids,
// and this catches it at the name rather than after counting producers.
test("E1-013 an event type is named for the aggregate it versions", () => {
  for (const event of catalog.events) {
    assert.equal(
      event.event_type.slice(0, event.event_type.indexOf(".")),
      event.aggregate_type,
      event.event_type,
    );
  }
});

// docs/07-data-api/04-event-contracts.md: events contain identifiers and safe
// facts, not evidence bytes or secrets. The payload field types make an unsafe
// payload unrepresentable, and this asserts the vocabulary stays that way.
test("E1-013 no payload field type can carry bytes or free text", () => {
  const safe = new Set([
    "identifier",
    "timestamp",
    "integer",
    "boolean",
    "enum_value",
    "digest",
    "label",
  ]);

  assert.deepEqual([...catalogSchema.$defs.payload_field.properties.type.enum].sort(), [
    ...safe,
  ].sort());

  for (const event of catalog.events) {
    for (const field of event.payload_fields) {
      assert.ok(safe.has(field.type), `${event.event_type}.${field.name}`);
      assert.doesNotMatch(
        field.name,
        /(secret|token|password|cookie|authorization|evidence_bytes|body|raw)/,
        `${event.event_type}.${field.name} looks like it carries sensitive material`,
      );
    }
  }
});

test("E1-013 every event declares at least one required payload field", () => {
  for (const event of catalog.events) {
    assert.ok(
      event.payload_fields.some((field) => field.required),
      `${event.event_type} declares no required field`,
    );
  }
});

// The envelope and the catalog are separate contracts; a producer or aggregate
// the envelope cannot express would make an event unpublishable.
test("E1-013 the envelope and the catalog share their vocabularies", () => {
  const envelopeProducers = new Set(envelopeSchema.$defs.producer.enum);
  const envelopeAggregates = new Set(envelopeSchema.$defs.aggregate_type.enum);

  for (const event of catalog.events) {
    assert.ok(envelopeProducers.has(event.producer), event.producer);
    assert.ok(envelopeAggregates.has(event.aggregate_type), event.aggregate_type);
  }
});

test("E1-013 the envelope event type pattern accepts every catalogued type", () => {
  const pattern = new RegExp(envelopeSchema.$defs.event_type.pattern);

  for (const event of catalog.events) {
    assert.match(event.event_type, pattern);
  }
});

test("E1-013 the sample envelope matches its catalogue entry", () => {
  const entry = catalog.events.find((event) => event.event_type === sample.event_type);

  assert.ok(entry, `${sample.event_type} is not catalogued`);
  assert.equal(sample.producer, entry.producer);
  assert.equal(sample.aggregate_type, entry.aggregate_type);

  for (const field of entry.payload_fields.filter((f) => f.required)) {
    assert.ok(
      Object.hasOwn(sample.payload, field.name),
      `payload is missing required field ${field.name}`,
    );
  }
});

test("E1-013 an unversioned event type is rejected", () => {
  const broken = { ...sample, event_type: "finding.confirmed" };

  assert.ok(validate(envelopeSchema, broken).length > 0);
});

test("E1-013 an envelope without an idempotency key or version is rejected", () => {
  for (const field of ["event_id", "aggregate_version", "correlation_id"]) {
    const broken = { ...sample };
    delete broken[field];

    assert.ok(validate(envelopeSchema, broken).length > 0, field);
  }
});

test("E1-013 an unknown envelope field is rejected", () => {
  const broken = { ...sample, evidence_bytes: "..." };

  assert.ok(validate(envelopeSchema, broken).length > 0);
});

test("E1-013 the first event in a chain needs no causation", () => {
  const first = { ...sample };
  delete first.causation_id;

  assert.deepEqual(validate(envelopeSchema, first), []);
});
