/**
 * The Tier sitting (#309): the maintainer marks a sample of Answers E, H or B
 * with knownness hidden, and both lines are placed from the marks. Tested at
 * the pure module: the draw from scheduled days, and placement from fixture
 * marks. The page that takes the marks is a shell over this and is untested.
 */

import { describe, expect, it } from "vitest";
import { Derivation, IndexDataSource } from "../derivation.ts";
import type { EchoLexicon } from "../echo.ts";
import { parseLabelSet } from "../judgeLabels.ts";
import { compareSignals, consequencesAt, drawSample, marksOf, placeLines, unscheduledPool, type Mark, type MarkedWord, type SittingDay } from "../tierSitting.ts";

const day = (seedWord: string, answers: [string, number | null][], over: Partial<SittingDay> = {}): SittingDay => ({
  date: "2026-11-02",
  week: 1,
  seedWord,
  rhymeKey: `${seedWord.toUpperCase()} KEY`,
  seedKnownness: 2,
  answers: answers.map(([word, knownness]) => ({ word, length: word.length, knownness })),
  ...over,
});

/** Thirty words in every band from 0.0 to 2.5, spread over three days. */
function crowdedDays(): SittingDay[] {
  const days: SittingDay[] = [day("ship", []), day("cup", []), day("ate", [])];
  for (let band = 0; band < 10; band++) {
    for (let i = 0; i < 30; i++) days[i % 3]!.answers.push({ word: `w${band}x${i}`, length: 5, knownness: band * 0.25 + 0.01 * (i % 20) });
  }
  return days;
}

describe("drawing the sample", () => {
  it("takes fifteen Answers from each 0.25 band of knownness, each with a Seed Word it is an Answer for", () => {
    const days = crowdedDays();
    const sample = drawSample(days);
    expect(sample).toHaveLength(150);
    for (let band = 0; band < 10; band++) {
      expect(sample.filter((s) => s.word.startsWith(`w${band}x`))).toHaveLength(15);
    }
    for (const item of sample) {
      const on = days.find((d) => d.seedWord === item.seedWord)!;
      expect(on.answers.map((a) => a.word)).toContain(item.word);
      expect(item.rhymeKey).toBe(on.rhymeKey);
    }
  });

  it("draws the same sample from the same days, shuffled across bands", () => {
    const first = drawSample(crowdedDays());
    expect(drawSample(crowdedDays())).toEqual(first);
    const bands = first.map((s) => Number(s.word.slice(1, s.word.indexOf("x"))));
    expect(bands).not.toEqual([...bands].sort((a, b) => a - b));
  });

  it("takes what a short band has, and nothing outside 0.0 to 2.5 or carrying an editor's verdict", () => {
    const sample = drawSample([
      day("ship", [["lordship", 2.11], ["guardianship", 2.19], ["worship", 2.6], ["consulship", -0.4], ["hardship", null]]),
      // 3.0, 1.1 and -3.0 are what an editor's Tier verdict compiles to: no measured knownness.
      day("cup", [["teacup", 3.0], ["buttercup", 1.1], ["hiccup", 1.3]]),
    ]);
    expect(sample.map((s) => s.word).sort()).toEqual(["guardianship", "hiccup", "lordship"]);
  });

  it("draws a word that is an Answer on two days once", () => {
    const sample = drawSample([day("tear", [["bear", 2]]), day("care", [["bear", 2]])]);
    expect(sample.map((s) => s.word)).toEqual(["bear"]);
  });
});

/** A hundred Answers evenly from 0.0 to 2.475: 28 sit below today's rare line of 0.7. */
const SCHEDULED = {
  days: [day("ship", Array.from({ length: 100 }, (_, i): [string, number] => [`s${i}`, i / 40]))],
  today: { answerLine: 0, rareLine: 0.7 },
};

const LETTER: Record<string, Mark> = { E: "easy", H: "hard-find", B: "bonus" };

/** Marks in one band of the sitting, from a string such as `"BBHE"`: band 4 sits at 1.0 to 1.25. */
const band = (n: number, marks: string): MarkedWord[] =>
  [...marks].map((m, i) => ({ word: `b${n}w${i}`, knownness: n * 0.25 + 0.01 * (i + 1), frequency: null, mark: LETTER[m]! }));

/** A sitting with every band given, lowest first. */
const sitting = (...bands: string[]): MarkedWord[] => bands.flatMap((marks, n) => band(n, marks));

