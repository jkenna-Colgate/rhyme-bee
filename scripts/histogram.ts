/**
 * Answer ADR-0004's open question: how many playable Rhyme Keys does English
 * contain? Runs the production `buildPuzzle` path over every distinct Rhyme Key
 * and prints the family-size histogram plus the candidate Seed Word count.
 *
 *   npm run histogram
 *
 * Requires the built artifact from `npm run build:index`.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RhymeIndex } from "../src/rhymeIndex.ts";
import { deserialise, type SerialisedIndex } from "../src/serialise.ts";
import { curate } from "../src/curation.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = JSON.parse(
  readFileSync(resolve(root, "dist-data/index.json"), "utf8"),
) as SerialisedIndex;

const index: RhymeIndex = deserialise(artifact);

const MIN = Number(process.env.BAND_MIN ?? "20");
const MAX = Number(process.env.BAND_MAX ?? "120");

const report = curate(index, { sizeBand: { min: MIN, max: MAX } });

console.log(`Distinct Rhyme Keys: ${report.families.length}`);
console.log(`Candidate Seed Words in band [${MIN}, ${MAX}]: ${report.candidates.length}`);
console.log("");
console.log("Answers  Families");
for (const count of [...report.histogram.keys()].sort((a, b) => a - b)) {
  const families = report.histogram.get(count)!;
  console.log(`${String(count).padStart(7)}  ${"#".repeat(Math.min(families, 60))} ${families}`);
}
