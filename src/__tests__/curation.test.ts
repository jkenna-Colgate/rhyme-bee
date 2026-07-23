/**
 * Slice: the family-size histogram and candidate Seed Word list. Curation runs
 * buildPuzzle over every distinct Rhyme Key, dedupes by key (not spelling),
 * filters to a configurable size band, and records why each excluded family was
 * dropped.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { curate } from "../curation.ts";
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
    const commonOnly = { foundAnswers: ["quag", "shabog"], foundBonus: [] };
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
