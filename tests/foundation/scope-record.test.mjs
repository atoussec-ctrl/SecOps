import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validate } from "../../tools/schema.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const contractDirectory = path.join(repositoryRoot, "packages", "contracts", "security");

function readJson(...segments) {
  return readFile(path.join(...segments), "utf8").then((contents) =>
    JSON.parse(contents),
  );
}

const schema = await readJson(contractDirectory, "scope-record.schema.json");

async function readSample(name) {
  return readJson(contractDirectory, "samples", "scope-record", name);
}

// Unsafe fixtures are built here rather than stored as files, so an
// out-of-scope document can never be mistaken for a usable scope template.
async function mutatedScope(mutate) {
  const scope = structuredClone(await readSample("lab-loopback.json"));
  mutate(scope);
  return scope;
}

function assertRejected(scope, expectedPath) {
  const errors = validate(schema, scope);

  assert.ok(errors.length > 0, "the scope record should have been rejected");

  if (expectedPath !== undefined) {
    assert.ok(
      errors.some((error) => error.path === expectedPath),
      `expected a failure at ${expectedPath}, got ${JSON.stringify(errors)}`,
    );
  }
}

test("E0-004 the safe sample scopes satisfy the contract", async () => {
  for (const name of ["lab-loopback.json", "lab-private-network.json"]) {
    assert.deepEqual(validate(schema, await readSample(name)), [], name);
  }
});

test("E0-004 a public IPv4 target is rejected", async () => {
  for (const address of ["8.8.8.8", "93.184.216.34", "1.1.1.1", "172.32.0.1"]) {
    const scope = await mutatedScope((s) => {
      s.targets.ipv4 = [address];
    });

    assertRejected(scope, "/targets/ipv4/0");
  }
});

// 169.254.169.254 is the cloud metadata endpoint and 0.0.0.0 binds every
// interface. Neither may appear in an authorization boundary.
test("E0-004 link-local, metadata and wildcard addresses are rejected", async () => {
  for (const address of ["169.254.169.254", "0.0.0.0", "255.255.255.255"]) {
    const scope = await mutatedScope((s) => {
      s.targets.ipv4 = [address];
    });

    assertRejected(scope, "/targets/ipv4/0");
  }
});

// Alternate encodings of 127.0.0.1 must not slip past the pattern.
test("E0-004 alternate address encodings are rejected", async () => {
  for (const address of [
    "127.000.000.001",
    "2130706433",
    "0x7f.0.0.1",
    "::ffff:127.0.0.1",
    "127.0.0.1 ",
  ]) {
    const scope = await mutatedScope((s) => {
      s.targets.ipv4 = [address];
    });

    assertRejected(scope, "/targets/ipv4/0");
  }
});

test("E0-004 a public hostname is rejected", async () => {
  for (const hostname of ["example.com", "api.evil.net", "localhost.example.com."]) {
    const scope = await mutatedScope((s) => {
      s.targets.hostnames = [hostname];
    });

    assertRejected(scope, "/targets/hostnames/0");
  }
});

test("E0-004 a reserved lab hostname is accepted", async () => {
  const scope = await mutatedScope((s) => {
    s.targets.hostnames = ["web.lab.test", "api.lab.example", "host.invalid"];
  });

  assert.deepEqual(validate(schema, scope), []);
});

test("E0-004 a public URL is rejected", async () => {
  for (const url of [
    "https://example.com/",
    "http://93.184.216.34:80/",
    "ftp://localhost/",
    "file:///etc/passwd",
  ]) {
    const scope = await mutatedScope((s) => {
      s.targets.urls = [url];
    });

    assertRejected(scope, "/targets/urls/0");
  }
});

test("E0-004 a public CIDR is rejected", async () => {
  for (const cidr of ["0.0.0.0/0", "8.8.8.0/24", "172.32.0.0/16"]) {
    const scope = await mutatedScope((s) => {
      s.targets.cidrs = [cidr];
    });

    assertRejected(scope, "/targets/cidrs/0");
  }
});

test("E0-004 a destructive profile cannot be authorized", async () => {
  for (const profile of ["destructive", "active", "all"]) {
    const scope = await mutatedScope((s) => {
      s.allowed_profiles = [profile];
    });

    assertRejected(scope, "/allowed_profiles/0");
  }
});

test("E0-004 a scope cannot authorize work against real data", async () => {
  const scope = await mutatedScope((s) => {
    s.data_handling.synthetic_data_only = false;
  });

  assertRejected(scope, "/data_handling/synthetic_data_only");
});

test("E0-004 budgets above the ceiling are rejected", async () => {
  const ceilings = {
    max_requests_per_second: 51,
    max_concurrency: 17,
    max_duration_seconds: 3601,
    max_response_bytes: 10485761,
    max_test_records: 101,
  };

  for (const [field, value] of Object.entries(ceilings)) {
    const scope = await mutatedScope((s) => {
      s.budgets[field] = value;
    });

    assertRejected(scope, `/budgets/${field}`);
  }
});

test("E0-004 an unbounded budget is rejected", async () => {
  const scope = await mutatedScope((s) => {
    delete s.budgets.max_concurrency;
  });

  assertRejected(scope, "/budgets");
});

test("E0-004 a scope without approval is rejected", async () => {
  const scope = await mutatedScope((s) => {
    delete s.approval;
  });

  assertRejected(scope, "/");
});

test("E0-004 an approval without a full scope hash is rejected", async () => {
  for (const hash of ["", "abc", "0".repeat(63), "0".repeat(65), "a".repeat(64).toUpperCase()]) {
    const scope = await mutatedScope((s) => {
      s.approval.scope_hash = hash;
    });

    assertRejected(scope, "/approval/scope_hash");
  }
});

test("E0-004 a malformed validity window is rejected", async () => {
  for (const value of ["2026-08-03", "2026-08-03 09:00:00", "not-a-date"]) {
    const scope = await mutatedScope((s) => {
      s.validity.start = value;
    });

    assertRejected(scope, "/validity/start");
  }
});

test("E0-004 an unknown top-level field is rejected", async () => {
  const scope = await mutatedScope((s) => {
    s.allow_everything = true;
  });

  assertRejected(scope, "/");
});

test("E0-004 a scope must name at least one application and port", async () => {
  for (const field of ["applications", "ports"]) {
    const scope = await mutatedScope((s) => {
      s.targets[field] = [];
    });

    assertRejected(scope, `/targets/${field}`);
  }
});

test("E0-004 duplicate targets are rejected", async () => {
  const scope = await mutatedScope((s) => {
    s.targets.ports = [8081, 8081];
  });

  assertRejected(scope, "/targets/ports");
});

test("E0-004 a scope must name a stop contact", async () => {
  const scope = await mutatedScope((s) => {
    s.stop.contacts = [];
  });

  assertRejected(scope, "/stop/contacts");
});
