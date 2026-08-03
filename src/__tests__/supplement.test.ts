/**
 * The committed supplement is the human override layer merged over the pinned
 * upstream inputs at build time (ADR-0009). It both adds missing words and
 * corrects upstream pronunciations, and its entries must survive a rebuild.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applySupplement } from "../supplement.ts";
import { parseCmudict } from "../cmudict.ts";
import type { RhymeIndex } from "../rhymeIndex.ts";
import { makeTestData, makeTestIndex, type TestInputs } from "../__fixtures__/index.ts";
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
    // Through the composed build, so these are the verdicts a real build
    // produces — the supplement runs after demotions and before coverage, and
    // its readings reach the index via normalisation (ADR-0010).
    return makeTestIndex({ supplement });
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

describe("the hurricane correction (#96)", () => {
  /**
   * The upstream pair, reproduced. The second reading's `AH1 R` first syllable
   * is a legitimate US variant; only its trailing `Z` is wrong, and that `Z`
   * puts `hurricane` in the plural key `EY N Z`, where it is the lone native
   * member (ADR-0008).
   */
  const UPSTREAM: Pronunciation[] = [
    ["HH", "ER1", "AH0", "K", "EY2", "N"],
    ["HH", "AH1", "R", "AH0", "K", "EY2", "N", "Z"],
  ];

  /** The correction, as `data/supplement.dict` carries it. */
  const CORRECTION = [
    "hurricane HH ER1 AH0 K EY2 N",
    "hurricane(1) HH AH1 R AH0 K EY2 N",
  ].join("\n");

  /** `cane` (EY N) and `planes` (EY N Z) — one key either side of the defect. */
  const upstream: TestInputs = {
    pronunciations: [
      ["hurricane", UPSTREAM],
      ["cane", [["K", "EY1", "N"]]],
      ["planes", [["P", "L", "EY1", "N", "Z"]]],
    ],
    words: ["hurricane", "cane", "planes"],
    prevalence: [["hurricane", 2.4], ["cane", 2.3], ["planes", 2.4]],
  };

  it("serves hurricane as a rhyme for planes, until the supplement corrects it", () => {
    // The defect itself, asserted so the fix cannot be mistaken for a test that
    // was always green: the spurious reading is enough on its own, because a
    // Submission rhymes if *any* of its Rhyme Keys matches (ADR-0001).
    const index = makeTestIndex(upstream);

    expect(index.adjudicate(index.pinSeed("planes"), "hurricane").outcome)
      .not.toBe("rejected");
  });

  it("stops hurricane rhyming with planes, and leaves cane alone", () => {
    const index = makeTestIndex({ ...upstream, supplement: CORRECTION });

    expect(index.adjudicate(index.pinSeed("planes"), "hurricane")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
    expect(index.adjudicate(index.pinSeed("cane"), "hurricane").outcome).toBe("answer");
  });

  it("keeps both readings — it removes the Z, it does not pick a first syllable", () => {
    // The stage on its own: what the supplement did to the readings, before any
    // later stage has had a chance to touch them.
    const data = makeTestData();
    data.pronunciations.set("hurricane", UPSTREAM);
    applySupplement(CORRECTION, data);

    expect(data.pronunciations.get("hurricane")).toEqual([
      ["HH", "ER1", "AH0", "K", "EY2", "N"],
      ["HH", "AH1", "R", "AH0", "K", "EY2", "N"],
    ]);
  });
});

describe("the committed supplement", () => {
  const entries = parseCmudict(
    readFileSync(
      fileURLToPath(new URL("../../data/supplement.dict", import.meta.url)),
      "utf8",
    ).replace(/^#.*$/gm, ""),
  );

  it("carries the hurricane correction, both readings, neither ending in Z", () => {
    const readings = entries.get("hurricane");

    expect(readings).toHaveLength(2);
    for (const reading of readings ?? []) {
      expect(reading.at(-1)).toBe("N");
    }
  });
});
