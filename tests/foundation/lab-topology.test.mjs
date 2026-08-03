import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseJson, validate } from "../../tools/schema.mjs";
import {
  COMPOSE_FILE,
  checkExposure,
  checkTopologyPolicy,
  deferredImages,
  renderCompose,
  resolveImage,
} from "../../tools/topology.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

async function readRepositoryJson(...segments) {
  return parseJson(await readFile(path.join(repositoryRoot, ...segments), "utf8"));
}

const schema = await readRepositoryJson(
  "packages",
  "contracts",
  "infra",
  "lab-topology.schema.json",
);
const repositoryTopology = await readRepositoryJson(
  "infra",
  "compose",
  "lab-topology.json",
);
const repositoryManifest = await readRepositoryJson("version-manifest.json");

const HARDENED_RUNTIME = {
  read_only: true,
  no_new_privileges: true,
  user: "10001:10001",
  cap_drop: ["ALL"],
  memory_limit_mb: 512,
  cpu_limit: "0.50",
  pids_limit: 128,
};

const DIGEST = `sha256:${"a".repeat(64)}`;

const PINNED_MANIFEST = {
  entries: {
    consoleImage: {
      status: "pinned",
      version: "1.0.0",
      image: "registry.invalid/console",
      digest: DIGEST,
    },
    targetImage: {
      status: "pinned",
      version: "1.0.0",
      image: "registry.invalid/target",
      digest: DIGEST,
    },
  },
};

function fixtureTopology() {
  return {
    topology_version: "1.0.0",
    project_name: "fixture",
    networks: {
      "fixture-ingress": { internal: false, purpose: "Loopback ingress for the console." },
      "fixture-lab": { internal: true, purpose: "Internal lab network for targets." },
    },
    services: {
      console: {
        role: "console",
        image_ref: "consoleImage",
        networks: ["fixture-ingress"],
        published_ports: [
          { host_ip: "127.0.0.1", host_port: 8080, container_port: 8080 },
        ],
        runtime: { ...HARDENED_RUNTIME },
      },
      "web-lab-insecure": {
        role: "target-insecure",
        image_ref: "targetImage",
        networks: ["fixture-lab"],
        published_ports: [],
        runtime: { ...HARDENED_RUNTIME },
      },
    },
  };
}

function mutated(mutate) {
  const topology = fixtureTopology();
  mutate(topology);
  return topology;
}

test("E0-005 the repository topology satisfies its contract", () => {
  assert.deepEqual(validate(schema, repositoryTopology), []);
});

test("E0-005 the repository topology satisfies the exposure policy", () => {
  assert.deepEqual(checkTopologyPolicy(repositoryTopology, repositoryManifest), []);
});

test("E0-005 no lab target attaches to an ingress network", () => {
  for (const [name, service] of Object.entries(repositoryTopology.services)) {
    if (service.role !== "target-insecure" && service.role !== "target-secure") {
      continue;
    }

    for (const network of service.networks) {
      assert.equal(
        repositoryTopology.networks[network].internal,
        true,
        `${name} must stay on internal networks`,
      );
    }

    assert.deepEqual(service.published_ports, [], `${name} must publish no host port`);
  }
});

// The schema has no representation for a wildcard bind address, so a publicly
// reachable target cannot be written down.
test("E0-005 a non-loopback bind address is not expressible", () => {
  for (const address of ["0.0.0.0", "::", "192.168.56.1", ""]) {
    const topology = mutated((t) => {
      t.services.console.published_ports[0].host_ip = address;
    });

    assert.ok(
      validate(schema, topology).length > 0,
      `${address} must be rejected as a bind address`,
    );
  }
});

test("E0-005 privileged mode, host networking and bind mounts are not expressible", () => {
  const unsafe = [
    (t) => {
      t.services.console.privileged = true;
    },
    (t) => {
      t.services.console.network_mode = "host";
    },
    (t) => {
      t.services.console.volumes = ["/var/run/docker.sock:/var/run/docker.sock"];
    },
    (t) => {
      t.services.console.cap_add = ["SYS_ADMIN"];
    },
  ];

  for (const mutate of unsafe) {
    assert.ok(validate(schema, mutated(mutate)).length > 0);
  }
});

test("E0-005 container hardening cannot be switched off", () => {
  const weakened = [
    (t) => {
      t.services.console.runtime.read_only = false;
    },
    (t) => {
      t.services.console.runtime.no_new_privileges = false;
    },
    (t) => {
      t.services.console.runtime.cap_drop = [];
    },
    (t) => {
      t.services.console.runtime.user = "0:0";
    },
    (t) => {
      t.services.console.runtime.user = "root";
    },
  ];

  for (const mutate of weakened) {
    assert.ok(validate(schema, mutated(mutate)).length > 0);
  }
});

test("E0-005 a target that publishes a host port is rejected", () => {
  const topology = mutated((t) => {
    t.services["web-lab-insecure"].published_ports = [
      { host_ip: "127.0.0.1", host_port: 9000, container_port: 9000 },
    ];
  });

  const problems = checkTopologyPolicy(topology, PINNED_MANIFEST);

  assert.ok(problems.some((problem) => /must not publish a host port/.test(problem)));
});

