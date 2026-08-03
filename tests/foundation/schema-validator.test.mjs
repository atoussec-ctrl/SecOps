import assert from "node:assert/strict";
import test from "node:test";

import { SchemaError, validate } from "../../tools/schema.mjs";

function messages(schema, instance) {
  return validate(schema, instance).map((error) => `${error.path} ${error.message}`);
}

test("E0-003 an unsupported keyword is rejected instead of ignored", () => {
  assert.throws(
    () => validate({ type: "object", oneOf: [] }, {}),
    (error) => error instanceof SchemaError && /oneOf/.test(error.message),
  );
});

test("E0-003 an unsupported keyword nested in a subschema is rejected", () => {
  assert.throws(
    () =>
      validate(
        { type: "object", properties: { a: { type: "string", contentEncoding: "b" } } },
        {},
      ),
    (error) => error instanceof SchemaError && /contentEncoding/.test(error.message),
  );
});

test("E0-003 a non-object schema is rejected", () => {
  for (const schema of [null, [], "string", 3, true]) {
    assert.throws(() => validate(schema, {}), SchemaError);
  }
});

test("E0-003 type mismatches are reported with their instance path", () => {
  const schema = {
    type: "object",
    properties: { port: { type: "integer" } },
  };

  assert.deepEqual(messages(schema, { port: "8080" }), ["/port expected integer"]);
});

test("E0-003 an integer keyword rejects a fractional number", () => {
  assert.equal(validate({ type: "integer" }, 1.5).length, 1);
  assert.deepEqual(validate({ type: "integer" }, 2), []);
});

test("E0-003 a number keyword accepts an integer but rejects a string", () => {
  assert.deepEqual(validate({ type: "number" }, 2), []);
  assert.equal(validate({ type: "number" }, "2").length, 1);
});

test("E0-003 null is distinguished from object and from absence", () => {
  assert.deepEqual(validate({ type: "null" }, null), []);
  assert.equal(validate({ type: "object" }, null).length, 1);
  assert.equal(validate({ type: "array" }, {}).length, 1);
});

test("E0-003 a union type accepts any listed type", () => {
  const schema = { type: ["string", "null"] };

  assert.deepEqual(validate(schema, "value"), []);
  assert.deepEqual(validate(schema, null), []);
  assert.equal(validate(schema, 7).length, 1);
});

test("E0-003 missing required properties are reported individually", () => {
  const schema = {
    type: "object",
    required: ["engagementId", "owner"],
    properties: { engagementId: { type: "string" }, owner: { type: "string" } },
  };

  assert.deepEqual(messages(schema, {}), [
    "/ is missing required property \"engagementId\"",
    "/ is missing required property \"owner\"",
  ]);
});

test("E0-003 additional properties are rejected when the schema closes the object", () => {
  const schema = {
    type: "object",
    properties: { known: { type: "string" } },
    additionalProperties: false,
  };

  assert.deepEqual(messages(schema, { known: "a", sneaky: "b" }), [
    "/ has unexpected property \"sneaky\"",
  ]);
});

test("E0-003 additional properties are allowed when the schema stays open", () => {
  const schema = { type: "object", properties: { known: { type: "string" } } };

  assert.deepEqual(validate(schema, { known: "a", extra: 1 }), []);
});

test("E0-003 string patterns and lengths are enforced", () => {
  const schema = { type: "string", pattern: "^E\\d-\\d{3}$", minLength: 6, maxLength: 6 };

  assert.deepEqual(validate(schema, "E0-004"), []);
  assert.equal(validate(schema, "nope").length, 2);
});

test("E0-003 numeric bounds are enforced inclusively", () => {
  const schema = { type: "integer", minimum: 1, maximum: 10 };

  assert.deepEqual(validate(schema, 1), []);
  assert.deepEqual(validate(schema, 10), []);
  assert.equal(validate(schema, 0).length, 1);
  assert.equal(validate(schema, 11).length, 1);
});

test("E0-003 enum and const restrict values", () => {
  assert.deepEqual(validate({ enum: ["passive", "active"] }, "passive"), []);
  assert.equal(validate({ enum: ["passive", "active"] }, "destructive").length, 1);
  assert.deepEqual(validate({ const: 1 }, 1), []);
  assert.equal(validate({ const: 1 }, 2).length, 1);
});

test("E0-003 array items are validated element by element", () => {
  const schema = { type: "array", items: { type: "string" } };

  assert.deepEqual(messages(schema, ["a", 2, "c"]), ["/1 expected string"]);
});

test("E0-003 array length and uniqueness are enforced", () => {
  const schema = { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true };

  assert.equal(validate(schema, []).length, 1);
  assert.equal(validate(schema, ["a", "a"]).length, 1);
  assert.deepEqual(validate(schema, ["a", "b"]), []);
});

test("E0-003 uniqueness compares structurally, not by reference", () => {
  const schema = { type: "array", uniqueItems: true };

  assert.equal(validate(schema, [{ a: 1 }, { a: 1 }]).length, 1);
  assert.deepEqual(validate(schema, [{ a: 1 }, { a: 2 }]), []);
});

