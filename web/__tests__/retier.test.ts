/**
 * The Tier picker's arithmetic, held against the engine's.
 *
 * The picker's whole promise is that a verdict clicked in the browser moves the
 * day's figures to **exactly** where a rebuild would put them (#159). The way
 * that promise fails is a browser that reimplements the formula, so the cases
 * here do not assert figures typed out by hand: each one builds the fixture
 * index twice — once plain, once with the very override under test in
 * `data/tier-overrides.csv`'s own format — and asserts that what `retierDay`
 * produced from the plain day equals what the rebuilt index produces from
 * scratch. The rebuild is the independent source of truth, and it is the same
 * source of truth the acceptance criterion names.
 *
 * `web/editorTierPayload.ts` builds the state the browser resolves against, so
 * it is exercised here too: a payload naming the wrong lemma candidates would
 * break these cases in the same breath.
 *
 * Everything is built at the **shipped** threshold rather than the fixture's own
 * 1.0, for the reason `src/__tests__/tierOverride-build.test.ts` gives: the four
 * verdicts' values are sentinels calibrated against the shipped configuration
 * (ADR-0015), and at 1.0 the `answer-rare` sentinel (0.6) would not even be an
 * Answer.
 */

import { describe, expect, it } from "vitest";
import { measureAnswers } from "../../src/curation.ts";
import type { PuzzleEntry, RhymeIndex } from "../../src/rhymeIndex.ts";
import { TIER_OVERRIDE_HEADER } from "../../src/tierOverride.ts";
import { buildTestIndex, makeTestIndex } from "../../src/__fixtures__/index.ts";
import { tierPickerState } from "../editorTierPayload.ts";
import { retierDay, type DayLists } from "../src/editor/retier.ts";

/** See `tierOverride-build.test.ts`: the sentinels are calibrated for this. */
const SHIPPED_THRESHOLD = 0.0;

/** The fixture's `-ate` family — the widest one it has, and the Tutorial's Seed. */
const ATE = { seed: "ate", key: "EY T" };

/**
 * The `-ates` family. It exists here for one word: `gates` carries no prevalence
 * row of its own and tiers on `gate`'s, and `gate` lives in a *different* family
 * — which is the lemma reach, seen from the day it actually shows up on.
 */
const ATES = { seed: "plates", key: "EY T S" };

/** The measured norms, unpatched — what `data/prevalence.csv` says. */
const MEASURED = buildTestIndex().data.prevalence;

function index(overrides = ""): RhymeIndex {
  return makeTestIndex({ tierOverrides: overrides, knownnessThreshold: SHIPPED_THRESHOLD });
}

function listsOf(built: RhymeIndex, family: { seed: string; key: string }): DayLists {
  const puzzle = built.buildPuzzle(built.pinSeed(family.seed, family.key));
  return { answers: puzzle.answers.map(toDayWord), bonusWords: puzzle.bonusWords.map(toDayWord) };
}

function toDayWord(entry: PuzzleEntry) {
  return { word: entry.word, length: entry.length, knownness: entry.knownness };
}

function overrideFile(...rows: string[]): string {
  return [TIER_OVERRIDE_HEADER, ...rows, ""].join("\n");
}

/** The state the endpoint would send for this day, over the fixture's own data. */
function stateFor(built: RhymeIndex, lists: DayLists, overrides: string) {
  return tierPickerState({
    date: "2026-08-09",
    lemmaCandidates: (word) => built.derivation.lemmaCandidates(word),
    lists,
    measured: MEASURED,
    overrides,
    knownnessThreshold: SHIPPED_THRESHOLD,
  });
}

const words = (list: { word: string }[]) => list.map((w) => w.word).sort();

describe("the picker reproduces the built index before any verdict is applied", () => {
  it("resolves every word in the day to the knownness the index gave it", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const retiered = retierDay(lists, stateFor(built, lists, ""));

    expect(retiered.answers.length).toBeGreaterThan(5);
    for (const word of [...retiered.answers, ...retiered.bonusWords]) {
      expect([word.word, word.knownness]).toEqual([word.word, built.tierOf(word.word).knownness]);
    }
  });

  it("leaves the two lists and the three figures exactly as the day arrived", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const retiered = retierDay(lists, stateFor(built, lists, ""));

    expect(words(retiered.answers)).toEqual(words(lists.answers));
    expect(words(retiered.bonusWords)).toEqual(words(lists.bonusWords));
    expect(retiered.facts).toEqual(measureAnswers(lists.answers));
  });
});