test("E0-005 a target attached to the ingress network is rejected", () => {
  const topology = mutated((t) => {
    t.services["web-lab-insecure"].networks = ["fixture-ingress"];
  });

  const problems = checkTopologyPolicy(topology, PINNED_MANIFEST);

  assert.ok(
    problems.some((problem) => /must not attach to an ingress network/.test(problem)),
  );
});

test("E0-005 a second ingress network is rejected", () => {
  const topology = mutated((t) => {
    t.networks["fixture-extra"] = { internal: false, purpose: "A second way onto the host." };
  });

  const problems = checkTopologyPolicy(topology, PINNED_MANIFEST);

  assert.ok(problems.some((problem) => /only one ingress network/.test(problem)));
});

test("E0-005 an undeclared network reference is rejected", () => {
  const topology = mutated((t) => {
    t.services.console.networks = ["nowhere"];
  });

  const problems = checkTopologyPolicy(topology, PINNED_MANIFEST);

  assert.ok(problems.some((problem) => /undeclared network "nowhere"/.test(problem)));
});

test("E0-005 an undeclared dependency is rejected", () => {
  const topology = mutated((t) => {
    t.services.console.depends_on = ["ghost"];
  });

  const problems = checkTopologyPolicy(topology, PINNED_MANIFEST);

  assert.ok(problems.some((problem) => /undeclared service "ghost"/.test(problem)));
});

test("E0-005 two services cannot claim the same host port", () => {
  const topology = mutated((t) => {
    t.services["control-plane"] = {
      role: "control-plane",
      image_ref: "consoleImage",
      networks: ["fixture-ingress"],
      published_ports: [{ host_ip: "127.0.0.1", host_port: 8080, container_port: 8081 }],
      runtime: { ...HARDENED_RUNTIME },
    };
  });

  const problems = checkTopologyPolicy(topology, PINNED_MANIFEST);

  assert.ok(problems.some((problem) => /claimed by both/.test(problem)));
});

test("E0-005 an image outside the version manifest is rejected", () => {
  const topology = mutated((t) => {
    t.services.console.image_ref = "mysteryImage";
  });

  const problems = checkTopologyPolicy(topology, PINNED_MANIFEST);

  assert.ok(problems.some((problem) => /not in the version manifest/.test(problem)));
});

test("E0-005 an image without an immutable digest is rejected", () => {
  const manifest = {
    entries: {
      consoleImage: { status: "pinned", version: "1.0.0", image: "registry.invalid/console" },
      targetImage: PINNED_MANIFEST.entries.targetImage,
    },
  };

  const problems = checkTopologyPolicy(fixtureTopology(), manifest);

  assert.ok(problems.some((problem) => /no image name and sha256 digest/.test(problem)));
});

test("E0-005 a tag is not accepted in place of a digest", () => {
  const manifest = {
    entries: {
      consoleImage: {
        status: "pinned",
        version: "1.0.0",
        image: "registry.invalid/console",
        digest: "latest",
      },
    },
  };

  assert.deepEqual(resolveImage("consoleImage", manifest), { state: "unpinned" });
});

test("E0-005 an unselected image is deferred rather than failed", () => {
  const manifest = {
    entries: {
      consoleImage: { status: "unselected", blockedBy: "E1-014" },
      targetImage: PINNED_MANIFEST.entries.targetImage,
    },
  };

  assert.deepEqual(checkTopologyPolicy(fixtureTopology(), manifest), []);
  assert.deepEqual(deferredImages(fixtureTopology(), manifest), [
    { id: "consoleImage", blockedBy: "E1-014" },
  ]);
});

test("E0-005 deferred images are reported in a stable order", () => {
  const manifest = {
    entries: {
      consoleImage: { status: "unselected", blockedBy: "E1-014" },
      targetImage: { status: "unselected", blockedBy: "E2-001" },
    },
  };

  assert.deepEqual(deferredImages(fixtureTopology(), manifest), [
    { id: "consoleImage", blockedBy: "E1-014" },
    { id: "targetImage", blockedBy: "E2-001" },
  ]);
});

test("E0-005 rendering refuses to emit a service whose image is unselected", () => {
  const manifest = {
    entries: { consoleImage: { status: "unselected", blockedBy: "E1-014" } },
  };

  assert.throws(
    () => renderCompose(fixtureTopology(), manifest),
    /cannot render service "console".*deferred/,
  );
});

