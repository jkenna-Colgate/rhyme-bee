/**
 * A word's final vowel, when the data marks it unstressed but it is a full vowel
 * sitting in a closed syllable, carries real secondary stress in ordinary
 * General American — `module` is "MODJ-ool", not "MODJ-ə-l" — so normalisation
 * gives such a reading a second reading with the stress marked (ADR-0010).
 *
 * The rule *appends*, so it can only ever turn a rejection into an acceptance —
 * every reading the index had before is still there, still first.
 *
 * These tests assert a reading or a verdict, never the rule's internals. Each
 * limit pinned below is stated in full, with its measurement, in the rule's
 * docblock in `src/normalise.ts` — that is where the figures live, so they cannot
 * drift between two copies.
 */

import { describe, expect, it } from "vitest";
import { applyNormalisation } from "../normalise.ts";
import { makeTestIndex } from "../__fixtures__/index.ts";
import type { Pronunciation, RhymeKey } from "../phonology.ts";
import type { RhymeIndex } from "../rhymeIndex.ts";
import { isAccepted } from "../verdict.ts";

function target(entries: [string, Pronunciation[]][] = []) {
  return { pronunciations: new Map(entries) };
}

/** Every Rhyme Key in an index, with the wordhood-valid words that share it. */
function familiesOf(index: RhymeIndex): Map<RhymeKey, string[]> {
  const families = new Map<RhymeKey, string[]>();
  for (const [word] of index.wordhoodEntries()) {
    for (const key of index.rhymeKeysOf(word)) {
      families.set(key, [...(families.get(key) ?? []), word]);
    }
  }
  return families;
}

