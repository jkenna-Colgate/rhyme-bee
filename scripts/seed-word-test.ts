/**
 * Run the Seed Word test over every place in the Schedule (#264), and repair
 * the days whose Seed Word fails it.
 *
 *   npm run seeds:test                       # say what would change
 *   npm run seeds:test -- --write            # and write the repairs to data/schedule.json
 *   npm run seeds:test -- --re-rank [--write]  # also re-rank passing days, as #264 did once
 *
 * Read off the built Rhyme Index, so run `npm run build:index` first. The test
 * is not run at every build (ADR-0012, amended 2026-10-14): it was run once over
 * the Schedule, and is run again after a reading lands on a scheduled Seed
 * Word, which the Editor's Pass says when it happens. A run repairs a failing
 * day and never moves one that passes. The ranking ran once, in #264, and some
 * of its picks were then corrected by hand, so `--re-rank`, which would undo
 * them, has to be named. The run is `runSeedWordTest` (`src/seedWordRun.ts`);
 * this file only reads, prints and writes.
 */

import { runSeedWordTest } from "../src/seedWordRun.ts";
import { loadIndex, readScheduleFile, writeScheduleFile } from "./judgeRun.ts";

const write = process.argv.includes("--write");
const reRank = process.argv.includes("--re-rank");
const { raw, schedule } = readScheduleFile();

const run = runSeedWordTest(schedule.days, loadIndex(), { reRank });
console.log(
  `Seed Word test: ${schedule.days.length} scheduled days, ${run.changes.length} Seed Word(s) changed, ` +
    `${run.freePlay.length} Free Play${reRank ? " (re-ranking passing days too)" : ""}.`,
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
  console.log(`Wrote ${writeScheduleFile(raw, { days: run.days })}.`);
} else if (run.changes.length > 0) {
  console.log("Nothing written. Pass --write to write these to data/schedule.json.");
}
