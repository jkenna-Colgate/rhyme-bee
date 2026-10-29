/**
 * Move to Answer the Bonus Words enough players produce (#270, ADR-0015
 * amended), and report.
 *
 *   npm run tier:moves              replay, append the moves, report
 *   npm run tier:moves -- --dry-run  replay and report, write nothing
 *
 * Reads the Session Records `npm run records:pull` brought home, replays each
 * against the built Rhyme Index, and appends every new move to
 * `data/tier-moves.csv`. It never writes `data/tier-overrides.csv`. The next
 * `npm run build:index` merges the moves, over the editor's verdicts and under a
 * locked one.
 *
 * Non-interactive, so the monthly workflow (#274) can run it: it asks nothing,
 * exits 0 whether or not anything moved, and exits 1 only when a file it needs
 * cannot be read.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRhymeIndex } from "../src/loader.ts";
import { parsePrevalenceCsv, parseWordList } from "../src/pipeline.ts";
import { TIER_MOVES_HEADER } from "../src/tierMoves.ts";
import { indexArtifactPath } from "./indexArtifact.ts";
import { readPulledRecords, SESSION_RECORDS_DIR } from "./sessionRecordStore.ts";
import { runTierMoves } from "./tierMovesRun.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const movesPath = resolve(dataDir, "tier-moves.csv");
const dryRun = process.argv.includes("--dry-run");

/** What a new moves file opens with, so the file says what it is. */
const FILE_HEAD =
  "# Tier moves from Session Records (#270, ADR-0015 amended). Machine-written by\n" +
  "# `npm run tier:moves`; never hand-edited, and never by the Editor's Pass. Each\n" +
  "# row moves a Bonus Word to Answer: the build reads it over the editor's\n" +
  "# verdicts in data/tier-overrides.csv and under a locked one. Append-only:\n" +
  "# nothing here moves a word back. The columns after the word are the evidence.\n" +
  `${TIER_MOVES_HEADER}\n`;

function readOptional(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const pulled = readPulledRecords(resolve(root, SESSION_RECORDS_DIR));
const existing = readOptional(movesPath);

const run = runTierMoves({
  records: pulled.records,
  openIndex: () => loadRhymeIndex(indexArtifactPath(resolve(root, "dist-data"))),
  measured: parsePrevalenceCsv(readFileSync(resolve(dataDir, "prevalence.csv"), "utf8")),
  names: parseWordList(readFileSync(resolve(dataDir, "names.txt"), "utf8")),
  overrides: readOptional(resolve(dataDir, "tier-overrides.csv")),
  moves: existing,
  now: new Date().toISOString(),
});

for (const path of pulled.unreadable) console.log(`  ! ${path} holds no readable Session Record.`);
for (const line of run.report) console.log(line);

if (run.rows === "") {
  console.log("data/tier-moves.csv unchanged.");
} else if (dryRun) {
  console.log("Dry run: data/tier-moves.csv unchanged.");
} else if (existing.trim() === "") {
  writeFileSync(movesPath, FILE_HEAD + run.rows);
  console.log("Wrote data/tier-moves.csv. Rebuild the index to ship the moves.");
} else {
  appendFileSync(movesPath, (existing.endsWith("\n") ? "" : "\n") + run.rows);
  console.log("Appended to data/tier-moves.csv. Rebuild the index to ship the moves.");
}
