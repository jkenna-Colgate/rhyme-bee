/**
 * Label sets and the Judge's score against them (#250). A label set is the
 * maintainer's verdicts as authored input, one file per set in
 * `data/judge-labels/`; the scorer never knows whose labels it reads, so every
 * figure is stated per labeller, and the rules fill in only the pairs no person
 * ruled.
 */

import { describe, expect, it } from "vitest";
import type { RhymeRuling, WordhoodRuling } from "../judge.ts";
import { parseLabelSet, scoreRhymes, scoreWordhood, standingVerdict, type LabelVerdict, type RuledPair } from "../judgeLabels.ts";

const v = (verdict: string, over: Partial<LabelVerdict> = {}): LabelVerdict => ({ labeller: "jkenna", verdict, on: "2026-10-07", blind: true, ...over });
const rhyme = (reading: string, confidence: RhymeRuling["confidence"] = "high"): RhymeRuling => ({ verdict: "rhyme", reading, confidence, why: "" });
const noRhyme: RhymeRuling = { verdict: "no-rhyme", reading: null, confidence: "high", why: "" };

const ruled = (over: Partial<RuledPair>): RuledPair => ({
  word: "grates",
  seedWord: "plates",
  rhymeKey: "EY T S",
  question: { ask: "missing-reading" },
  rule: { verdict: "ask", why: "" },
  ruling: rhyme("G R EY1 T S"),
  verdicts: [],
  ...over,
});

const SET = {
  set: "heldout-2",
  question: "rhyme",
  labelledBy: ["jkenna"],
  labelledOn: "2026-10-07",
  blind: true,
  rules: ["#232"],
  tuning: false,
  notes: [],
  pairs: [{ word: "grates", seedWord: "plates", seedReading: "P L EY1 T S", rhymeKeyWhenCut: "EY T S", wiktionary: [], verdicts: [v("rhyme")] }],
};

describe("a label set", () => {
  it("reads a set with its header and verdicts", () => {
    const set = parseLabelSet(SET);
    expect([set.set, set.question, set.tuning, set.pairs[0]!.verdicts[0]!.verdict]).toEqual(["heldout-2", "rhyme", false, "rhyme"]);
  });

  it("refuses a verdict that names no labeller, or one the question does not have", () => {
    const pairs = (verdicts: unknown[]) => [{ ...SET.pairs[0], verdicts }];
    expect(() => parseLabelSet({ ...SET, pairs: pairs([{ verdict: "rhyme", on: "2026-10-07", blind: true }]) })).toThrow(/labeller/);
    expect(() => parseLabelSet({ ...SET, pairs: pairs([v("not-a-word")]) })).toThrow(/not-a-word/);
  });
});

describe("the verdict that stands", () => {
  const pair = { verdicts: [v("no-rhyme", { superseded: true }), v("rhyme", { on: "2026-10-13" }), v("no-rhyme", { on: "2026-10-13", blind: false })] };

  it("is a labeller's latest blind verdict that nothing has superseded", () => {
    expect(standingVerdict(pair, "jkenna", { blindOnly: true })?.verdict).toBe("rhyme");
  });

  it("is a verdict taken back after seeing the Judge only when asked for", () => {
    expect(standingVerdict(pair, "jkenna", { blindOnly: false })?.verdict).toBe("no-rhyme");
  });

  it("is nobody else's", () => {
    expect(standingVerdict(pair, "someone-else", { blindOnly: true })).toBeNull();
  });
});

