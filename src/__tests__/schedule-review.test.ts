/**
 * Slice: the review a person reads before signing off a schedule (ADR-0012).
 *
 * The gate is a human, which makes the summary they read load-bearing rather
 * than decorative — and it used to live inside a print loop in an untested
 * script. As values it can be asserted: the ramp per weekday, the short final
 * week, and the days flagged as worth reading first.
 */

import { describe, expect, it } from "vitest";
import {
  dealSchedule,
  DAYS_PER_WEEK,
  reviewSchedule,
  type Reviewable,
} from "../schedule.ts";

const MONDAY = "2026-08-03";

/** A pool of `count` families, Difficulty spread evenly over 0…1. */
function pool(count: number, overrides: Partial<Reviewable>[] = []): Reviewable[] {
  return Array.from({ length: count }, (_, i) => ({
    rhymeKey: `K${String(i).padStart(3, "0")}`,
    representative: `word${i}`,
    difficulty: i / count,
    answerCount: 40,
    nativeCount: 20,
    ...overrides[i],
  }));
}

const review = (count: number, overrides?: Partial<Reviewable>[]) =>
  reviewSchedule(dealSchedule(pool(count, overrides), MONDAY));

describe("the ramp", () => {
  const { ramp } = review(294);

  it("reports one band per weekday, Monday to Sunday", () => {
    expect(ramp.map((b) => b.weekday)).toEqual([
      "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    ]);
  });

  it("ramps monotonically Monday to Sunday across the dealt pool", () => {
    // The deal cuts non-overlapping Difficulty bands, so this holds by
    // construction — which is exactly why it is worth asserting: it is the one
    // property the whole weekday scheme rests on.
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i]!.min).toBeGreaterThan(ramp[i - 1]!.max);
    }
  });

  it("reports each band's range from its own days", () => {
    for (const band of ramp) {
      expect(band.min).toBeLessThanOrEqual(band.max);
    }
  });

  it("omits a weekday the pool never reaches", () => {
    // Three families fill Monday, Tuesday and Wednesday and no more. A band
    // with no members has no range, so it is absent rather than infinite.
    expect(review(3).ramp.map((b) => b.weekday)).toEqual(["Mon", "Tue", "Wed"]);
  });
});

describe("the short final week", () => {
  it("reports no short final week when the pool divides exactly into weeks", () => {
    expect(review(294).shortFinalWeek).toBeNull();
    expect(review(DAYS_PER_WEEK).shortFinalWeek).toBeNull();
  });

  it("reports the tail when the pool does not", () => {
    const { shortFinalWeek, weeks, totalDays } = review(297);
    expect(totalDays).toBe(297);
    expect(weeks).toBe(43);
    expect(shortFinalWeek).not.toBeNull();
    expect(shortFinalWeek!.length).toBe(3);
    expect(shortFinalWeek!.week).toBe(43);
    expect(shortFinalWeek!.days).toHaveLength(3);
  });

  it("hands back the tail's own days, in schedule order", () => {
    const { shortFinalWeek } = review(297);
    expect(shortFinalWeek!.days.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed"]);
    expect(shortFinalWeek!.days.every((d) => d.week === 43)).toBe(true);
  });
});

describe("the days flagged as worth reading first", () => {
  // A Seed is shown *and spoken* to the player, so a representative that is not
  // a recognisable word is the failure the review exists to catch. Three
  // families, one tripping on each condition and one on neither.
  const { flagged } = review(3, [
    { representative: "ers", nativeCount: 20 }, // trips on length
    { representative: "beard", nativeCount: 2 }, // trips on native content
    { representative: "impregnate", nativeCount: 20 }, // trips on neither
  ]);
  const flaggedSeeds = flagged.map((d) => d.entry.representative);

  it("flags a Seed Word too short to be recognisable", () => {
    expect(flaggedSeeds).toContain("ers");
  });

  it("flags a family with almost no native content", () => {
    expect(flaggedSeeds).toContain("beard");
  });

  it("leaves a Seed that trips on neither alone", () => {
    expect(flaggedSeeds).not.toContain("impregnate");
  });

  it("flags nothing when no day trips either condition", () => {
    expect(review(20).flagged).toEqual([]);
  });

  it("keeps the flagged days in schedule order", () => {
    const { flagged: many } = review(14, [
      { representative: "ers" },
      {},
      {},
      {},
      {},
      {},
      {},
      { representative: "ohs" },
    ]);
    const dates = many.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
  });
});
