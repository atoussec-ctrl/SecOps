// Contract validation (backlog E0-003).
//
// Every repository-owned JSON Schema must compile, and every sample document
// must satisfy the schema it claims to demonstrate. A sample that no longer
// matches its contract is how an unsafe template reaches an operator.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { SchemaError, assertSchema, parseJson, validate } from "./schema.mjs";

const SCHEMA_SUFFIX = ".schema.json";
const SAMPLES_DIRECTORY = "samples";

async function walkDirectories(directory, visit) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await visit(absolute, entry.name);
      await walkDirectories(absolute, visit);
    }
  }
}

async function readJson(file) {
  return parseJson(await readFile(file, "utf8"));
}

async function collectSchemaFiles(directory, found = []) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await collectSchemaFiles(absolute, found);
    } else if (entry.isFile() && entry.name.endsWith(SCHEMA_SUFFIX)) {
      found.push(absolute);
    }
  }

  return found;
}

async function checkSampleGroup(root, samplesDirectory, problems) {
  const contractDirectory = path.dirname(samplesDirectory);
  const entries = await readdir(samplesDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const relative = path
      .relative(root, path.join(samplesDirectory, entry.name))
      .replaceAll("\\", "/");

    // Samples are grouped in a directory named after their schema so the
    // mapping is explicit rather than guessed.
    if (!entry.isDirectory()) {
      problems.push(`${relative}: samples must sit in a directory named after their schema`);
      continue;
    }

    const schemaPath = path.join(contractDirectory, `${entry.name}${SCHEMA_SUFFIX}`);
    let schema;

    try {
      schema = await readJson(schemaPath);
    } catch {
      problems.push(
        `${relative}: no schema at ${path.relative(root, schemaPath).replaceAll("\\", "/")}`,
      );
      continue;
    }

    const samples = await readdir(path.join(samplesDirectory, entry.name), {
      withFileTypes: true,
    });
    const documents = samples.filter(
      (sample) => sample.isFile() && sample.name.endsWith(".json"),
    );

    if (documents.length === 0) {
      problems.push(`${relative}: sample group contains no documents`);
      continue;
    }

    for (const document of documents) {
      const documentPath = path.join(samplesDirectory, entry.name, document.name);
      const documentRelative = path.relative(root, documentPath).replaceAll("\\", "/");

      try {
        const instance = await readJson(documentPath);

        for (const error of validate(schema, instance)) {
          problems.push(`${documentRelative}: ${error.path} ${error.message}`);
        }
      } catch (error) {
        problems.push(`${documentRelative}: ${error.message}`);
      }
    }
  }
}

export async function checkContracts(root) {
  const problems = [];
  const contractsDirectory = path.join(root, "packages", "contracts");

  let schemaFiles;

  try {
    schemaFiles = await collectSchemaFiles(contractsDirectory);
  } catch {
    return ["packages/contracts is unreadable"];
  }

  for (const schemaFile of schemaFiles) {
    const relative = path.relative(root, schemaFile).replaceAll("\\", "/");

    try {
      assertSchema(await readJson(schemaFile));
    } catch (error) {
      const label = error instanceof SchemaError ? "invalid schema" : "unreadable";
      problems.push(`${relative}: ${label}: ${error.message}`);
    }
  }

  await walkDirectories(contractsDirectory, async (absolute, name) => {
    if (name === SAMPLES_DIRECTORY) {
      await checkSampleGroup(root, absolute, problems);
    }
  });

  return problems.sort();
}