describe("the Judge's score on a rhyme set", () => {
  it("counts a Rhyme only when the reading the Judge gives reaches the key", () => {
    const score = scoreRhymes([
      ruled({ verdicts: [v("rhyme")] }),
      ruled({ word: "crates", verdicts: [v("rhyme")], ruling: rhyme("K R AE1 T S") }),
    ], "jkenna", { blindOnly: true });

    expect([score.agreed, score.scored]).toEqual([1, 2]);
    expect(score.misses.map((m) => m.word)).toEqual(["crates"]);
  });

  it("takes the rules' label where no person ruled, and a person's over the rules'", () => {
    const score = scoreRhymes([
      ruled({ rule: { verdict: "rhyme", why: "" } }),
      ruled({ word: "crates", rule: { verdict: "rhyme", why: "" }, verdicts: [v("no-rhyme")] }),
    ], "jkenna", { blindOnly: true });

    expect(score.fromRules).toEqual({ scored: 1, agreed: 1 });
    expect(score.fromLabeller).toEqual({ scored: 1, agreed: 0 });
  });

  it("leaves out a pair the labeller was shown and would not rule, whatever the rules say", () => {
    const score = scoreRhymes([ruled({ rule: { verdict: "rhyme", why: "" }, verdicts: [v("out")] })], "jkenna", { blindOnly: true });
    expect(score.scored).toBe(0);
  });

  it("leaves out a pair the rules keep out of the question or put to a person who has not ruled", () => {
    const score = scoreRhymes([ruled({ rule: { verdict: "out", why: "" } }), ruled({ word: "crates" })], "jkenna", { blindOnly: true });
    expect(score.scored).toBe(0);
  });

  it("states where the rulings would land, and how many of those land on a pair labelled no Rhyme", () => {
    const score = scoreRhymes([
      ruled({ verdicts: [v("rhyme")] }),
      ruled({ word: "crates", ruling: rhyme("K R EY1 T S"), verdicts: [v("no-rhyme")] }),
      ruled({ word: "freights", question: { ask: "overrule" }, ruling: rhyme("F R EY1 T S"), verdicts: [v("rhyme")] }),
      ruled({ word: "weights", ruling: rhyme("W EY1 T S", "medium"), verdicts: [v("rhyme")] }),
      ruled({ word: "baits", question: { ask: "overrule" }, ruling: noRhyme, verdicts: [v("no-rhyme")] }),
    ], "jkenna", { blindOnly: true });

    expect(score.wouldLand).toEqual({
      reading: { written: 2, wrong: 1 },
      "unconfirmed-rhyme": { written: 2, wrong: 0 },
    });
  });

  it("breaks agreement down by what the game knew and by the Judge's confidence", () => {
    const score = scoreRhymes([
      ruled({ verdicts: [v("rhyme")] }),
      ruled({ word: "baits", question: { ask: "overrule" }, ruling: { ...noRhyme, confidence: "medium" }, verdicts: [v("rhyme")] }),
      ruled({ word: "plate", question: { setAside: "already-rhymes" }, ruling: rhyme("P L EY1 T S"), verdicts: [v("rhyme")] }),
    ], "jkenna", { blindOnly: true });

    expect(score.byCase).toEqual({
      "missing-reading": { scored: 1, agreed: 1 },
      overrule: { scored: 1, agreed: 0 },
      "already-rhymes": { scored: 1, agreed: 1 },
    });
    expect(score.byConfidence).toEqual({ high: { scored: 2, agreed: 2 }, medium: { scored: 1, agreed: 0 } });
    expect(score.confusion).toEqual({ "rhyme -> rhyme": 2, "rhyme -> no-rhyme": 1 });
  });
});

describe("the Judge's score on a wordhood set", () => {
  it("counts the names and non-words it holds back, and the words it leaves alone", () => {
    const pairs = [
      { word: "heinz", verdicts: [v("not-a-word")] },
      { word: "kish", verdicts: [v("not-a-word")] },
      { word: "sue", verdicts: [v("word")] },
    ];
    const rulings: WordhoodRuling[] = [
      { word: "heinz", verdict: "name", confidence: "high", why: "" },
      { word: "kish", verdict: "word", confidence: "low", why: "" },
      { word: "sue", verdict: "word", confidence: "high", why: "" },
    ];
    const score = scoreWordhood(pairs, rulings, "jkenna", { blindOnly: true });

    expect(score.caught).toEqual({ scored: 2, agreed: 1 });
    expect(score.leftAlone).toEqual({ scored: 1, agreed: 1 });
    expect(score.misses.map((m) => m.word)).toEqual(["kish"]);
  });
});
