/**
 * Re-sorting each week of the Schedule by Difficulty (#312, ADR-0012 amended
 * 2026-11-10): every played week except the one holding today runs Monday
 * easiest to Sunday hardest again, and every Seed Word stays in its week.
 */

import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  DAYS_PER_WEEK,
  parseSchedule,
  seedForDate,
  weekdayOf,
  type Schedule,
  type ScheduleDay,
} from "../schedule.ts";
import { resortWeeks, type Measured } from "../scheduleResort.ts";

function day(date: string, seed: string): ScheduleDay {
  const week = Math.floor(daysBetween("2026-08-03", date) / DAYS_PER_WEEK) + 1;
  return { date, weekday: weekdayOf(date), week, seed, rhymeKey: `K ${seed}`, answerCount: 30, difficulty: 0 };
}

/**
 * A Schedule shaped like the committed one: a spare on Monday 2026-08-03, then
 * a lap of three weeks from Tuesday 2026-08-04 to Monday 2026-08-24, so the
 * last listed day is the Monday of the week the next lap opens.
 */
function schedule(): Schedule {
  const days = [day("2026-08-03", "spare")];
  for (let i = 0; i < 21; i++) days.push(day(addDays("2026-08-04", i), `s${i}`));
  return { startDate: "2026-08-03", lapStart: "2026-08-04", days };
}

/** Each listed day's Difficulty now, by date, read off the Seed Word's number. */
function measured(s: Schedule, difficultyOf: (seed: string) => number): Map<string, Measured> {
  return new Map(s.days.map((d) => [d.date, { answerCount: 40, difficulty: difficultyOf(d.seed) }]));
}

function seedsFrom(s: Schedule, from: string, to: string): (string | undefined)[] {
  const seeds: (string | undefined)[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) seeds.push(seedForDate(s, date)?.word);
  return seeds;
}

const n = (seed: string) => Number(seed.slice(1));

describe("re-sorting the weeks", () => {
  it("turns a week in reverse round, Monday easiest to Sunday hardest", () => {
    const before = schedule();
    // The week of Monday 2026-08-10 holds s6..s12; make s6 the hardest and s12 the easiest.
    const after = resortWeeks(before, measured(before, (s) => (s === "spare" ? 0 : -n(s))), "2026-08-03");

    expect(seedsFrom(after, "2026-08-10", "2026-08-16")).toEqual(["s12", "s11", "s10", "s9", "s8", "s7", "s6"]);
  });

  it("leaves a week already in order where it is, and records the Difficulty it was sorted on", () => {
    const before = schedule();
    const after = resortWeeks(before, measured(before, (s) => (s === "spare" ? 0 : n(s) / 100)), "2026-08-03");

    expect(seedsFrom(after, "2026-08-10", "2026-08-16")).toEqual(seedsFrom(before, "2026-08-10", "2026-08-16"));
    expect(after.days.find((d) => d.date === "2026-08-10")).toMatchObject({ seed: "s6", weekday: "Mon", week: 2, difficulty: 0.06, answerCount: 40 });
  });

  it("keeps a tie in the order it was in", () => {
    const before = schedule();
    // s7..s12 tie, and s6 is the hardest: it goes to Sunday and the rest keep their order.
    const after = resortWeeks(before, measured(before, (s) => (s === "s6" ? 0.5 : 0.1)), "2026-08-03");

    expect(seedsFrom(after, "2026-08-10", "2026-08-16")).toEqual(["s7", "s8", "s9", "s10", "s11", "s12", "s6"]);
  });

  it("leaves the week holding today in its order, and re-sorts the weeks already played this lap", () => {
    const before = schedule();
    const after = resortWeeks(before, measured(before, (s) => (s === "spare" ? 0 : -n(s))), "2026-08-12");

    expect(seedsFrom(after, "2026-08-10", "2026-08-16")).toEqual(["s6", "s7", "s8", "s9", "s10", "s11", "s12"]);
    // The week of 2026-08-17 is ahead of today, and re-sorted.
    expect(seedsFrom(after, "2026-08-17", "2026-08-23")).toEqual(["s19", "s18", "s17", "s16", "s15", "s14", "s13"]);
  });

  it("records the week holding today at the figures measured now, as every other week is", () => {
    const before = schedule();
    // The week of 2026-08-10 holds today; its days were dealt at 30 Answers and Difficulty 0.
    const after = resortWeeks(before, measured(before, (s) => (s === "spare" ? 0 : n(s) / 100 + 0.00001)), "2026-08-12");

    expect(after.days.find((d) => d.date === "2026-08-10")).toEqual({
      date: "2026-08-10",
      weekday: "Mon",
      week: 2,
      seed: "s6",
      rhymeKey: "K s6",
      answerCount: 40,
      difficulty: 0.06,
    });
    expect(after.days.find((d) => d.date === "2026-08-16")).toMatchObject({ seed: "s12", answerCount: 40, difficulty: 0.12 });
  });

  it("re-sorts the week that opens the next lap as it is played: the last listed Monday, then the lap's first six", () => {
    const before = schedule();
    // s20 is the listed Monday 2026-08-24, played in the week that opens each later lap.
    const after = resortWeeks(before, measured(before, (s) => (s === "spare" ? 0 : -n(s))), "2026-08-12");

    // The second lap opens on Tuesday 2026-08-25; that week's Monday is 2026-08-24.
    expect(seedsFrom(after, "2026-08-24", "2026-08-30")).toEqual(["s20", "s5", "s4", "s3", "s2", "s1", "s0"]);
    // Every Seed Word stays in its week, the spare before the lap is left alone, and the loop still reads.
    expect(after.days[0]).toEqual(before.days[0]);
    expect(new Set(after.days.map((d) => d.seed))).toEqual(new Set(before.days.map((d) => d.seed)));
    expect(parseSchedule(after)).toEqual(after);
  });

  it("counts the week holding today round the loop, so a later lap's week in progress stays put", () => {
    const before = schedule();
    // Thursday 2026-08-27 is in the second lap, in the week that opens it.
    const after = resortWeeks(before, measured(before, (s) => (s === "spare" ? 0 : -n(s))), "2026-08-27");

    expect(seedsFrom(after, "2026-08-24", "2026-08-30")).toEqual(seedsFrom(before, "2026-08-24", "2026-08-30"));
    expect(seedsFrom(after, "2026-08-31", "2026-09-06")).toEqual(["s12", "s11", "s10", "s9", "s8", "s7", "s6"]);
  });
});
