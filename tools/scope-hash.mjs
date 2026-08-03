// Canonical scope serialization and hashing (backlog E1-003).
//
// A scope record is approved once and then referenced by digest. The approving
// signature and the runtime check must therefore agree byte for byte on what
// was approved, across a TypeScript console and a Python orchestrator. That
// agreement needs one canonical form, defined here and pinned by conformance
// vectors in packages/contracts/security.
//
// The form is deliberately narrower than JSON: only the value types a scope
// record can contain are representable, and anything else is an error rather
// than a silently different encoding.

import { createHash } from "node:crypto";

export class CanonicalFormError extends Error {
  constructor(message) {
    super(message);
    this.name = "CanonicalFormError";
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalizeValue(value, location) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    // Floating point has no single textual form across languages, and a scope
    // record has no use for one. Integers only.
    if (!Number.isInteger(value)) {
      throw new CanonicalFormError(`${location}: only integer numbers are canonical`);
    }

    if (!Number.isSafeInteger(value)) {
      throw new CanonicalFormError(`${location}: integer is outside the safe range`);
    }

    return `${value === 0 ? 0 : value}`;
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    // Array order is meaningful and is preserved.
    return `[${value
      .map((item, index) => canonicalizeValue(item, `${location}/${index}`))
      .join(",")}]`;
  }

  if (isPlainObject(value)) {
    // Object key order is not meaningful, so it is normalized by sorting.
    const keys = Object.keys(value).sort();

    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalizeValue(value[key], `${location}/${key}`)}`)
      .join(",")}}`;
  }

  throw new CanonicalFormError(`${location}: ${typeof value} is not representable`);
}

export function canonicalize(value) {
  return canonicalizeValue(value, "");
}

// The digest cannot cover the field that carries it, so scope_hash is removed
// before hashing. Everything else in the record is covered.
export function scopeWithoutHash(scope) {
  if (!isPlainObject(scope)) {
    throw new CanonicalFormError(": a scope record must be an object");
  }

  if (!isPlainObject(scope.approval)) {
    return scope;
  }

  const { scope_hash: _omitted, ...approval } = scope.approval;

  return { ...scope, approval };
}

export function scopeHash(scope) {
  return createHash("sha256")
    .update(canonicalize(scopeWithoutHash(scope)), "utf8")
    .digest("hex");
}

export function verifyScopeHash(scope) {
  const expected = scopeHash(scope);
  const declared = scope.approval?.scope_hash;

  return { expected, declared, matches: declared === expected };
}
