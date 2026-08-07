/**
 * The deploy, and the one decision it makes for itself:
 *
 *   npm run deploy
 *
 * Rebuild the Rhyme Index, build the web bundle, upload. The rebuild is four
 * minutes and the other two are seconds, and a great many deploys do not need
 * it — a Seed Word swap changes `data/schedule.json`, which the Index never
 * reads, so the bundle is the only thing that has to change.
 *
 * **There is exactly one deploy command and no fast-path flag.** The editor
 * should not have to be right about which kind of change they just made, at
 * speed, at night; `indexStaleness` decides, and errs toward rebuilding, so the
 * worst case is a wasted four minutes rather than a bundle shipping a judge
 * that predates the fix it was made for.
 *
 * A shell with no logic of its own: the predicate is in `indexArtifact.ts` and
 * tested there, and this runs the same three npm scripts in the same order the
 * one-liner did.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { indexStaleness } from "./indexArtifact.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const staleness = indexStaleness(root);
if (staleness.stale) {
  console.log(`Rebuilding the Rhyme Index: ${explain(staleness.reason, staleness.input)}.`);
  run("npm run build:index");
} else {
  console.log("Skipping the Rhyme Index rebuild: no Index input has changed since it was built.");
}

run("npm run --prefix web build");
run("npm run --prefix web deploy");

/** Why the rebuild is happening, so a four-minute wait is never a mystery. */
function explain(reason: string | null, input: string | undefined): string {
  const name = input === undefined ? "" : ` (${resolve(input).slice(root.length + 1)})`;
  switch (reason) {
    case "no-artifact":
      return "no index has been built here yet";
    case "missing-input":
      return `an input is missing${name}`;
    default:
      return `an input is newer than the artifact${name}`;
  }
}

function run(command: string): void {
  const { status } = spawnSync(command, { shell: true, stdio: "inherit" });
  if (status !== 0) {
    console.error(`Deploy stopped: \`${command}\` exited ${status ?? "on a signal"}.`);
    process.exit(status ?? 1);
  }
}