describe("placing the Answer line", () => {
  it("sits at the lower edge of the band where B stops being the majority", () => {
    const placed = placeLines(SCHEDULED, sitting("BBBB", "BBBH", "BBHE", "BHHE", "HHEE", "HEEE", "EEEE", "EEEE", "EEEE", "EEEE"));
    expect(placed.answerLine).toBe(0.75);
  });

  it("counts a band split exactly in half as B", () => {
    const placed = placeLines(SCHEDULED, sitting("BBBB", "BBHH", "BHHE", "HHEE", "EEEE", "EEEE", "EEEE", "EEEE", "EEEE", "EEEE"));
    expect(placed.answerLine).toBe(0.5);
  });

  it("needs every band above it to agree, so a B majority higher up lifts the line over it", () => {
    const placed = placeLines(SCHEDULED, sitting("BBBB", "HHHE", "BBBH", "HHEE", "EEEE", "BBBE", "EEEE", "EEEE", "EEEE", "EEEE"));
    expect(placed.answerLine).toBe(1.5);
  });

  it("stays at the bottom of the sitting when no band has a B majority", () => {
    const placed = placeLines(SCHEDULED, sitting("BHHE", "HHEE", "EEEE", "EEEE", "EEEE", "EEEE", "EEEE", "EEEE", "EEEE", "EEEE"));
    expect(placed.answerLine).toBe(0);
  });
});

describe("comparing the signals", () => {
  const marked = (word: string, knownness: number, frequency: number | null, m: string): MarkedWord => ({ word, knownness, frequency, mark: LETTER[m]! });
  // `guardianship` is well known and rarely said; `cat` the other way round.
  const marks = [
    marked("consulship", 0.1, 1, "B"),
    marked("objurgate", 0.3, 1.5, "B"),
    marked("guardianship", 1.9, 1.2, "B"),
    marked("cat", 0.2, 3.5, "E"),
    marked("lordship", 0.5, 3, "H"),
    marked("hardship", 1.0, 2.5, "E"),
    marked("worship", 2.0, 4, "E"),
  ];

  it("finds the best single cut on each signal, and the share of marks it agrees with on B against E and H", () => {
    const signals = compareSignals(marks);
    // A cut sits midway between the last word it calls B and the first it does not.
    expect(signals.knownness.cut).toBeCloseTo(0.15, 9);
    expect(signals.knownness.agreement).toBe(5 / 7);
    expect(signals.frequency).toMatchObject({ cut: 2, agreement: 1 });
    expect(signals.combined.agreement).toBe(1);
  });

  it("lets knownness set a minimum under frequency when neither alone separates the marks", () => {
    const signals = compareSignals([...marks, marked("abecedarian", 0.05, 3.2, "B")]);
    expect(signals.frequency.agreement).toBe(7 / 8);
    expect(signals.combined.knownnessMinimum).toBeCloseTo(0.075, 9);
    expect(signals.combined).toMatchObject({ frequencyCut: 2, agreement: 1 });
  });

  it("reads a word with no frequency as less frequent than any word that has one", () => {
    const signals = compareSignals([marked("hod", 1, null, "B"), marked("cod", 1, 3, "E")]);
    expect(signals.frequency).toMatchObject({ cut: 3, agreement: 1 });
  });

  it("scores each mark held out, by the cut fitted to all the other marks", () => {
    // In sample, a cut at 0.3 calls only `a` B and gets three of four. Held out, each
    // mark is cut on the other three: `b` on a, c and d (0.8, calling it B), `c` on
    // a, b and d (0.3, not), `a` on b, c and d (none called B), and only `d` comes out right.
    const signals = compareSignals([
      marked("a", 0.1, null, "B"),
      marked("b", 0.5, null, "E"),
      marked("c", 0.6, null, "B"),
      marked("d", 1.0, null, "E"),
    ]);
    expect(signals.knownness.agreement).toBe(3 / 4);
    expect(signals.knownness.heldOut).toBe(1 / 4);
  });

  it("reports how far the combined signal beats knownness, in sample and held out", () => {
    // Knownness separates the marks but for `e`, a B among the Es; frequency is noise
    // that happens to put `e` lowest. In sample the combined signal catches `e` on it,
    // and held out it cannot, as nothing else on the noise points that way.
    const signals = compareSignals([
      marked("a", 0.1, 3, "B"),
      marked("b", 0.2, 3, "B"),
      marked("c", 1.0, 2, "E"),
      marked("d", 1.1, 2.5, "E"),
      marked("e", 1.2, 1, "B"),
    ]);
    expect(signals.knownness).toMatchObject({ agreement: 4 / 5, heldOut: 4 / 5 });
    expect(signals.combined).toMatchObject({ agreement: 1, heldOut: 4 / 5 });
    expect(signals.combinedOverKnownness.agreement).toBeCloseTo(0.2, 9);
    expect(signals.combinedOverKnownness.heldOut).toBe(0);
  });
});

