/**
 * The schedule: which Seed Word runs on which date, dealt once from the curated
 * pool and thereafter fixed (ADR-0012).
 *
 * CONTEXT.md requires Difficulty to ramp monotonically *within* a week, Monday
 * easiest to Sunday hardest, and says nothing about across weeks. The deal
 * satisfies the first without introducing the second: sort the pool by
 * Difficulty, cut it into seven contiguous bands, and let the easiest band
 * supply every Monday, the next every Tuesday, and the hardest every Sunday.
 * Because the bands do not overlap, `Mon < Tue < … < Sun` holds for every week
 * *by construction* — it is a property of the deal, not an invariant to police.
 *
 * Within a band the order is free, and it is deliberately **not** Difficulty
 * order. Keeping each band sorted would hand week 1 the easiest member of every
 * band and week 42 the hardest, which is the across-the-year ramp ADR-0012
 * rejects — the weekday signal only means something if a Tuesday in month nine
 * is like a Tuesday in week one. A band is therefore scrambled by a hash of its
 * Rhyme Key: decorrelated from Difficulty, and identical on every run.
 */

import type { SeedWord } from "./rhymeIndex.ts";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** The days of one week, in the order the deal fills them. */
export const DAYS_PER_WEEK = WEEKDAYS.length;

/** What the deal needs from a curated family. `FamilyEntry` satisfies it. */
export interface Schedulable {
  rhymeKey: string;
  representative: string;
  difficulty: number;
}

export interface ScheduledDay<T extends Schedulable> {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  weekday: Weekday;
  /** 1-based, for reading the schedule rather than for any behaviour. */
  week: number;
  entry: T;
}

export interface Deal<T extends Schedulable> {
  days: ScheduledDay<T>[];
  /**
   * Days in the final week, when the pool is not a multiple of seven. Fewer than
   * `DAYS_PER_WEEK` means the run ends mid-week; 0 means it ends on a Sunday.
   */
  finalWeekLength: number;
}

/**
 * FNV-1a over the Rhyme Key. Any stable hash would do; this one is short, has no
 * dependency, and is fixed so a rebuild produces the same calendar — the whole
 * point of the schedule being an artifact is that it does not move underneath a
 * review.
 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayOf(isoDate: string): Weekday {
  // getUTCDay is Sunday-based; the schedule is Monday-based.
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[(day + 6) % DAYS_PER_WEEK]!;
}

/**
 * Deal a curated pool into a dated schedule. `startDate` must be a Monday: the
 * ramp is defined over a Monday-to-Sunday week, so starting mid-week would ship
 * a first week that ramps in the wrong order.
 */
export function dealSchedule<T extends Schedulable>(
  pool: readonly T[],
  startDate: string,
): Deal<T> {
  if (weekdayOf(startDate) !== "Mon") {
    throw new Error(`schedule must start on a Monday; ${startDate} is a ${weekdayOf(startDate)}`);
  }

  // Sort by Difficulty, breaking ties on Rhyme Key so the deal is total and
  // reproducible rather than dependent on the pool's incoming order.
  const sorted = [...pool].sort(
    (a, b) => a.difficulty - b.difficulty || a.rhymeKey.localeCompare(b.rhymeKey),
  );

  // A pool that is not a multiple of seven ends on a short final week rather
  // than losing its remainder — the four families that fall off a whole number
  // of weeks include some of the best boards in the set, and a run that stops on
  // a Thursday costs nothing but tidiness. The short week still ramps: it runs
  // Monday onward, so it holds the *front* of the ramp and simply stops early.
  //
  // Weekdays that occur in the short week therefore get one more entry than
  // those that do not, and the bands are cut to those sizes.
  const fullWeeks = Math.floor(sorted.length / DAYS_PER_WEEK);
  const finalWeekLength = sorted.length % DAYS_PER_WEEK;

  const bands: T[][] = [];
  let cut = 0;
  for (let i = 0; i < DAYS_PER_WEEK; i++) {
    const size = fullWeeks + (i < finalWeekLength ? 1 : 0);
    bands.push(
      sorted
        .slice(cut, cut + size)
        .sort((a, b) => hash(a.rhymeKey) - hash(b.rhymeKey) || a.rhymeKey.localeCompare(b.rhymeKey)),
    );
    cut += size;
  }

  const days: ScheduledDay<T>[] = [];
  for (let offset = 0; offset < sorted.length; offset++) {
    const weekdayIndex = offset % DAYS_PER_WEEK;
    const weekIndex = Math.floor(offset / DAYS_PER_WEEK);
    days.push({
      date: addDays(startDate, offset),
      weekday: WEEKDAYS[weekdayIndex]!,
      week: weekIndex + 1,
      entry: bands[weekdayIndex]![weekIndex]!,
    });
  }

  return { days, finalWeekLength };
}

