/**
 * Growing the Schedule by whole weeks (#271, ADR-0012 amended 2026-10-11).
 *
 * New Seed Words that have passed a Batch are dealt among themselves into weeks
 * by the banded deal (`dealSchedule`), so each new week ramps Monday to Sunday
 * as the first deal did. The weeks go in after the week in progress. Weeks
 * behind it are untouched and the rest of the lap slides later by the weeks
 * added, so a place already given keeps its weekday and comes round no sooner.
 *
 * For that the lap's start moves to the start of the lap in progress. A lap
 * held only as a list and a length would move every future date when the length
 * changed; with the start moved, every date before the new weeks is listed
 * (laps already played are written out day by day, in front of the new lap,
 * where they hold no place) and the new lap is the lap in progress with the new
 * weeks in it.
 *
 * Nothing here reads or writes a file. `scripts/grow-schedule.ts` does both,
 * and the maintainer runs it, present: nothing calls it unattended.
 */

import { batchesOf, type BatchRecord } from "./batch.ts";
import { normaliseWord } from "./cmudict.ts";
import { placeCollisions, type PlaceCollision } from "./continuity.ts";
import { DEFAULT_PLAYABLE_BAND, measureAnswers } from "./curation.ts";
import type { RhymeKey } from "./phonology.ts";
import type { RhymeIndex } from "./rhymeIndex.ts";
import {
  addDays,
  daysBetween,
  DAYS_PER_WEEK,
  dealSchedule,
  scheduledDayFor,
  weekdayOf,
  type Schedule,
  type ScheduleDay,
  type SizeBand,
} from "./schedule.ts";
import { seedWordTestLine, testSeedWord } from "./seedWord.ts";

/**
 * The Monday after the week `today` is in: where new weeks go. A week runs
 * Monday to Sunday, as the ramp does, so the week in progress on a Monday is
 * the one that Monday begins.
 */
export function weekAfter(today: string): string {
  const intoWeek = (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const).indexOf(weekdayOf(today));
  return addDays(today, DAYS_PER_WEEK - intoWeek);
}

/** A day moved to another date, its week counted from the Schedule's start as the deal counts it. */
function redate(schedule: Schedule, day: ScheduleDay, date: string): ScheduleDay {
  return { ...day, date, week: Math.floor(daysBetween(schedule.startDate, date) / DAYS_PER_WEEK) + 1 };
}

/**
 * The Schedule with `weeks` in it, dated from their first day on. That day must
 * be a Monday after the lap has begun, and the weeks whole and consecutive.
 * Every date before it plays what it played before; the new weeks follow; then
 * the rest of the lap in progress, later by the weeks added.
 */
export function placeWeeks(schedule: Schedule, weeks: readonly ScheduleDay[]): Schedule {
  const { lapStart } = schedule;
  if (lapStart === undefined) throw new Error("the Schedule records no lap start, so it does not loop and cannot grow");
  const at = weeks[0]?.date;
  if (at === undefined || weeks.length % DAYS_PER_WEEK !== 0) {
    throw new Error(`new weeks must be whole: ${weeks.length} day(s) given`);
  }
  if (weekdayOf(at) !== "Mon") throw new Error(`new weeks must start on a Monday; ${at} is a ${weekdayOf(at)}`);
  if (!weeks.every((d, i) => d.date === addDays(at, i))) throw new Error("new weeks must be consecutive days");
  if (at <= lapStart) throw new Error(`new weeks go after the lap has begun (${lapStart}), not on ${at}`);

  const listed = new Map(schedule.days.map((d) => [d.date, d]));
  const loop = schedule.days.filter((d) => d.date >= lapStart);
  // The lap the last day before the new weeks is in, and how far into it they go.
  const lap = loop.length;
  const current = addDays(lapStart, Math.floor(daysBetween(lapStart, addDays(at, -1)) / lap) * lap);
  const into = daysBetween(current, at);

  const days = schedule.days.filter((d) => d.date < lapStart);
  for (let date = lapStart; date < at; date = addDays(date, 1)) {
    days.push(listed.get(date) ?? redate(schedule, scheduledDayFor(schedule, date)!, date));
  }
  for (const d of weeks) days.push(redate(schedule, d, d.date));
  const after = addDays(at, weeks.length);
  for (let i = into; i < lap; i++) days.push(redate(schedule, loop[i]!, addDays(after, i - into)));

  return { ...schedule, lapStart: current, days };
}