describe("placing the rare line", () => {
  it("sits at the lower edge of the lowest band in which more than half the words are E", () => {
    const placed = placeLines(SCHEDULED, sitting("BBBB", "BBBH", "BBHE", "BHHE", "HHEE", "HEEE", "EEEE", "EEEE", "EEEE", "EEEE"));
    expect(placed.rareLine).toBe(1.25);
    expect(placed.inForce).toEqual({ answerLine: 0.75, rareLine: 1.25 });
  });

  it("looks for it only at or above the Answer line, so an E majority below that line does not place it", () => {
    // Band 0 is all E, but the B majorities in bands 1 and 2 put the Answer line at 0.75.
    const placed = placeLines(SCHEDULED, sitting("EEEE", "BBBB", "BBBH", "HHEE", "HEEE", "EEEE", "EEEE", "EEEE", "EEEE", "EEEE"));
    expect(placed.answerLine).toBe(0.75);
    expect(placed.rareLine).toBe(1);
  });

  it("falls back to the line that keeps today's rare share when too few words are E to place one", () => {
    const placed = placeLines(SCHEDULED, sitting("BBBB", "BBBH", "BBHE", "BHHE", "HHEE", "HHEE", "HHHE", "HHEE", "HHEE", "HHEE"));
    expect(placed.rareLine).toBeNull();
    // The Answer at 1.1 reads as an editor's `answer-rare` verdict and is left
    // out, so 28 of 99 Answers are rare today. Above a line of 0.75 sit 69, so 19
    // stay rare: the line falls between the 19th and the 20th, at 1.225 and 1.25.
    expect(placed.rareShareLine).toBeCloseTo(1.2375, 6);
    expect(placed.inForce.rareLine).toBeCloseTo(1.2375, 6);
  });
});

describe("the marks file", () => {
  // Shaped as the page saves it: a label set beside the Judge's, asking the tier question.
  const file = {
    set: "tier-1",
    question: "tier",
    labelledBy: ["jkenna"],
    labelledOn: "2026-11-05",
    blind: true,
    rules: ["#307"],
    tuning: false,
    notes: [],
    pairs: [
      { word: "guardianship", seedWord: "ship", seedReading: null, rhymeKeyWhenCut: "IH P", verdicts: [{ labeller: "jkenna", verdict: "bonus", on: "2026-11-05", blind: true }] },
      { word: "lordship", seedWord: "ship", seedReading: null, rhymeKeyWhenCut: "IH P", verdicts: [{ labeller: "jkenna", verdict: "hard-find", on: "2026-11-05", blind: true }] },
      { word: "unmarked", seedWord: "ship", seedReading: null, rhymeKeyWhenCut: "IH P", verdicts: [] },
    ],
  };

  it("reads as a label set, and gives each word its labeller's standing mark", () => {
    const set = parseLabelSet(file);
    expect(marksOf(set, "jkenna")).toEqual([
      { word: "guardianship", seedWord: "ship", mark: "bonus" },
      { word: "lordship", seedWord: "ship", mark: "hard-find" },
    ]);
  });

  it("refuses a mark that is not E, H or B, and a tier mark on a rhyme set", () => {
    const wrong = structuredClone(file);
    wrong.pairs[0]!.verdicts[0]!.verdict = "rhyme";
    expect(() => parseLabelSet(wrong)).toThrow(/rhyme, which a tier set does not have/);
    expect(() => parseLabelSet({ ...file, question: "rhyme" })).toThrow(/bonus, which a rhyme set does not have/);
  });
});

