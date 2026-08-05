// Mutation testing for security-critical modules (docs/06-testing/02-tdd-coverage-mutation.md).
//
// Coverage says a line ran. It does not say a test would have noticed the line
// being wrong. For the Scope Guard that difference is the whole point, so each
// safety property is written down as the edit that removes it and the suite has
// to fail when the edit is present.
//
// Nothing is mutated in place. The module tree is copied to a temporary
// directory and the copy is edited, so an interrupted run cannot leave a
// deliberate defect in the working tree.

import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseJson, validate } from "./schema.mjs";

const CATALOGUE = path.join(
  "packages",
  "contracts",
  "testing",
  "samples",
  "mutant-catalogue",
  "orchestrator-scope.json",
);

const SCHEMA = path.join(
  "packages",
  "contracts",
  "testing",
  "mutant-catalogue.schema.json",
);

async function readCatalogue(root) {
  const catalogue = parseJson(await readFile(path.join(root, CATALOGUE), "utf8"));
  const schema = parseJson(await readFile(path.join(root, SCHEMA), "utf8"));
  const problems = validate(schema, catalogue);

  if (problems.length > 0) {
    throw new Error(
      `mutant catalogue is invalid: ${problems.map((p) => `${p.path} ${p.message}`).join("; ")}`,
    );
  }

  return catalogue;
}

function runSuite(interpreter, command, cwd) {
  const result = spawnSync(interpreter, command, { cwd, encoding: "utf8" });

  if (result.error) {
    return { ran: false, passed: false, detail: result.error.message };
  }

  return { ran: true, passed: result.status === 0, detail: result.stderr };
}

export async function checkMutation(root, interpreter = process.env.PYTHON ?? "python3") {
  const catalogue = await readCatalogue(root);
  const source = path.join(root, catalogue.suite.root);
  const problems = [];
  const survivors = [];

  // A suite that fails before anything is mutated makes every mutant look
  // killed, which would report a perfect score for a broken module.
  const baseline = runSuite(interpreter, catalogue.suite.command, source);

  if (!baseline.ran) {
    return { problems: [`the suite could not start: ${baseline.detail}`] };
  }

  if (!baseline.passed) {
    return { problems: ["the suite fails before any mutation; fix it first"] };
  }

  // One copy for the whole catalogue rather than one per mutant. Copying the
  // module tree ninety times dominated the runtime and bought nothing: each
  // mutant edits one file and the original is written back before the next, so
  // the copy is only ever holding one deliberate defect at a time. The working
  // tree is still never touched, which is the property that matters.
  const workspace = await mkdtemp(path.join(tmpdir(), "mutation-"));

  try {
    await cp(source, workspace, {
      recursive: true,
      filter: (entry) => !entry.includes("__pycache__"),
    });

    for (const [index, mutant] of catalogue.mutants.entries()) {
      const file = path.join(workspace, mutant.file);
      const original = await readFile(file, "utf8");

      // An anchor that no longer matches is a silent pass: the suite runs
      // against unmutated code and the mutant is recorded as killed.
      if (!original.includes(mutant.find)) {
        problems.push(
          `mutant ${index + 1} (${mutant.file}) no longer matches its source; ` +
            "the catalogue is describing code that has changed",
        );
        continue;
      }

      await writeFile(file, original.replace(mutant.find, mutant.replace));

      let mutated;

      try {
        mutated = runSuite(interpreter, catalogue.suite.command, workspace);
      } finally {
        // Restored before the next mutant whatever happened, so two deliberate
        // defects can never be present at once.
        await writeFile(file, original);
      }

      if (!mutated.ran) {
        problems.push(`mutant ${index + 1} could not run: ${mutated.detail}`);
        continue;
      }

      if (mutated.passed) {
        survivors.push(`${mutant.file}: ${mutant.property}`);
      }
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  const total = catalogue.mutants.length;
  const killed = total - survivors.length;
  const score = Math.floor((100 * killed) / total);

  if (problems.length === 0 && score < catalogue.threshold_percent) {
    problems.push(
      `mutation score ${score}% is below the required ${catalogue.threshold_percent}%`,
    );
  }

  for (const survivor of survivors) {
    problems.push(`survived: ${survivor}`);
  }

  return { problems, note: `${killed}/${total} mutants killed (${score}%)` };
}
