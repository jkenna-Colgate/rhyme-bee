/**
 * The Corrected Day: the two corrections composed, and the rules that sit
 * between them.
 *
 * `retier.test.ts` and `demote.test.ts` each hold one correction against a
 * genuine rebuild. This file is about what neither of them owns — the order the
 * two run in, the date guard that decides whether a picker state may be applied
 * to this day at all, and `moved`, which withdraws the band verdicts. Those
 * rules used to live in `DayReadoutView`'s render body, out of reach of a suite
 * with no DOM environment.
 *
 * The technique is `retier.test.ts`'s and no figure is typed out by hand: a case
 * that expects the day to have moved builds the fixture index a second time with
 * the very correction under test written in the file format it belongs to, and
 * asserts the browser's arithmetic landed where the rebuild did.
 *
 * Everything is built at the shipped threshold rather than the fixture's own
 * 1.0, for the reason `retier.test.ts` gives: the verdict sentinels are
 * calibrated for it (ADR-0015).
 */

import { describe, expect, it } from "vitest";
import type { ScheduledDayReadout } from "../../scripts/editorDay.ts";
import { measureAnswers } from "../../src/curation.ts";
import { serialiseDemotion, type Demotion } from "../../src/demotions.ts";
import type { PuzzleEntry, RhymeIndex } from "../../src/rhymeIndex.ts";
import { TIER_OVERRIDE_HEADER } from "../../src/tierOverride.ts";
import { buildTestIndex, makeTestIndex, type TestInputs } from "../../src/__fixtures__/index.ts";
import { tierPickerState } from "../editorTierPayload.ts";
import { correctedDay } from "../src/editor/correctedDay.ts";
import type { DayLists, TierPickerState } from "../src/editor/retier.ts";

/** See `retier.test.ts`: the override sentinels are calibrated for this. */
const SHIPPED_THRESHOLD = 0.0;

/** The fixture's `-ate` family — the widest one it has, and the Tutorial's Seed. */
const ATE = { seed: "ate", key: "EY T" };

const DATE = "2026-08-09";

/**
 * `demote.test.ts`'s leak, reproduced: `kate` is a name `data/words.txt` also
 * calls a word, so until it is demoted the day serves it as an ordinary Answer.
 * It is the word this file demotes, and — in the ordering case — also judges.
 */
const LEAK: TestInputs = { words: ["kate"], prevalence: [["kate", 2.5]] };

const KATE: Demotion = { word: "kate", reason: "proper-noun" };

/**
 * The measured norms, unpatched — what `data/prevalence.csv` says, `kate`'s own
 * row included. The leak has to be in here: a payload that could not measure a
 * word the day contains would tier it to Bonus on a technicality, and the days
 * below would move for a reason no correction caused.
 */
const MEASURED = buildTestIndex(LEAK).data.prevalence;

function index(inputs: TestInputs = {}): RhymeIndex {
  return makeTestIndex({ ...LEAK, ...inputs, knownnessThreshold: SHIPPED_THRESHOLD });
}

function listsOf(built: RhymeIndex, family: { seed: string; key: string }): DayLists {
  const puzzle = built.buildPuzzle(built.pinSeed(family.seed, family.key));
  return { answers: puzzle.answers.map(toDayWord), bonusWords: puzzle.bonusWords.map(toDayWord) };
}

function toDayWord(entry: PuzzleEntry) {
  return { word: entry.word, length: entry.length, knownness: entry.knownness };
}

const words = (list: { word: string }[]) => list.map((w) => w.word).sort();

function overrideFile(...rows: string[]): string {
  return [TIER_OVERRIDE_HEADER, ...rows, ""].join("\n");
}

function demotionFile(...demotions: Demotion[]): string {
  return demotions.map(serialiseDemotion).join("");
}

/**
 * The day as the endpoint would send it. `correctedDay` reads four fields of
 * this — `date`, `facts` and the two lists — and the rest is the payload's
 * identity and drift, filled in here only because the type carries them.
 */
function readoutFor(built: RhymeIndex, date = DATE): ScheduledDayReadout {
  const lists = listsOf(built, ATE);
  const facts = measureAnswers(lists.answers);
  return {
    outcome: "day",
    date,
    weekday: "Sun",
    week: 1,
    seed: ATE.seed,
    seedRespelling: "ayt",
    rhymeKey: ATE.key,
    facts,
    drift: {
      date,
      weekday: "Sun",
      seed: ATE.seed,
      rhymeKey: ATE.key,
      recorded: { answerCount: facts.answerCount, difficulty: facts.difficulty },
      recomputed: facts,
      weekdayBand: { weekday: "Sun", min: 0, max: 1 },
      sizeBand: { min: 1, max: 500 },
      drifted: false,
      reasons: [],
    },
    answers: lists.answers,
    bonusWords: lists.bonusWords,
  };
}

/** The picker state the endpoint would send for `date`, over the fixture's data. */
function stateFor(
  built: RhymeIndex,
  lists: DayLists,
  overrides: string,
  date = DATE,
): TierPickerState {
  return tierPickerState({
    date,
    lemmaCandidates: (word) => built.derivation.lemmaCandidates(word),
    lists,
    measured: MEASURED,
    overrides,
    knownnessThreshold: SHIPPED_THRESHOLD,
  });
}

