/**
 * The Continuity check run at every index build, and the repair it runs on a
 * day whose Seed Word no longer pins (#256, decided in #225 and #228).
 *
 * Asserted over the mini fixture index, which holds the two shapes the shipped
 * index fails on today: a Seed whose family moved to another Rhyme Key (any
 * Seed recorded on a key spelled the old way), and #208's Seed that leads its
 * own family and still cannot be pinned to it (`cool` on `UW AH L`).
 */

import { describe, expect, it } from "vitest";
import { checkContinuity, continuityLines } from "../continuity.ts";
import { measureAnswers } from "../curation.ts";
import type { ScheduleDay } from "../schedule.ts";
import { makeTestIndex } from "../__fixtures__/index.ts";

const index = makeTestIndex();

/** What the Editor's Pass reads off a day: the same measurement, not a new one. */
function figuresOf(seed: string, rhymeKey: string) {
  const facts = measureAnswers(index.buildPuzzle(index.pinSeed(seed, rhymeKey)).answers);
  return { answerCount: facts.answerCount, difficulty: Number(facts.difficulty.toFixed(4)) };
}

function day(date: string, seed: string, rhymeKey: string, figures = { answerCount: 0, difficulty: 0 }): ScheduleDay {
  return { date, weekday: "Mon", week: 1, seed, rhymeKey, ...figures };
}

describe("a day whose Seed Word still pins", () => {
  it("is left exactly as it was, and nothing is reported", () => {
    const days = [day("2026-09-07", "ate", "EY T", { answerCount: 999, difficulty: 0.5 })];
    const report = checkContinuity(days, index);
    expect(report.days).toEqual(days);
    expect(report.repairs).toEqual([]);
    expect(report.freePlay).toEqual([]);
  });
});

describe("step 1: the same Seed Word on its current Rhyme Key", () => {
  it("re-pins a Seed recorded on a key spelled the old way, keeping its place", () => {
    const stale = day("2026-09-07", "eight", "EY AH T", { answerCount: 1, difficulty: 0.9 });
    const report = checkContinuity([stale], index);

    expect(report.days).toEqual([{ ...stale, rhymeKey: "EY T", ...figuresOf("eight", "EY T") }]);
    expect(report.repairs).toEqual([
      { date: "2026-09-07", step: 1, before: stale, after: report.days[0] },
    ]);
    expect(report.freePlay).toEqual([]);
  });

  it("re-pins a Seed that sits in two families on the one of them it can be pinned to", () => {
    // `power` is written with "er" only, and glide-r files it under `AW R` as
    // well (#261), so it is in two families and pins only on `AW ER`.
    const glide = makeTestIndex({
      pronunciations: [
        ["power", [["P", "AW1", "ER0"]]],
        ["hour", [["AW1", "ER0"], ["AW1", "R"]]],
        ["flour", [["F", "L", "AW1", "ER0"], ["F", "L", "AW1", "R"]]],
      ],
      words: ["power", "hour", "flour"],
      prevalence: [["power", 2.5], ["hour", 2.5], ["flour", 2.4]],
    });
    const stale = day("2026-09-07", "power", "AW AH R", { answerCount: 1, difficulty: 0.9 });
    const report = checkContinuity([stale], glide);

    expect(report.days[0]).toMatchObject({ seed: "power", rhymeKey: "AW ER" });
    expect(report.repairs.map((r) => r.step)).toEqual([1]);
    expect(report.freePlay).toEqual([]);
  });
});

describe("step 3: the day is Free Play, and is counted", () => {
  it("counts a Seed that leads its own family and still cannot pin to it (#208), and leaves it unwritten", () => {
    const stale = day("2026-11-13", "cool", "UW UW L");
    const report = checkContinuity([stale], index);

    expect(report.days).toEqual([stale]);
    expect(report.repairs).toEqual([]);
    expect(report.freePlay).toEqual([
      { date: "2026-11-13", seed: "cool", rhymeKey: "UW UW L", detail: expect.stringContaining("cool") },
    ]);
  });
});

