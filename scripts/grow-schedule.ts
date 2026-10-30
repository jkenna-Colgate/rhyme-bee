/**
 * Grow the Schedule by whole weeks (#271, ADR-0012 amended 2026-10-11).
 *
 *   npm run schedule:grow -- [word ...] [--band MIN,MAX]           # say what would change
 *   npm run schedule:grow -- [word ...] [--band MIN,MAX] --write   # and write data/schedule.json
 *
 * Takes the Seed Words named, and every Seed Word `data/batches.json` says
 * passed Trust in its last Batch and holds no place (the spares an earlier
 * growth left). Its last Batch must have passed No False Accepts too, and a
 * word given its Batch with `batch --seeds` is how one that holds no place gets
 * one. Each must pin on the Rhyme Key its Batch played, pass the Seed Word
 * test, land in the size band (the Schedule's own, or `--band`, which is then
 * recorded), and hold no place another day holds. Those that do are dealt into
 * whole weeks and placed after the week in progress; the rest of a week waits.
 *
 * The maintainer runs it, present: nothing calls it unattended. Read off the
 * built Rhyme Index, so run `npm run build:index` first. The rules are
 * `growSchedule` (`src/scheduleGrowth.ts`); this file reads, prints and writes.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseBatchRecord } from "../src/batch.ts";
import { addDays, localCalendarDate, type SizeBand } from "../src/schedule.ts";
import { growSchedule } from "../src/scheduleGrowth.ts";
import { loadIndex, readScheduleFile, writeScheduleFile } from "./judgeRun.ts";
import { root } from "./modelCall.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const bandAt = args.indexOf("--band");
let band: SizeBand | undefined;
if (bandAt !== -1) {
  const [min, max] = (args[bandAt + 1] ?? "").split(",").map(Number);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min! > max!) {
    console.error("--band takes MIN,MAX, two whole numbers, the smaller first (--band 10,120).");
    process.exit(1);
  }
  band = { min: min!, max: max! };
}
const named = args.filter((a, i) => !a.startsWith("--") && (bandAt === -1 || i !== bandAt + 1));

const { raw, schedule } = readScheduleFile();
const batchesPath = resolve(root, "data", "batches.json");
const record = parseBatchRecord(existsSync(batchesPath) ? readFileSync(batchesPath, "utf8") : null);

// A player east of the maintainer may already be on tomorrow, and that day's
// week is the one in progress for them.
const today = addDays(localCalendarDate(), 1);
const growth = growSchedule(schedule, loadIndex(), record, named, { today, band });

for (const { seed, named: asked, reasons } of growth.refused) {
  console.log(`Refused ${seed}${asked ? "" : " (waiting in data/batches.json)"}:`);
  for (const reason of reasons) console.log(`  ${reason}`);
}
if (growth.added.length > 0) {
  console.log(`${growth.added.length / 7} week(s) from ${growth.at}:`);
  for (const d of growth.added) {
    console.log(`  ${d.date} ${d.weekday}  ${d.seed.padEnd(14)} ${String(d.answerCount).padStart(4)} Answers  Difficulty ${d.difficulty}  ${d.rhymeKey}`);
  }
}
if (growth.spares.length > 0) {
  console.log(`Waiting for a whole week (${growth.spares.length} of 7): ${growth.spares.join(", ")}.`);
}

if (growth.grown === null) {
  const refusedNamed = growth.refused.some((r) => r.named);
  const why = refusedNamed ? "a Seed Word named was refused" : "fewer than seven Seed Words may join";
  console.log(`The Schedule is unchanged: ${why}.`);
  process.exit(refusedNamed ? 1 : 0);
}
if (!write) {
  console.log(`Nothing written. The lap would start ${growth.grown.lapStart}; pass --write to write data/schedule.json.`);
} else {
  const { lapStart, band: dealtBand, days } = growth.grown;
  const path = writeScheduleFile(raw, { lapStart, band: dealtBand, days });
  console.log(`Wrote ${path}: ${days.length} days, the lap from ${lapStart}.`);
}
