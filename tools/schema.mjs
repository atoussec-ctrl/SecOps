// Minimal JSON Schema validator for repository-owned contracts (backlog E0-003).
//
// This deliberately implements a subset of draft 2020-12 and throws SchemaError
// on any keyword it does not implement. A validator that silently ignores an
// unknown keyword would report a security contract as valid while enforcing
// less than the contract states, so unsupported input fails closed.

import { isDeepStrictEqual } from "node:util";

const ANNOTATION_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$comment",
  "title",
  "description",
  "examples",
  "default",
  "deprecated",
]);

const VALIDATION_KEYWORDS = new Set([
  "$defs",
  "$ref",
  "additionalProperties",
  "const",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "pattern",
  "properties",
  "required",
  "type",
  "uniqueItems",
]);

const TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

const LOCAL_REF_PREFIX = "#/$defs/";

// Windows editors routinely save JSON with a byte order mark, which JSON.parse
// rejects with a message that points at nothing useful. A BOM is an encoding
// artifact, not a content difference, so it is stripped before parsing.
export function parseJson(contents) {
  return JSON.parse(contents.charCodeAt(0) === 0xfeff ? contents.slice(1) : contents);
}

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const compiledPatterns = new Map();

// Compiled once at walk time so an invalid pattern is a schema error rather
// than a SyntaxError thrown from the middle of a validation run. No unicode
// flag: JSON Schema patterns are ECMA-262 regexes, and unicode mode rejects
// identity escapes such as \- that are legal in an ordinary pattern.
function compilePattern(pattern, location) {
  const cached = compiledPatterns.get(pattern);

  if (cached !== undefined) {
    return cached;
  }

  if (typeof pattern !== "string") {
    throw new SchemaError(`${location}: "pattern" must be a string`);
  }

  let compiled;

  try {
    compiled = new RegExp(pattern);
  } catch (error) {
    throw new SchemaError(`${location}: "pattern" is not a valid expression: ${error.message}`);
  }

  compiledPatterns.set(pattern, compiled);
  return compiled;
}

function joinPath(parent, segment) {
  return parent === "/" ? `/${segment}` : `${parent}/${segment}`;
}

function resolveRef(reference, root, location) {
  if (typeof reference !== "string" || !reference.startsWith(LOCAL_REF_PREFIX)) {
    throw new SchemaError(
      `${location}: only local "${LOCAL_REF_PREFIX}" references are supported`,
    );
  }

  const name = reference.slice(LOCAL_REF_PREFIX.length);
  const target = isPlainObject(root.$defs) ? root.$defs[name] : undefined;

  if (!isPlainObject(target)) {
    throw new SchemaError(`${location}: reference "${reference}" does not resolve`);
  }

  return target;
}

function walkSchema(schema, location, root) {
  if (!isPlainObject(schema)) {
    throw new SchemaError(`${location}: schema must be a JSON object`);
  }

  for (const keyword of Object.keys(schema)) {
    if (!ANNOTATION_KEYWORDS.has(keyword) && !VALIDATION_KEYWORDS.has(keyword)) {
      throw new SchemaError(`${location}: unsupported schema keyword "${keyword}"`);
    }
  }

  if (schema.$ref !== undefined) {
    const siblings = Object.keys(schema).filter(
      (keyword) => keyword !== "$ref" && VALIDATION_KEYWORDS.has(keyword),
    );

    if (siblings.length > 0) {
      throw new SchemaError(
        `${location}: "$ref" cannot be combined with ${siblings.join(", ")}`,
      );
    }

    resolveRef(schema.$ref, root, location);
  }

  if (schema.type !== undefined) {
    const declared = Array.isArray(schema.type) ? schema.type : [schema.type];

    for (const type of declared) {
      if (!TYPES.has(type)) {
        throw new SchemaError(`${location}: unsupported type "${type}"`);
      }
    }
  }

  if (schema.pattern !== undefined) {
    compilePattern(schema.pattern, location);
  }

  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    throw new SchemaError(`${location}: "required" must be an array`);
  }

  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    throw new SchemaError(`${location}: "enum" must be an array`);
  }

  for (const keyword of ["properties", "$defs"]) {
    if (schema[keyword] === undefined) {
      continue;
    }

    if (!isPlainObject(schema[keyword])) {
      throw new SchemaError(`${location}: "${keyword}" must be a JSON object`);
    }

    for (const [key, subschema] of Object.entries(schema[keyword])) {
      walkSchema(subschema, `${location}/${keyword}/${key}`, root);
    }
  }

  if (schema.items !== undefined) {
    walkSchema(schema.items, `${location}/items`, root);
  }

  if (schema.additionalProperties !== undefined) {
    if (isPlainObject(schema.additionalProperties)) {
      walkSchema(schema.additionalProperties, `${location}/additionalProperties`, root);
    } else if (typeof schema.additionalProperties !== "boolean") {
      throw new SchemaError(
        `${location}: "additionalProperties" must be a boolean or a schema`,
      );
    }
  }
}

