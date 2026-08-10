/**
 * One scheduled day of the Editor's Pass, as a **value**. Resolving the date,
 * building the Puzzle from the built index, measuring it and checking it against
 * the bands it was dealt from — all of it, and none of the printing.
 *
 * The readout used to measure and then make five print calls, which is why the
 * pass has never been testable: there was no seam between deciding what the day
 * is and deciding how it looks. Splitting the value out is what makes the web
 * mode additive rather than a rewrite (#150) — `editorRead.ts` renders this to a
 * terminal, and the React view renders the same value to a screen. Neither owns
 * a figure of its own, so the two cannot disagree about the day.
 *
 * The index arrives as an argument rather than being loaded here, for the usual
 * reason: the artifact is megabytes and the caller already knows whether it
 * wants one. It also lets the whole of this module be tested over the fixture
 * index, which is the point. It arrives *unopened* — as a function rather than
 * an index — because a date outside the run is answered without building
 * anything, and the CLI should not read fifteen megabytes to tell the editor
 * they mistyped a date. Passing the index itself made that load unconditional.
 *
 * Every failure is a **case in the returned value**, never a process exit. A
 * date outside the run and a Seed the index cannot pin are both things the
 * editor needs *rendered* — the second especially, since it is the failure that
 * reaches players as a silent Free Play (#126) and the diagnosis is the whole
 * value of meeting it here rather than in production.
 */

import type { RhymeKey } from "../src/phonology.ts";
import type { PuzzleEntry, RhymeIndex } from "../src/rhymeIndex.ts";
import type { Scorable } from "../src/scoring.ts";
import { measureAnswers } from "../src/curation.ts";
import {
  checkDayDrift,
  scheduleBands,
  type DayDrift,
  type PuzzleFacts,
  type Schedule,
  type ScheduleDay,
  type Weekday,
} from "../src/schedule.ts";
import { message } from "./editorShell.ts";

/**
 * One word in a day's lists. `Scorable` is the whole of what moving a word
 * between the lists costs, so the payload extends it rather than restating its
 * two fields: a client that re-measures a rearranged day feeds these straight
 * back into `measureAnswers` and lands on the engine's own arithmetic, exactly
 * rather than approximately.
 *
 * Deliberately *not* a `PuzzleEntry`. The pronunciation and the respelling are
 * how a Puzzle presents a member to a player; nothing in the day view shows
 * them, and carrying them for two hundred words would multiply a payload whose
 * cheapness is what lets the day be re-read on every Submit.
 */
export interface DayWord extends Scorable {
  word: string;
}

/**
 * A day the index could build.
 *
 * The day's identity (`date`, `weekday`, `seed`, `rhymeKey`) also appears on
 * `drift`, because `checkDayDrift` names the day it judged and that type is the
 * tested core's, not this module's to reshape. Restating the four here is the
 * accepted cost of a flat payload: both renderers ask for the Seed Word far more
 * often than they ask about drift, and `drift.seed` is not what either of them
 * means. `facts` and `drift.recomputed` are the same three figures for the same
 * reason — one is the day, the other is the day held against what the schedule
 * recorded.
 */
export interface ScheduledDayReadout {
  outcome: "day";
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  weekday: Weekday;
  /** 1-based, for reading the schedule rather than for any behaviour. */
  week: number;
  seed: string;
  /** Plain-English respelling of the Seed, read in its pinned Rhyme Key. */
  seedRespelling: string;
  rhymeKey: RhymeKey;
  /** The three figures as the built index reads the day *now*. */
  facts: PuzzleFacts;
  /** The bands the day was dealt from, the recorded figures, and the verdict. */
  drift: DayDrift;
  answers: DayWord[];
  bonusWords: DayWord[];
}

/**
 * A date the schedule does not cover. It names the run's edges rather than
 * returning nothing, so a typo reads as a typo instead of as an empty screen.
 */
export interface UnscheduledDateReadout {
  outcome: "not-scheduled";
  date: string;
  firstDate: string;
  lastDate: string;
}

/**
 * The schedule/index disagreement: a scheduled Seed the built index cannot pin
 * to the key the schedule records. Nothing else in the repo performs this check
 * (#126), and in production it is silent — `pinSeed` throws, the boot policy
 * catches it, and the player is handed Free Play instead of the Daily Puzzle.
 *
 * It names *both* sides, because the repair is choosing between them: the key
 * the schedule asked for, and every key the index actually holds for the Seed.
 * An empty `indexRhymeKeys` is its own diagnosis — the index has no reading for
 * that spelling at all.
 */
export interface UnpinnableDayReadout {
  outcome: "unpinnable";
  date: string;
  weekday: Weekday;
  week: number;
  seed: string;
  scheduledRhymeKey: RhymeKey;
  /** Every Rhyme Key the built index holds for the Seed. Possibly empty. */
  indexRhymeKeys: RhymeKey[];
  /** What the index said when asked, kept verbatim for the reader. */
  detail: string;
}

export type DayReadout = ScheduledDayReadout | UnscheduledDateReadout | UnpinnableDayReadout;

/**
 * One scheduled day, built and checked against the bands it was dealt from.
 *
 * `openIndex` is called at most once, and not at all for a date the run does not
 * cover — see the note on the index in this module's header.
 */
export function readScheduledDay(
  openIndex: () => RhymeIndex,
  schedule: Schedule,
  date: string,
): DayReadout {
  const day = schedule.days.find((d) => d.date === date);
  if (day === undefined) {
    return {
      outcome: "not-scheduled",
      date,
      firstDate: schedule.days[0]!.date,
      lastDate: schedule.days[schedule.days.length - 1]!.date,
    };
  }

  const index = openIndex();
  let puzzle: ReturnType<RhymeIndex["buildPuzzle"]>;
  try {
    puzzle = index.buildPuzzle(index.pinSeed(day.seed, day.rhymeKey));
  } catch (error) {
    return unpinnable(index, day, error);
  }

  // Measured over the *listed* words rather than over the Puzzle's own entries,
  // so the figures shown and the figures a client recomputes come from one
  // list. Measured from `puzzle.answers`, a field dropped from `DayWord` could
  // silently move the payload's arithmetic away from the readout's.
  const answers = puzzle.answers.map(toDayWord);
  const facts = measureAnswers(answers);

  return {
    outcome: "day",
    date: day.date,
    weekday: day.weekday,
    week: day.week,
    seed: day.seed,
    seedRespelling: puzzle.seedRespelling,
    rhymeKey: day.rhymeKey,
    facts,
    drift: checkDayDrift(day, facts, scheduleBands(schedule)),
    answers,
    bonusWords: puzzle.bonusWords.map(toDayWord),
  };
}

/**
 * A Puzzle's member, narrowed to what a day's list shows and re-measures. The
 * narrowing is the whole of it — `pronunciation` and `respelling` are dropped
 * here and nowhere else, so this is the one place to look for why the payload
 * is the size it is.
 */
function toDayWord(entry: PuzzleEntry): DayWord {
  return { word: entry.word, length: entry.length, knownness: entry.knownness };
}

function unpinnable(index: RhymeIndex, day: ScheduleDay, error: unknown): UnpinnableDayReadout {
  return {
    outcome: "unpinnable",
    date: day.date,
    weekday: day.weekday,
    week: day.week,
    seed: day.seed,
    scheduledRhymeKey: day.rhymeKey,
    indexRhymeKeys: index.rhymeKeysOf(day.seed),
    detail: message(error),
  };
}
