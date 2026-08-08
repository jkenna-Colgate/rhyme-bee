/**
 * The Retrieval override layer (ADR-0015), wired into the composed build
 * (`manufactureIndexData`), rather than the pure module's own rules — those are
 * `tierOverride.test.ts`'s job. This file asks: does the merge actually reach a
 * built `RhymeIndex`, in the position ADR-0015 fixes ("before any Tier is
 * read"), through the same stage order `npm run build:index` runs (#106)?
 *
 * Every case here goes through `makeTestIndex`/`buildTestIndex`, which run all
 * five stages — demotions, supplement, coverage, normalisation, tier overrides
 * — over the fixture, exactly as the shipped build does. A test that called
 * `applyTierOverrides` directly would only prove the module works, which
 * `tierOverride.test.ts` already does; this proves the *wiring*.
 */

import { describe, expect, it } from "vitest";
import { serialiseTierOverride, type TierOverrideRow } from "../tierOverride.ts";
import { DEFAULT_SCORING_CONFIG, isRare } from "../scoring.ts";
import { buildTestIndex, makeTestIndex } from "../__fixtures__/index.ts";

/**
 * The shipped threshold (0.0) and the shipped rare cutoff (0.7, via
 * `DEFAULT_SCORING_CONFIG`) — not the fixture's own 1.0 — because the four
 * verdicts' values (`VERDICT_VALUE`) are sentinels calibrated against the
 * *shipped* configuration (ADR-0015). Building at the fixture's usual
 * threshold would test a knob combination no sentinel was chosen for.
 */
const SHIPPED_THRESHOLD = 0.0;

function row(over: Partial<TierOverrideRow>): string {
  return serialiseTierOverride({
    word: "objurgate",
    verdict: "bonus",
    measured: null,
    decided: "2026-08-08T00:00:00.000Z",
    note: "",
    ...over,
  });
}

describe("the override layer, merged into the composed build", () => {
  it("tiers an overridden word to Bonus, whatever its measured prevalence said", () => {
    // objurgate measures 0.2, which is an Answer at the shipped threshold —
    // the override is the thing that has to move it.
    const index = makeTestIndex({
      tierOverrides: row({ word: "objurgate", verdict: "bonus" }),
      knownnessThreshold: SHIPPED_THRESHOLD,
    });

    expect(index.tierOf("objurgate")).toEqual({ tier: "bonus", knownness: -3.0 });
  });

  it("tiers an overridden word to a rare Answer — earning the rare bonus scoring reads separately", () => {
    // `sate` is the fixture's deliberate prevalence gap (ADR-0003's
    // absent-defaults-to-Bonus case) — exactly the shape a lemmatiser
    // coverage gap takes, which `answer-rare` exists to correct.
    const index = makeTestIndex({
      tierOverrides: row({ word: "sate", verdict: "answer-rare", measured: null }),
      knownnessThreshold: SHIPPED_THRESHOLD,
    });

    const { tier, knownness } = index.tierOf("sate");
    expect(tier).toBe("answer");
    expect(isRare(knownness, DEFAULT_SCORING_CONFIG)).toBe(true);
  });

  it("tiers an overridden word to an ordinary Answer, not rare", () => {
    const index = makeTestIndex({
      tierOverrides: row({ word: "objurgate", verdict: "answer-common" }),
      knownnessThreshold: SHIPPED_THRESHOLD,
    });

    const { tier, knownness } = index.tierOf("objurgate");
    expect(tier).toBe("answer");
    expect(isRare(knownness, DEFAULT_SCORING_CONFIG)).toBe(false);
  });

  it("leaves prevalence governing on `none`, as if no override had ever run", () => {
    // A `bonus` row, reversed by a later `none` row — resolved to `none`, which
    // patches nothing (src/tierOverride.ts), so the word's own measured
    // prevalence (1.6) is what the build should still show.
    const overridden = makeTestIndex({
      tierOverrides: row({ word: "impregnate", verdict: "bonus" }) + row({ word: "impregnate", verdict: "none" }),
      knownnessThreshold: SHIPPED_THRESHOLD,
    });
    const plain = makeTestIndex({ knownnessThreshold: SHIPPED_THRESHOLD });

    expect(overridden.tierOf("impregnate")).toEqual(plain.tierOf("impregnate"));
  });

  it("builds identically with no tier-overrides input at all", () => {
    // A missing file is a legitimate no-op (ADR-0015) — the build script gives
    // this stage empty text rather than throwing, so the fixture leaving
    // `tierOverrides` unset must build exactly as it always did.
    const withoutInput = buildTestIndex({ knownnessThreshold: SHIPPED_THRESHOLD });
    const withEmptyText = buildTestIndex({ tierOverrides: "", knownnessThreshold: SHIPPED_THRESHOLD });

    expect(withoutInput.data.prevalence).toEqual(withEmptyText.data.prevalence);
    expect(withoutInput.index.tierOf("objurgate")).toEqual(withEmptyText.index.tierOf("objurgate"));
  });

  it("does not open a second tiering path — the override reaches Tier only through prevalence", () => {
    // If the wiring ever routed the verdict anywhere but `data.prevalence`,
    // this would be the only place that could catch it: the returned data is
    // exactly what `build-index.ts` serialises.
    const { data } = buildTestIndex({
      tierOverrides: row({ word: "objurgate", verdict: "bonus" }),
      knownnessThreshold: SHIPPED_THRESHOLD,
    });

    expect(data.prevalence.get("objurgate")).toBe(-3.0);
  });
});

describe("an override on a lemma also re-tiers the surface forms that lemmatise to it (pinned, not asserted as intended)", () => {
  // `RhymeIndex#tier` resolves knownness through `lemmaCandidates`, which tries
  // the surface form first and falls back to candidate lemmas. `gates` is the
  // fixture's own worked example of that fallback: it deliberately carries no
  // prevalence row of its own, so it tiers on `gate`'s (see __fixtures__/index.ts).
  // Overriding `gate` therefore does not stay put on `gate` — it reaches
  // `gates` too, on the very same lookup. ADR-0015 documents the override as
  // "global across a word's Rhyme Keys" (i.e. within one word, across its own
  // pronunciations); this is broader than that — it crosses to a *different*
  // word that merely shares a lemma. This test pins the behaviour the build
  // actually has. It does not say whether that reach is the intended one —
  // that judgement belongs to the maintainer.
  it("re-tiers `gates` when `gate`, its lemma, is overridden", () => {
    const plain = makeTestIndex({ knownnessThreshold: SHIPPED_THRESHOLD });
    // Baseline: `gates` carries no prevalence row of its own and tiers on
    // `gate`'s measured 2.4.
    expect(plain.tierOf("gates")).toEqual({ tier: "answer", knownness: 2.4 });

    const overridden = makeTestIndex({
      tierOverrides: row({ word: "gate", verdict: "bonus" }),
      knownnessThreshold: SHIPPED_THRESHOLD,
    });

    expect(overridden.tierOf("gate")).toEqual({ tier: "bonus", knownness: -3.0 });
    // The word actually named in the override file was `gate`, never `gates` —
    // and `gates` moved anyway.
    expect(overridden.tierOf("gates")).toEqual({ tier: "bonus", knownness: -3.0 });
  });
});
