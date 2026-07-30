/**
 * Suffix derivation (issue #77, the second slice of the Tier 1 coverage epic):
 * a word ending in a configured stress-neutral suffix, whose stripped stem the
 * build already reads, gains the stem's reading with the suffix's phonemes on
 * the end.
 *
 * Unlike the prefix slice, **the suffix's phonemes are inside the Rhyme Key** —
 * the key runs from the last stressed vowel, which a stress-neutral suffix
 * leaves in the stem, so the key runs through the suffix to the end of the word.
 * A wrong suffix reading is therefore a wrong rhyme verdict, which is why the
 * readings below are asserted phoneme by phoneme and not merely for their shape.
 */

import { describe, expect, it } from "vitest";
import { AFFIX_RULES, SUFFIXES } from "../affixes.ts";
import { applyCoverage } from "../coverage.ts";
import { isVowel, rhymeKeyOf, stressOf, type Pronunciation } from "../phonology.ts";
import { makeTestIndex } from "../__fixtures__/index.ts";

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

/** Derive `word` from a one-stem build and return its single reading. */
function derived(
  word: string,
  stem: string,
  stemReading: Pronunciation,
  extraWords: string[] = [],
): Pronunciation | undefined {
  const data = target({
    pronunciations: [[stem, [stemReading]]],
    words: [stem, word, ...extraWords],
    prevalence: [[word, 2.0]],
  });
  applyCoverage(data);
  return data.pronunciations.get(word)?.[0];
}

const ABOLISH: Pronunciation = ["AH0", "B", "AA1", "L", "IH0", "SH"];
const ZESTFUL: Pronunciation = ["Z", "EH1", "S", "T", "F", "AH0", "L"];
const YOUTHFUL: Pronunciation = ["Y", "UW1", "TH", "F", "AH0", "L"];

describe("a stress-neutral suffix composes onto the stem's reading", () => {
  it("appends the suffix's phonemes to the stem's reading", () => {
    expect(derived("abolisher", "abolish", ABOLISH)).toEqual([...ABOLISH, "ER0"]);
  });

  it("runs the Rhyme Key through the suffix, unlike a prefix", () => {
    // The prefix slice asserts the key is *unchanged*. Here it must change: the
    // key is the stem's key with the suffix's sounds on the end, so `abolisher`
    // rhymes with `polisher` and not with `abolish`.
    const reading = derived("abolisher", "abolish", ABOLISH)!;
    expect(rhymeKeyOf(reading)).toBe("AA L IH SH ER");
    expect(rhymeKeyOf(reading)).toBe(`${rhymeKeyOf(ABOLISH)} ER`);
  });

  it("infers no stress — the stem still carries the word's stressed vowel", () => {
    const reading = derived("youthfulness", "youthful", YOUTHFUL)!;
    const suffix = reading.slice(YOUTHFUL.length);
    expect(suffix.every((phoneme) => stressOf(phoneme) !== 1)).toBe(true);
    expect(suffix.every((phoneme) => stressOf(phoneme) !== 2)).toBe(true);
  });

  it("carries a stem's several pronunciations through to several derived ones", () => {
    const data = target({
      pronunciations: [["read", [["R", "IY1", "D"], ["R", "EH1", "D"]]]],
      words: ["read", "reader"],
      prevalence: [["reader", 2.4]],
    });
    applyCoverage(data);

    expect((data.pronunciations.get("reader") ?? []).map((r) => rhymeKeyOf(r))).toEqual([
      "IY D ER",
      "EH D ER",
    ]);
  });
});

describe("a suffix declines a stem whose readings are two different words", () => {
  const ARTICULATE_VERB: Pronunciation =
    ["AA0", "R", "T", "IH1", "K", "Y", "AH0", "L", "EY2", "T"];
  const ARTICULATE_ADJ: Pronunciation =
    ["AA0", "R", "T", "IH1", "K", "Y", "AH0", "L", "AH0", "T"];

  it("refuses a stem whose readings disagree about where the stress falls", () => {
    // `articulate` is a verb ending in a stressed `EY2 T` and an adjective ending
    // in an unstressed schwa — the contrast ADR-0001 is built on. `-ly` attaches
    // to the adjective, and nothing in a pronunciation says which is which, so
    // deriving on both would make `articulately` rhyme with `lately`.
    const data = target({
      pronunciations: [["articulate", [ARTICULATE_VERB, ARTICULATE_ADJ]]],
      words: ["articulate", "articulately"],
      prevalence: [["articulately", 1.6]],
    });
    applyCoverage(data);

    expect(data.pronunciations.has("articulately")).toBe(false);
  });

  it("still composes on a stem that is one word said two ways", () => {
    // `arid` reads `AE1 R AH0 D` or `EH1 R AH0 D` — the same word, same stress, so
    // both readings are genuinely the word's and both are carried through.
    const data = target({
      pronunciations: [["arid", [["AE1", "R", "AH0", "D"], ["EH1", "R", "AH0", "D"]]]],
      words: ["arid", "aridly"],
      prevalence: [["aridly", 1.2]],
    });
    applyCoverage(data);

    expect((data.pronunciations.get("aridly") ?? []).map((r) => rhymeKeyOf(r))).toEqual([
      "AE R AH D L IY",
      "EH R AH D L IY",
    ]);
  });

  it("lets a prefix compose on a stem a suffix would decline", () => {
    // The asymmetry is the point: a prefix's phonemes sit outside the key, so
    // both derived readings carry one of the stem's own genuine keys (#76).
    const data = target({
      pronunciations: [["articulate", [ARTICULATE_VERB, ARTICULATE_ADJ]]],
      words: ["articulate", "rearticulate"],
      prevalence: [["rearticulate", 1.1]],
    });
    applyCoverage(data);

    expect(data.pronunciations.get("rearticulate")).toHaveLength(2);
  });
});