describe("step 2: the family's lead word on that Rhyme Key", () => {
  it("swaps in the lead word when the index no longer holds the Seed at all, keeping the day's Puzzle", () => {
    const lost = day("2026-09-08", "eightish", "EY T", { answerCount: 1, difficulty: 0.9 });
    const report = checkContinuity([lost], index);

    expect(report.days).toEqual([{ ...lost, seed: "ate", ...figuresOf("ate", "EY T") }]);
    expect(report.repairs).toEqual([
      { date: "2026-09-08", step: 2, before: lost, after: report.days[0] },
    ]);
    expect(report.freePlay).toEqual([]);
  });
});

describe("the repair keeps the one-place rule", () => {
  it("goes past every step that would land on a Rhyme Key the Schedule already holds", () => {
    const holder = day("2026-09-07", "ate", "EY T");
    const stale = day("2026-09-14", "eight", "EY AH T");
    const report = checkContinuity([holder, stale], index);

    expect(report.days).toEqual([holder, stale]);
    expect(report.repairs).toEqual([]);
    expect(report.freePlay.map((d) => d.date)).toEqual(["2026-09-14"]);
  });

  it("counts a key an earlier repair has just taken as held", () => {
    const first = day("2026-09-07", "eight", "EY AH T");
    const second = day("2026-09-14", "late", "EY AH T");
    const report = checkContinuity([first, second], index);

    expect(report.repairs.map((r) => r.date)).toEqual(["2026-09-07"]);
    expect(report.freePlay.map((d) => d.date)).toEqual(["2026-09-14"]);
  });
});

describe("the repair keeps one place per Seed Word too", () => {
  it("does not swap in a lead word that already holds another place", () => {
    const lost = day("2026-09-08", "eightish", "EY T");
    const elsewhere = day("2026-09-15", "ate", "AE T");
    const report = checkContinuity([lost, elsewhere], index);

    expect(report.repairs).toEqual([]);
    expect(report.freePlay.map((d) => d.date)).toEqual(["2026-09-08", "2026-09-15"]);
  });
});

describe("the one-place check", () => {
  it("reports a Seed Word and a Rhyme Key that each hold two places, without repairing either", () => {
    const days = [
      day("2026-11-04", "ate", "EY T"),
      day("2026-11-11", "ate", "EY T"),
      day("2026-11-12", "hat", "AE T"),
    ];
    const report = checkContinuity(days, index);

    expect(report.days).toEqual(days);
    expect(report.collisions).toEqual([
      { kind: "seed", value: "ate", dates: ["2026-11-04", "2026-11-11"] },
      { kind: "rhymeKey", value: "EY T", dates: ["2026-11-04", "2026-11-11"] },
    ]);
  });

  it("finds none in a Schedule that keeps the rule", () => {
    const report = checkContinuity([day("2026-11-04", "ate", "EY T"), day("2026-11-12", "hat", "AE T")], index);
    expect(report.collisions).toEqual([]);
  });
});

describe("what the build prints", () => {
  it("names every repair with its step, every Free Play day, and every collision", () => {
    const report = checkContinuity(
      [
        day("2026-09-07", "eight", "EY AH T"),
        day("2026-09-08", "cool", "UW UW L"),
        day("2026-09-09", "hat", "AE T"),
        day("2026-09-10", "hat", "AE T"),
      ],
      index,
    );
    const printed = continuityLines(report).join("\n");

    expect(printed).toContain("2026-09-07");
    expect(printed).toMatch(/step 1.*eight on EY AH T.*eight on EY T/);
    expect(printed).toMatch(/2026-09-08.*cool.*UW UW L/);
    expect(printed).toMatch(/Free Play/);
    expect(printed).toMatch(/hat.*2026-09-09.*2026-09-10/);
  });

  it("says so in one line when every day pins and nothing collides", () => {
    const report = checkContinuity([day("2026-09-07", "ate", "EY T")], index);
    expect(continuityLines(report)).toEqual([
      "Continuity: all 1 scheduled days pin; no Seed Word or Rhyme Key holds two places.",
    ]);
  });
});
