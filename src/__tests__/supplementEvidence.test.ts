/**
 * The evidence a supplement judge needs for one word against one target Rhyme
 * Key: wordhood, name status, any direct reading it already carries, and its
 * inflectional relatives' readings — the same evidence the queue-driven report
 * has always shown, pulled out so a supplied word list can get it too (#70).
 */

import { describe, expect, it } from "vitest";
import { composeReading, gatherEvidence, verifyReading } from "../supplementEvidence.ts";
import { Derivation, IndexDataSource } from "../derivation.ts";
import { rhymeKeyOf, type Pronunciation } from "../phonology.ts";

function context(overrides: {
  pronunciations?: [string, Pronunciation[]][];
  words?: string[];
  names?: string[];
} = {}) {
  const pronunciations = new Map(overrides.pronunciations ?? []);
  const words = new Set(overrides.words ?? []);
  const names = new Set(overrides.names ?? []);
  const derivation = new Derivation(new IndexDataSource({ words, pronunciations }));
  return { pronunciations, words, names, derivation };
}

describe("gatherEvidence", () => {
  it("reports a word absent from the dictionary with no relatives", () => {
    const ctx = context();
    const evidence = gatherEvidence("overjoy", "OY", ctx);

    expect(evidence.word).toBe("overjoy");
    expect(evidence.target).toBe("OY");
    expect(evidence.isWord).toBe(false);
    expect(evidence.isName).toBe(false);
    expect(evidence.direct).toEqual([]);
    expect(evidence.rhymesDirectly).toBe(false);
    expect(evidence.relatives).toEqual([]);
  });

  it("finds an inflectional relative, whose own Rhyme Key includes the inflection", () => {
    // overjoyed's own Rhyme Key is "OY D" (the -ed's D is part of it) — the
    // judge still has to strip the inflection by hand to compare against a
    // bare target like "OY"; this evidence reports the relative's key as-is.
    const ctx = context({
      pronunciations: [["overjoyed", [["OW2", "V", "ER0", "JH", "OY1", "D"]]]],
    });
    const evidence = gatherEvidence("overjoy", "OY D", ctx);

    expect(evidence.direct).toEqual([]);
    expect(evidence.relatives).toEqual([
      {
        word: "overjoyed",
        readings: [{ phonemes: ["OW2", "V", "ER0", "JH", "OY1", "D"], key: "OY D" }],
        rhymes: true,
      },
    ]);
  });

  it("does not rhyme a relative whose own key differs from the target", () => {
    const ctx = context({
      pronunciations: [["overjoyed", [["OW2", "V", "ER0", "JH", "OY1", "D"]]]],
    });
    const evidence = gatherEvidence("overjoy", "OY", ctx);

    expect(evidence.relatives[0]).toMatchObject({ word: "overjoyed", rhymes: false });
  });

  it("reports a word with a direct reading as a correction case, rhyming or not", () => {
    // viceroy's stress currently lands on its first syllable, so the reading's
    // last STRESSED vowel is AY1, not the unstressed final OY0 — the Rhyme Key
    // runs from there: "AY S R OY", not "OY". A misplaced-stress correction
    // case exactly like the one docs/agents/supplement-judge.md walks through.
    const ctx = context({
      pronunciations: [["viceroy", [["V", "AY1", "S", "R", "OY0"]]]],
      words: ["viceroy"],
    });
    const evidence = gatherEvidence("viceroy", "OY", ctx);

    expect(evidence.isWord).toBe(true);
    expect(evidence.direct).toEqual([
      { phonemes: ["V", "AY1", "S", "R", "OY0"], key: "AY S R OY" },
    ]);
    expect(evidence.rhymesDirectly).toBe(false);
    // A word with a direct reading is never sent looking for relatives — the
    // correction case and the derivation case are mutually exclusive.
    expect(evidence.relatives).toEqual([]);
  });

  it("reports a name as a name, independent of wordhood or readings", () => {
    const ctx = context({ names: ["hyundai"] });
    const evidence = gatherEvidence("hyundai", "EY", ctx);

    expect(evidence.isName).toBe(true);
    expect(evidence.isWord).toBe(false);
  });

  it("normalises the supplied word the same way CMUdict lookups do", () => {
    const ctx = context({
      pronunciations: [["skate", [["S", "K", "EY1", "T"]]]],
      words: ["skate"],
    });
    const evidence = gatherEvidence("  Skate ", "EY T", ctx);

    expect(evidence.word).toBe("skate");
    expect(evidence.isWord).toBe(true);
    expect(evidence.rhymesDirectly).toBe(true);
  });
});

/**
 * Composition: a reading for a word the pinned sources do not read, built from
 * a compound split so the editor never hand-authors ARPAbet (ADR-0014).
 *
 * The rule is the one the existing supplement entries were authored under by
 * hand — head, plus tail with its stress demoted to secondary — and the whole
 * safety of it rests on the last assertion in each pair: a proposal is accepted
 * only when its computed Rhyme Key equals the target, whoever proposed it.
 */
