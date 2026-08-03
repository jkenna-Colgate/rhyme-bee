/**
 * `inflectionalVariants` casts a wide orthographic net so a missing lemma can be
 * matched to a present inflection (and vice versa). Correctness is "does it
 * contain the relative CMUdict actually holds", not "is every guess a real word".
 *
 * The backward direction is not orthographic: it goes through `Derivation`, so
 * the evidence a supplement judge reads and the verdict the engine reaches are
 * one rule (#105). The forward direction stays a spelling guess — there is no
 * reading to gate a form that may not exist against.
 */

import { describe, expect, it } from "vitest";
import { makeShortPluralIndex } from "../__fixtures__/shortPlurals.ts";
import { Derivation, IndexDataSource } from "../derivation.ts";
import { inflectionalVariants } from "../inflections.ts";

/** The forward cases turn on spelling alone, so an empty source serves them. */
const spellingOnly = new Derivation(
  new IndexDataSource({ words: new Set<string>(), pronunciations: new Map() }),
);

const variantsOf = (word: string, derivation: Derivation = spellingOnly) =>
  inflectionalVariants(word, derivation);

describe("inflectionalVariants — forward guesses, unchanged", () => {
  it("reaches the inflection that carries the reading (overjoy -> overjoyed)", () => {
    const variants = variantsOf("overjoy");
    expect(variants).toContain("overjoyed");
    expect(variants).toContain("overjoys");
    expect(variants).not.toContain("overjoy");
  });

  it("handles consonant-y inflection (carry -> carries/carried/carrying)", () => {
    const variants = variantsOf("carry");
    expect(variants).toEqual(expect.arrayContaining(["carries", "carried", "carrying"]));
    expect(variants).not.toContain("carrys");
  });

  it("handles a silent-e stem (rate -> rates/rated/rating)", () => {
    const variants = variantsOf("rate");
    expect(variants).toEqual(expect.arrayContaining(["rates", "rated", "rating"]));
  });

  it("offers the doubled-consonant past/progressive (stop -> stopped/stopping)", () => {
    const variants = variantsOf("stop");
    expect(variants).toEqual(expect.arrayContaining(["stopped", "stopping"]));
  });
});

describe("inflectionalVariants — backward guesses, under the sound gate", () => {
  it("runs the other direction (overjoyed -> overjoy)", () => {
    expect(variantsOf("overjoyed")).toContain("overjoy");
  });

  // The short-plural slice is where judge and engine could disagree: `ups` is
  // `AH1 P` + `S` and reduces to `up`; `has` is `HH AE1 Z` where `ha` is
  // `HH AA1`, and reduces to nothing.
  const { derivation } = makeShortPluralIndex();

  it("offers the base of a short plural the engine does reduce (ups -> up)", () => {
    expect(variantsOf("ups", derivation)).toContain("up");
  });

  it("withholds the base of a short plural the engine refuses (has -/-> ha)", () => {
    // The evidence must agree with the engine: `ha` is not a base for `has`, so
    // a judge must not be shown it as one and hand-author a reading toward it.
    expect(derivation.isDerived("has")).toBe(false);
    expect(variantsOf("has", derivation)).not.toContain("ha");
  });

  it("withholds it on the same vowel contrast (gas -/-> ga)", () => {
    expect(variantsOf("gas", derivation)).not.toContain("ga");
  });

  it("never returns the word itself", () => {
    for (const word of ["ups", "has", "gas", "overjoyed", "rate", "carry"]) {
      expect(variantsOf(word, derivation)).not.toContain(word);
    }
  });

  it("leaves a longer plural exactly as spelling had it (cups -> cup)", () => {
    // The sound gate only ever reaches three-letter `-s` forms, so everything
    // longer is untouched by this change.
    expect(variantsOf("cups", derivation)).toContain("cup");
  });
});
