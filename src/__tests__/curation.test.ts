/**
 * Slice: the family-size histogram and candidate Seed Word list. Curation runs
 * buildPuzzle over every distinct Rhyme Key, dedupes by key (not spelling),
 * filters to a configurable size band, and records why each excluded family was
 * dropped.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { makeShortPluralIndex } from "../__fixtures__/shortPlurals.ts";
import { curate, DEFAULT_PLAYABLE_BAND, playableSeeds } from "../curation.ts";
import type { Pronunciation } from "../phonology.ts";
import { RhymeIndex, type RhymeIndexData } from "../rhymeIndex.ts";
import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from "../scoring.ts";
import { score, startSession } from "../session.ts";

const index = makeTestIndex();

describe("families are keyed by Rhyme Key, not spelling", () => {
  const report = curate(index, { sizeBand: { min: 1, max: 100 } });

  it("collapses every word sharing a Rhyme Key into one family", () => {
    const keys = report.families.map((f) => f.rhymeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("counts a family's Answers", () => {
    const family = report.families.find((f) => f.rhymeKey === "EY T");
    // late, eight, collate, impregnate, adjudicate, defenestrate, gate.
    expect(family?.answerCount).toBe(7);
  });

  it("emits a histogram of answer-count -> number of families", () => {
    const total = [...report.histogram.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(report.families.length);
  });

  it("flags a representative that has more than one pronunciation", () => {
    // `read` (IY D and EH D) is the only word under key IY D, so it represents
    // it and is flagged; `bed` represents EH D and is not.
    expect(report.families.find((f) => f.rhymeKey === "IY D")?.multiplePronunciations).toBe(true);
    expect(report.families.find((f) => f.rhymeKey === "EH D")?.multiplePronunciations).toBe(false);
  });
});

describe("the size band and exclusions", () => {
  it("drops families outside the band with a reason", () => {
    const report = curate(index, { sizeBand: { min: 3, max: 5 } });
    const above = report.dropped.find((d) => d.rhymeKey === "EY T");
    expect(above?.reason).toBe("above-band"); // 7 answers > 5
    expect(report.candidates).not.toContainEqual(
      expect.objectContaining({ rhymeKey: "EY T" }),
    );
  });

  it("excludes an accent-unstable Rhyme Key (ate splits US/UK, ADR-0002)", () => {
    const report = curate(index, {
      sizeBand: { min: 1, max: 100 },
      accentUnstable: new Set(["EY T"]),
    });
    expect(report.dropped.find((d) => d.rhymeKey === "EY T")?.reason).toBe("accent-unstable");
  });

  it("blocks a Seed Word with a note that survives the report", () => {
    const report = curate(index, {
      sizeBand: { min: 1, max: 100 },
      blocked: new Map([["bed", "reserved for the tutorial family"]]),
    });
    const dropped = report.dropped.find((d) => d.representative === "bed");
    expect(dropped?.reason).toBe("blocked");
    expect(dropped?.note).toBe("reserved for the tutorial family");
  });
});

// --- Shadow Keys: a Rhyme Key with no native content is barred as a Seed --------

describe("Shadow Keys are dropped from the candidate pool (ADR-0008)", () => {
  const report = curate(makeShadowIndex(), { sizeBand: { min: 1, max: 100 } });

  it("drops a key whose every member is a derived form, with reason shadow-key", () => {
    const dropped = report.dropped.find((d) => d.rhymeKey === "AW N Z");
    expect(dropped?.reason).toBe("shadow-key");
    expect(report.candidates).not.toContainEqual(
      expect.objectContaining({ rhymeKey: "AW N Z" }),
    );
  });

  it("keeps a key that holds native words even when it also holds derived ones", () => {
    // AY N D: find/mind/blind are native; `combined` is derived from `combine`.
    const family = report.candidates.find((f) => f.rhymeKey === "AY N D");
    expect(family).toBeDefined();
    expect(family?.nativeCount).toBe(3);
  });

  it("reports a shadow key's native content as zero", () => {
    const shadow = report.families.find((f) => f.rhymeKey === "AW N Z");
    expect(shadow?.nativeCount).toBe(0);
  });
});

/**
 * A synthetic Rhyme Index with two families: a pure shadow key `AW N Z` (every
 * member is a base word with `-s` stapled on — `crowns/frowns/gowns`, the `downs`
 * shape) and a native key `AY N D` (`find/mind/blind` plus the derived
 * `combined`). The base words `crown/frown/gown/combine` sit in the word list so
 * the derivation detector can find them, but carry no pronunciation of their own,
 * so they are not themselves family members.
 */
