// Private lab topology policy and Compose rendering (backlog E0-005).
//
// The Compose file is generated from infra/compose/lab-topology.json rather than
// hand-written, so the exposure assertion runs against a validated structure.
// A hand-edited Compose file cannot introduce a public bind without failing the
// drift check in checkExposure.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseJson, validate } from "./schema.mjs";

export const COMPOSE_FILE = "docker-compose.lab.yaml";

const PUBLISHING_ROLES = new Set(["console", "control-plane"]);

const GENERATED_HEADER = [
  "# Generated from infra/compose/lab-topology.json by tools/topology.mjs.",
  "# Do not edit by hand: `node tools/repo.mjs check:exposure` fails when this",
  "# file differs from the topology it is rendered from.",
];

function problemsForNetworks(topology) {
  const problems = [];
  const names = Object.keys(topology.networks);

  if (names.length === 0) {
    problems.push("topology declares no networks");
  }

  const external = names.filter((name) => topology.networks[name].internal === false);

  if (external.length > 1) {
    problems.push(
      `only one ingress network is permitted, found ${external.sort().join(", ")}`,
    );
  }

  return problems;
}

function problemsForService(name, service, topology) {
  const problems = [];
  const declared = new Set(Object.keys(topology.networks));

  for (const network of service.networks) {
    if (!declared.has(network)) {
      problems.push(`service "${name}" attaches to undeclared network "${network}"`);
    }
  }

  for (const dependency of service.depends_on ?? []) {
    if (!Object.hasOwn(topology.services, dependency)) {
      problems.push(`service "${name}" depends on undeclared service "${dependency}"`);
    }
  }

  const reachesHost = service.networks.some(
    (network) => topology.networks[network]?.internal === false,
  );

  // Only the console and control API may be reachable from the host, and only
  // over loopback (docs/02-architecture/04-runtime-deployment.md).
  if (reachesHost && !PUBLISHING_ROLES.has(service.role)) {
    problems.push(
      `service "${name}" has role "${service.role}" and must not attach to an ingress network`,
    );
  }

  if (service.published_ports.length > 0 && !PUBLISHING_ROLES.has(service.role)) {
    problems.push(
      `service "${name}" has role "${service.role}" and must not publish a host port`,
    );
  }

  if (service.published_ports.length > 0 && !reachesHost) {
    problems.push(
      `service "${name}" publishes a host port without attaching to an ingress network`,
    );
  }

  return problems;
}

function problemsForPorts(topology) {
  const problems = [];
  const claimed = new Map();

  for (const [name, service] of Object.entries(topology.services)) {
    for (const published of service.published_ports) {
      const key = `${published.host_ip}:${published.host_port}`;
      const owner = claimed.get(key);

      if (owner === undefined) {
        claimed.set(key, name);
      } else {
        problems.push(`host port ${key} is claimed by both "${owner}" and "${name}"`);
      }
    }
  }

  return problems;
}

const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;

// Container images are referenced by immutable digest, never by tag
// (adrs/007-pinned-artifacts.md). A tag can be moved; a digest cannot.
export function resolveImage(imageRef, manifest) {
  const entry = manifest.entries?.[imageRef];

  if (entry === undefined) {
    return { state: "unknown" };
  }

  if (entry.status !== "pinned") {
    return { state: "deferred", blockedBy: entry.blockedBy };
  }

  if (
    typeof entry.image !== "string" ||
    entry.image.length === 0 ||
    !IMAGE_DIGEST.test(`${entry.digest}`)
  ) {
    return { state: "unpinned" };
  }

  return { state: "resolved", image: `${entry.image}@${entry.digest}` };
}

export function checkTopologyPolicy(topology, manifest) {
  const problems = [...problemsForNetworks(topology), ...problemsForPorts(topology)];

  if (Object.keys(topology.services).length === 0) {
    problems.push("topology declares no services");
  }

  for (const [name, service] of Object.entries(topology.services)) {
    problems.push(...problemsForService(name, service, topology));

    const resolved = resolveImage(service.image_ref, manifest);

    if (resolved.state === "unknown") {
      problems.push(
        `service "${name}" references image "${service.image_ref}", which is not in the version manifest`,
      );
    } else if (resolved.state === "unpinned") {
      problems.push(
        `service "${name}" references entry "${service.image_ref}", which declares no image name and sha256 digest`,
      );
    }
  }

  return problems.sort();
}