test("E0-003 local references are resolved", () => {
  const schema = {
    $defs: { port: { type: "integer", minimum: 1, maximum: 65535 } },
    type: "object",
    properties: { port: { $ref: "#/$defs/port" } },
  };

  assert.deepEqual(validate(schema, { port: 8080 }), []);
  assert.equal(validate(schema, { port: 0 }).length, 1);
});

test("E0-003 an unresolvable reference is a schema error", () => {
  const schema = { type: "object", properties: { a: { $ref: "#/$defs/missing" } } };

  assert.throws(() => validate(schema, { a: 1 }), SchemaError);
});

test("E0-003 a non-local reference is rejected", () => {
  const schema = { $ref: "https://example.test/schema.json" };

  assert.throws(() => validate(schema, {}), SchemaError);
});

test("E0-003 nested errors report a full instance path", () => {
  const schema = {
    type: "object",
    properties: {
      budgets: {
        type: "object",
        properties: { maxConcurrency: { type: "integer", minimum: 1 } },
      },
    },
  };

  assert.deepEqual(messages(schema, { budgets: { maxConcurrency: 0 } }), [
    "/budgets/maxConcurrency must be at least 1",
  ]);
});

test("E0-003 every failure is reported, not only the first", () => {
  const schema = {
    type: "object",
    required: ["a"],
    properties: { b: { type: "string" }, c: { type: "integer" } },
    additionalProperties: false,
  };

  assert.equal(validate(schema, { b: 1, c: "x", d: true }).length, 4);
});

test("E0-003 a reference combined with other constraints is rejected as ambiguous", () => {
  const schema = {
    $defs: { name: { type: "string" } },
    $ref: "#/$defs/name",
    minLength: 3,
  };

  assert.throws(() => validate(schema, "ab"), SchemaError);
});

// Unicode mode rejects identity escapes that are legal in an ordinary ECMA-262
// pattern, so compiling with the "u" flag would throw a SyntaxError from the
// middle of a validation run instead of reporting a problem.
test("E0-003 an ordinary escape in a pattern is accepted", () => {
  const schema = { type: "string", pattern: "^[a-z]+\\-[a-z]+$" };

  assert.deepEqual(validate(schema, "lab-target"), []);
  assert.equal(validate(schema, "labtarget").length, 1);
});

test("E0-003 an invalid pattern is a schema error, not a crash", () => {
  assert.throws(
    () => validate({ type: "string", pattern: "^([a-z]+$" }, "x"),
    (error) => error instanceof SchemaError && /not a valid expression/.test(error.message),
  );
});

test("E0-003 a non-string pattern is rejected", () => {
  assert.throws(() => validate({ type: "string", pattern: 7 }, "x"), SchemaError);
});

test("E0-003 an invalid pattern is caught even when no instance reaches it", () => {
  const schema = {
    type: "object",
    properties: { unused: { type: "string", pattern: "a{2,1}" } },
  };

  assert.throws(() => validate(schema, {}), SchemaError);
});

test("E0-003 an unsupported type name is rejected", () => {
  assert.throws(() => validate({ type: "date" }, "2026-08-03"), SchemaError);
  assert.throws(() => validate({ type: ["string", "date"] }, "x"), SchemaError);
});

test("E0-003 malformed keyword shapes are rejected", () => {
  const malformed = [
    { type: "object", required: "name" },
    { enum: "passive" },
    { type: "object", properties: [] },
    { $defs: [] },
    { type: "object", additionalProperties: 5 },
  ];

  for (const schema of malformed) {
    assert.throws(() => validate(schema, {}), SchemaError, JSON.stringify(schema));
  }
});

test("E0-003 a declared null type rejects a non-null value", () => {
  assert.equal(validate({ type: "null" }, "text").length, 1);
  assert.equal(validate({ type: "null" }, 0).length, 1);
});

test("E0-003 maximum string length is enforced", () => {
  assert.deepEqual(validate({ type: "string", maxLength: 3 }, "abc"), []);
  assert.equal(validate({ type: "string", maxLength: 3 }, "abcd").length, 1);
});

test("E0-003 exclusive numeric bounds are enforced", () => {
  const schema = { type: "integer", exclusiveMinimum: 0, exclusiveMaximum: 10 };

  assert.deepEqual(validate(schema, 5), []);
  assert.equal(validate(schema, 0).length, 1);
  assert.equal(validate(schema, 10).length, 1);
});

test("E0-003 maximum array length is enforced", () => {
  const schema = { type: "array", maxItems: 2 };

  assert.deepEqual(validate(schema, [1, 2]), []);
  assert.equal(validate(schema, [1, 2, 3]).length, 1);
});

test("E0-003 an open additionalProperties schema validates extra properties", () => {
  const schema = {
    type: "object",
    properties: { known: { type: "string" } },
    additionalProperties: { type: "integer" },
  };

  assert.deepEqual(validate(schema, { known: "a", extra: 1 }), []);
  assert.deepEqual(messages(schema, { known: "a", extra: "b" }), ["/extra expected integer"]);
});

test("E0-003 annotations are accepted and do not affect validation", () => {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.test/s.json",
    title: "Example",
    description: "Annotated",
    examples: [{}],
    type: "object",
  };

  assert.deepEqual(validate(schema, {}), []);
});
