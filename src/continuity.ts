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
 *  2. else the family's lead word on that Rhyme Key: its best-ranked word that
 *     passes the Seed Word test (#264), since that word joins the Schedule;
 *  3. else the day is Free Play, and is counted.
 *
 * Continuity is held exactly and the one-place rule is only reported (ADR-0012,
 * 2026-10-27), so a step is never skipped because the key or Seed Word it lands
 * on is held by another day: a candidate that collides with nothing is
 * preferred, and when none does the first that pins is taken and reported.
 * Free Play is only for a day where nothing pins.
 *
 * Nothing here throws for a failing day. With nobody attending the build, a
 * blocked build never unblocks, and it would hold back every other fix.
 */

import type { RhymeKey } from "./phonology.ts";
import type { RhymeFamily, RhymeIndex } from "./rhymeIndex.ts";
import { measureAnswers } from "./curation.ts";
import type { ScheduleDay } from "./schedule.ts";
import { seedWordFor, seedWordTestLine, testSeedWord } from "./seedWord.ts";

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

/**
 * A Seed Word, a Rhyme Key or a Puzzle holding more than one place in the
 * Schedule. A Puzzle is its set of Answers, and its `value` names the Rhyme
 * Keys it is held under, since that is the only way two days share one without
 * sharing a key.
 */
export interface PlaceCollision {
  kind: "seed" | "rhymeKey" | "answers";
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

/** Null when the test is off or the day's Seed Word passes it; otherwise the test's sentence. */
function testFailure(index: RhymeIndex, day: ScheduleDay, options: ContinuityOptions): string | null {
  if (!options.seedWordTest) return null;
  const test = testSeedWord(index, day.seed, day.rhymeKey);
  return test.passes ? null : seedWordTestLine(day.seed, day.rhymeKey, test);
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

export interface ContinuityOptions {
  /**
   * Also fail a day whose Seed Word pins but fails the Seed Word test
   * (`src/seedWord.ts`), and hold step 1 to it too. Off at the build, which
   * does not run the test (ADR-0012, amended 2026-10-14); on for the run over
   * the whole Schedule and for a Seed Word joining it. Step 2 runs the test
   * either way, since its lead word is a Seed Word joining the Schedule.
   */
  seedWordTest?: boolean;
}

export function checkContinuity(
  days: readonly ScheduleDay[],
  index: RhymeIndex,
  options: ContinuityOptions = {},
): ContinuityReport {
  const families = [...index.families().values()];
  const repaired = [...days];
  const repairs: DayRepair[] = [];
  const freePlay: FreePlayDay[] = [];
  const puzzleOf = puzzleReader(index);
  const passes = (seed: string, rhymeKey: RhymeKey) =>
    !options.seedWordTest || testSeedWord(index, seed, rhymeKey).passes;

  repaired.forEach((day, i) => {
    const failure = pinFailure(index, day.seed, day.rhymeKey) ?? testFailure(index, day, options);
    if (failure === null) return;

    // Every family the Seed Word is in now, the most Answers first. A word may
    // be in several: glide-r files `power` under `AW ER` and `AW R` (#261).
    const holding = families
      .filter((f) => f.members.some((m) => m.word === day.seed))
      .sort((a, b) => answersIn(b) - answersIn(a));
    const recorded = families.find((f) => f.rhymeKey === day.rhymeKey);
    // While the Seed is still in the family on the key the day recorded, that
    // key is its current one, and it has just failed (a Seed no longer heard
    // one way): the day keeps its key and goes to step 2.
    const keyStands = recorded !== undefined && holding.includes(recorded);

    // Step 1 (ADR-0012): the same word on its current Rhyme Key, among the keys
    // it is filed under. Step 2: the lead word of the day's family. That is the
    // family on the recorded key while the Seed is in it, so the day keeps its
    // Puzzle; else the ones the Seed moved to; else, for a Seed the index no
    // longer holds, whatever the index still files on the recorded key.
    const step2Families = keyStands ? [recorded] : holding.length > 0 ? holding : recorded ? [recorded] : [];
    const candidates: { step: 1 | 2; seed: string; rhymeKey: RhymeKey }[] = [
      ...(keyStands ? [] : holding.map((f) => ({ step: 1 as const, seed: day.seed, rhymeKey: f.rhymeKey }))),
      ...step2Families.flatMap((f) => {
        // The lead word is a Seed Word joining the Schedule, so it is the
        // family's best-ranked word that passes the Seed Word test (#264),
        // which also keeps an Unconfirmed Rhyme out (ADR-0012 amended). Step 1
        // keeps the day's own Seed Word, which the build reports instead if
        // it is listed.
        const seed = seedWordFor(f.members.map((m) => m.word), index, f.rhymeKey);
        return seed === null ? [] : [{ step: 2 as const, seed, rhymeKey: f.rhymeKey }];
      }),
    ]
      .filter((c) => c.step === 2 || passes(c.seed, c.rhymeKey))
      .filter((c) => pinFailure(index, c.seed, c.rhymeKey) === null);

    // The one-place rule is reported and never blocks (ADR-0012, 2026-10-27):
    // the steps keep their order and a candidate that shares no Seed Word,
    // Rhyme Key or Puzzle with another day is preferred, but when every one
    // that pins collides the first is taken, and the one-place check reports
    // it. Another day is read as it stands, an earlier repair included.
    const collides = (seed: string, rhymeKey: RhymeKey): boolean => {
      const answers = puzzleOf(seed, rhymeKey);
      return repaired.some(
        (d, j) =>
          j !== i && (d.seed === seed || d.rhymeKey === rhymeKey || (answers !== null && puzzleOf(d.seed, d.rhymeKey) === answers)),
      );
    };
    const chosen = candidates.find((c) => !collides(c.seed, c.rhymeKey)) ?? candidates[0];
    if (chosen !== undefined) {
      const after = rePin(index, day, chosen.seed, chosen.rhymeKey);
      repaired[i] = after;
      repairs.push({ date: day.date, step: chosen.step, before: day, after });
      return;
    }

    freePlay.push({ date: day.date, seed: day.seed, rhymeKey: day.rhymeKey, detail: failure });
  });

  return { days: repaired, repairs, freePlay, collisions: collisionsIn(repaired, puzzleOf) };
}

/**
 * A day's Puzzle as the one-place check compares it: every word that counts,
 * the Seed Word with its Answers, as one string. Null for a pair that does not
 * pin, which is no Puzzle. Kept per pair, since the check asks of every day.
 */
function puzzleReader(index: RhymeIndex): (seed: string, rhymeKey: RhymeKey) => string | null {
  const seen = new Map<string, string | null>();
  return (seed, rhymeKey) => {
    const pair = `${seed}|${rhymeKey}`;
    if (!seen.has(pair)) {
      let answers: string | null = null;
      try {
        const puzzle = index.buildPuzzle(index.pinSeed(seed, rhymeKey));
        answers = [seed, ...puzzle.answers.map((a) => a.word)].sort().join(" ");
      } catch {
        // A pair that does not pin is no Puzzle, and shares none.
      }
      seen.set(pair, answers);
    }
    return seen.get(pair) ?? null;
  };
}

/** How many of a family's words are Answers, which is how step 1 ranks a Seed's keys. */
function answersIn(family: RhymeFamily): number {
  return family.members.filter((m) => m.tier === "answer").length;
}

/**
 * The one-place check: no Seed Word, no Rhyme Key and no Puzzle holds two
 * places (#228), so a Puzzle comes back only after every other one has been
 * played. Puzzles are compared as well as strings, because an appending
 * Normalisation can file one family under two key spellings (`purifier` on
 * `AY ER`, `expire` on `AY R`); days on one Rhyme Key are reported once, as
 * that key. Run over the Schedule as repaired, since that is the Schedule the
 * build writes.
 */
function collisionsIn(
  days: readonly ScheduleDay[],
  puzzleOf: (seed: string, rhymeKey: RhymeKey) => string | null,
): PlaceCollision[] {
  const collisions: PlaceCollision[] = [];
  const group = (keyOf: (day: ScheduleDay) => string | null) => {
    const groups = new Map<string, ScheduleDay[]>();
    for (const day of days) {
      const key = keyOf(day);
      if (key !== null) groups.set(key, [...(groups.get(key) ?? []), day]);
    }
    return [...groups.values()].filter((held) => held.length > 1);
  };
  for (const kind of ["seed", "rhymeKey"] as const) {
    for (const held of group((day) => day[kind])) {
      collisions.push({ kind, value: held[0]![kind], dates: held.map((d) => d.date) });
    }
  }
  for (const held of group((day) => puzzleOf(day.seed, day.rhymeKey))) {
    const keys = [...new Set(held.map((d) => d.rhymeKey))];
    if (keys.length > 1) collisions.push({ kind: "answers", value: keys.join(" / "), dates: held.map((d) => d.date) });
  }
  return collisions;
}

/**
 * The day on a new pair, keeping its date, weekday and week. The figures are
 * re-measured the way curation and the Editor's Pass measure a Puzzle, and
 * recorded to the precision the Schedule was dealt with. Exported for the
 * Seed Word run's re-seed (`src/seedWordRun.ts`), which moves a day the same way.
 */
export function rePin(index: RhymeIndex, day: ScheduleDay, seed: string, rhymeKey: RhymeKey): ScheduleDay {
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
  const seedOn = new Map(days.map((d) => [d.date, d.seed]));
  for (const { kind, value, dates } of collisions) {
    const what =
      kind === "answers"
        ? `the same Answers, on ${value}, hold`
        : `${kind === "seed" ? "Seed Word" : "Rhyme Key"} ${value} holds`;
    const held = dates.map((date) => `${date} (${seedOn.get(date)})`).join(", ");
    lines.push(`  one-place: ${what} ${dates.length} places: ${held}`);
  }
  return lines;
}