describe("a day nobody has corrected", () => {
  it("shows the readout's own words and figures, and has not moved", () => {
    const readout = readoutFor(index());
    const corrected = correctedDay(readout, null, null);

    expect(words(corrected.answers)).toEqual(words(readout.answers));
    expect(words(corrected.bonusWords)).toEqual(words(readout.bonusWords));
    expect(corrected.facts).toBe(readout.facts);
    expect(corrected.moved).toBe(false);
  });

  it("carries no verdict on any word, because no state has been applied", () => {
    const corrected = correctedDay(readoutFor(index()), null, null);

    expect(corrected.answers.length).toBeGreaterThan(5);
    const all = [...corrected.answers, ...corrected.bonusWords];
    expect(all.every((w) => w.verdict === null)).toBe(true);
  });

  /**
   * The exactness `moved` rests on. A live state carrying no standing verdict
   * sends the day down `retierDay`'s re-measuring path rather than the
   * untouched one, and the figures must still come back bit-identical — which
   * is why `sameFigures` compares Difficulty with `===` and wants no epsilon.
   */
  it("has not moved when a live state stands over it with nothing in it", () => {
    const built = index();
    const readout = readoutFor(built);
    const state = stateFor(built, listsOf(built, ATE), "");

    const corrected = correctedDay(readout, state, { standing: [] });

    expect(corrected.facts).toEqual(readout.facts);
    expect(corrected.facts.difficulty).toBe(readout.facts.difficulty);
    expect(corrected.moved).toBe(false);
  });
});

describe("a picker state fetched for another day", () => {
  /**
   * `useTierPicker` drops a superseded *reply* but never clears `state` when the
   * date changes, so between a new date being typed and its fetch landing the
   * hook still holds the previous day's verdicts. Applying them would be
   * Monday's judgements over Tuesday's words, and would look exactly like a
   * correctly rendered day.
   */
  it("is not applied, leaving the day as if no state had arrived at all", () => {
    const built = index();
    const readout = readoutFor(built, "2026-08-10");
    const file = overrideFile("collate,bonus,1.8,2026-08-09T10:00:00.000Z,");
    const yesterday = stateFor(built, listsOf(built, ATE), file, "2026-08-09");

    const corrected = correctedDay(readout, yesterday, null);
    const untouched = correctedDay(readout, null, null);

    expect(words(corrected.answers)).toContain("collate");
    expect(words(corrected.answers)).toEqual(words(untouched.answers));
    expect(words(corrected.bonusWords)).toEqual(words(untouched.bonusWords));
    expect(corrected.facts).toEqual(untouched.facts);
    expect(corrected.moved).toBe(false);
  });
});

describe("the two corrections composed", () => {
  /**
   * The order. A demotion withdraws wordhood, so the word leaves the Puzzle
   * rather than moving between its lists — and re-tiering it afterwards would
   * be asking which Tier a non-word is. `kate` here is demoted *and* carries a
   * standing verdict, so a composition that re-tiered first would be putting it
   * through the picker on its way out. What is asserted is the contract that
   * outlives the ordering: the word is gone from both lists, and the figures
   * are a rebuild of both files.
   */
  it("drops a word that is both demoted and judged, and matches a rebuild of both", () => {
    const overrides = overrideFile("kate,bonus,2.5,2026-08-09T10:00:00.000Z,");
    const built = index();
    const readout = readoutFor(built);
    const rebuilt = listsOf(index({ demotions: demotionFile(KATE), tierOverrides: overrides }), ATE);

    const corrected = correctedDay(
      readout,
      stateFor(built, listsOf(built, ATE), overrides),
      { standing: [KATE] },
    );

    expect(words(readout.answers)).toContain("kate");
    expect(words(corrected.answers)).not.toContain("kate");
    expect(words(corrected.bonusWords)).not.toContain("kate");
    expect(words(corrected.answers)).toEqual(words(rebuilt.answers));
    expect(words(corrected.bonusWords)).toEqual(words(rebuilt.bonusWords));
    expect(corrected.facts).toEqual(measureAnswers(rebuilt.answers));
    expect(corrected.moved).toBe(true);
  });

  it("moves the day on a Tier verdict alone, to where a rebuild would put it", () => {
    const overrides = overrideFile("collate,bonus,1.8,2026-08-09T10:00:00.000Z,");
    const built = index();
    const readout = readoutFor(built);
    const rebuilt = listsOf(index({ tierOverrides: overrides }), ATE);

    const corrected = correctedDay(readout, stateFor(built, listsOf(built, ATE), overrides), null);

    expect(words(corrected.bonusWords)).toContain("collate");
    expect(words(corrected.answers)).toEqual(words(rebuilt.answers));
    expect(corrected.facts).toEqual(measureAnswers(rebuilt.answers));
    expect(corrected.moved).toBe(true);
  });

  it("moves the day on a demotion alone, with no picker state in sight", () => {
    const rebuilt = listsOf(index({ demotions: demotionFile(KATE) }), ATE);

    const corrected = correctedDay(readoutFor(index()), null, { standing: [KATE] });

    expect(words(corrected.answers)).toEqual(words(rebuilt.answers));
    expect(corrected.facts).toEqual(measureAnswers(rebuilt.answers));
    expect(corrected.moved).toBe(true);
  });

  /**
   * Demoting a **Bonus Word** removes it from the day without touching a single
   * figure, because the three are measured over the Answers alone. The day has
   * changed and has not *moved*, and the band verdicts stay: they were decided
   * against figures that are still current.
   */
  it("has not moved when the demoted word was a Bonus Word", () => {
    const built = index();
    const readout = readoutFor(built);
    const bonus = readout.bonusWords[0]!.word;

    const corrected = correctedDay(readout, null, { standing: [{ word: bonus, reason: "not-a-word" }] });

    expect(words(corrected.bonusWords)).not.toContain(bonus);
    expect(corrected.facts).toEqual(readout.facts);
    expect(corrected.moved).toBe(false);
  });
});
