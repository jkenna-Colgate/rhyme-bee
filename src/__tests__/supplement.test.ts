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

describe("the -os plurals correction (#85)", () => {
  /**
   * Two representative upstream defects, reproduced. `burritos` reaches the
   * `OW S` family (representative word `dose`) only via stress promotion — its
   * bad reading is unstressed, `OW0 S`. `altos`'s bad reading is its *second*
   * upstream reading, and it is already stressed (`OW2 S`), so it reaches
   * `OW S` without any promotion at all — the case the issue's stress-promotion
   * story doesn't cover, and why it is pinned separately from `burritos`.
   */
  const BURRITOS_UPSTREAM: Pronunciation[] = [["B", "ER0", "IY1", "T", "OW0", "S"]];
  const ALTOS_UPSTREAM: Pronunciation[] = [
    ["AE1", "L", "T", "OW0", "Z"],
    ["AO1", "L", "T", "OW2", "S"],
  ];

  /** The correction, as `data/supplement.dict` carries it. */
  const CORRECTION = [
    "burritos B ER0 IY1 T OW0 Z",
    "altos AE1 L T OW0 Z",
    "altos(1) AO1 L T OW2 Z",
  ].join("\n");

  const upstream: TestInputs = {
    pronunciations: [
      ["burritos", BURRITOS_UPSTREAM],
      ["altos", ALTOS_UPSTREAM],
      ["dose", [["D", "OW1", "S"]]],
      ["sucrose", [["S", "UW1", "K", "R", "OW0", "S"]]],
    ],
    words: ["burritos", "altos", "dose", "sucrose"],
    prevalence: [["burritos", 2.2], ["altos", 1.0], ["dose", 2.4], ["sucrose", 1.8]],
  };

  it("serves burritos and altos as rhymes for dose, until the supplement corrects them", () => {
    // The defect itself, asserted so the fix cannot be mistaken for a test that
    // was always green.
    const index = makeTestIndex(upstream);
    const dose = index.pinSeed("dose");

    expect(index.adjudicate(dose, "burritos").outcome).not.toBe("rejected");
    expect(index.adjudicate(dose, "altos").outcome).not.toBe("rejected");
  });

  it("stops burritos and altos rhyming with dose, and leaves sucrose alone", () => {
    const index = makeTestIndex({ ...upstream, supplement: CORRECTION });
    const dose = index.pinSeed("dose");

    expect(index.adjudicate(dose, "burritos")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
    expect(index.adjudicate(dose, "altos")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
    expect(index.adjudicate(dose, "sucrose").outcome).toBe("answer");
  });
});

describe("the -ule family sweep (#71)", () => {
  /**
   * The six Answer-tier words from the 38-word `-ule` sweep, as
   * `data/supplement.dict` carries them. All 38 were absent from CMUdict
   * entirely (not a stress defect, a missing reading), so every Submission
   * below is `not-a-known-word` until the supplement is applied.
   */
  const ADDITIONS = [
    "macromolecule M AE2 K R OW0 M AA1 L AH0 K Y UW2 L",
    "globule G L AA1 B Y UW0 L",
    "pustule P AH1 S CH UW0 L",
    "reticule R EH1 T AH0 K Y UW0 L",
    "glandule G L AE1 N JH UW0 L",
    "ampoule AE1 M P UW2 L",
    // A Bonus-tier word from the same sweep, carried with no prevalence
    // override below — it should rhyme, but never outrank a Bonus verdict.
    "bascule B AE1 S K Y UW0 L",
  ].join("\n");

  const ANSWER_TIER = [
    "macromolecule", "globule", "pustule", "reticule", "glandule", "ampoule",
  ];

  const upstream: TestInputs = {
    words: [...ANSWER_TIER, "bascule"],
    // Above the fixture's KNOWNNESS_THRESHOLD (1.0), so each tiers as an
    // Answer once it has a reading at all. `bascule` is deliberately absent
    // here — it has wordhood but no prevalence, the ordinary Bonus default.
    prevalence: ANSWER_TIER.map((word): [string, number] => [word, 2.0]),
  };

  it("rejects every one of the six as not a known word before the supplement", () => {
    const index = makeTestIndex(upstream);
    const pool = index.pinSeed("pool");

    for (const word of ANSWER_TIER) {
      expect(index.adjudicate(pool, word), word).toMatchObject({
        outcome: "rejected",
        reason: "not-a-known-word",
      });
    }
  });

  it("accepts all six as Answers against a UW L seed, once added", () => {
    const index = makeTestIndex({ ...upstream, supplement: ADDITIONS });
    const pool = index.pinSeed("pool");

    for (const word of ANSWER_TIER) {
      expect(index.adjudicate(pool, word), word).toMatchObject({ outcome: "answer" });
    }
  });

  it("tiers the un-prevalenced bascule as a Bonus Word, not an Answer", () => {
    const index = makeTestIndex({ ...upstream, supplement: ADDITIONS });
    const pool = index.pinSeed("pool");

    expect(index.adjudicate(pool, "bascule")).toMatchObject({ outcome: "bonus" });
  });

  it("leaves the chocolate/ate guardrail alone", () => {
    // The addition touches only the `-ule` words; it must not perturb the
    // guardrail ADR-0001 is built on.
    const index = makeTestIndex({ ...upstream, supplement: ADDITIONS });

    expect(index.adjudicate(index.pinSeed("ate"), "chocolate")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
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

  it("carries all thirteen -os plural corrections, every reading ending in Z (#85)", () => {
    const OS_PLURALS = [
      "anglos", "altos", "bimbos", "bios", "burritos", "campesinos",
      "centavos", "cheerios", "cruzados", "latinos", "lobos", "narcos", "winos",
    ];

    for (const word of OS_PLURALS) {
      const readings = entries.get(word);
      expect(readings, word).toBeDefined();
      for (const reading of readings ?? []) {
        expect(reading.at(-1), `${word}: ${reading.join(" ")}`).toBe("Z");
      }
    }
  });

  it("keeps anglos and altos to the reading count the fix claims (#85)", () => {
    // `anglos`'s upstream second reading duplicates its first once the S is
    // fixed, so it collapses to one; `altos`'s two readings stay genuinely
    // distinct pronunciations, so both survive — the same shape the hurricane
    // correction above is pinned on (`toHaveLength`, not just the tail phoneme).
    expect(entries.get("anglos")).toHaveLength(1);
    expect(entries.get("altos")).toHaveLength(2);
  });
});