function makeShadowIndex(): RhymeIndex {
  const p = (...phonemes: string[]): Pronunciation[] => [phonemes];
  const pronunciations = new Map<string, Pronunciation[]>([
    ["crowns", p("K", "R", "AW1", "N", "Z")],
    ["frowns", p("F", "R", "AW1", "N", "Z")],
    ["gowns", p("G", "AW1", "N", "Z")],
    ["find", p("F", "AY1", "N", "D")],
    ["mind", p("M", "AY1", "N", "D")],
    ["blind", p("B", "L", "AY1", "N", "D")],
    ["combined", p("K", "AH0", "M", "B", "AY1", "N", "D")],
  ]);
  const data: RhymeIndexData = {
    pronunciations,
    words: new Set([
      "crowns", "frowns", "gowns", "find", "mind", "blind", "combined",
      // Bases present for the derivation detector, absent from pronunciations so
      // they are not family members themselves.
      "crown", "frown", "gown", "combine",
    ]),
    names: new Set(),
    prevalence: new Map([
      ["crowns", 2.0], ["frowns", 2.0], ["gowns", 2.0],
      ["find", 2.0], ["mind", 2.0], ["blind", 2.0], ["combined", 2.0],
    ]),
  };
  return new RhymeIndex(data, { knownnessThreshold: 0 });
}

// --- Shadow Keys made of three-letter plurals (issue #97) -----------------------

describe("a key whose only native member is a three-letter plural (issue #97)", () => {
  const shortPlurals = makeShortPluralIndex();
  const report = curate(shortPlurals, { sizeBand: { min: 1, max: 100 } });
  const family = (key: string) => report.families.find((f) => f.rhymeKey === key);

  it.each([
    ["AH P S", "ups"],
    ["IH N Z", "ins"],
    ["EH L Z", "els"],
  ])("reports %j as a Shadow Key, now %j reaches its lemma", (key, plural) => {
    // Every member of the key is the base family with an `s` on it, the plural
    // included: `AH P S` is the `up` family and offers no Seed of its own.
    expect(shortPlurals.rhymeKeysOf(plural)).toContain(key);
    expect(family(key)?.nativeCount).toBe(0);
    expect(report.dropped.find((d) => d.rhymeKey === key)?.reason).toBe("shadow-key");
    expect(report.candidates).not.toContainEqual(expect.objectContaining({ rhymeKey: key }));
  });

  it.each([
    ["AE Z", "has"],
    ["AE S", "gas"],
  ])("keeps %j a candidate — %j is native, because its vowel disagrees", (key, native) => {
    expect(shortPlurals.rhymeKeysOf(native)).toContain(key);
    expect(family(key)?.nativeCount).toBe(3);
    expect(report.candidates).toContainEqual(expect.objectContaining({ rhymeKey: key }));
  });

  it.each([
    ["AA Z", "was"],
    ["EH S", "yes"],
  ])("keeps %j a candidate though the rule misreads %j as an inflection", (key, missed) => {
    // The known misses: `was` is `wa` + Z and `yes` is `ye` + S in the
    // dictionary's own transcription. Both families keep native content, so
    // neither miss costs a Seed.
    expect(shortPlurals.rhymeKeysOf(missed)).toContain(key);
    expect(family(key)?.nativeCount).toBe(2);
    expect(report.candidates).toContainEqual(expect.objectContaining({ rhymeKey: key }));
  });

  it("leaves a family with no short plural in it untouched", () => {
    // `AH S`: `bus` has no base to be a plural of, `plus` and `thus` are longer.
    expect(family("AH S")?.nativeCount).toBe(3);
  });
});