// ---- which Seed Words may join -------------------------------------------------

/** A Seed Word that may not join, and every reason the checks it reached gave. */
export interface Refusal {
  seed: string;
  /** Named by the maintainer, rather than found waiting in the Batch record. */
  named: boolean;
  reasons: string[];
}

export interface Growth {
  /** The Monday the new weeks start on. */
  at: string;
  /** The new days, as placed. Empty when fewer than seven Seed Words may join. */
  added: ScheduleDay[];
  /** Seed Words that may join and are left over from a whole week: they wait in the Batch record. */
  spares: string[];
  refused: Refusal[];
  /**
   * The Schedule to write, or null when there is nothing to write: no whole
   * week, or a word the maintainer named was refused and is theirs to look at
   * first. A refused word found waiting in the record is passed over, and said.
   */
  grown: Schedule | null;
}

export interface GrowthOptions {
  /** The latest date any player has reached. The new weeks go after the week it is in. */
  today: string;
  /** The size band a new Seed Word must land in. Defaults to the Schedule's own. */
  band?: SizeBand;
}

/** A Seed Word that has cleared the checks of its own, with the figures it is dealt on. */
interface Admitted {
  seed: string;
  named: boolean;
  rhymeKey: RhymeKey;
  answerCount: number;
  difficulty: number;
}

/**
 * Grow the Schedule from the Seed Words that may join it: those `named`, and
 * every Seed Word the Batch record says passed and that holds no place, which
 * is where the spares of an earlier growth wait. Each must have passed its last
 * Batch, and is dealt on the Rhyme Key that Batch played; it must pin there,
 * pass the Seed Word test, land in the size band, and hold no place another day
 * holds (no Seed Word, Rhyme Key or Puzzle twice). Those that may join are
 * dealt among themselves into whole weeks by the banded deal, and placed after
 * the week in progress.
 */
export function growSchedule(
  schedule: Schedule,
  index: RhymeIndex,
  record: BatchRecord,
  named: readonly string[],
  options: GrowthOptions,
): Growth {
  const { lapStart } = schedule;
  if (lapStart === undefined) throw new Error("the Schedule records no lap start, so it does not loop and cannot grow");
  const band = options.band ?? schedule.band ?? DEFAULT_PLAYABLE_BAND;
  const placed = schedule.days.filter((d) => d.date >= lapStart);
  const holding = new Set(placed.map((d) => d.seed));

  // Named first, in the order named; then the spares waiting in the record, by word.
  const asked = [...new Set(named.map(normaliseWord))];
  const waiting = Object.keys(record.seeds)
    .filter((seed) => !asked.includes(seed) && !holding.has(seed) && batchesOf(record, seed).at(-1)?.trust === "pass")
    .sort();
  const candidates = [...asked.map((seed) => ({ seed, named: true })), ...waiting.map((seed) => ({ seed, named: false }))];

  const refusals = new Map<string, string[]>();
  const checked: Admitted[] = [];
  for (const candidate of candidates) {
    const result = checkOwn(index, record, candidate.seed, band);
    if ("reasons" in result) refusals.set(candidate.seed, result.reasons);
    else checked.push({ ...candidate, ...result });
  }
  const clashes = clashesWith(placed, checked, index);
  for (const [seed, reasons] of clashes) refusals.set(seed, reasons);
  const refused = candidates
    .filter((c) => refusals.has(c.seed))
    .map((c) => ({ ...c, reasons: refusals.get(c.seed)! }));
  const admitted = checked.filter((c) => !clashes.has(c.seed));

  // The banded deal, as the Schedule was first dealt; its short week is the spares.
  const at = weekAfter(options.today);
  const deal = dealSchedule(admitted.map((a) => ({ ...a, representative: a.seed })), at);
  const whole = deal.days.length - deal.finalWeekLength;
  const added = deal.days.slice(0, whole).map(({ date, weekday, entry }) =>
    redate(schedule, {
      date,
      weekday,
      week: 0,
      seed: entry.seed,
      rhymeKey: entry.rhymeKey,
      answerCount: entry.answerCount,
      difficulty: Number(entry.difficulty.toFixed(4)),
    }, date),
  );
  const spares = deal.days.slice(whole).map((d) => d.entry.seed);

  const blocked = refused.some((r) => r.named);
  const grown = added.length === 0 || blocked ? null : { ...placeWeeks(schedule, added), band };
  return { at, added, spares, refused, grown };
}

