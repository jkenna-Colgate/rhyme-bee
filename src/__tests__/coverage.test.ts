/**
 * Coverage derivation: the build stage that gives a known word a reading by
 * composing it from a known stem's reading (issue #76, the first slice of the
 * Tier 1 coverage epic). It runs after the committed supplement and before
 * normalisation.
 *
 * The slice shipped here is **prefix** derivation, which cannot change a rhyme
 * verdict: the Rhyme Key runs from the last stressed vowel, which lies in the
 * stem, so a prefix's phonemes never enter the key. The tests below assert the
 * readings and the verdicts, not which prefixes happen to be configured.
 */

import { describe, expect, it } from "vitest";
import { applyCoverage, derivationTargets } from "../coverage.ts";
import { applySupplement } from "../supplement.ts";
import { rhymeKeyOf, type Pronunciation } from "../phonology.ts";
import { buildTestIndex, makeTestData, makeTestIndex } from "../__fixtures__/index.ts";

function target(
  overrides: {
    pronunciations?: [string, Pronunciation[]][];
    words?: string[];
    names?: string[];
    prevalence?: [string, number][];
  } = {},
) {
  return {
    pronunciations: new Map(overrides.pronunciations ?? []),
    words: new Set(overrides.words ?? []),
    names: new Set(overrides.names ?? []),
    prevalence: new Map(overrides.prevalence ?? []),
  };
}

const DOCKED: Pronunciation = ["D", "AA1", "K", "T"];

describe("applyCoverage composes a reading from a prefix and a stem", () => {
  it("prepends the prefix's phonemes to the stem's reading", () => {
    const data = target({
      pronunciations: [["docked", [DOCKED]]],
      words: ["docked", "undocked"],
      prevalence: [["undocked", 2.0]],
    });
    applyCoverage(data);

    const [reading] = data.pronunciations.get("undocked") ?? [];
    expect(reading).toBeDefined();
    expect(reading?.slice(-DOCKED.length)).toEqual(DOCKED);
    expect(reading?.length).toBeGreaterThan(DOCKED.length);
  });

  it("leaves the Rhyme Key exactly the stem's — a prefix cannot change a verdict", () => {
    const data = target({
      pronunciations: [["docked", [DOCKED]]],
      words: ["docked", "undocked"],
      prevalence: [["undocked", 2.0]],
    });
    applyCoverage(data);

    const [reading] = data.pronunciations.get("undocked") ?? [];
    expect(rhymeKeyOf(reading!)).toBe(rhymeKeyOf(DOCKED));
  });

  it("gives the prefix no primary stress, so the stem still carries the word", () => {
    // The respelling layer upper-cases the primary-stressed syllable. A prefix
    // that took primary stress would move the emphasis off the rhyming stem.
    const data = target({
      pronunciations: [["docked", [DOCKED]]],
      words: ["docked", "undocked"],
      prevalence: [["undocked", 2.0]],
    });
    applyCoverage(data);

    const [reading] = data.pronunciations.get("undocked") ?? [];
    const prefix = reading!.slice(0, reading!.length - DOCKED.length);
    expect(prefix.some((phoneme) => phoneme.endsWith("1"))).toBe(false);
  });

  it("carries a stem's several pronunciations through to several derived ones", () => {
    // ADR-0001: a Submission rhymes if *any* of its readings rhymes, so a stem
    // that reads two ways must hand both readings on to the derived word.
    const data = target({
      pronunciations: [["read", [["R", "IY1", "D"], ["R", "EH1", "D"]]]],
      words: ["read", "misread"],
      prevalence: [["misread", 1.9]],
    });
    applyCoverage(data);

    const readings = data.pronunciations.get("misread") ?? [];
    expect(readings).toHaveLength(2);
    expect(readings.map((r) => rhymeKeyOf(r))).toEqual(["IY D", "EH D"]);
  });
});

describe("the derivation target set", () => {
  it("skips a word that is absent from the prevalence norms", () => {
    // Restricting to the norms bounds derivation to attested vocabulary and
    // guarantees every derived word arrives with a knownness to tier on.
    const data = target({
      pronunciations: [["docked", [DOCKED]]],
      words: ["docked", "undocked"],
    });
    applyCoverage(data);

    expect(data.pronunciations.has("undocked")).toBe(false);
  });

  it("never grants wordhood — a word without it stays underived", () => {
    const data = target({
      pronunciations: [["docked", [DOCKED]]],
      words: ["docked"],
      prevalence: [["undocked", 2.0]],
    });
    applyCoverage(data);

    expect(data.pronunciations.has("undocked")).toBe(false);
    expect(data.words.has("undocked")).toBe(false);
  });

  it("skips a name, however well the prefix fits", () => {
    const data = target({
      pronunciations: [["docked", [DOCKED]]],
      words: ["docked", "underhill"],
      names: ["underhill"],
      prevalence: [["underhill", 2.0]],
    });
    applyCoverage(data);

    expect(data.pronunciations.has("underhill")).toBe(false);
  });

  it("skips a word that already has a reading, and never overwrites one", () => {
    const upstream: Pronunciation = ["AH0", "N", "D", "AA1", "K", "T"];
    const data = target({
      pronunciations: [["docked", [DOCKED]], ["undocked", [upstream]]],
      words: ["docked", "undocked"],
      prevalence: [["undocked", 2.0]],
    });
    const derived = applyCoverage(data);

    expect(data.pronunciations.get("undocked")).toEqual([upstream]);
    expect(derived.map((d) => d.word)).not.toContain("undocked");
  });

  it("never overwrites a hand-authored supplement reading", () => {
    // Ordering contract: the committed supplement runs first, so its reading is
    // already present by the time this stage looks — and stays untouched.
    const data = target({
      pronunciations: [["docked", [DOCKED]]],
      words: ["docked"],
      prevalence: [["undocked", 2.0]],
    });
    applySupplement("undocked  AH2 N D AA1 K T", data);
    applyCoverage(data);

    expect(data.pronunciations.get("undocked")).toEqual([
      ["AH2", "N", "D", "AA1", "K", "T"],
    ]);
  });

  it("lists exactly the words a stage could give a reading to", () => {
    const data = target({
      pronunciations: [["docked", [DOCKED]], ["talked", [["T", "AO1", "K", "T"]]]],
      words: ["docked", "talked", "undocked", "untalked"],
      prevalence: [["docked", 2.0], ["undocked", 2.0], ["untalked", 0.4]],
    });

    // `docked` already reads; `untalked` is a target even though no rule in this
    // slice need reach it — the candidate set is not the affix inventory.
    expect([...derivationTargets(data)]).toEqual(["undocked", "untalked"]);
  });
});