describe("what the placed lines would do", () => {
  /** `n` five-letter Answers at one knownness, named from `stem`. */
  const many = (stem: string, n: number, knownness: number) =>
    Array.from({ length: n }, (_, i) => ({ word: `${stem}${i}`, length: 5, knownness }));
  const five = (word: string, knownness: number) => ({ word, length: 5, knownness });
  const LINES = { answerLine: 1, rareLine: 1.5 };

  const days: SittingDay[] = [
    // Mon: 12 common and 3 rare survive the line, so 15 Answers; 10 fall to Bonus Word.
    { date: "2026-11-02", week: 1, seedWord: "ship", rhymeKey: "IH P", seedKnownness: 2, answers: [...many("a", 12, 2), ...many("r", 3, 1.2), ...many("c", 10, 0.5)] },
    // Tue: a Seed Word below the line, and 7 Answers, two of them held by an editor's verdict (common and rare).
    { date: "2026-11-03", week: 1, seedWord: "cup", rhymeKey: "AH P", seedKnownness: 0.8, answers: [...many("u", 5, 2), five("teacup", 3.0), five("buttercup", 1.1)] },
    // Mon: no rare Answer at all.
    { date: "2026-11-09", week: 2, seedWord: "ate", rhymeKey: "EY T", seedKnownness: 2, answers: many("e", 25, 2) },
    { date: "2026-11-10", week: 2, seedWord: "fine", rhymeKey: "AY N", seedKnownness: 2, answers: [...many("f", 20, 2), ...many("g", 5, 1.2)] },
  ];
  const pool = [
    { seedWord: "bake", rhymeKey: "EY K", seedKnownness: 2, answers: many("b", 25, 2) },
    { seedWord: "moon", rhymeKey: "UW N", seedKnownness: 2, answers: [...many("m", 22, 2), ...many("n", 3, 1.2)] },
    { seedWord: "loon", rhymeKey: "UW N Z", seedKnownness: 0.5, answers: many("l", 25, 2) },
    { seedWord: "dune", rhymeKey: "UW N D", seedKnownness: 2, answers: many("d", 12, 2) },
  ];
  const at = consequencesAt(LINES, { days, pool });

  it("lists the Answers that become Bonus Words, and keeps an editor's verdict where it stands", () => {
    expect(at.answersToBonus.map((c) => c.word).sort()).toEqual(many("c", 10, 0).map((a) => a.word).sort());
  });

  it("finds the days under 20 and under 10 Answers, and the Seed Words below the Answer line", () => {
    expect(at.daysUnderBand.map((d) => [d.date, d.answerCount])).toEqual([["2026-11-02", 15], ["2026-11-03", 7]]);
    expect(at.daysToReplace.map((d) => d.seedWord)).toEqual(["cup"]);
    expect(at.seedWordsBelowLine.map((d) => d.seedWord)).toEqual(["cup"]);
  });

  it("finds the days with Difficulty 0 and the weeks that no longer run easiest to hardest", () => {
    expect(at.difficultyZero.map((d) => d.seedWord)).toEqual(["ate"]);
    // Week 1: ship is 21/81 rare, cup 7/37, so Monday is now harder than Tuesday.
    expect(at.weeksOutOfRamp).toEqual([1]);
  });

  it("offers unscheduled Seed Words for a day under 10, nearest its weekday's Difficulty, each big enough with its Seed Word an Answer", () => {
    expect(at.replacements).toEqual([{ date: "2026-11-03", seedWord: "cup", candidates: ["moon", "bake"] }]);
  });
});

describe("the unscheduled Seed pool (#311)", () => {
  const five = (word: string) => ({ word, length: 5, knownness: 2 });
  const family = (seedWord: string, rhymeKey: string, answers: string[]) => ({ seedWord, rhymeKey, seedKnownness: 2, answers: answers.map(five) });
  const days: SittingDay[] = [
    day("wall", [["ball", 2], ["call", 2]], { rhymeKey: "AA L" }),
    day("hire", [["fire", 2], ["expire", 2]], { rhymeKey: "AY ER" }),
  ];
  // Words and their Rhyme Keys, all with wordhood: enough to tell an Echo.
  const keys: Record<string, string> = {
    ball: "AA L", call: "AA L", wall: "AA L", balls: "AA L Z", calls: "AA L Z", walls: "AA L Z", dolls: "AA L Z",
    fire: "AY ER", hire: "AY ER", expire: "AY ER", moon: "UW N", soon: "UW N", tune: "UW N",
  };
  const words = new Set(Object.keys(keys));
  const lex: EchoLexicon = {
    derivation: new Derivation(new IndexDataSource({ words, pronunciations: new Map() })),
    hasWord: (w) => words.has(w),
    rhymeKeysOf: (w) => (keys[w] ? [keys[w]] : []),
  };

  it("keeps a family no scheduled day holds", () => {
    const moon = family("moon", "UW N", ["soon", "tune"]);
    expect(unscheduledPool([moon], days, lex)).toEqual([moon]);
  });

  it("passes over a family on a Rhyme Key the Schedule holds", () => {
    expect(unscheduledPool([family("ball", "AA L", ["wall", "call"])], days, lex)).toEqual([]);
  });

  it("passes over a family whose Seed Word already holds a place under another Rhyme Key", () => {
    // `wall` leads AA AH L as well as AA L, where it is scheduled.
    expect(unscheduledPool([family("wall", "AA AH L", ["squall", "brawl"])], days, lex)).toEqual([]);
  });

  it("passes over a family whose Puzzle a scheduled day already holds under another Rhyme Key spelling", () => {
    // `expire` on AY R holds the Answers `hire` holds on AY ER: the same Puzzle in a second place.
    expect(unscheduledPool([family("expire", "AY R", ["fire", "hire"])], days, lex)).toEqual([]);
  });

  it("passes over a family that would be an Echo of the scheduled days (#315)", () => {
    // Every Answer is a `wall` word with an `s`, and none is native.
    expect(unscheduledPool([family("dolls", "AA L Z", ["balls", "calls", "walls"])], days, lex)).toEqual([]);
  });
});
