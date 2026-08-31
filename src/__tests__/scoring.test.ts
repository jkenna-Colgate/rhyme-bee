/**
 * Slice: the shape of the Rank ladder. The labels are tuneable configuration
 * and are deliberately not asserted here — what is pinned is the structure a
 * relabelling could break without anyone noticing, since Rank is read off the
 * ladder by threshold and nothing else validates it at load.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RANK_LADDER, DEFAULT_SCORING_CONFIG } from "../scoring.ts";

describe("the default Rank ladder", () => {
  it("has ten rungs", () => {
    expect(DEFAULT_RANK_LADDER).toHaveLength(10);
  });

  it("starts at 0%, so every Session holds a Rank from its first moment", () => {
    expect(DEFAULT_RANK_LADDER[0]?.threshold).toBe(0);
  });

  it("ends at 100%, the perfect game", () => {
    expect(DEFAULT_RANK_LADDER.at(-1)?.threshold).toBe(100);
  });

  it("ascends strictly, so the highest rung reached is unambiguous", () => {
    const thresholds = DEFAULT_RANK_LADDER.map((tier) => tier.threshold);
    const ascending = thresholds.slice(1).every((t, i) => t > thresholds[i]!);
    expect(ascending).toBe(true);
  });

  it("names every rung differently, so a promotion always reads as one", () => {
    const labels = DEFAULT_RANK_LADDER.map((tier) => tier.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("is the ladder the shipped scoring config carries", () => {
    expect(DEFAULT_SCORING_CONFIG.rankLadder).toBe(DEFAULT_RANK_LADDER);
  });
});
