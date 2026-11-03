/**
 * The Answers that only Normalisation puts on a day's Rhyme Key (#296; ADR-0021,
 * 2026-11-02 amendment), and the trial that scores the Judge on them against
 * the maintainer's rulings, as pure functions.
 */

import { describe, expect, it } from "vitest";
import {
  appendedOnlyAnswers,
  GIVEN_RULINGS,
  parseSampleRuling,
  reachesKeyOnlyByAppended,
  sampleAcrossDays,
  samplePrompt,
  scoreTrial,
  type TrialItem,
} from "../appendedReadings.ts";
import type { RhymeRuling } from "../judge.ts";
import type { Pronunciation } from "../phonology.ts";

const r = (s: string): Pronunciation => s.split(" ");
const source = (s: string) => ({ pronunciation: r(s), generated: false });
const appended = (s: string) => ({ pronunciation: r(s), generated: true });

describe("reachesKeyOnlyByAppended", () => {
  it("holds for a word whose only reading on the key Normalisation appended (`annual` for `cool` before the fix)", () => {
    expect(reachesKeyOnlyByAppended([source("AE1 N Y UW0 AH0 L"), appended("AE1 N Y UW2 L")], ["UW L"])).toBe(true);
  });

  it("does not hold when a reading a source transcribed reaches the key as well (`module`)", () => {
    expect(reachesKeyOnlyByAppended([source("M AA1 JH UW0 L"), source("M AA1 JH UW2 L"), appended("M AA1 JH AH0 L")], ["UW L"])).toBe(false);
  });

  it("does not hold for a word with no reading on the key at all", () => {
    expect(reachesKeyOnlyByAppended([source("F UW1 D")], ["UW L"])).toBe(false);
  });

  it("reads the merged keys as the key: a source reading on the Schwa Twin keeps the word out", () => {
    const keys = ["EH K SH AH N", "EH K SH N"];
    expect(reachesKeyOnlyByAppended([source("S AH1 B S EH2 K SH N")], keys)).toBe(false);
    expect(reachesKeyOnlyByAppended([source("IH0 N S EH1 K SH AH0 N"), appended("IH0 N S EH1 K SH N")], keys)).toBe(false);
  });

  it("and an appended reading on the Schwa Twin, with nothing from a source on either key, puts it in", () => {
    expect(reachesKeyOnlyByAppended([source("K AH1 M EH0 K SH AH0 N"), appended("K AH1 M EH2 K SH N")], ["EH K SH AH N", "EH K SH N"])).toBe(true);
  });
});

describe("appendedOnlyAnswers", () => {
  const READINGS: Record<string, ReturnType<typeof source>[]> = {
    annual: [source("AE1 N Y UW0 AH0 L"), appended("AE1 N Y UW2 L")],
    manual: [source("M AE1 N Y UW0 AH0 L"), appended("M AE1 N Y UW2 L")],
    module: [source("M AA1 JH UW0 L"), source("M AA1 JH UW2 L")],
    pool: [source("P UW1 L")],
  };

  it("picks the day's Answers on the key only through appended readings, once each, in alphabetical order", () => {
    const got = appendedOnlyAnswers(["pool", "manual", "module", "annual", "manual"], ["UW L"], (w) => READINGS[w] ?? []);
    expect(got).toEqual(["annual", "manual"]);
  });
});

describe("sampleAcrossDays", () => {
  const day = (date: string, seedWord: string, words: string[]) => ({ date, seedWord, rhymeKey: "K", words });
  const DAYS = [
    day("2027-01-01", "a", ["a1", "a2", "a3"]),
    day("2027-01-02", "b", []),
    day("2027-01-03", "c", ["c1"]),
    day("2027-01-04", "d", ["d1", "d2"]),
    day("2027-01-05", "e", ["e1"]),
    day("2027-01-06", "f", ["f1", "f2", "f3"]),
  ];

  it("takes one word from each of n days spread evenly across the days that have any, skipping the days already ruled on", () => {
    // Eligible days, in date order: a, c, e, f (d is ruled on, b has no word). Two spread evenly are c and f.
    const got = sampleAcrossDays(DAYS, 2, new Set(["d"]));
    expect(got.map((p) => p.seedWord)).toEqual(["c", "f"]);
    expect(got[0]).toEqual({ word: "c1", seedWord: "c", rhymeKey: "K", date: "2027-01-03" });
    expect(got[1]!.word).toBe("f2");
  });

  it("takes every eligible day once when asked for more than there are", () => {
    expect(sampleAcrossDays(DAYS, 10, new Set()).map((p) => p.seedWord)).toEqual(["a", "c", "d", "e", "f"]);
  });

  it("is the same sample every time it is drawn", () => {
    expect(sampleAcrossDays(DAYS, 3, new Set())).toEqual(sampleAcrossDays(DAYS, 3, new Set()));
  });
});

