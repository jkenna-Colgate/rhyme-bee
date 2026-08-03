/**
 * Offline pipeline: build the Rhyme Index artifact from pinned raw data.
 *
 *   npm run build:index
 *
 * Reads the raw inputs from `data/` (uncommitted — see .gitignore and
 * data/README.md), writes the built artifact and the dropped-words and
 * derived-words reports to `dist-data/`. Rebuilding from the same pinned inputs
 * yields the same verdicts (story 35); nothing here touches the network.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manufactureIndexData } from "../src/manufacture.ts";
import { serialise } from "../src/serialise.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const outDir = resolve(root, "dist-data");

// Default sits between the two probe words so `defenestrate` (+0.25) is an
// Answer and `objurgate` (-0.43) is a Bonus Word — see ADR-0003's Resolution.
// Still tunable per build via the env var, and to be sharpened by human review.
const KNOWNNESS_THRESHOLD = Number(process.env.KNOWNNESS_THRESHOLD ?? "0.0");

function read(name: string): string {
  return readFileSync(resolve(dataDir, name), "utf8");
}

const sources = JSON.parse(read("sources.json")) as Record<string, string>;

// The whole stage order lives behind this one call — demotions, supplement,
// coverage, normalisation — so the script cannot run them out of turn, twice, or
// not at all. Its job from here is files in, files out. See src/manufacture.ts.
const { data, demoted, derived, dropped } = manufactureIndexData({
  cmudict: read("cmudict.dict"),
  words: read("words.txt"),
  names: read("names.txt"),
  prevalence: read("prevalence.csv"),
  demotions: read("demotions.txt"),
  supplement: read("supplement.dict"),
});

mkdirSync(outDir, { recursive: true });
writeFileSync(
  resolve(outDir, "index.json"),
  JSON.stringify(serialise(data, { knownnessThreshold: KNOWNNESS_THRESHOLD }, sources)),
);
writeFileSync(resolve(outDir, "dropped-report.json"), JSON.stringify(dropped, null, 2));

// Derived-words report (issue #76): every word coverage derivation gave a
// reading to, its stem, and the rule that produced it — so over-generation is
// visible rather than buried in the index.
writeFileSync(resolve(outDir, "derived-report.json"), JSON.stringify(derived, null, 2));

console.log(
  `Built index: ${data.pronunciations.size} pronunciations, ${data.words.size} words, ` +
    `${data.prevalence.size} prevalence entries, ${derived.length} derived, ` +
    `${dropped.length} dropped. Threshold ${KNOWNNESS_THRESHOLD}.`,
);

// A demotion whose word the upstream list no longer holds is dead weight, and
// the file is hand-maintained, so say so rather than letting it accumulate.
const stale = demoted.filter((d) => !d.hadWordhood);
console.log(
  `Demoted ${demoted.length} words (${demoted.filter((d) => d.reason === "proper-noun").length} ` +
    `proper nouns)${stale.length > 0 ? `; ${stale.length} stale: ${stale.map((d) => d.word).join(", ")}` : ""}.`,
);