describe("the stem must itself be a known, already-read word", () => {
  it("refuses a stem the wordhood set does not hold", () => {
    // A CMUdict entry is not enough: a stem must be a real word, or a surname
    // or an artefact of the raw dictionary could father a family of readings.
    const data = target({
      pronunciations: [["floop", [["F", "L", "UW1", "P"]]]],
      words: ["unfloop"],
      prevalence: [["unfloop", 2.0]],
    });
    applyCoverage(data);

    expect(data.pronunciations.has("unfloop")).toBe(false);
  });

  it("is a single pass — a derived reading is not itself a stem in the build", () => {
    // `understand` derives from `stand`; `misunderstand` would have to stand on
    // `understand`, which has no reading yet, and so waits for a later build.
    const data = target({
      pronunciations: [["stand", [["S", "T", "AE1", "N", "D"]]]],
      words: ["stand", "understand", "misunderstand"],
      prevalence: [["understand", 2.5], ["misunderstand", 2.2]],
    });
    applyCoverage(data);

    expect(data.pronunciations.has("understand")).toBe(true);
    expect(data.pronunciations.has("misunderstand")).toBe(false);
  });
});

describe("the derived-words report", () => {
  it("names every derived word, its stem, and the rule that produced it", () => {
    const data = target({
      pronunciations: [["docked", [DOCKED]]],
      words: ["docked", "undocked"],
      prevalence: [["undocked", 2.0]],
    });
    const derived = applyCoverage(data);

    expect(derived).toEqual([
      { word: "undocked", stem: "docked", rule: "prefix:un" },
    ]);
  });

  it("is sorted by word, so a rebuild produces an identical report", () => {
    const data = target({
      pronunciations: [["docked", [DOCKED]], ["read", [["R", "EH1", "D"]]]],
      words: ["docked", "read", "undocked", "misread"],
      prevalence: [["undocked", 2.0], ["misread", 1.9]],
    });
    const derived = applyCoverage(data);

    expect(derived.map((d) => d.word)).toEqual(["misread", "undocked"]);
  });
});

describe("a derived index adjudicates", () => {
  const index = makeTestIndex();
  const docked = index.pinSeed("docked");

  it("accepts `undocked` as an Answer for the Seed Word `docked`", () => {
    // The headline case: the game already holds a reading for `docked`, and
    // `undocked` is an ordinary word. Before this stage it was not-a-known-word.
    expect(index.adjudicate(docked, "undocked").outcome).toBe("answer");
  });

  it("tiers a low-prevalence derived word as a Bonus Word, by the ordinary threshold", () => {
    // No Bonus-default special case: `outwalked` tiers on its own knownness,
    // which sits below the threshold, exactly as an underived word would.
    expect(index.adjudicate(docked, "outwalked").outcome).toBe("bonus");
  });

  it("still rejects a word the wordhood gate does not hold", () => {
    // `unwalked` has a prevalence score and a stem the index reads, and would
    // be derived on wordhood alone. It has none, so no reading is composed for
    // it and the rejection is unchanged — derivation cannot introduce a word.
    expect(index.adjudicate(docked, "unwalked")).toMatchObject({
      outcome: "rejected",
      reason: "not-a-known-word",
    });
  });

  it("respells a derived word with the Seed Word's rhyming tail", () => {
    const tail = index.buildPuzzle(docked).seedRespelling.slice(1).toLowerCase();
    const verdict = index.adjudicate(docked, "undocked");

    expect(verdict).toMatchObject({ outcome: "answer" });
    if (verdict.outcome === "answer") {
      expect(verdict.respelling.toLowerCase()).toContain(tail);
    }
  });
});

describe("coverage derivation runs before normalisation", () => {
  it("hands the derived reading to the accent specification, not around it", () => {
    // `outwalked` is composed from `walked` (W AO1 K T) while the reading still
    // carries the unmerged vowel; normalisation then merges it, so the derived
    // word lands on the same Rhyme Key as `docked` rather than beside it.
    const data = makeTestData();
    const index = buildTestIndex(data);

    expect(index.rhymeKeysOf("outwalked")).toEqual(["AA K T"]);
  });

  it("leaves a word whose stem the fixture has no reading for alone", () => {
    // `grates` passes the wordhood gate with no pronunciation and no prefix, so
    // it is still the truthful no-reading rejection (issue #28) after this stage.
    const index = makeTestIndex();
    expect(index.adjudicate(index.pinSeed("plates"), "grates")).toMatchObject({
      outcome: "rejected",
      reason: "not-a-known-word",
    });
  });
});
