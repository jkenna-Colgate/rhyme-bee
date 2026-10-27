/**
 * The Continuity check: every scheduled day's Seed Word must pin to its Rhyme
 * Key, because a day that does not is silently served as Free Play (#126). Run
 * at every index build over every place in the Schedule, not only the future
 * ones, because every place comes round again on the next lap (#225, #228).
 *
 * A failing day is repaired where it can be, in order, stopping at the first
 * step that works (#256):
 *
 *  1. the same Seed Word on its current Rhyme Key (of several, the one with
 *     the most Answers the Schedule does not hold), which fixes a key whose
 *     spelling went stale (#151);
 *  2. else the family's lead word on that Rhyme Key;
 *  3. else the day is Free Play, and is counted.
 *
 * Nothing here throws for a failing day. With nobody attending the build, a
 * blocked build never unblocks, and it would hold back every other fix.
 */

import type { RhymeKey } from "./phonology.ts";
import type { RhymeFamily, RhymeIndex } from "./rhymeIndex.ts";
import { chooseRepresentative, measureAnswers } from "./curation.ts";
import type { ScheduleDay } from "./schedule.ts";

/** A day the check re-pinned, as recorded before and as written after. */
export interface DayRepair {
  date: string;
  step: 1 | 2;
  before: ScheduleDay;
  after: ScheduleDay;
}

/** A day no step could repair: it is served as Free Play until someone acts. */
export interface FreePlayDay {
  date: string;
  seed: string;
  rhymeKey: RhymeKey;
  /** What the index said when the recorded pair was pinned, kept verbatim. */
  detail: string;
}

/** A Seed Word or a Rhyme Key holding more than one place in the Schedule. */
export interface PlaceCollision {
  kind: "seed" | "rhymeKey";
  value: string;
  /** Every date it holds, in Schedule order. */
  dates: string[];
}

export interface ContinuityReport {
  /** Every day, with each repair applied and every other day untouched. */
  days: ScheduleDay[];
  repairs: DayRepair[];
  freePlay: FreePlayDay[];
  /** Reported and never repaired: filling a place is its own build. */
  collisions: PlaceCollision[];
}

