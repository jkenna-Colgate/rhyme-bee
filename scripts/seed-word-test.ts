/**
 * Run the Seed Word test over every place in the Schedule (#264).
 *
 *   npm run seeds:test            # say what would change
 *   npm run seeds:test -- --write # and write it to data/schedule.json
 *
 * Read off the built Rhyme Index, so run `npm run build:index` first. The test
 * is not run at every build (ADR-0012, amended 2026-10-14): it is run once over
 * the Schedule, and again after a reading lands on a scheduled Seed Word, which
 * the Editor's Pass says when it happens. The run is `runSeedWordTest`
 * (`src/seedWordRun.ts`); this file only reads, prints and writes.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchedule } from "../src/schedule.ts";
import { deserialise, type SerialisedIndex } from "../src/serialise.ts";
import { runSeedWordTest } from "../src/seedWordRun.ts";
import { indexArtifactPath } from "./indexArtifact.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const write = process.argv.includes("--write");
const schedulePath = resolve(root, "data", "schedule.json");
const raw = JSON.parse(readFileSync(schedulePath, "utf8")) as Record<string, unknown>;
const schedule = parseSchedule(raw);
if (schedule === null) {
  console.error(`${schedulePath} is not a readable schedule.`);
  process.exit(1);
}
const index = deserialise(
  JSON.parse(readFileSync(indexArtifactPath(resolve(root, "dist-data")), "utf8")) as SerialisedIndex,
);

const run = runSeedWordTest(schedule.days, index);
console.log(
  `Seed Word test: ${schedule.days.length} scheduled days, ${run.changes.length} Seed Word(s) changed, ` +
    `${run.freePlay.length} Free Play.`,
);
for (const { date, why, before, after } of run.changes) {
  console.log(
    `  ${date} ${before.weekday}  ${before.seed} -> ${after.seed} on ${after.rhymeKey} (${why}; ` +
      `${before.answerCount} -> ${after.answerCount} Answers, Difficulty ${before.difficulty} -> ${after.difficulty})`,
  );
}
for (const { date, seed, rhymeKey, detail } of run.freePlay) {
  console.log(`  Free Play ${date}: ${seed} on ${rhymeKey}. ${detail}`);
}

if (write && run.changes.length > 0) {
  writeFileSync(schedulePath, `${JSON.stringify({ ...raw, days: run.days }, null, 2)}\n`);
  console.log(`Wrote ${schedulePath}.`);
} else if (run.changes.length > 0) {
  console.log("Nothing written. Pass --write to write these to data/schedule.json.");
}
