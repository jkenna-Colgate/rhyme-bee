/**
 * Slice: the Answer / Bonus tier split by word prevalence, with lemmatisation
 * before the knownness lookup only. Includes the two design assumptions turned
 * into tests: that `defenestrate` outranks `objurgate`, and that `gates` is not
 * misfiled merely because the prevalence data lists only `gate`.
 */

import { describe, expect, it } from "vitest";
import { isAccepted } from "../verdict.ts";
import {
  KNOWNNESS_THRESHOLD,
  makeTestData,
  makeTestIndex,
} from "../__fixtures__/index.ts";
import { RhymeIndex } from "../rhymeIndex.ts";

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
    const strict = new RhymeIndex(makeTestData(), {
      knownnessThreshold: KNOWNNESS_THRESHOLD + 1.0,
    });
    expect(strict.adjudicate(strict.pinSeed("ate"), "collate").outcome).toBe("bonus");
  });
});
