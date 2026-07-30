/**
 * Slice: the banded deal (ADR-0012). The claim under test is that the
 * Monday-to-Sunday Difficulty ramp holds for *every* week by construction, and
 * that weeks do not also ramp across the run.
 */

import { describe, expect, it } from "vitest";
import { dealSchedule, DAYS_PER_WEEK, type Schedulable } from "../schedule.ts";

/** A pool of `count` families, Difficulty spread evenly over 0…1. */
function pool(count: number): Schedulable[] {
  return Array.from({ length: count }, (_, i) => ({
    rhymeKey: `K${String(i).padStart(3, "0")}`,
    representative: `word${i}`,
    difficulty: i / count,
  }));
}

const MONDAY = "2026-08-03";

describe("the ramp holds within every week", () => {
  const { days } = dealSchedule(pool(294), MONDAY);

  it("places every entry exactly once", () => {
    expect(days).toHaveLength(294);
    expect(new Set(days.map((d) => d.entry.rhymeKey)).size).toBe(294);
  });

  it("ramps Difficulty monotonically Monday to Sunday, in all 42 weeks", () => {
    for (let week = 0; week < days.length / DAYS_PER_WEEK; week++) {
      const run = days.slice(week * DAYS_PER_WEEK, (week + 1) * DAYS_PER_WEEK);
      expect(run.map((d) => d.weekday)).toEqual([
        "Mon",
        "Tue",
        "Wed",
        "Thu",
        "Fri",
        "Sat",
        "Sun",
      ]);
      const difficulties = run.map((d) => d.entry.difficulty);
      expect(difficulties).toEqual([...difficulties].sort((a, b) => a - b));
    }
  });

  it("dates run consecutively from the start date", () => {
    expect(days[0]?.date).toBe(MONDAY);
    expect(days[1]?.date).toBe("2026-08-04");
    expect(days[7]?.date).toBe("2026-08-10");
    expect(days[7]?.week).toBe(2);
  });
});

describe("weeks do not ramp across the run", () => {
  // The failure this guards against is keeping each band in Difficulty order,
  // which hands week 1 the easiest member of every band and the last week the
  // hardest — a year-long ramp that makes the weekday signal meaningless.
  it("does not order a weekday's slot by week", () => {
    const { days } = dealSchedule(pool(294), MONDAY);
    const mondays = days.filter((d) => d.weekday === "Mon").map((d) => d.entry.difficulty);
    expect(mondays).not.toEqual([...mondays].sort((a, b) => a - b));
  });
});

describe("determinism", () => {
  it("deals the same calendar on every run", () => {
    const once = dealSchedule(pool(294), MONDAY);
    const twice = dealSchedule(pool(294), MONDAY);
    expect(once.days).toEqual(twice.days);
  });

  it("does not depend on the pool's incoming order", () => {
    const forwards = dealSchedule(pool(294), MONDAY);
    const backwards = dealSchedule([...pool(294)].reverse(), MONDAY);
    expect(backwards.days).toEqual(forwards.days);
  });
});

describe("a pool that is not a multiple of seven", () => {
  // 291 is the live pool: 41 whole weeks and a Monday-to-Thursday tail. The
  // families that fall off a whole number of weeks include some of the best
  // boards in the set, so the run ends mid-week rather than losing them.
  const { days, finalWeekLength } = dealSchedule(pool(291), MONDAY);

  it("places every entry, ending on a short final week", () => {
    expect(days).toHaveLength(291);
    expect(new Set(days.map((d) => d.entry.rhymeKey)).size).toBe(291);
    expect(finalWeekLength).toBe(4);
  });

  it("runs the short week from Monday, so it holds the front of the ramp", () => {
    const finalWeek = days.slice(-finalWeekLength);
    expect(finalWeek.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu"]);
    const difficulties = finalWeek.map((d) => d.entry.difficulty);
    expect(difficulties).toEqual([...difficulties].sort((a, b) => a - b));
  });

  it("still ramps in every whole week before it", () => {
    const wholeWeeks = (days.length - finalWeekLength) / DAYS_PER_WEEK;
    for (let week = 0; week < wholeWeeks; week++) {
      const run = days.slice(week * DAYS_PER_WEEK, (week + 1) * DAYS_PER_WEEK);
      const difficulties = run.map((d) => d.entry.difficulty);
      expect(difficulties).toEqual([...difficulties].sort((a, b) => a - b));
    }
  });

  it("reports a whole number of weeks as no short week at all", () => {
    expect(dealSchedule(pool(294), MONDAY).finalWeekLength).toBe(0);
  });
});

describe("the start date", () => {
  it("refuses a start that is not a Monday", () => {
    expect(() => dealSchedule(pool(14), "2026-08-04")).toThrow(/Monday/);
  });
});
