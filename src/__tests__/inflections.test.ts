/**
 * `inflectionalVariants` casts a wide orthographic net so a missing lemma can be
 * matched to a present inflection (and vice versa). Correctness is "does it
 * contain the relative CMUdict actually holds", not "is every guess a real word".
 */

import { describe, expect, it } from "vitest";
import { inflectionalVariants } from "../inflections.ts";

describe("inflectionalVariants", () => {
  it("reaches the inflection that carries the reading (overjoy -> overjoyed)", () => {
    const variants = inflectionalVariants("overjoy");
    expect(variants).toContain("overjoyed");
    expect(variants).toContain("overjoys");
    expect(variants).not.toContain("overjoy");
  });

  it("runs the other direction too (overjoyed -> overjoy)", () => {
    expect(inflectionalVariants("overjoyed")).toContain("overjoy");
  });

  it("handles consonant-y inflection (carry -> carries/carried/carrying)", () => {
    const variants = inflectionalVariants("carry");
    expect(variants).toEqual(expect.arrayContaining(["carries", "carried", "carrying"]));
    expect(variants).not.toContain("carrys");
  });

  it("handles a silent-e stem (rate -> rates/rated/rating)", () => {
    const variants = inflectionalVariants("rate");
    expect(variants).toEqual(expect.arrayContaining(["rates", "rated", "rating"]));
  });

  it("offers the doubled-consonant past/progressive (stop -> stopped/stopping)", () => {
    const variants = inflectionalVariants("stop");
    expect(variants).toEqual(expect.arrayContaining(["stopped", "stopping"]));
  });
});