describe("a final unstressed full vowel in a closed syllable", () => {
  it("gains a reading carrying secondary stress, keeping the base reading first", () => {
    const data = target([["module", [["M", "AA1", "JH", "UW0", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("module")).toEqual([
      ["M", "AA1", "JH", "UW0", "L"],
      ["M", "AA1", "JH", "UW2", "L"],
    ]);
  });

  it("promotes the `-ate` of `candidate`, which ADR-0001 already rhymes on", () => {
    // The same claim `impregnate` rests on: a full `EY` in a closed final
    // syllable is stress-bearing, whatever digit the data happens to carry.
    const data = target([["candidate", [["K", "AE1", "N", "D", "AH0", "D", "EY0", "T"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("candidate")).toContainEqual([
      "K", "AE1", "N", "D", "AH0", "D", "EY2", "T",
    ]);
  });

  it("appends variants after every base reading, in the order they arrived", () => {
    // Load-bearing: a Seed Word is spoken and respelled in its first reading, so
    // a variant must never displace the reading the data actually asserts.
    const data = target([
      ["module", [["M", "AA1", "JH", "UW0", "L"], ["M", "AA1", "D", "UW0", "L"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("module")).toEqual([
      ["M", "AA1", "JH", "UW0", "L"],
      ["M", "AA1", "D", "UW0", "L"],
      ["M", "AA1", "JH", "UW2", "L"],
      ["M", "AA1", "D", "UW2", "L"],
    ]);
  });

  it("leaves an already-stressed final vowel alone", () => {
    const data = target([["cool", [["K", "UW1", "L"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("cool")).toEqual([["K", "UW1", "L"]]);
  });
});

describe("a word-final vowel is never promoted", () => {
  // The load-bearing limit. Promoting a word-final vowel yields a Rhyme Key of a
  // single phoneme, and admitting the `-y` ending that way collapses every `-y`
  // word into one family. A closed final syllable is genuinely unreduced; a
  // word-final unstressed vowel is the classic reduction position.

  it("leaves `happy` alone, so it keeps a Rhyme Key of its own", () => {
    const data = target([["happy", [["HH", "AE1", "P", "IY0"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("happy")).toEqual([["HH", "AE1", "P", "IY0"]]);
  });

  it("leaves a word-final vowel of any quality alone", () => {
    const data = target([
      ["arrow", [["AE1", "R", "OW0"]]],
      ["menu", [["M", "EH1", "N", "Y", "UW0"]]],
      ["viceroy", [["V", "AY1", "S", "R", "OY0"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("arrow")).toEqual([["AE1", "R", "OW0"]]);
    expect(data.pronunciations.get("menu")).toEqual([["M", "EH1", "N", "Y", "UW0"]]);
    expect(data.pronunciations.get("viceroy")).toEqual([["V", "AY1", "S", "R", "OY0"]]);
  });

  it("does not collapse the `-y` words into one shared single-phoneme key", () => {
    const index = makeTestIndex();

    expect(index.rhymeKeysOf("happy")).toEqual(["AE P IY"]);
    expect(index.rhymeKeysOf("smelly")).toEqual(["EH L IY"]);
    expect(index.adjudicate(index.pinSeed("happy"), "smelly")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
  });

  it("leaves no single-phoneme Rhyme Key in the index but the legitimate `AY`", () => {
    // The regression that pins the blow-up. Its signature is a bare-vowel key
    // swallowing a whole ending, so assert the shape directly: every
    // single-phoneme key in the index, and who is in it.
    const single = [...familiesOf(makeTestIndex())].filter(([key]) => !key.includes(" "));

    expect(single.map(([key]) => key)).toEqual(["AY"]);
    expect(single[0]?.[1].slice().sort()).toEqual(["buy", "eye", "high"]);
  });

  it("keeps every family far below the scale the unconstrained rule reached", () => {
    // The scale half of the same claim: unconstrained, one key held most of the
    // words in the lexicon. The fixture is small, so this is the loose guard and
    // the single-phoneme assertion above is the sharp one — but a family that
    // ever swallows a quarter of the words is the blow-up returning.
    const families = familiesOf(makeTestIndex());
    const largest = Math.max(...[...families.values()].map((m) => m.length));
    const lexicon = new Set([...families.values()].flat()).size;

    expect(largest / lexicon).toBeLessThan(0.25);
  });

  it("keeps the legitimate one-phoneme key `AY` shared by `high`, `buy` and `eye`", () => {
    // The fix is a following consonant, never a minimum key length: a key can be
    // one phoneme long and perfectly real.
    const index = makeTestIndex();

    expect(index.rhymeKeysOf("high")).toEqual(["AY"]);
    expect(index.rhymeKeysOf("buy")).toEqual(["AY"]);
    expect(index.rhymeKeysOf("eye")).toEqual(["AY"]);
    expect(isAccepted(index.adjudicate(index.pinSeed("high"), "buy"))).toBe(true);
    expect(isAccepted(index.adjudicate(index.pinSeed("high"), "eye"))).toBe(true);
  });
});

describe("a reducible vowel is never promoted", () => {
  // A genuine schwa is the contrast everybody hears, and excluding it is what
  // preserves the `chocolate` / `ate` rejection ADR-0001 rests on.

  it("leaves the schwa of `chocolate` alone", () => {
    const data = target([["chocolate", [["CH", "AA1", "K", "L", "AH0", "T"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("chocolate")).toEqual([
      ["CH", "AA1", "K", "L", "AH0", "T"],
    ]);
  });

  it("still refuses `chocolate` for `ate`", () => {
    const index = makeTestIndex();

    expect(index.adjudicate(index.pinSeed("ate"), "chocolate")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
  });

  it("leaves the reduced `IH` and `ER` alone", () => {
    // `ER0` is the r-coloured schwa. Leaving it out is also what keeps the
    // hand-authored `bratwurst` correction (ADR-0009) a deliberate judgement
    // about one loanword rather than something this rule silently duplicates.
    const data = target([
      ["bratwurst", [["B", "R", "AE1", "T", "W", "ER0", "S", "T"]]],
      ["accurate", [["AE1", "K", "Y", "ER0", "AH0", "T"]]],
      ["forfeit", [["F", "AO1", "R", "F", "IH0", "T"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("bratwurst")).toEqual([
      ["B", "R", "AE1", "T", "W", "ER0", "S", "T"],
    ]);
    expect(data.pronunciations.get("accurate")).toEqual([
      ["AE1", "K", "Y", "ER0", "AH0", "T"],
    ]);
    expect(data.pronunciations.get("forfeit")).toEqual([
      ["F", "AO1", "R", "F", "IH0", "T"],
    ]);
  });
});

describe("a lone inflectional coda does not close a syllable", () => {
  // Measured, not reasoned. After a vowel the regular `-s` is always voiced to
  // `Z` and the regular `-ed` to `D`, so a lone one of those is an ending stuck
  // on a word whose own final vowel was word-final — the reduction position the
  // rule refuses. Without the limit the rule had `arrows` rhyming with `nose`,
  // `cities` with `bees` and `married` with `deed`.

  it("does not let `arrows` rhyme with `nose`", () => {
    const data = target([["arrows", [["AE1", "R", "OW0", "Z"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("arrows")).toEqual([["AE1", "R", "OW0", "Z"]]);
  });

  it("does not let `cities` rhyme with `bees`, nor `married` with `deed`", () => {
    const data = target([
      ["cities", [["S", "IH1", "T", "IY0", "Z"]]],
      ["married", [["M", "EH1", "R", "IY0", "D"]]],
    ]);
    applyNormalisation(data);

    expect(data.pronunciations.get("cities")).toEqual([["S", "IH1", "T", "IY0", "Z"]]);
    expect(data.pronunciations.get("married")).toEqual([["M", "EH1", "R", "IY0", "D"]]);
  });

  it("still promotes a coda of more than one consonant", () => {
    // `modules` is `module` with the same inflection, and its coda is `L Z` — a
    // consonant of the stem before the ending, so the syllable really is closed.
    const data = target([["modules", [["M", "AA1", "JH", "UW0", "L", "Z"]]]]);
    applyNormalisation(data);

    expect(data.pronunciations.get("modules")).toContainEqual([
      "M", "AA1", "JH", "UW2", "L", "Z",
    ]);
  });

  it("refuses `arrows` for `nose` end to end", () => {
    const index = makeTestIndex();

    expect(index.adjudicate(index.pinSeed("nose"), "arrows")).toMatchObject({
      outcome: "rejected",
      reason: "does-not-rhyme",
    });
  });
});

describe("a normalised index adjudicates against the Seed Word `cool`", () => {
  const index = makeTestIndex();
  const cool = index.pinSeed("cool", "UW L");

  it("accepts `module`, whose final syllable carries real secondary stress", () => {
    expect(index.adjudicate(cool, "module").outcome).toBe("answer");
  });

  it("keeps the data's own reading of `module` alongside the promoted one", () => {
    expect(index.rhymeKeysOf("module")).toEqual(["AA JH UW L", "UW L"]);
  });

  it("puts `module` in the `cool` Puzzle", () => {
    const puzzle = index.buildPuzzle(cool);
    const members = [...puzzle.answers, ...puzzle.bonusWords].map((e) => e.word);

    expect(members).toContain("module");
  });

  it("still accepts `pool`, whose final vowel was stressed all along", () => {
    expect(index.adjudicate(cool, "pool").outcome).toBe("answer");
  });
});