describe("the maintainer's ruling on a sampled word", () => {
  it("reads y as a Rhyme, n as no Rhyme and s as skipped, whatever the case and spacing", () => {
    expect(parseSampleRuling("y")).toBe("rhyme");
    expect(parseSampleRuling(" N ")).toBe("no-rhyme");
    expect(parseSampleRuling("s")).toBe("skip");
  });

  it("refuses anything else, so the caller asks again", () => {
    for (const typed of ["", "yes please", "x", "y n", "constructor"]) expect(parseSampleRuling(typed)).toBeNull();
  });

  it("names every command it reads in the prompt, and asks about the word for the Seed Word", () => {
    const lines = samplePrompt({ word: "annual", seedWord: "cool", rhymeKey: "UW L", date: "2026-11-13" });
    expect(lines.join("\n")).toContain("annual");
    expect(lines.join("\n")).toContain("cool");
    const commands = lines.map((l) => /^\s+(\S+)\s{2,}/.exec(l)?.[1]).filter((c): c is string => !!c);
    expect(commands.sort()).toEqual(["n", "s", "y"]);
    for (const c of commands) expect(parseSampleRuling(c)).not.toBeNull();
  });
});

describe("the maintainer's given rulings", () => {
  it("are the eight the ticket gives: chess's and event's words no Rhyme, shoot's, lawn's and hire's Rhymes", () => {
    expect(GIVEN_RULINGS.map((g) => `${g.word}/${g.seedWord}/${g.maintainer}`).sort()).toEqual([
      "admire/hire/rhyme",
      "comment/event/no-rhyme",
      "document/event/no-rhyme",
      "flavorless/chess/no-rhyme",
      "gutless/chess/no-rhyme",
      "neon/lawn/rhyme",
      "thankfulness/chess/no-rhyme",
      "tribute/shoot/rhyme",
    ]);
  });
});

describe("scoreTrial", () => {
  const KEYS: Record<string, string> = { chess: "EH S", event: "EH N T", shoot: "UW T", lawn: "AA N", hire: "AY ER", cool: "UW L" };
  const judge = (verdict: RhymeRuling["verdict"], confidence: RhymeRuling["confidence"]): RhymeRuling => ({ verdict, confidence, reading: null, why: "" });
  /** What the Judge is taken to have said of each given pair, for the test. */
  const SAID: Record<string, RhymeRuling> = {
    gutless: judge("no-rhyme", "high"),
    flavorless: judge("no-rhyme", "medium"),
    thankfulness: judge("rhyme", "high"),
    comment: judge("no-rhyme", "high"),
    document: judge("no-ruling", "low"),
    tribute: judge("rhyme", "high"),
    neon: judge("no-rhyme", "high"),
    admire: judge("rhyme", "medium"),
  };
  const items: TrialItem[] = [
    ...GIVEN_RULINGS.map((g) => ({ ...g, rhymeKey: KEYS[g.seedWord]!, from: "given" as const, judge: SAID[g.word]! })),
    { word: "annual", seedWord: "cool", rhymeKey: "UW L", from: "sampled", maintainer: "no-rhyme", judge: judge("no-rhyme", "high") },
    { word: "module", seedWord: "cool", rhymeKey: "UW L", from: "sampled", maintainer: "skip", judge: judge("no-rhyme", "high") },
  ];
  const score = scoreTrial(items);

  it("compares the Judge's verdict with every ruling the maintainer gave, leaving out a skip", () => {
    expect(score.compared).toBe(9);
    expect(score.agreed).toBe(6);
    expect(score.rate).toBeCloseTo(6 / 9);
    expect(score.byFrom).toEqual({ given: [5, 8], sampled: [1, 1] });
  });

  it("counts a ruling the Judge gave none of as a disagreement, and states agreement at each confidence the Judge gave", () => {
    expect(score.byConfidence).toEqual({ high: [4, 6], medium: [2, 2], low: [0, 1] });
  });

  it("says what the hunt would do: how many false accepts its ruling list catches, and how many Rhymes it puts on the list", () => {
    // Only a high-confidence no Rhyme goes on the list, as rulingList puts it.
    expect(score.falseAcceptsListed).toEqual([3, 6]);
    expect(score.rhymesListed).toEqual([1, 3]);
  });

  it("names every disagreement", () => {
    expect(score.misses.map((m) => m.word).sort()).toEqual(["document", "neon", "thankfulness"]);
  });

  it("has no rate when the maintainer gave nothing to compare", () => {
    expect(scoreTrial([]).rate).toBeNull();
  });
});