describe("degemination collapses a doubled consonant at the seam", () => {
  it("gives `zestfully` a single L before the `-ly` vowel", () => {
    // The bug a scratch prototype shipped: `zestful` ends in L and `-ly` starts
    // with one, and the two are a single sound in any mouth.
    const reading = derived("zestfully", "zestful", ZESTFUL)!;
    expect(reading).toEqual(["Z", "EH1", "S", "T", "F", "AH0", "L", "IY0"]);
    expect(reading.filter((phoneme) => phoneme === "L")).toHaveLength(1);
  });

  it("does not double the N of `-ness` on a stem that ends in one", () => {
    const stern: Pronunciation = ["S", "T", "ER1", "N"];
    expect(derived("sternness", "stern", stern)).toEqual(["S", "T", "ER1", "N", "AH0", "S"]);
  });

  it("leaves an undoubled seam alone", () => {
    expect(derived("youthfulness", "youthful", YOUTHFUL)).toEqual([
      ...YOUTHFUL,
      "N",
      "AH0",
      "S",
    ]);
  });

  it("keeps two identical unstressed vowels, which are two syllables", () => {
    // `murderer` really is `M ER1 D ER0 ER0` — collapsing a repeated vowel would
    // delete a syllable, so degemination is a consonant rule only.
    const murder: Pronunciation = ["M", "ER1", "D", "ER0"];
    expect(derived("murderer", "murder", murder)).toEqual([...murder, "ER0"]);
  });
});

describe("orthographic stem candidates are tried in a fixed order", () => {
  it("prefers the bare stem before a consonant-initial suffix", () => {
    // English keeps a silent `e` before `-ly`/`-ness` (`lately`, `politeness`),
    // so `madly` is `mad` + `-ly` and never `made` + `-ly`.
    const data = target({
      pronunciations: [["mad", [["M", "AE1", "D"]]], ["made", [["M", "EY1", "D"]]]],
      words: ["mad", "made", "madly"],
      prevalence: [["madly", 2.0]],
    });
    applyCoverage(data);

    expect(data.pronunciations.get("madly")).toEqual([["M", "AE1", "D", "L", "IY0"]]);
  });

  it("restores a silent `e` before a vowel-initial suffix", () => {
    // English drops the silent `e` before `-er`/`-ing`/`-est` (`hoping`), so
    // `user` is `use` + `-er` even though `us` is also a word.
    const data = target({
      pronunciations: [["us", [["AH1", "S"]]], ["use", [["Y", "UW1", "Z"]]]],
      words: ["us", "use", "user"],
      prevalence: [["user", 2.3]],
    });
    applyCoverage(data);

    expect(data.pronunciations.get("user")).toEqual([["Y", "UW1", "Z", "ER0"]]);
  });

  it("undoubles a doubled final consonant", () => {
    expect(derived("biggest", "big", ["B", "IH1", "G"])).toEqual([
      "B",
      "IH1",
      "G",
      "AH0",
      "S",
      "T",
    ]);
  });

  it("restores a terminal `i` to `y`", () => {
    expect(derived("happiness", "happy", ["HH", "AE1", "P", "IY0"])).toEqual([
      "HH",
      "AE1",
      "P",
      "IY0",
      "N",
      "AH0",
      "S",
    ]);
  });

  it("finds no stem when no candidate spelling is a known, read word", () => {
    const data = target({
      pronunciations: [["float", [["F", "L", "OW1", "T"]]]],
      words: ["float", "flotsamly"],
      prevalence: [["flotsamly", 2.0]],
    });
    applyCoverage(data);

    expect(data.pronunciations.has("flotsamly")).toBe(false);
  });
});

