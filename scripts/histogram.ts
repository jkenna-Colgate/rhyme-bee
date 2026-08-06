/**
 * Answer ADR-0004's open question: how many playable Rhyme Keys does English
 * contain? Runs the production `buildPuzzle` path over every distinct Rhyme Key
 * and prints the family-size histogram plus the candidate Seed Word count.
 *
 *   npm run histogram
 *
 * The candidate size band is set by the BAND_MIN / BAND_MAX env vars, defaulting
 * to the shared `DEFAULT_PLAYABLE_BAND` rather than a second copy of the numbers;
 * a Rhyme Key counts as a candidate when its Answer count falls in
 * [BAND_MIN, BAND_MAX].
 *
 * Requires the built artifact from `npm run build:index`.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RhymeIndex } from "../src/rhymeIndex.ts";
import { deserialise, type SerialisedIndex } from "../src/serialise.ts";
import { curate, DEFAULT_PLAYABLE_BAND } from "../src/curation.ts";
import { indexArtifactPath } from "./indexArtifact.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = JSON.parse(
  readFileSync(indexArtifactPath(resolve(root, "dist-data")), "utf8"),
) as SerialisedIndex;

const index: RhymeIndex = deserialise(artifact);

const MIN = Number(process.env.BAND_MIN ?? DEFAULT_PLAYABLE_BAND.min);
const MAX = Number(process.env.BAND_MAX ?? DEFAULT_PLAYABLE_BAND.max);

const report = curate(index, { sizeBand: { min: MIN, max: MAX } });

console.log(`Distinct Rhyme Keys: ${report.families.length}`);
console.log(`Candidate Seed Words in band [${MIN}, ${MAX}]: ${report.candidates.length}`);
console.log("");

const merged = report.families.filter((f) => f.mergedKeys.length > 0);
console.log(`Schwa Twin merges (issue #110): ${merged.length}`);
for (const family of merged) {
  console.log(`  ${family.rhymeKey} absorbed ${family.mergedKeys.join(", ")} (${family.representative})`);
}
console.log("");
console.log("Answers  Families");
for (const count of [...report.histogram.keys()].sort((a, b) => a - b)) {
  const families = report.histogram.get(count)!;
  console.log(`${String(count).padStart(7)}  ${"#".repeat(Math.min(families, 60))} ${families}`);
}
