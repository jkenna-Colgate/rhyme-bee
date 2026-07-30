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
   * Pool members the deal could not place: a pool that is not a multiple of
   * seven leaves a remainder, and a partial week would break the ramp. Returned
   * rather than dropped silently, so the caller can say what was left out.
   */
  unplaced: T[];
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

  const weeks = Math.floor(sorted.length / DAYS_PER_WEEK);
  const placeable = weeks * DAYS_PER_WEEK;
  // The remainder comes off the hard end: dropping the easiest entries would
  // raise the floor of the whole run, while dropping the hardest only shortens
  // the top of the Sunday band.
  const unplaced = sorted.slice(placeable);

  const bands = WEEKDAYS.map((_, i) =>
    sorted
      .slice(i * weeks, (i + 1) * weeks)
      .sort((a, b) => hash(a.rhymeKey) - hash(b.rhymeKey) || a.rhymeKey.localeCompare(b.rhymeKey)),
  );

  const days: ScheduledDay<T>[] = [];
  for (let offset = 0; offset < placeable; offset++) {
    const weekdayIndex = offset % DAYS_PER_WEEK;
    const weekIndex = Math.floor(offset / DAYS_PER_WEEK);
    days.push({
      date: addDays(startDate, offset),
      weekday: WEEKDAYS[weekdayIndex]!,
      week: weekIndex + 1,
      entry: bands[weekdayIndex]![weekIndex]!,
    });
  }

  return { days, unplaced };
}
