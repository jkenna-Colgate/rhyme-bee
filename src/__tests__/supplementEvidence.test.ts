/**
 * The evidence a supplement judge needs for one word against one target Rhyme
 * Key: wordhood, name status, any direct reading it already carries, and its
 * inflectional relatives' readings — the same evidence the queue-driven report
 * has always shown, pulled out so a supplied word list can get it too (#70).
 */

import { describe, expect, it } from "vitest";
import { gatherEvidence } from "../supplementEvidence.ts";
import { Derivation, IndexDataSource } from "../derivation.ts";
import type { Pronunciation } from "../phonology.ts";

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