describe("the longest matching affix wins", () => {
  it("reads `unhappiness` as `unhappy` + `-ness`, not `un-` + `happiness`", () => {
    // Both segmentations reach a stem the build reads. `-ness` is the longer
    // spelling, so it wins and the more specific segmentation is the one
    // reported — the same rule the prefix slice states for `under-` over `un-`.
    const data = target({
      pronunciations: [
        ["unhappy", [["AH0", "N", "HH", "AE1", "P", "IY0"]]],
        ["happiness", [["HH", "AE1", "P", "IY0", "N", "AH0", "S"]]],
      ],
      words: ["unhappy", "happiness", "unhappiness"],
      prevalence: [["unhappiness", 2.1]],
    });
    const report = applyCoverage(data);

    expect(report).toEqual([
      { word: "unhappiness", stem: "unhappy", rule: "suffix:ness" },
    ]);
    expect(data.pronunciations.get("unhappiness")).toEqual([
      ["AH0", "N", "HH", "AE1", "P", "IY0", "N", "AH0", "S"],
    ]);
  });

  it("orders every affix rule by descending spelling length", () => {
    const lengths = AFFIX_RULES.map((rule) => rule.name.split(":")[1]!.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });
});

describe("the suffix inventory is configuration, not code", () => {
  it("gives no configured suffix a stressed vowel", () => {
    // "No stress is inferred" is the whole safety argument for deriving this
    // class mechanically: a stressed suffix vowel would become the word's last
    // stressed one and the Rhyme Key would stop running from the stem.
    for (const { spelling, phonemes } of SUFFIXES) {
      const stressed = phonemes.filter((p) => isVowel(p) && stressOf(p) !== 0);
      expect(stressed, `suffix:${spelling}`).toEqual([]);
    }
  });

  it("names each rule after the suffix it configures", () => {
    const names = AFFIX_RULES.map((rule) => rule.name);
    for (const { spelling } of SUFFIXES) {
      expect(names).toContain(`suffix:${spelling}`);
    }
  });
});

describe("a derived index adjudicates the words the issue names", () => {
  const index = makeTestIndex();

  it("accepts `abolisher` for a Seed Word on `AA L IH SH ER`", () => {
    expect(index.adjudicate(index.pinSeed("polisher"), "abolisher").outcome).toBe("answer");
  });

  it("accepts `youthfulness` for a Seed Word on `UW TH F AH L N AH S`", () => {
    expect(index.adjudicate(index.pinSeed("truthfulness"), "youthfulness").outcome).toBe(
      "answer",
    );
  });

  it("accepts `zestfully` for a Seed Word on `EH S T F AH L IY`", () => {
    expect(index.adjudicate(index.pinSeed("restfully"), "zestfully").outcome).toBe("answer");
  });

  it("accepts `abashedly` for a Seed Word on `AE SH IH D L IY`", () => {
    // `unabashedly` carries the dictionary's own reading here, so this asserts
    // agreement with CMUdict rather than two derivations sharing a mistake.
    expect(index.adjudicate(index.pinSeed("unabashedly"), "abashedly").outcome).toBe("answer");
  });

  it("gives `abashedly` the syllabic `-ed` the dictionary gives it", () => {
    expect(index.rhymeKeysOf("abashedly")).toEqual(["AE SH IH D L IY"]);
  });

  it("does not let `cussedly` rhyme with `justly`", () => {
    // The participle route composed `-ly` onto `cussed` (`K AH1 S T`) and landed
    // `cussedly` on `AH S T L IY`. Deriving from `cuss` keeps the two apart.
    expect(index.rhymeKeysOf("cussedly")).toEqual(["AH S IH D L IY"]);
    expect(index.adjudicate(index.pinSeed("justly"), "cussedly")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
  });

  it("accepts `yodeler`, tiered a Bonus Word by the ordinary threshold", () => {
    // Low knownness, so it tiers Bonus on the same rule any underived word
    // does — accepted and celebrated, with no special case for derived words.
    expect(index.adjudicate(index.pinSeed("yodeller"), "yodeler").outcome).toBe("bonus");
  });

  it("degeminates through the whole build, so `zestfully` has one L", () => {
    // End-to-end: two L phonemes would read `EH S T F AH L L IY` here.
    expect(index.rhymeKeysOf("zestfully")).toEqual(["EH S T F AH L IY"]);
  });

  it("respells a derived word with the Seed Word's rhyming tail", () => {
    const seed = index.pinSeed("restfully");
    const tail = index.buildPuzzle(seed).seedRespelling.slice(1).toLowerCase();
    const verdict = index.adjudicate(seed, "zestfully");

    expect(verdict).toMatchObject({ outcome: "answer" });
    if (verdict.outcome === "answer") {
      expect(verdict.respelling.toLowerCase()).toContain(tail);
    }
  });
});

describe("a participle base belongs only to the `-ed` suffix variants", () => {
  // Adverbial `-ed` is syllabic where the participle's is not, so `-ly` and
  // `-ness` refuse a base spelled `…ed` outright. Where `-edly`/`-edness` cannot
  // reach a stem either, the word stays underived rather than wrongly read.
  const index = makeTestIndex();

  it("leaves a word underived rather than reading it from the participle", () => {
    // `absentmindedly` has no `absentmind` stem, so nothing derives it — and it
    // must not fall through to `-ly` on `absentminded`.
    expect(index.adjudicate(index.pinSeed("justly"), "absentmindedly")).toMatchObject({
      outcome: "rejected",
    });
  });

  it("still derives an ordinary `-ly` word whose base is not a participle", () => {
    expect(index.rhymeKeysOf("zestfully")).toEqual(["EH S T F AH L IY"]);
  });
});