describe("a verdict moves the word and the figures to where a rebuild would put them", () => {
  it("demoting an Answer to a Bonus Word matches a rebuild", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const file = overrideFile("collate,bonus,1.8,2026-08-09T10:00:00.000Z,");

    const retiered = retierDay(lists, stateFor(built, lists, file));
    const rebuilt = listsOf(index(file), ATE);

    expect(words(retiered.bonusWords)).toContain("collate");
    expect(words(retiered.answers)).toEqual(words(rebuilt.answers));
    expect(words(retiered.bonusWords)).toEqual(words(rebuilt.bonusWords));
    expect(retiered.facts).toEqual(measureAnswers(rebuilt.answers));
  });

  it("marking an Answer rare matches a rebuild, flat bonus and Difficulty and all", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const file = overrideFile("adjudicate,answer-rare,1.7,2026-08-09T10:00:00.000Z,");

    const retiered = retierDay(lists, stateFor(built, lists, file));
    const rebuilt = listsOf(index(file), ATE);

    expect(words(retiered.answers)).toEqual(words(rebuilt.answers));
    expect(retiered.facts).toEqual(measureAnswers(rebuilt.answers));
    // The rare cutoff is 0.7 and the sentinel is 0.6, so this is Score mass
    // moving into Difficulty rather than a word merely changing list.
    expect(retiered.facts.difficulty).toBeGreaterThan(
      measureAnswers(lists.answers).difficulty,
    );
  });

  it("promoting a Bonus Word to a common Answer matches a rebuild", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    // `sate` is deliberately absent from the fixture's prevalence data, so it
    // defaults to a Bonus Word and its judgement records an empty `measured`.
    const file = overrideFile("sate,answer-common,,2026-08-09T10:00:00.000Z,");

    const retiered = retierDay(lists, stateFor(built, lists, file));
    const rebuilt = listsOf(index(file), ATE);

    expect(words(retiered.answers)).toContain("sate");
    expect(words(retiered.answers)).toEqual(words(rebuilt.answers));
    expect(retiered.facts).toEqual(measureAnswers(rebuilt.answers));
  });

  /**
   * The lemma-family reach the maintainer has ruled accepted: `gates` carries no
   * prevalence row and tiers on `gate`'s, so a verdict on `gate` — a word this
   * day does not contain — moves `gates`, which it does. If the browser did not
   * follow the same lemma walk the build does, this is where it would part
   * company with a rebuild.
   */
  it("follows an override on a lemma into the derived form the day actually holds", () => {
    const built = index();
    const lists = listsOf(built, ATES);
    const file = overrideFile("gate,bonus,2.4,2026-08-09T10:00:00.000Z,");

    const retiered = retierDay(lists, stateFor(built, lists, file));
    const rebuilt = listsOf(index(file), ATES);

    expect(words(lists.answers)).toContain("gates");
    expect(words(retiered.bonusWords)).toContain("gates");
    expect(words(retiered.answers)).toEqual(words(rebuilt.answers));
    expect(words(retiered.bonusWords)).toEqual(words(rebuilt.bonusWords));
    expect(retiered.facts).toEqual(measureAnswers(rebuilt.answers));
  });

  it("names the word an inherited knownness came from, so the reach is not a mystery", () => {
    const built = index();
    const lists = listsOf(built, ATES);
    const file = overrideFile("gate,bonus,2.4,2026-08-09T10:00:00.000Z,");

    const retiered = retierDay(lists, stateFor(built, lists, file));
    const gates = retiered.bonusWords.find((w) => w.word === "gates")!;

    // The file never named `gates`, so it carries no verdict of its own.
    expect(gates.verdict).toBeNull();
    expect(gates.source).toBe("gate");
    expect(gates.sourceVerdict).toBe("bonus");
  });

  /**
   * Withdrawal and reversal are different acts (ADR-0015). `none` must put the
   * word back where prevalence had it, not pin it above the rare cutoff — which
   * is what "undoing" with `answer-common` would have done.
   */
  it("restores the measured value on `none`, matching a rebuild with the same two rows", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const file = overrideFile(
      "collate,bonus,1.8,2026-08-09T10:00:00.000Z,",
      "collate,none,1.8,2026-08-09T10:05:00.000Z,",
    );

    const retiered = retierDay(lists, stateFor(built, lists, file));
    const rebuilt = listsOf(index(file), ATE);

    expect(words(retiered.answers)).toEqual(words(rebuilt.answers));
    expect(retiered.facts).toEqual(measureAnswers(lists.answers));
    expect(retiered.answers.find((w) => w.word === "collate")!.knownness).toBe(1.8);
  });
});

describe("what the day view shows about a word's history", () => {
  it("shows the standing verdict on a word already judged on an earlier visit", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const file = overrideFile("collate,bonus,1.8,2026-08-01T10:00:00.000Z,");

    const retiered = retierDay(lists, stateFor(built, lists, file));
    const collate = retiered.bonusWords.find((w) => w.word === "collate")!;

    expect(collate.verdict).toBe("bonus");
    expect(collate.rows).toBe(1);
  });

  it("flags a word carrying more than one row, so a reversal is never invisible", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const file = overrideFile(
      "collate,bonus,1.8,2026-08-01T10:00:00.000Z,",
      "collate,none,1.8,2026-08-02T10:00:00.000Z,",
      "collate,answer-rare,1.8,2026-08-03T10:00:00.000Z,",
    );

    const retiered = retierDay(lists, stateFor(built, lists, file));
    const collate = retiered.answers.find((w) => w.word === "collate")!;

    expect(collate.verdict).toBe("answer-rare");
    expect(collate.rows).toBe(3);
  });

  it("carries no verdict and no reversal for a word the file has never named", () => {
    const built = index();
    const lists = listsOf(built, ATE);
    const retiered = retierDay(lists, stateFor(built, lists, ""));

    expect(retiered.answers.every((w) => w.verdict === null && w.rows === 0)).toBe(true);
  });
});