describe("composing a reading", () => {
  const compounds = {
    place: [["P", "L", "EY1", "S"]] as Pronunciation[],
    holder: [["HH", "OW1", "L", "D", "ER0"]] as Pronunciation[],
    ache: [["EY1", "K"]] as Pronunciation[],
    tooth: [["T", "UW1", "TH"]] as Pronunciation[],
  };
  const ctx = context({ pronunciations: Object.entries(compounds) });

  it("yields a reading whose Rhyme Key equals the target", () => {
    const composed = composeReading("placeholder", "OW L D ER", ctx);
    expect(composed?.key).toBe("OW L D ER");
    expect(rhymeKeyOf(composed!.phonemes)).toBe("OW L D ER");
  });

  it("demotes every primary stress in the tail to secondary", () => {
    // The whole point of the rule: `holder` keeps its vowel but not its primary
    // stress, which is what makes the compound's Rhyme Key come out right.
    const composed = composeReading("placeholder", "OW L D ER", ctx);
    expect(composed?.phonemes).toEqual(["P", "L", "EY1", "S", "HH", "OW2", "L", "D", "ER0"]);
    expect(composed?.tail).toEqual({ word: "holder", phonemes: ["HH", "OW1", "L", "D", "ER0"] });
  });

  it("reports the parts it came from, so the proposal is inspectable", () => {
    const composed = composeReading("toothache", "EY K", ctx);
    expect(composed?.head).toEqual({ word: "tooth", phonemes: ["T", "UW1", "TH"] });
    expect(composed?.tail.word).toBe("ache");
  });

  it("rejects a split that produces the wrong Rhyme Key rather than returning it", () => {
    // `place` + `holder` composes perfectly well; it just does not rhyme on the
    // target it was asked for, and an unverified reading is never handed back.
    expect(composeReading("placeholder", "EY K", ctx)).toBeNull();
  });

  it("yields nothing for a word with no viable split", () => {
    expect(composeReading("objurgate", "EY T", ctx)).toBeNull();
  });

  it("searches every reading of both parts, not only the first", () => {
    // `read` has two readings and only the second reaches the target. Taking
    // each part's first reading alone would lose the word silently.
    const twoReadings = context({
      pronunciations: [
        ["proof", [["P", "R", "UW1", "F"]]],
        ["read", [["R", "IY1", "D"], ["R", "EH1", "D"]]],
      ],
    });
    const composed = composeReading("proofread", "EH D", twoReadings);
    expect(composed?.phonemes).toEqual(["P", "R", "UW1", "F", "R", "EH2", "D"]);
  });
});

describe("verifying a reading", () => {
  it("accepts a supplied reading whose Rhyme Key equals the target", () => {
    expect(verifyReading(["HH", "AE1", "N", "D", "B", "R", "EY2", "K"], "EY K")).toBe(true);
  });

  it("rejects an arbitrary supplied reading that misses the target", () => {
    // The agent path rests on exactly this: authorship is delegated, the check
    // is not, and a returned reading is held to the same bar as a composed one.
    expect(verifyReading(["HH", "AE1", "N", "D", "B", "R", "EY2", "K"], "OW L D ER")).toBe(false);
  });

  it("rejects a reading with no stressed vowel at all", () => {
    expect(verifyReading(["AH0", "K"], "EY K")).toBe(false);
  });
});

describe("what composition is not for", () => {
  it("leaves a word that already has a reading alone, however wrong that reading", () => {
    // A word with a non-rhyming direct reading is a *correction*, not an add:
    // overriding an upstream pronunciation by machine is a bigger claim than
    // filling a gap, and stays the deliberate hand-edit it is today.
    const ctx = context({
      pronunciations: [
        ["candleholder", [["K", "AE1", "N", "D", "AH0", "L", "HH", "OW0", "L", "D", "ER0"]]],
        ["candle", [["K", "AE1", "N", "D", "AH0", "L"]]],
        ["holder", [["HH", "OW1", "L", "D", "ER0"]]],
      ],
    });
    const evidence = gatherEvidence("candleholder", "OW L D ER", ctx);
    expect(evidence.direct).toHaveLength(1);
    expect(evidence.rhymesDirectly).toBe(false);
    expect(evidence.composed).toBeNull();
  });

  it("offers a composed reading as evidence for a word with no reading at all", () => {
    const ctx = context({
      pronunciations: [
        ["candle", [["K", "AE1", "N", "D", "AH0", "L"]]],
        ["holder", [["HH", "OW1", "L", "D", "ER0"]]],
      ],
    });
    const evidence = gatherEvidence("candleholder", "OW L D ER", ctx);
    expect(evidence.composed?.key).toBe("OW L D ER");
    expect(evidence.composed?.head.word).toBe("candle");
  });
});
