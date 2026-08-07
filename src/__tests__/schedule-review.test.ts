/**
 * Slice: the review a person reads before signing off a schedule (ADR-0012).
 *
 * The gate is a human, which makes the summary they read load-bearing rather
 * than decorative — and it used to live inside a print loop in an untested
 * script. As values it can be asserted: the ramp per weekday, the short final
 * week, and the days flagged as worth reading first.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkDayDrift,
  dealSchedule,
  DAYS_PER_WEEK,
  parseSchedule,
  reviewSchedule,
  scheduleBands,
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

/**
 * The other half of ADR-0012: review binds the calendar, not what a Puzzle
 * contains. A rebuild can move a scheduled Seed's Answer count out of the size
 * band or shift its Difficulty off the weekday rung it was dealt for, and the
 * Editor's Pass is what surfaces that the night before it ships.
 *
 * The bands come from the real committed artifact, as `schedule-dates.test.ts`
 * does — a drift check that agreed with a hand-written stand-in would be
 * checking days nobody plays. The drifted and un-drifted cases are constructed,
 * because they are about the arithmetic and not about any particular day.
 */
describe("the drift check", () => {
  const artifact: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../data/schedule.json", import.meta.url)), "utf8"),
  );
  const schedule = parseSchedule(artifact)!;
  const bands = scheduleBands(schedule);
  const monday = schedule.days.find((d) => d.weekday === "Mon")!;
  const mondayBand = bands.weekday.find((b) => b.weekday === "Mon")!;

  /** The Puzzle a day was recorded as, so a test can move one figure at a time. */
  const asRecorded = (day = monday) => ({
    answerCount: day.answerCount,
    maxScore: 180,
    difficulty: day.difficulty,
  });

  it("recovers both bands from the committed artifact", () => {
    expect(bands.size).toEqual({ min: 20, max: 120 });
    expect(bands.weekday.map((b) => b.weekday)).toEqual([
      "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    ]);
    expect(mondayBand.min).toBeLessThanOrEqual(mondayBand.max);
  });

  it("reports the recorded and the recomputed figures side by side", () => {
    const drift = checkDayDrift(monday, { answerCount: 34, maxScore: 205, difficulty: 0.5 }, bands);
    expect(drift.recorded).toEqual({
      answerCount: monday.answerCount,
      difficulty: monday.difficulty,
    });
    expect(drift.recomputed).toEqual({ answerCount: 34, maxScore: 205, difficulty: 0.5 });
    expect(drift.date).toBe(monday.date);
    expect(drift.seed).toBe(monday.seed);
    expect(drift.rhymeKey).toBe(monday.rhymeKey);
  });

  it("leaves a day sitting inside both bands undrifted", () => {
    const drift = checkDayDrift(monday, asRecorded(), bands);
    expect(drift.drifted).toBe(false);
    expect(drift.reasons).toEqual([]);
  });

  it("reports a day whose Difficulty has left its weekday band", () => {
    const drift = checkDayDrift(
      monday,
      { ...asRecorded(), difficulty: mondayBand.max + 0.2 },
      bands,
    );
    expect(drift.drifted).toBe(true);
    expect(drift.reasons).toEqual(["difficulty-out-of-band"]);
    expect(drift.weekdayBand).toEqual(mondayBand);
  });

  it("reports a Difficulty below its weekday band too, not only above", () => {
    const drift = checkDayDrift(
      monday,
      { ...asRecorded(), difficulty: mondayBand.min - 0.2 },
      bands,
    );
    expect(drift.reasons).toEqual(["difficulty-out-of-band"]);
  });

  it("reports a day whose Answer count has left the size band", () => {
    const belowBand = checkDayDrift(monday, { ...asRecorded(), answerCount: 4 }, bands);
    expect(belowBand.reasons).toEqual(["answer-count-out-of-band"]);
    const aboveBand = checkDayDrift(monday, { ...asRecorded(), answerCount: 400 }, bands);
    expect(aboveBand.reasons).toEqual(["answer-count-out-of-band"]);
  });

  it("reports both reasons when a day has left both bands", () => {
    const drift = checkDayDrift(
      monday,
      { answerCount: 400, maxScore: 4000, difficulty: mondayBand.max + 0.2 },
      bands,
    );
    expect(drift.reasons).toEqual(["answer-count-out-of-band", "difficulty-out-of-band"]);
  });

  it("does not call the artifact's own rounding a drift", () => {
    // Difficulty is recorded to four decimal places, so a day sitting exactly on
    // its band edge is half a step outside it as often as not. That is
    // arithmetic, not a Puzzle that moved.
    const drift = checkDayDrift(
      monday,
      { ...asRecorded(), difficulty: mondayBand.min - 0.00004 },
      bands,
    );
    expect(drift.drifted).toBe(false);
  });

  it("holds every committed day inside the bands it was dealt from", () => {
    // Nothing has been rebuilt since the deal, so every day agrees with itself.
    // This is the baseline the check is read against: a report on a fresh clone
    // should be empty, and anything in it is a real change.
    const drifted = schedule.days
      .filter((day) => checkDayDrift(day, asRecorded(day), bands).drifted)
      .map((day) => day.date);
    expect(drifted).toEqual([]);
  });

  it("constrains only the size band when the artifact records no weekday for it", () => {
    // A weekday the run never fills has no band to be outside of, so the day is
    // reported with a null band rather than the check inventing one.
    const sunday = { ...monday, weekday: "Sun" as const };
    const drift = checkDayDrift(sunday, asRecorded(), { weekday: [], size: bands.size });
    expect(drift.weekdayBand).toBeNull();
    expect(drift.drifted).toBe(false);
  });
});