// --- playableSeeds: the shared in-band Seed pool (issue #33) --------------------

describe("playableSeeds: the shared in-band Seed pool", () => {
  it("returns only families whose Answer count lands inside the band", () => {
    const band = { min: 1, max: 100 };
    const pool = playableSeeds(index, band);
    expect(pool.length).toBeGreaterThan(0);
    for (const family of pool) {
      expect(family.answerCount).toBeGreaterThanOrEqual(band.min);
      expect(family.answerCount).toBeLessThanOrEqual(band.max);
    }
  });

  it("returns exactly curation's surviving candidates for the same band", () => {
    const band = { min: 1, max: 100 };
    expect(playableSeeds(index, band)).toEqual(curate(index, { sizeBand: band }).candidates);
  });

  it("honours the band bounds — a tighter band excludes out-of-band Rhyme Keys", () => {
    // EY T has 7 Answers: in the pool at [1, 100], dropped above-band at [3, 5].
    expect(playableSeeds(index, { min: 1, max: 100 }).map((f) => f.rhymeKey)).toContain("EY T");
    expect(playableSeeds(index, { min: 3, max: 5 }).map((f) => f.rhymeKey)).not.toContain("EY T");
  });

  it("is deterministic and sorted by Rhyme Key", () => {
    const band = { min: 1, max: 100 };
    const first = playableSeeds(index, band);
    const second = playableSeeds(index, band);
    expect(first).toEqual(second);
    const keys = first.map((f) => f.rhymeKey);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });

  it("defaults to DEFAULT_PLAYABLE_BAND when no band is passed", () => {
    expect(playableSeeds(index)).toEqual(playableSeeds(index, DEFAULT_PLAYABLE_BAND));
  });
});

// --- Difficulty: the share of a Puzzle's Score locked in rare Answers ----------

describe("Difficulty of a candidate Seed Word (ADR-0007)", () => {
  it("computes the real EY T family's Difficulty from the shared scoreEntry", () => {
    // The default rare cutoff (0.7) marks nothing rare on the fixture's z-scale,
    // so we pin the same fixture-appropriate 1.55 the session suite uses — only
    // `defenestrate` (1.5) is then rare. The 7 EY T Answers (with the seed `ate`
    // excluded as the representative):
    //   adjudicate 10, collate 7, eight 5, gate 4, impregnate 10, late 4  (common)
    //   defenestrate 12+2=14                                              (rare)
    // maxScore 54, rareMass 14 -> difficulty 14/54.
    const scoring: ScoringConfig = { ...DEFAULT_SCORING_CONFIG, rareKnownnessCutoff: 1.55 };
    const report = curate(index, { sizeBand: { min: 1, max: 100 }, scoring });
    const family = report.candidates.find((f) => f.rhymeKey === "EY T");
    expect(family?.difficulty).toBeCloseTo(14 / 54, 10);
  });

  it("is exactly rareMass / maxScore, and 1 − Difficulty is the common-only ceiling", () => {
    // A hand-built family under one Rhyme Key with controlled lengths and
    // knownness. Representative `og` (uniquely shortest) is skipped, leaving four
    // Answers under DEFAULT_SCORING_CONFIG (rare cutoff 0.7, rare bonus 2):
    //   quag   len 4, knownness 2.0 -> 4   (common)
    //   shabog len 6, knownness 2.0 -> 6   (common)
    //   vroog  len 5, knownness 0.2 -> 7   (rare: 5 + 2)
    //   yog    len 3, knownness 0.1 -> 5   (rare: 3 + 2)
    // maxScore 22, rareMass 12 -> difficulty 12/22.
    const synthetic = makeSyntheticIndex();
    const report = curate(synthetic, { sizeBand: { min: 1, max: 100 } });
    const family = report.candidates.find((f) => f.representative === "og");
    expect(family?.difficulty).toBe(12 / 22);

    // The identity, proven end-to-end through the session scorer: a player who
    // knows only the common Answers tops out at Score/maxScore = 1 − Difficulty.
    const context = startSession(synthetic, "og", DEFAULT_SCORING_CONFIG);
    const commonOnly = { foundAnswers: ["quag", "shabog"], foundBonus: [], ended: false };
    expect(score(context, commonOnly) / context.maxScore).toBeCloseTo(1 - family!.difficulty, 10);
  });
});

