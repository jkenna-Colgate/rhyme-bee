/**
 * Slice: the Answer / Bonus tier split by word prevalence, with lemmatisation
 * before the knownness lookup only. Includes the two design assumptions turned
 * into tests: that `defenestrate` outranks `objurgate`, and that `gates` is not
 * misfiled merely because the prevalence data lists only `gate`.
 */

import { describe, expect, it } from "vitest";
import { isAccepted } from "../verdict.ts";
import { KNOWNNESS_THRESHOLD, makeTestIndex } from "../__fixtures__/index.ts";
import { makeShortPluralIndex } from "../__fixtures__/shortPlurals.ts";

const index = makeTestIndex();
const ate = index.pinSeed("ate");

describe("the ADR-0003 assumption, as a test", () => {
  it("ranks defenestrate as an Answer and objurgate as a Bonus Word", () => {
    expect(index.adjudicate(ate, "defenestrate").outcome).toBe("answer");
    expect(index.adjudicate(ate, "objurgate").outcome).toBe("bonus");
  });

  it("scores defenestrate strictly above objurgate", () => {
    const known = index.adjudicate(ate, "defenestrate");
    const obscure = index.adjudicate(ate, "objurgate");
    if (isAccepted(known) && isAccepted(obscure)) {
      expect(known.knownness!).toBeGreaterThan(obscure.knownness!);
    }
  });
});

describe("lemmatise before the knownness lookup, not before rhyme matching", () => {
  it("treats gates as an Answer via its lemma gate, not a Bonus", () => {
    // `plates` and `gates` share the Rhyme Key EY T S — the surface form still
    // drives the rhyme, but knownness is looked up on the lemma `gate`.
    const verdict = index.adjudicate(index.pinSeed("plates"), "gates");
    expect(verdict.outcome).toBe("answer");
  });
});

describe("a three-letter plural tiers on its base, when the sound agrees (issue #97)", () => {
  const shortPlurals = makeShortPluralIndex();

  it.each([
    ["ups", "up"],
    ["ins", "in"],
  ])("tiers %j as an Answer on %j's knownness, not as a Bonus Word", (form, base) => {
    // The prevalence norms list the lemma, so a plural that never reaches it
    // takes no knownness at all and defaults to Bonus — the celebration
    // reserved for `objurgate`, handed to a word everybody knows.
    const tier = shortPlurals.tierOf(form);
    expect(tier.tier).toBe("answer");
    expect(tier.knownness).toBe(shortPlurals.tierOf(base).knownness);
  });

  it("leaves has where it was — absent from the norms, not tiered on ha", () => {
    // `ha` scores 1.28 and is an Answer. `has` is absent from the norms, as it
    // is from the real ones: if the rule took `ha` as its base it would jump to
    // Answer on knownness that is not its own.
    expect(shortPlurals.tierOf("ha").tier).toBe("answer");
    expect(shortPlurals.tierOf("has")).toEqual({ tier: "bonus", knownness: null });
  });

  it.each([
    ["gas", "ga"],
    ["was", "wa"],
    ["yes", "ye"],
  ])("leaves %j its own knownness rather than %j's", (form, base) => {
    expect(shortPlurals.tierOf(form).knownness).not.toBe(
      shortPlurals.tierOf(base).knownness,
    );
  });

  it("leaves bus its own knownness — there is no `bu` to be a plural of", () => {
    expect(shortPlurals.tierOf("bus").knownness).toBe(1.9);
  });

  it("still tiers a de-doubled three-letter word on its base (inn ← in)", () => {
    // `inn` is not an `-s` form and reaches `in` by de-doubling, as it always
    // did. The sound test adds a candidate to `-s` forms; it takes none away.
    expect(shortPlurals.tierOf("inn")).toEqual(shortPlurals.tierOf("in"));
  });

  it("still accepts a demoted word wherever it rhymes", () => {
    // Demotion bears on Seed selection only. `ups` is no longer native content,
    // and is still an Answer on the board its Rhyme Key belongs to.
    const cups = shortPlurals.pinSeed("cups");
    expect(shortPlurals.adjudicate(cups, "ups").outcome).toBe("answer");
  });
});

describe("absent from the prevalence data defaults to Bonus", () => {
  it("tiers a rhyming word with no prevalence entry as Bonus, knownness null", () => {
    const verdict = index.adjudicate(ate, "sate");
    expect(verdict.outcome).toBe("bonus");
    if (isAccepted(verdict)) expect(verdict.knownness).toBeNull();
  });
});

describe("the knownness threshold is configuration, not a constant", () => {
  it("re-tiers a borderline word when the threshold moves", () => {
    // collate scores 1.8. At the default threshold (1.0) it is an Answer; raise
    // the cutoff above it and the same word becomes a Bonus Word.
    expect(index.adjudicate(ate, "collate").outcome).toBe("answer");
    const strict = makeTestIndex({ knownnessThreshold: KNOWNNESS_THRESHOLD + 1.0 });
    expect(strict.adjudicate(strict.pinSeed("ate"), "collate").outcome).toBe("bonus");
  });
});