function matchesType(value, type) {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return value === null;
  }
}

function validateString(schema, instance, path, errors) {
  if (schema.pattern !== undefined && !compilePattern(schema.pattern, "#").test(instance)) {
    errors.push({ path, message: `must match ${schema.pattern}` });
  }

  if (schema.minLength !== undefined && instance.length < schema.minLength) {
    errors.push({ path, message: `must be at least ${schema.minLength} characters` });
  }

  if (schema.maxLength !== undefined && instance.length > schema.maxLength) {
    errors.push({ path, message: `must be at most ${schema.maxLength} characters` });
  }
}

function validateNumber(schema, instance, path, errors) {
  if (schema.minimum !== undefined && instance < schema.minimum) {
    errors.push({ path, message: `must be at least ${schema.minimum}` });
  }

  if (schema.maximum !== undefined && instance > schema.maximum) {
    errors.push({ path, message: `must be at most ${schema.maximum}` });
  }

  if (schema.exclusiveMinimum !== undefined && instance <= schema.exclusiveMinimum) {
    errors.push({ path, message: `must be greater than ${schema.exclusiveMinimum}` });
  }

  if (schema.exclusiveMaximum !== undefined && instance >= schema.exclusiveMaximum) {
    errors.push({ path, message: `must be less than ${schema.exclusiveMaximum}` });
  }
}

function validateArray(schema, instance, path, root, errors) {
  if (schema.minItems !== undefined && instance.length < schema.minItems) {
    errors.push({ path, message: `must contain at least ${schema.minItems} items` });
  }

  if (schema.maxItems !== undefined && instance.length > schema.maxItems) {
    errors.push({ path, message: `must contain at most ${schema.maxItems} items` });
  }

  if (schema.uniqueItems === true) {
    const duplicated = instance.some((item, index) =>
      instance.some((other, otherIndex) => otherIndex > index && isDeepStrictEqual(item, other)),
    );

    if (duplicated) {
      errors.push({ path, message: "must not contain duplicate items" });
    }
  }

  if (schema.items !== undefined) {
    instance.forEach((item, index) => {
      validateNode(schema.items, item, joinPath(path, index), root, errors);
    });
  }
}

function validateObject(schema, instance, path, root, errors) {
  for (const required of schema.required ?? []) {
    if (!Object.hasOwn(instance, required)) {
      errors.push({ path, message: `is missing required property "${required}"` });
    }
  }

  const declared = schema.properties ?? {};

  for (const [key, value] of Object.entries(instance)) {
    if (Object.hasOwn(declared, key)) {
      validateNode(declared[key], value, joinPath(path, key), root, errors);
      continue;
    }

    if (schema.additionalProperties === false) {
      errors.push({ path, message: `has unexpected property "${key}"` });
    } else if (isPlainObject(schema.additionalProperties)) {
      validateNode(
        schema.additionalProperties,
        value,
        joinPath(path, key),
        root,
        errors,
      );
    }
  }
}

function validateNode(schema, instance, path, root, errors) {
  const active =
    schema.$ref === undefined ? schema : resolveRef(schema.$ref, root, path);

  if (active.type !== undefined) {
    const declared = Array.isArray(active.type) ? active.type : [active.type];

    if (!declared.some((type) => matchesType(instance, type))) {
      errors.push({ path, message: `expected ${declared.join(" or ")}` });
      return;
    }
  }

  if (active.const !== undefined && !isDeepStrictEqual(instance, active.const)) {
    errors.push({ path, message: `must equal ${JSON.stringify(active.const)}` });
  }

  if (
    active.enum !== undefined &&
    !active.enum.some((candidate) => isDeepStrictEqual(candidate, instance))
  ) {
    errors.push({
      path,
      message: `must be one of ${active.enum.map((v) => JSON.stringify(v)).join(", ")}`,
    });
  }

  if (typeof instance === "string") {
    validateString(active, instance, path, errors);
  }

  if (typeof instance === "number") {
    validateNumber(active, instance, path, errors);
  }

  if (Array.isArray(instance)) {
    validateArray(active, instance, path, root, errors);
  }

  if (isPlainObject(instance)) {
    validateObject(active, instance, path, root, errors);
  }
}

// Check a schema on its own, without an instance, so a malformed or
// under-enforcing contract is caught before anything is validated against it.
export function assertSchema(schema) {
  walkSchema(schema, "#", schema);
}

export function validate(schema, instance) {
  walkSchema(schema, "#", schema);

  const errors = [];
  validateNode(schema, instance, "/", schema, errors);
  return errors;
}
