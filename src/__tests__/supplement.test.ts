/**
 * The committed supplement is the human override layer merged over the pinned
 * upstream inputs at build time (ADR-0009). It both adds missing words and
 * corrects upstream pronunciations, and its entries must survive a rebuild.
 */

import { describe, expect, it } from "vitest";
import { applySupplement } from "../supplement.ts";
import { RhymeIndex } from "../rhymeIndex.ts";
import { makeTestData, KNOWNNESS_THRESHOLD } from "../__fixtures__/index.ts";
import type { Pronunciation } from "../phonology.ts";

function target(overrides: {
  pronunciations?: [string, Pronunciation[]][];
  words?: string[];
  names?: string[];
} = {}) {
  return {
    pronunciations: new Map(overrides.pronunciations ?? []),
    words: new Set(overrides.words ?? []),
    names: new Set(overrides.names ?? []),
  };
}

describe("applySupplement", () => {
  it("adds a word absent upstream and grants it wordhood", () => {
    const data = target();
    applySupplement("airburst EH1 R B ER2 S T", data);

    expect(data.pronunciations.get("airburst")).toEqual([
      ["EH1", "R", "B", "ER2", "S", "T"],
    ]);
    expect(data.words.has("airburst")).toBe(true);
  });

  it("overrides an existing pronunciation rather than appending a variant", () => {
    const data = target({
      pronunciations: [["viceroy", [["V", "AY1", "S", "R", "OY0"]]]],
      words: ["viceroy"],
    });
    applySupplement("viceroy V AY1 S R OY2", data);

    expect(data.pronunciations.get("viceroy")).toEqual([
      ["V", "AY1", "S", "R", "OY2"],
    ]);
  });

  it("ignores blank lines and # comment lines", () => {
    const data = target();
    applySupplement("# why: final syllable is really secondary stress\n\nbratwurst B R AE1 T W ER2 S T\n", data);

    expect(data.pronunciations.has("bratwurst")).toBe(true);
    expect(data.words.has("bratwurst")).toBe(true);
    expect(data.pronunciations.has("#")).toBe(false);
  });

  it("does not launder a proper noun into a word — names stay names", () => {
    const data = target({ names: ["hyundai"] });
    applySupplement("hyundai HH Y UH1 N D EY2", data);

    // The pronunciation may be asserted, but wordhood is never granted to a name.
    expect(data.words.has("hyundai")).toBe(false);
  });
});

describe("a supplemented index adjudicates", () => {
  function indexWith(supplement: string): RhymeIndex {
    const data = makeTestData();
    applySupplement(supplement, data);
    return new RhymeIndex(data, { knownnessThreshold: KNOWNNESS_THRESHOLD });
  }

  it("accepts an added word, absent upstream, as a Bonus rhyme", () => {
    // `skate` is in neither the fixture wordhood set nor its CMUdict — without
    // the supplement it would be `not-a-known-word`. With a reading it rhymes
    // with `gate` (EY T), and with no prevalence it tiers as a Bonus Word.
    const index = indexWith("skate S K EY1 T");
    const verdict = index.adjudicate(index.pinSeed("gate"), "skate");

    expect(verdict.outcome).toBe("bonus");
  });

  it("overrides a reading rather than appending it — the old reading is gone", () => {
    // The fixture's `tear` reads two ways: T IH1 R (rhymes with `beer`) and
    // T EH1 R (rhymes with `care`). A correction to the single T EH1 R reading
    // must replace both, so `tear` stops rhyming with `beer`.
    const index = indexWith("tear T EH1 R");

    expect(index.adjudicate(index.pinSeed("care"), "tear").outcome).toBe("answer");
    expect(index.adjudicate(index.pinSeed("beer"), "tear")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
  });
});