export function deferredImages(topology, manifest) {
  const deferred = new Map();

  for (const service of Object.values(topology.services)) {
    const resolved = resolveImage(service.image_ref, manifest);

    if (resolved.state === "deferred") {
      deferred.set(service.image_ref, resolved.blockedBy);
    }
  }

  return [...deferred]
    .map(([id, blockedBy]) => ({ id, blockedBy }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// A narrow emitter for the shape above rather than a general YAML serializer:
// every value written here is a validated string, integer or boolean.
export function renderCompose(topology, manifest) {
  const lines = [...GENERATED_HEADER, "", `name: ${topology.project_name}`, "", "networks:"];

  for (const [name, network] of Object.entries(topology.networks)) {
    lines.push(`  ${name}:`, `    internal: ${network.internal}`);
  }

  lines.push("", "services:");

  for (const [name, service] of Object.entries(topology.services)) {
    const resolved = resolveImage(service.image_ref, manifest);

    if (resolved.state !== "resolved") {
      throw new Error(
        `cannot render service "${name}": image "${service.image_ref}" is ${resolved.state}`,
      );
    }

    lines.push(
      `  ${name}:`,
      `    image: "${resolved.image}"`,
      "    read_only: true",
      `    user: "${service.runtime.user}"`,
      "    cap_drop:",
      "      - ALL",
      "    security_opt:",
      '      - "no-new-privileges:true"',
      `    mem_limit: ${service.runtime.memory_limit_mb}m`,
      `    cpus: "${service.runtime.cpu_limit}"`,
      `    pids_limit: ${service.runtime.pids_limit}`,
      "    networks:",
    );

    for (const network of service.networks) {
      lines.push(`      - ${network}`);
    }

    if ((service.depends_on ?? []).length > 0) {
      lines.push("    depends_on:");
      for (const dependency of service.depends_on) {
        lines.push(`      - ${dependency}`);
      }
    }

    if (service.published_ports.length > 0) {
      lines.push("    ports:");
      for (const published of service.published_ports) {
        lines.push(
          `      - "${published.host_ip}:${published.host_port}:${published.container_port}"`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

async function readJson(file) {
  return parseJson(await readFile(file, "utf8"));
}

export async function checkExposure(root) {
  const composePath = path.join(root, "infra", "compose", COMPOSE_FILE);
  let topology;
  let schema;
  let manifest;

  try {
    topology = await readJson(path.join(root, "infra", "compose", "lab-topology.json"));
    schema = await readJson(
      path.join(root, "packages", "contracts", "infra", "lab-topology.schema.json"),
    );
    manifest = await readJson(path.join(root, "version-manifest.json"));
  } catch (error) {
    return { problems: [`topology inputs are unusable: ${error.message}`], deferred: [] };
  }

  const schemaProblems = validate(schema, topology).map(
    (error) => `lab-topology.json: ${error.path} ${error.message}`,
  );

  if (schemaProblems.length > 0) {
    return { problems: schemaProblems.sort(), deferred: [] };
  }

  const problems = checkTopologyPolicy(topology, manifest);
  const deferred = deferredImages(topology, manifest);
  const composeExists = await readFile(composePath, "utf8").then(
    (contents) => contents,
    () => null,
  );

  if (deferred.length > 0) {
    // Rendering is impossible until every image is pinned. A Compose file
    // present anyway did not come from this topology and is not covered by the
    // exposure assertion.
    if (composeExists !== null) {
      problems.push(
        `infra/compose/${COMPOSE_FILE} exists but cannot be generated yet, so it is unverified`,
      );
    }
  } else if (problems.length === 0) {
    const rendered = renderCompose(topology, manifest);

    if (composeExists === null) {
      problems.push(`infra/compose/${COMPOSE_FILE} is missing`);
    } else if (composeExists !== rendered) {
      problems.push(
        `infra/compose/${COMPOSE_FILE} does not match the topology it is rendered from`,
      );
    }
  }

  return { problems: problems.sort(), deferred };
}