/** Null when the pair pins; otherwise what the index said, verbatim. */
function pinFailure(index: RhymeIndex, seed: string, rhymeKey: RhymeKey): string | null {
  try {
    index.pinSeed(seed, rhymeKey);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function checkContinuity(days: readonly ScheduleDay[], index: RhymeIndex): ContinuityReport {
  const families = [...index.families().values()];
  const repaired = [...days];
  const repairs: DayRepair[] = [];
  const freePlay: FreePlayDay[] = [];

  repaired.forEach((day, i) => {
    const failure = pinFailure(index, day.seed, day.rhymeKey);
    if (failure === null) return;

    // The one-place rule: a repair may not land on a Rhyme Key or a Seed Word
    // another place holds, including one an earlier repair in this same pass
    // has just taken. Both steps re-pin onto a family's key, so a held key is
    // never a candidate, and a day with none left ends at step 3.
    const heldElsewhere = (key: RhymeKey) => repaired.some((d, j) => j !== i && d.rhymeKey === key);
    const seedElsewhere = (seed: string) => repaired.some((d, j) => j !== i && d.seed === seed);

    // Every family the Seed Word is in now, the Schedule's own keys left out,
    // the most Answers first. A word may be in several: glide-r files `power`
    // under `AW ER` and `AW R` (#261).
    const holding = families.filter((f) => f.members.some((m) => m.word === day.seed));
    const free = holding
      .filter((f) => !heldElsewhere(f.rhymeKey))
      .sort((a, b) => answersIn(b) - answersIn(a));
    const recorded = families.find((f) => f.rhymeKey === day.rhymeKey);
    // While the Seed is still in the family on the key the day recorded, that
    // key is its current one, and it has just failed (a Seed no longer heard
    // one way): the day keeps its key and goes to step 2.
    const keyStands = recorded !== undefined && holding.includes(recorded);

    // Step 1 (ADR-0012): the same word on its current Rhyme Key, the one with
    // the most Answers that the Schedule does not already hold, among the keys
    // it can be pinned to.
    const current =
      keyStands || seedElsewhere(day.seed)
        ? undefined
        : free.find((f) => pinFailure(index, day.seed, f.rhymeKey) === null);
    if (current !== undefined) return repair(1, day.seed, current.rhymeKey);

    // Step 2: the lead word of the day's family. That is the family on the
    // recorded key while the Seed is in it, so the day keeps its Puzzle; else
    // the one the Seed moved to; else, for a Seed the index no longer holds,
    // whatever the index still files on the recorded key.
    const family = keyStands ? recorded : holding.length > 0 ? free[0] : recorded;
    if (family !== undefined && !heldElsewhere(family.rhymeKey)) {
      const lead = chooseRepresentative(family.members.map((m) => m.word), index);
      if (!seedElsewhere(lead) && pinFailure(index, lead, family.rhymeKey) === null) {
        return repair(2, lead, family.rhymeKey);
      }
    }

    freePlay.push({ date: day.date, seed: day.seed, rhymeKey: day.rhymeKey, detail: failure });

    function repair(step: 1 | 2, seed: string, rhymeKey: RhymeKey): void {
      const after = rePin(index, day, seed, rhymeKey);
      repaired[i] = after;
      repairs.push({ date: day.date, step, before: day, after });
    }
  });

  return { days: repaired, repairs, freePlay, collisions: collisionsIn(repaired) };
}

/** How many of a family's words are Answers, which is how step 1 ranks a Seed's keys. */
function answersIn(family: RhymeFamily): number {
  return family.members.filter((m) => m.tier === "answer").length;
}

/**
 * The one-place check: no Seed Word and no Rhyme Key holds two places (#228),
 * so a Puzzle comes back only after every other one has been played. Run over
 * the Schedule as repaired, since that is the Schedule the build writes.
 */
function collisionsIn(days: readonly ScheduleDay[]): PlaceCollision[] {
  const collisions: PlaceCollision[] = [];
  for (const kind of ["seed", "rhymeKey"] as const) {
    const dates = new Map<string, string[]>();
    for (const day of days) dates.set(day[kind], [...(dates.get(day[kind]) ?? []), day.date]);
    for (const [value, held] of dates) {
      if (held.length > 1) collisions.push({ kind, value, dates: held });
    }
  }
  return collisions;
}

/**
 * The day on a new pair, keeping its date, weekday and week. The figures are
 * re-measured the way curation and the Editor's Pass measure a Puzzle, and
 * recorded to the precision the Schedule was dealt with.
 */
function rePin(index: RhymeIndex, day: ScheduleDay, seed: string, rhymeKey: RhymeKey): ScheduleDay {
  const facts = measureAnswers(index.buildPuzzle(index.pinSeed(seed, rhymeKey)).answers);
  return {
    ...day,
    seed,
    rhymeKey,
    answerCount: facts.answerCount,
    difficulty: Number(facts.difficulty.toFixed(4)),
  };
}

/**
 * The lines the build prints, and that an unattended job's run report will
 * carry: what was repaired and by which step, what is Free Play, and what holds
 * two places. One line when there is nothing to say.
 */
export function continuityLines(report: ContinuityReport): string[] {
  const { days, repairs, freePlay, collisions } = report;
  if (repairs.length === 0 && freePlay.length === 0 && collisions.length === 0) {
    return [
      `Continuity: all ${days.length} scheduled days pin; no Seed Word or Rhyme Key holds two places.`,
    ];
  }

  const lines = [
    `Continuity: ${days.length} scheduled days, ${repairs.length + freePlay.length} failed to pin; ` +
      `${repairs.length} repaired, ${freePlay.length} Free Play.`,
  ];
  for (const { date, step, before, after } of repairs) {
    const figures =
      before.answerCount === after.answerCount && before.difficulty === after.difficulty
        ? "figures unchanged"
        : `${before.answerCount} -> ${after.answerCount} Answers, ` +
          `Difficulty ${before.difficulty} -> ${after.difficulty}`;
    lines.push(
      `  repaired ${date} by step ${step}: ${before.seed} on ${before.rhymeKey} -> ` +
        `${after.seed} on ${after.rhymeKey} (${figures})`,
    );
  }
  for (const { date, seed, rhymeKey, detail } of freePlay) {
    lines.push(`  Free Play ${date}: ${seed} on ${rhymeKey}. ${detail}`);
  }
  for (const { kind, value, dates } of collisions) {
    const what = kind === "seed" ? "Seed Word" : "Rhyme Key";
    lines.push(`  one-place: ${what} ${value} holds ${dates.length} places: ${dates.join(", ")}`);
  }
  return lines;
}
