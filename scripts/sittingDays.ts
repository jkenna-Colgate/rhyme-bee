/**
 * Every scheduled day with the Answers its Puzzle holds in the built index:
 * what the Tier sitting draws from and measures the lines against (#309), and
 * what the week re-sort measures Difficulty with (#312).
 */

import type { RhymeKey } from "../src/phonology.ts";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import type { ScheduleDay } from "../src/schedule.ts";
import type { SittingDay } from "../src/tierSitting.ts";

export function sittingDays(index: RhymeIndex, days: readonly ScheduleDay[]): SittingDay[] {
  return days.map((d) => {
    const puzzle = index.buildPuzzle(index.pinSeed(d.seed, d.rhymeKey as RhymeKey));
    return {
      date: d.date,
      week: d.week,
      seedWord: d.seed,
      rhymeKey: d.rhymeKey,
      seedKnownness: index.tierOf(d.seed).knownness,
      answers: puzzle.answers.map((a) => ({ word: a.word, length: a.length, knownness: a.knownness })),
    };
  });
}