// --- Reading the artifact back ------------------------------------------------

/**
 * One day of the committed schedule artifact. The deal above holds a whole
 * `Schedulable` per day; the artifact flattens it, because the only things a
 * player's browser needs are the Seed Word and the Rhyme Key it is pinned to.
 * The rest is there so a person can read the file.
 */
export interface ScheduleDay {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  weekday: Weekday;
  week: number;
  seed: string;
  rhymeKey: string;
  answerCount: number;
  difficulty: number;
}

/** The artifact, once it has been recognised as one. */
export interface Schedule {
  startDate: string;
  days: ScheduleDay[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isScheduleDay(value: unknown): value is ScheduleDay {
  if (typeof value !== "object" || value === null) return false;
  const day = value as Partial<ScheduleDay>;
  return (
    typeof day.date === "string" &&
    ISO_DATE.test(day.date) &&
    typeof day.weekday === "string" &&
    (WEEKDAYS as readonly string[]).includes(day.weekday) &&
    typeof day.week === "number" &&
    typeof day.seed === "string" &&
    typeof day.rhymeKey === "string" &&
    typeof day.answerCount === "number" &&
    typeof day.difficulty === "number"
  );
}

/**
 * Read the committed artifact. The schedule is a reviewed file the deploy ships
 * whole, so this is not defending against an attacker — it is refusing to
 * half-read a file that has changed shape, which would otherwise surface as a
 * player being served a Puzzle on `undefined`. Null means "there is no schedule
 * here"; the caller falls back to free play, which is where an out-of-range date
 * lands anyway.
 */
export function parseSchedule(raw: unknown): Schedule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const artifact = raw as { startDate?: unknown; days?: unknown };
  if (typeof artifact.startDate !== "string") return null;
  if (!Array.isArray(artifact.days) || artifact.days.length === 0) return null;
  if (!artifact.days.every(isScheduleDay)) return null;
  return { startDate: artifact.startDate, days: artifact.days };
}

/**
 * The Seed Word for a calendar date, pinned to the Rhyme Key the schedule
 * records — exactly as the free-play draw pins a Seed to its family's key, so an
 * ambiguous representative cannot misfire into the wrong Puzzle.
 *
 * Null for any date the run does not cover: an early visit before the start
 * date, a visit after the 260 days are up, or a date that is not a date. All
 * three mean the same thing to the shell — there is no Puzzle of the day, so
 * play a free one.
 */
export function seedForDate(schedule: Schedule | null, isoDate: string): SeedWord | null {
  if (schedule === null || !ISO_DATE.test(isoDate)) return null;
  const day = schedule.days.find((d) => d.date === isoDate);
  return day === undefined ? null : { word: day.seed, rhymeKey: day.rhymeKey };
}

/**
 * The player's own calendar date, as the artifact spells it. The rollover is
 * local midnight (ADR-0013): with no server there is no authoritative clock, and
 * local rollover is what every daily puzzle a player has already met does.
 *
 * Built from the local-time getters rather than `toISOString`, which would hand
 * a player west of Greenwich yesterday's Puzzle all evening and one east of it
 * tomorrow's all morning.
 */
export function localCalendarDate(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// --- The review ---------------------------------------------------------------

/**
 * What the review needs from a dealt entry, over and above what the deal needed.
 * `FamilyEntry` satisfies it.
 */
export interface Reviewable extends Schedulable {
  answerCount: number;
  nativeCount: number;
}

/** One weekday's Difficulty band across the whole run: the ramp, one rung. */
export interface WeekdayBand {
  weekday: Weekday;
  min: number;
  max: number;
}

/** The tail of the run, when the pool is not a multiple of seven. */
export interface ShortFinalWeek<T extends Reviewable> {
  /** 1-based week number, matching `ScheduledDay.week`. */
  week: number;
  length: number;
  days: ScheduledDay<T>[];
}

export interface ScheduleReview<T extends Reviewable> {
  totalDays: number;
  weeks: number;
  /**
   * One band per weekday that the deal actually fills, in Monday-to-Sunday
   * order. Monotonic by construction — the deal cuts non-overlapping Difficulty
   * bands — and asserted so, because that construction is the whole ramp.
   */
  ramp: WeekdayBand[];
  /** The short tail, or null when the pool divides exactly into weeks. */
  shortFinalWeek: ShortFinalWeek<T> | null;
  /** The days worth reading first, in schedule order. See `isFlagged`. */
  flagged: ScheduledDay<T>[];
}

/**
 * A Seed Word this short is unlikely to be a word the player recognises when it
 * is spoken to them — abbreviations and fragments hold wordhood and are always
 * short.
 */
const FLAG_MAX_SEED_LENGTH = 3;

/**
 * Native content this thin means the family is barely more than a Shadow Key —
 * ADR-0008's gray band, measured in #89. It passed the gate, but only just, so a
 * person should look.
 */
const FLAG_MAX_NATIVE_COUNT = 3;

/**
 * Whether a dealt day is worth reading first. A Seed Word is shown *and spoken*
 * to the player (ADR-0002), so a representative that is not a recognisable word
 * is exactly the failure the review exists to catch. Flagging is advisory: it
 * points the reviewer at the likeliest offenders rather than deciding anything.
 */
function isFlagged<T extends Reviewable>(day: ScheduledDay<T>): boolean {
  return (
    day.entry.representative.length <= FLAG_MAX_SEED_LENGTH ||
    day.entry.nativeCount <= FLAG_MAX_NATIVE_COUNT
  );
}

/**
 * The review of a dealt schedule, as values.
 *
 * The schedule is a reviewed artifact — a person reading it is the gate, not an
 * automated check (ADR-0012) — which makes the summary they read load-bearing.
 * It lived inside a print loop in an untested script; here it is data, so its
 * judgement can be tested. This does *not* automate the gate: nothing here
 * passes or fails a schedule, and the artifact stays hand-reviewed.
 */
export function reviewSchedule<T extends Reviewable>(deal: Deal<T>): ScheduleReview<T> {
  const { days, finalWeekLength } = deal;
  const weeks = Math.ceil(days.length / DAYS_PER_WEEK);

  const ramp: WeekdayBand[] = [];
  for (const weekday of WEEKDAYS) {
    const band = days.filter((d) => d.weekday === weekday).map((d) => d.entry.difficulty);
    // A pool shorter than a week leaves later weekdays unfilled; a band with no
    // members has no range to report, so it is absent rather than infinite.
    if (band.length === 0) continue;
    ramp.push({ weekday, min: Math.min(...band), max: Math.max(...band) });
  }

  const shortFinalWeek =
    finalWeekLength > 0
      ? { week: weeks, length: finalWeekLength, days: days.slice(-finalWeekLength) }
      : null;

  return {
    totalDays: days.length,
    weeks,
    ramp,
    shortFinalWeek,
    flagged: days.filter(isFlagged),
  };
}