/** The checks a Seed Word answers by itself: its Batch, its pin, the Seed Word test, the size band. */
function checkOwn(
  index: RhymeIndex,
  record: BatchRecord,
  seed: string,
  band: SizeBand,
): { reasons: string[] } | { rhymeKey: RhymeKey; answerCount: number; difficulty: number } {
  const last = batchesOf(record, seed).at(-1);
  if (last === undefined) return { reasons: [`${seed} has been through no Batch, so it has not been checked.`] };
  if (last.trust !== "pass") {
    return { reasons: [`${seed}'s last Batch (${last.date}, on ${last.rhymeKey}) was ${last.trust}, not a pass.`] };
  }
  const { rhymeKey } = last;
  let answers;
  try {
    answers = index.buildPuzzle(index.pinSeed(seed, rhymeKey)).answers;
  } catch (error) {
    return { reasons: [`${seed} does not pin to ${rhymeKey}: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const reasons: string[] = [];
  const test = testSeedWord(index, seed, rhymeKey);
  if (!test.passes) reasons.push(seedWordTestLine(seed, rhymeKey, test));
  const facts = measureAnswers(answers);
  if (facts.answerCount < band.min || facts.answerCount > band.max) {
    reasons.push(
      `${seed} on ${rhymeKey} holds ${facts.answerCount} Answers, outside the size band [${band.min}, ${band.max}].`,
    );
  }
  return reasons.length > 0 ? { reasons } : { rhymeKey, answerCount: facts.answerCount, difficulty: facts.difficulty };
}

/**
 * The one-place check on the words joining: every collision each is in, with a
 * place already given or with a word ahead of it in the order asked, which
 * keeps its claim. A joining word stands in the check under a date no day has.
 */
function clashesWith(
  placed: readonly ScheduleDay[],
  joining: readonly Admitted[],
  index: RhymeIndex,
): Map<string, string[]> {
  const tag = (seed: string) => `joining ${seed}`;
  const standIns: ScheduleDay[] = joining.map((j) => ({
    date: tag(j.seed),
    weekday: "Mon",
    week: 0,
    seed: j.seed,
    rhymeKey: j.rhymeKey,
    answerCount: j.answerCount,
    difficulty: j.difficulty,
  }));
  const seedOn = new Map(placed.map((d) => [d.date, d.seed]));
  const clashes = new Map<string, string[]>();
  for (const collision of placeCollisions([...placed, ...standIns], index)) {
    const given = collision.dates.filter((d) => seedOn.has(d));
    const words = joining.filter((j) => collision.dates.includes(tag(j.seed)));
    words.forEach((j, i) => {
      if (given.length === 0 && i === 0) return;
      const what = describe(collision);
      const reason =
        given.length > 0
          ? `${j.seed} on ${j.rhymeKey}: ${what} already holds a place, on ` +
            `${given.map((d) => `${d} (${seedOn.get(d)})`).join(", ")}.`
          : `${j.seed} on ${j.rhymeKey}: ${what} is ${words[0]!.seed}'s too, and ${words[0]!.seed} comes first.`;
      clashes.set(j.seed, [...(clashes.get(j.seed) ?? []), reason]);
    });
  }
  return clashes;
}

function describe({ kind, value }: PlaceCollision): string {
  if (kind === "answers") return `its Puzzle (the same Answers, on ${value})`;
  return `${kind === "seed" ? "Seed Word" : "Rhyme Key"} ${value}`;
}
