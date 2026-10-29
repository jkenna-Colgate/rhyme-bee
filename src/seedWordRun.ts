/**
 * The Seed Word test, run once over every place in the Schedule (#264). It
 * waited for the Normalisations and the hand-written readings, because all of
 * them change readings and nothing re-runs the test after they land.
 *
 * Two passes, in this order:
 *
 *  1. **The test is a gate.** A day whose Seed Word fails it goes through the
 *     Continuity repair (`checkContinuity`, with the test switched on), which
 *     keeps its Rhyme Key and gives it the family's best-ranked word that
 *     passes, or makes it Free Play and counts it. There is no second path.
 *  2. **The ranking is not a gate.** A day whose Seed Word passes but carries
 *     its Rhyme Key on a secondary stress is re-seeded in its own family when
 *     the family's best-ranked passing word carries it on the main stress
 *     (`makeup` to `cup`), keeping its Rhyme Key, place and weekday. When the
 *     ranking still picks a secondary-stress word, because the family's
 *     main-stress words are inflections (`breathtaking`), the day keeps its
 *     Seed Word: a ranking loses no day, and moves one only for the stress.
 *     A word another day holds as its Seed Word is passed over, so the
 *     re-seed adds no collision to the one-place check.
 */

import { checkContinuity, rePin, type FreePlayDay } from "./continuity.ts";
import { carriesMainStress, rankSeedWords } from "./curation.ts";
import type { RhymeIndex } from "./rhymeIndex.ts";
import type { ScheduleDay } from "./schedule.ts";
import { testSeedWord } from "./seedWord.ts";

/** Why a day's Seed Word changed. */
export type SeedWordChangeReason =
  | "re-ranked"
  | "not-heard-one-way"
  | "not-an-answer"
  | "unconfirmed-rhyme"
  | "did-not-pin";

export interface SeedWordChange {
  date: string;
  why: SeedWordChangeReason;
  before: ScheduleDay;
  after: ScheduleDay;
}

export interface SeedWordRun {
  /** Every day, with each change applied. */
  days: ScheduleDay[];
  changes: SeedWordChange[];
  /** Days nothing could repair, counted against Continuity. */
  freePlay: FreePlayDay[];
}

export function runSeedWordTest(days: readonly ScheduleDay[], index: RhymeIndex): SeedWordRun {
  const repaired = checkContinuity(days, index, { seedWordTest: true });
  const changes: SeedWordChange[] = repaired.repairs.map(({ date, before, after }) => ({
    date,
    why: failureOf(index, before),
    before,
    after,
  }));

  const result = [...repaired.days];
  result.forEach((day, i) => {
    if (repaired.repairs.some((r) => r.date === day.date)) return;
    if (repaired.freePlay.some((f) => f.date === day.date)) return;
    if (carriesMainStress(index, day.seed, day.rhymeKey)) return;

    const heldElsewhere = new Set(result.filter((_, j) => j !== i).map((d) => d.seed));
    const words = index.familyOf(day.rhymeKey).members.map((m) => m.word);
    const pick = rankSeedWords(words, index, day.rhymeKey).find(
      (w) => !heldElsewhere.has(w) && testSeedWord(index, w, day.rhymeKey).passes,
    );
    if (pick === undefined || pick === day.seed || !carriesMainStress(index, pick, day.rhymeKey)) return;

    const after = rePin(index, day, pick, day.rhymeKey);
    result[i] = after;
    changes.push({ date: day.date, why: "re-ranked", before: day, after });
  });

  changes.sort((a, b) => a.date.localeCompare(b.date));
  return { days: result, changes, freePlay: repaired.freePlay };
}

/** The part of the test the day's recorded Seed Word failed, or that it no longer pinned. */
function failureOf(index: RhymeIndex, day: ScheduleDay): SeedWordChangeReason {
  try {
    index.pinSeed(day.seed, day.rhymeKey);
  } catch {
    return "did-not-pin";
  }
  const test = testSeedWord(index, day.seed, day.rhymeKey);
  // A repair is made only for a day that failed, so a pass here cannot happen.
  return test.passes ? "did-not-pin" : test.reason;
}