test("E0-005 rendering emits loopback publishing and hardening", () => {
  const rendered = renderCompose(fixtureTopology(), PINNED_MANIFEST);

  assert.match(rendered, /^name: fixture$/m);
  assert.match(rendered, /^ {4}internal: true$/m);
  assert.match(rendered, /^ {6}- "127\.0\.0\.1:8080:8080"$/m);
  assert.match(rendered, new RegExp(`image: "registry.invalid/console@${DIGEST}"`));
  assert.match(rendered, /^ {4}read_only: true$/m);
  assert.match(rendered, /^ {6}- "no-new-privileges:true"$/m);
  assert.match(rendered, /^ {4}pids_limit: 128$/m);
  assert.doesNotMatch(rendered, /0\.0\.0\.0/);

  // The insecure target must appear without any ports block.
  const targetBlock = rendered.slice(rendered.indexOf("  web-lab-insecure:"));
  assert.doesNotMatch(targetBlock, /ports:/);
});

test("E0-005 an empty topology is rejected", () => {
  const problems = checkTopologyPolicy(
    { topology_version: "1.0.0", project_name: "empty", networks: {}, services: {} },
    PINNED_MANIFEST,
  );

  assert.ok(problems.some((problem) => /declares no networks/.test(problem)));
  assert.ok(problems.some((problem) => /declares no services/.test(problem)));
});

test("E0-005 rendering emits declared start-up dependencies", () => {
  const topology = mutated((t) => {
    t.services.console.depends_on = ["web-lab-insecure"];
  });

  const rendered = renderCompose(topology, PINNED_MANIFEST);

  assert.match(rendered, /^ {4}depends_on:$/m);
  assert.match(rendered, /^ {6}- web-lab-insecure$/m);
});

test("E0-005 rendering is deterministic", () => {
  assert.equal(
    renderCompose(fixtureTopology(), PINNED_MANIFEST),
    renderCompose(fixtureTopology(), PINNED_MANIFEST),
  );
});

async function createTopologyTree(topology, manifest, composeContents) {
  const root = await mkdtemp(path.join(tmpdir(), "security-lab-e0-005-"));

  await mkdir(path.join(root, "infra", "compose"), { recursive: true });
  await mkdir(path.join(root, "packages", "contracts", "infra"), { recursive: true });

  await writeFile(
    path.join(root, "infra", "compose", "lab-topology.json"),
    JSON.stringify(topology),
    "utf8",
  );
  await writeFile(
    path.join(root, "packages", "contracts", "infra", "lab-topology.schema.json"),
    JSON.stringify(schema),
    "utf8",
  );
  await writeFile(path.join(root, "version-manifest.json"), JSON.stringify(manifest), "utf8");

  if (composeContents !== undefined) {
    await writeFile(
      path.join(root, "infra", "compose", COMPOSE_FILE),
      composeContents,
      "utf8",
    );
  }

  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("E0-005 the exposure check reports a missing generated Compose file", async (t) => {
  const tree = await createTopologyTree(fixtureTopology(), PINNED_MANIFEST);
  t.after(tree.cleanup);

  const report = await checkExposure(tree.root);

  assert.ok(report.problems.some((problem) => /is missing/.test(problem)));
});

test("E0-005 the exposure check accepts a Compose file that matches the topology", async (t) => {
  const rendered = renderCompose(fixtureTopology(), PINNED_MANIFEST);
  const tree = await createTopologyTree(fixtureTopology(), PINNED_MANIFEST, rendered);
  t.after(tree.cleanup);

  assert.deepEqual(await checkExposure(tree.root), { problems: [], deferred: [] });
});

// A hand-edited Compose file is exactly how a public bind would be introduced.
test("E0-005 the exposure check detects a hand-edited Compose file", async (t) => {
  const tampered = renderCompose(fixtureTopology(), PINNED_MANIFEST).replace(
    "127.0.0.1:8080:8080",
    "0.0.0.0:8080:8080",
  );
  const tree = await createTopologyTree(fixtureTopology(), PINNED_MANIFEST, tampered);
  t.after(tree.cleanup);

  const report = await checkExposure(tree.root);

  assert.ok(report.problems.some((problem) => /does not match the topology/.test(problem)));
});

test("E0-005 a Compose file that cannot yet be generated is rejected as unverified", async (t) => {
  const manifest = {
    entries: { consoleImage: { status: "unselected", blockedBy: "E1-014" } },
  };
  const tree = await createTopologyTree(fixtureTopology(), manifest, "services: {}\n");
  t.after(tree.cleanup);

  const report = await checkExposure(tree.root);

  assert.ok(report.problems.some((problem) => /unverified/.test(problem)));
});

test("E0-005 the exposure check fails closed on an invalid topology", async (t) => {
  const tree = await createTopologyTree(
    mutated((topology) => {
      topology.services.console.published_ports[0].host_ip = "0.0.0.0";
    }),
    PINNED_MANIFEST,
  );
  t.after(tree.cleanup);

  const report = await checkExposure(tree.root);

  assert.ok(report.problems.some((problem) => /host_ip/.test(problem)));
});

test("E0-005 the exposure check fails closed on unreadable inputs", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "security-lab-e0-005e-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const report = await checkExposure(root);

  assert.ok(report.problems.some((problem) => /unusable/.test(problem)));
});

test("E0-005 a byte order mark does not break contract parsing", () => {
  assert.deepEqual(parseJson('﻿{"a":1}'), { a: 1 });
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
});
