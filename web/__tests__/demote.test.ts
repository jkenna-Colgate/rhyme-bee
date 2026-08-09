/**
 * What a demotion does to the day on screen, held against what it does to a
 * rebuilt index.
 *
 * A demotion is not a re-tier. A verdict moves a word between the two lists; a
 * demotion takes its **wordhood**, so it leaves *both* lists and the Puzzle
 * stops containing it at all. The figures follow from that rather than from
 * anything written here: `measureAnswers` is the engine's own, called over the
 * shortened list, so the Answer count, the maximum Score and the Difficulty are
 * whatever the engine makes of the day that is left.
 *
 * As in `retier.test.ts`, no case asserts a figure typed out by hand. Each one
 * builds the fixture index twice — once plain, once with the very demotion under
 * test written in `data/demotions.txt`'s own format by `serialiseDemotion` — and
 * asserts that what the browser showed equals what the rebuilt index produces
 * from scratch. The rebuild is the independent source of truth, and it is the
 * one the acceptance criterion names.
 *
 * Everything is built at the shipped threshold rather than the fixture's own
 * 1.0, so that a case combining a demotion with a Tier verdict meets the
 * sentinels calibrated for it (ADR-0015).
 */

import { describe, expect, it } from "vitest";
import { measureAnswers } from "../../src/curation.ts";
import { serialiseDemotion, type Demotion } from "../../src/demotions.ts";
import type { PuzzleEntry, RhymeIndex } from "../../src/rhymeIndex.ts";
import { TIER_OVERRIDE_HEADER } from "../../src/tierOverride.ts";
import { buildTestIndex, makeTestIndex, type TestInputs } from "../../src/__fixtures__/index.ts";
import { tierPickerState } from "../editorTierPayload.ts";
import { demotedWords, withoutDemoted } from "../src/editor/demote.ts";
import { retierDay, type DayLists } from "../src/editor/retier.ts";

/** See `retier.test.ts`: the override sentinels are calibrated for this. */
const SHIPPED_THRESHOLD = 0.0;

/** The fixture's `-ate` family — the widest one it has, and the Tutorial's Seed. */
const ATE = { seed: "ate", key: "EY T" };

/**
 * The upstream leak this whole file exists for, reproduced: `kate` is a name
 * that `data/words.txt` also calls a word, and the wordhood gate is tested
 * before name-hood — so until it is demoted the game serves it as an ordinary
 * Answer against the Tutorial's own Seed Word. Its prevalence is a common
 * name's, which is exactly why no Tier verdict is the right instrument.
 */
const LEAK: TestInputs = { words: ["kate"], prevalence: [["kate", 2.5]] };

const MEASURED = buildTestIndex().data.prevalence;

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

/** The demotion list as the endpoint would have written it. */
function demotionFile(...demotions: Demotion[]): string {
  return demotions.map(serialiseDemotion).join("");
}

const KATE: Demotion = { word: "kate", reason: "proper-noun" };

describe("a demotion takes the word out of the day", () => {
  it("removes a demoted Answer from the list, matching a rebuild", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const rebuilt = listsOf(index({ demotions: demotionFile(KATE) }), ATE);

    expect(words(lists.answers)).toContain("kate");
    const shown = withoutDemoted(lists, measureAnswers(lists.answers), demotedWords([KATE]));

    expect(words(shown.lists.answers)).toEqual(words(rebuilt.answers));
    expect(words(shown.lists.bonusWords)).toEqual(words(rebuilt.bonusWords));
  });

  /**
   * The figures, which are the reason a demotion is not just a filtered list. A
   * demoted Answer takes its points out of the maximum Score with it, so the
   * Answer count, the maximum and the Difficulty ratio all move — and they must
   * move to exactly where a rebuild puts them, not approximately.
   */
  it("re-measures the three figures to where a rebuild puts them", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const rebuilt = listsOf(index({ demotions: demotionFile(KATE) }), ATE);
    const before = measureAnswers(lists.answers);

    const shown = withoutDemoted(lists, before, demotedWords([KATE]));

    expect(shown.facts).toEqual(measureAnswers(rebuilt.answers));
    expect(shown.facts.answerCount).toBe(before.answerCount - 1);
    expect(shown.facts.maxScore).toBeLessThan(before.maxScore);
  });

  /**
   * A demoted **Bonus Word** leaves the day too, but the figures are measured
   * over the Answers alone — Bonus Words are celebrated and never counted
   * (CONTEXT.md) — so the Answer count, the maximum Score and the Difficulty are
   * untouched. Asserted against a rebuild rather than reasoned about, because
   * "nothing moved" is exactly the claim that is easy to be wrong about.
   */
  it("leaves the figures alone when the demoted word was a Bonus Word", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    // `sate` is absent from the fixture's prevalence data, so it defaults to a
    // Bonus Word — the one this family holds at the shipped threshold.
    const sate: Demotion = { word: "sate", reason: "not-a-known-word" };
    const rebuilt = listsOf(index({ demotions: demotionFile(sate) }), ATE);
    const before = measureAnswers(lists.answers);

    expect(words(lists.bonusWords)).toContain("sate");
    const shown = withoutDemoted(lists, before, demotedWords([sate]));

    expect(words(shown.lists.bonusWords)).toEqual(words(rebuilt.bonusWords));
    expect(shown.facts).toEqual(measureAnswers(rebuilt.answers));
    expect(shown.facts).toEqual(before);
  });

  it("leaves a day with no demotions on it exactly as it arrived", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const before = measureAnswers(lists.answers);

    const shown = withoutDemoted(lists, before, demotedWords([]));

    expect(shown.lists).toEqual(lists);
    expect(shown.facts).toBe(before);
  });

  /**
   * A demotion on a word this day never held — most of `data/demotions.txt` —
   * must not disturb it. The standing list is the whole file's, so this is the
   * ordinary case rather than an edge one.
   */
  it("ignores a demotion of a word the day does not contain", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const before = measureAnswers(lists.answers);

    const shown = withoutDemoted(
      lists,
      before,
      demotedWords([{ word: "algiers", reason: "proper-noun" }]),
    );

    expect(shown.lists).toEqual(lists);
    expect(shown.facts).toBe(before);
  });

  /**
   * The two corrections composed, which is the pass as an editor actually
   * conducts it: a Tier verdict on one word and a demotion on another, in one
   * sitting, before any rebuild. The browser applies both and must still land
   * where an index built with *both* files lands.
   */
  it("composes with a standing Tier verdict, still matching a rebuild of both", () => {
    const overrides = `${TIER_OVERRIDE_HEADER}\ncollate,bonus,1.8,2026-08-09T10:00:00.000Z,\n`;
    const built = index();
    const lists = listsOf(built, ATE);
    const rebuilt = listsOf(
      index({ demotions: demotionFile(KATE), tierOverrides: overrides }),
      ATE,
    );

    const shown = withoutDemoted(lists, measureAnswers(lists.answers), demotedWords([KATE]));
    const retiered = retierDay(
      shown.lists,
      tierPickerState({
        date: "2026-08-09",
        lemmaCandidates: (word) => built.derivation.lemmaCandidates(word),
        lists: shown.lists,
        measured: MEASURED,
        overrides,
        knownnessThreshold: SHIPPED_THRESHOLD,
      }),
    );

    expect(words(retiered.answers)).toEqual(words(rebuilt.answers));
    expect(words(retiered.bonusWords)).toEqual(words(rebuilt.bonusWords));
    expect(retiered.facts).toEqual(measureAnswers(rebuilt.answers));
  });
});
