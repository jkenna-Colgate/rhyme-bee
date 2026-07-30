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
import { parseCmudict } from "../src/cmudict.ts";
import { applyCoverage } from "../src/coverage.ts";
import { applyDemotions } from "../src/demotions.ts";
import { applyNormalisation } from "../src/normalise.ts";
import { parsePrevalenceCsv, parseWordList } from "../src/pipeline.ts";
import { serialise } from "../src/serialise.ts";
import { applySupplement } from "../src/supplement.ts";
import type { RhymeIndexData } from "../src/rhymeIndex.ts";

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

const pronunciations = parseCmudict(read("cmudict.dict"));
const words = parseWordList(read("words.txt"));
const names = parseWordList(read("names.txt"));
const prevalence = parsePrevalenceCsv(read("prevalence.csv"));

// The committed demotion list (#90), applied *first*, so every stage below reads
// a corrected word list rather than working around it: the upstream wordhood
// list carries surnames and placenames, and the gate tests wordhood before
// name-hood, so `algiers` was being served as an ordinary Answer. Running here
// means the supplement's standing refusal to launder a name into a word covers
// demoted names too. See src/demotions.ts.
const demoted = applyDemotions(read("demotions.txt"), { words, names });

// The committed human override layer (ADR-0009), merged over the pinned upstream
// inputs: it adds missing words (with a reading) and corrects mis-marked stress,
// and — unlike everything else in data/ — it survives this rebuild.
applySupplement(read("supplement.dict"), { pronunciations, words, names });

// Tier 1 coverage (issue #76): a known word with no reading is given one,
// composed from a stem the build already reads. It runs *after* the supplement,
// so a hand-authored reading always beats a composed one, and supplies readings
// only — never wordhood. See src/coverage.ts.
const derived = applyCoverage({ pronunciations, words, names, prevalence });

// The accent specification (ADR-0010), applied to every reading before any Rhyme
// Key is computed. It runs *last* so a hand-authored or derived reading is an
// input to the accent rather than an exemption from it. See src/normalise.ts.
applyNormalisation({ pronunciations });

const data: RhymeIndexData = { pronunciations, words, names, prevalence };

// Dropped-words report (story 40): every CMUdict surface form that will never be
// a valid Submission, and why — so over-aggressive filtering is visible.
const dropped: { word: string; reason: "proper-noun" | "not-in-word-list" }[] = [];
for (const word of pronunciations.keys()) {
  if (words.has(word)) continue;
  dropped.push({ word, reason: names.has(word) ? "proper-noun" : "not-in-word-list" });
}
dropped.sort((a, b) => a.word.localeCompare(b.word));

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
  `Built index: ${pronunciations.size} pronunciations, ${words.size} words, ` +
    `${prevalence.size} prevalence entries, ${derived.length} derived, ` +
    `${dropped.length} dropped. Threshold ${KNOWNNESS_THRESHOLD}.`,
);

// A demotion whose word the upstream list no longer holds is dead weight, and
// the file is hand-maintained, so say so rather than letting it accumulate.
const stale = demoted.filter((d) => !d.hadWordhood);
console.log(
  `Demoted ${demoted.length} words (${demoted.filter((d) => d.reason === "proper-noun").length} ` +
    `proper nouns)${stale.length > 0 ? `; ${stale.length} stale: ${stale.map((d) => d.word).join(", ")}` : ""}.`,
);
