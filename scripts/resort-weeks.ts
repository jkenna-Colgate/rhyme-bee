/**
 * Re-sort each week of the Schedule by the built index's Difficulty (#312).
 *
 *   npm run schedule:resort                         # say what would move
 *   npm run schedule:resort -- --write              # and write data/schedule.json
 *   npm run schedule:resort -- --today 2026-11-10   # the week held still, by default today's
 *
 * Read off the built Rhyme Index, so run `npm run build:index` first. Difficulty
 * is measured as the Tier sitting measures it (`consequencesAt`), at the lines
 * the index ships with. ADR-0012 (amended 2026-11-10) records the run made when
 * the lines moved as a one-off exception to "a place keeps its weekday"; the
 * re-sort is `resortWeeks` (`src/scheduleResort.ts`), and this file only reads,
 * prints and writes.
 */

import { placeCollisions } from "../src/continuity.ts";
import { DAYS_PER_WEEK, localCalendarDate, parseSchedule, weekdayOf, WEEKDAYS, type Weekday } from "../src/schedule.ts";
import { playedWeekOf, resortWeeks, type Measured } from "../src/scheduleResort.ts";
import { DEFAULT_SCORING_CONFIG } from "../src/scoring.ts";
import { consequencesAt } from "../src/tierSitting.ts";
import { loadIndex, readScheduleFile, writeScheduleFile } from "./judgeRun.ts";
import { sittingDays } from "./sittingDays.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const todayAt = args.indexOf("--today");
const today = todayAt === -1 ? localCalendarDate() : args[todayAt + 1]!;

const index = loadIndex();
const { raw, schedule } = readScheduleFile();
const lines = { answerLine: index.knownnessThreshold, rareLine: DEFAULT_SCORING_CONFIG.rareKnownnessCutoff };
const at = consequencesAt(lines, { days: sittingDays(index, schedule.days), pool: [] });
const measured = new Map<string, Measured>(at.days.map((d) => [d.date, { answerCount: d.answerCount, difficulty: d.difficulty }]));

const after = resortWeeks(schedule, measured, today);
const before = new Map(schedule.days.map((d) => [d.date, d]));
const moved = after.days.filter((d) => before.get(d.date)!.seed !== d.seed);
const weeksChanged = new Set(moved.map((d) => playedWeekOf(schedule, d.date)));
// Days whose recorded figures change, moved or not: the week holding today keeps its order and is re-recorded.
const refigured = after.days.filter((d) => {
  const was = before.get(d.date)!;
  return was.answerCount !== d.answerCount || was.difficulty !== d.difficulty;
});

console.log(
  `Re-sort at Answer line ${lines.answerLine}, rare line ${lines.rareLine}, holding played week ${playedWeekOf(schedule, today) + 1} (${today}): ` +
    `${moved.length} day(s) take another Seed Word, in ${weeksChanged.size} of ${(after.days.length - after.days.findIndex((d) => d.date === after.lapStart)) / DAYS_PER_WEEK} week(s).`,
);
console.log(`${refigured.length} day(s) record new figures.`);
for (const d of moved) {
  const was = before.get(d.date)!;
  const from = schedule.days.find((o) => o.seed === d.seed && o.rhymeKey === d.rhymeKey)!;
  console.log(`  ${d.date} ${d.weekday}  ${was.seed} -> ${d.seed} (from ${from.date} ${from.weekday}, Difficulty ${d.difficulty})`);
}

// Each played week of the lap, Monday first, measured afresh off the re-sorted days.
// Not `consequencesAt`'s `weeksOutOfRamp`, which groups by the listed `week`
// number in date order: the week that opens each lap is played as the last
// listed Monday then the lap's first six days, which no listed week holds.
const remeasured = consequencesAt(lines, { days: sittingDays(index, after.days), pool: [] }).days;
const played = new Map<number, { weekday: string; difficulty: number }[]>();
for (const d of remeasured.filter((d) => d.date >= after.lapStart!)) {
  const week = playedWeekOf(after, d.date);
  played.set(week, [...(played.get(week) ?? []), { weekday: weekdayOf(d.date), difficulty: d.difficulty }]);
}
const outOfRamp = [...played]
  .filter(([, days]) => {
    const ramp = [...days].sort((a, b) => WEEKDAYS.indexOf(a.weekday as Weekday) - WEEKDAYS.indexOf(b.weekday as Weekday));
    return ramp.some((d, i) => i > 0 && d.difficulty < ramp[i - 1]!.difficulty);
  })
  .map(([week]) => week + 1)
  .sort((a, b) => a - b);
console.log(`Played weeks out of ramp order after: ${outOfRamp.length}${outOfRamp.length ? ": " + outOfRamp.join(", ") : ""}.`);

const collisions = placeCollisions(after.days.filter((d) => d.date >= after.lapStart!), index);
console.log(`One place per Seed Word, Rhyme Key and Puzzle: ${collisions.length === 0 ? "holds" : `${collisions.length} collision(s)`}.`);
console.log(`The lap is whole weeks: ${parseSchedule({ ...raw, days: after.days }) === null ? "NO" : "yes"}.`);

const changed = moved.length > 0 || refigured.length > 0;
if (write && changed) {
  console.log(`Wrote ${writeScheduleFile(raw, { days: after.days })}.`);
} else if (changed) {
  console.log("Nothing written. Pass --write to write data/schedule.json.");
}