/**
 * A synthetic Rhyme Index: one family under the Rhyme Key `AO G`, with each
 * word's length (spelling) and knownness (prevalence) hand-chosen so the
 * Difficulty arithmetic is exact. Pronunciations are built directly — no CMUdict
 * text needed — each ending in a stressed `AO` + `G` so all share the key.
 */
function makeSyntheticIndex(): RhymeIndex {
  const p = (...phonemes: string[]): Pronunciation[] => [phonemes];
  const pronunciations = new Map<string, Pronunciation[]>([
    ["og", p("AO1", "G")], // representative (uniquely shortest), excluded
    ["quag", p("K", "W", "AO1", "G")],
    ["shabog", p("SH", "AO1", "G")],
    ["vroog", p("V", "R", "AO1", "G")],
    ["yog", p("Y", "AO1", "G")],
  ]);
  const data: RhymeIndexData = {
    pronunciations,
    words: new Set(["og", "quag", "shabog", "vroog", "yog"]),
    names: new Set(),
    prevalence: new Map([
      ["og", 2.0],
      ["quag", 2.0],
      ["shabog", 2.0],
      ["vroog", 0.2],
      ["yog", 0.1],
    ]),
  };
  // Threshold 0 so every rhyming word tiers to Answer; rarity (the 0.7 cutoff) is
  // a separate line, so `vroog`/`yog` are rare Answers, not Bonus Words.
  return new RhymeIndex(data, { knownnessThreshold: 0 });
}

// --- Choosing the representative: the Seed the player is shown and spoken -----

/**
 * One family under `EY N`, holding the three things that compete to represent
 * it: an abbreviation with wordhood (`ln`), a derived form that is better known
 * than any base (`gained`), and the base words themselves.
 */
function makeRepresentativeIndex(): RhymeIndex {
  const p = (...phonemes: string[]): Pronunciation[] => [phonemes];
  const pronunciations = new Map<string, Pronunciation[]>([
    ["ln", p("L", "EY1", "N")],
    ["gained", p("G", "EY1", "N", "D")],
    ["gain", p("G", "EY1", "N")],
    ["lane", p("L", "EY1", "N")],
    ["drain", p("D", "R", "EY1", "N")],
  ]);
  const data: RhymeIndexData = {
    pronunciations: new Map([...pronunciations, ["gaining", p("G", "EY1", "N", "IH0", "NG")]]),
    words: new Set(["ln", "gained", "gain", "lane", "drain", "gaining"]),
    names: new Set(),
    prevalence: new Map([
      // `ln` is shortest and `gained` is best known — under the old
      // shortest-first rule the Seed was `ln`, under knownness alone it is
      // `gained`. Native-first picks neither.
      ["ln", 1.0],
      ["gained", 3.0],
      ["gain", 2.0],
      ["lane", 1.5],
      ["drain", 1.4],
    ]),
  };
  return new RhymeIndex(data, { knownnessThreshold: 0 });
}

describe("the representative is the best-known native word", () => {
  const family = curate(makeRepresentativeIndex(), { sizeBand: { min: 1, max: 100 } }).families.find(
    (f) => f.rhymeKey === "EY N",
  );

  it("picks the best-known native word, not the shortest", () => {
    // `ln` holds wordhood and is shortest; a Seed is shown *and spoken*
    // (ADR-0002), so an abbreviation is the worst possible choice.
    expect(family?.representative).toBe("gain");
  });

  it("prefers a native word to a better-known derived one", () => {
    // `gained` outranks `gain` on prevalence but is an inflection of it
    // (ADR-0008), and an inflected Seed reads oddly when spoken aloud.
    expect(family?.representative).not.toBe("gained");
  });
});
