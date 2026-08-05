/**
 * Generate the committed schedule from the built index.
 *
 *   npm run build:schedule -- 2026-08-03
 *
 * Writes `data/schedule.json` — date to Seed Word for the whole run — and prints
 * a review summary. This is a **one-time** artifact (ADR-0012): it is generated
 * once, read by a person, corrected by hand, and thereafter fixed. Rerunning it
 * after the review would discard those corrections, so it refuses to overwrite
 * an existing file without `--force`.
 *
 * The Seed pool it deals from is the ordinary curation path (`playableSeeds`),
 * so ADR-0004's size band and ADR-0008's Shadow Key filter still produce the
 * list. What ADR-0012 retires is the *next* automated gate, not these.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PLAYABLE_BAND, playableSeeds } from "../src/curation.ts";
import { dealSchedule, reviewSchedule } from "../src/schedule.ts";
import { DEFAULT_SCORING_CONFIG } from "../src/scoring.ts";
import { deserialise, type SerialisedIndex } from "../src/serialise.ts";
import { indexArtifactPath } from "./indexArtifact.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "data", "schedule.json");

const args = process.argv.slice(2);
const force = args.includes("--force");
const startDate = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

if (startDate === undefined) {
  console.error("Usage: npm run build:schedule -- YYYY-MM-DD [--force]  (start must be a Monday)");
  process.exit(1);
}
if (existsSync(out) && !force) {
  console.error(
    `${out} already exists.\n` +
      "The schedule is reviewed by hand and then fixed (ADR-0012); regenerating\n" +
      "would discard that review. Pass --force if you really mean to redeal.",
  );
  process.exit(1);
}

const artifact = JSON.parse(
  readFileSync(indexArtifactPath(resolve(root, "dist-data")), "utf8"),
) as SerialisedIndex;
const index = deserialise(artifact);

const seeds = playableSeeds(index, DEFAULT_PLAYABLE_BAND);
const deal = dealSchedule(seeds, startDate);
const { days } = deal;

writeFileSync(
  out,
  `${JSON.stringify(
    {
      generated: new Date().toISOString().slice(0, 10),
      startDate,
      band: DEFAULT_PLAYABLE_BAND,
      // Every day's Difficulty is a share of a Puzzle's maximum achievable
      // Score, so it means nothing without the configuration that scored it
      // (ADR-0007): retune the rare bonus or the rarity cutoff and every figure
      // below silently describes a different ramp. Recorded as it was passed to
      // curation, whole, so a reviewer can tell which ramp they approved.
      scoring: DEFAULT_SCORING_CONFIG,
      sources: artifact.sources,
      note: "Reviewed artifact (ADR-0012). Edit by hand; do not regenerate.",
      days: days.map((day) => ({
        date: day.date,
        weekday: day.weekday,
        week: day.week,
        seed: day.entry.representative,
        rhymeKey: day.entry.rhymeKey,
        answerCount: day.entry.answerCount,
        difficulty: Number(day.entry.difficulty.toFixed(4)),
      })),
    },
    null,
    2,
  )}\n`,
);

// --- Review summary -------------------------------------------------------
// The schedule only works if someone reads it, so print what a reviewer needs to
// decide, not just a success line. The judgement — the ramp, the short final
// week, which days to read first — is `reviewSchedule`, so it is tested; this
// formats what it is handed and does no filtering or arithmetic of its own.

const review = reviewSchedule(deal);

console.log(`Wrote ${out}`);
console.log(
  `  pool ${seeds.length} -> ${review.totalDays} days (${review.weeks} weeks), from ${startDate}`,
);
if (review.shortFinalWeek) {
  const { week, length, days: tail } = review.shortFinalWeek;
  const last = tail[tail.length - 1]!;
  console.log(
    `  week ${week} is short (${length} days, ends ${last.weekday} ` +
      `${last.date}): ${tail.map((d) => d.entry.representative).join(", ")}`,
  );
}

console.log("\nDifficulty band per weekday (the ramp):");
for (const { weekday, min, max } of review.ramp) {
  console.log(`  ${weekday}  ${min.toFixed(3)} – ${max.toFixed(3)}`);
}

// A Seed is shown *and spoken* to the player (ADR-0002), so a representative
// that is not a recognisable word is the failure the review exists to catch.
console.log(`\nReview first — ${review.flagged.length} of ${review.totalDays} days:`);
for (const day of review.flagged) {
  console.log(
    `  ${day.date} ${day.weekday}  ${day.entry.representative.padEnd(14)}` +
      `${String(day.entry.answerCount).padStart(4)} answers  ` +
      `${String(day.entry.nativeCount).padStart(3)} native  ${day.entry.rhymeKey}`,
  );
}
