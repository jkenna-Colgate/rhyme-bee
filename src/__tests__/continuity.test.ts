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

  it("swaps in the family's best-ranked word that passes the Seed Word test (#264)", () => {
    // `frob` carries `AA B` on its main stress and ranks first, but it is a
    // Bonus Word, so the day goes to `doorknob`.
    const knobs = makeTestIndex({
      pronunciations: [
        ["frob", [["F", "R", "AA1", "B"]]],
        ["doorknob", [["D", "AO1", "R", "N", "AA2", "B"]]],
        ["heartthrob", [["HH", "AA1", "R", "T", "TH", "R", "AA2", "B"]]],
      ],
      words: ["frob", "doorknob", "heartthrob"],
      prevalence: [["doorknob", 2.0], ["heartthrob", 1.5]],
    });
    const lost = day("2026-09-08", "knobbish", "AA B");
    const report = checkContinuity([lost], knobs);

    expect(report.days[0]).toMatchObject({ seed: "doorknob", rhymeKey: "AA B" });
    expect(report.repairs.map((r) => r.step)).toEqual([2]);
  });
});

describe("the Seed Word test, when the caller asks for it (#264)", () => {
  it("is not run unless asked, since it is not run at every build", () => {
    const days = [day("2026-09-07", "objurgate", "EY T")];
    expect(checkContinuity(days, index).repairs).toEqual([]);
  });

  it("gives the day of a Seed Word that is not an Answer to its family's lead word, keeping its key", () => {
    const bonus = day("2026-09-07", "objurgate", "EY T");
    const report = checkContinuity([bonus], index, { seedWordTest: true });

    expect(report.days).toEqual([{ ...bonus, seed: "ate", ...figuresOf("ate", "EY T") }]);
    expect(report.repairs).toEqual([{ date: "2026-09-07", step: 2, before: bonus, after: report.days[0] }]);
  });

  it("gives the day of a Seed Word not heard one way to the next word, passing over the one that failed", () => {
    const heardTwoWays = day("2026-09-07", "tear", "IH R");
    const report = checkContinuity([heardTwoWays], index, { seedWordTest: true });

    expect(report.days[0]).toMatchObject({ seed: "beer", rhymeKey: "IH R" });
    expect(report.repairs.map((r) => r.step)).toEqual([2]);
  });

  it("makes the day Free Play, and counts it, when no word of the family passes", () => {
    const alone = makeTestIndex({
      pronunciations: [["zounds", [["Z", "AW1", "N", "D", "Z"]]]],
      words: ["zounds"],
      prevalence: [["zounds", -0.21]],
    });
    const report = checkContinuity([day("2026-11-23", "zounds", "AW N D Z")], alone, { seedWordTest: true });

    expect(report.repairs).toEqual([]);
    expect(report.freePlay).toEqual([
      expect.objectContaining({ date: "2026-11-23", seed: "zounds", detail: expect.stringContaining("not an Answer") }),
    ]);
  });
});

describe("the one-place rule is reported and never blocks a repair (2026-10-27)", () => {
  it("re-pins onto a Rhyme Key the Schedule already holds, and reports the collision", () => {
    const holder = day("2026-09-07", "ate", "EY T");
    const stale = day("2026-09-14", "eight", "EY AH T");
    const report = checkContinuity([holder, stale], index);

    expect(report.days[1]).toMatchObject({ seed: "eight", rhymeKey: "EY T" });
    expect(report.repairs.map((r) => [r.date, r.step])).toEqual([["2026-09-14", 1]]);
    expect(report.freePlay).toEqual([]);
    expect(report.collisions).toContainEqual({ kind: "rhymeKey", value: "EY T", dates: ["2026-09-07", "2026-09-14"] });
  });

  it("counts a key an earlier repair has just taken as held, and still re-pins", () => {
    const first = day("2026-09-07", "eight", "EY AH T");
    const second = day("2026-09-14", "late", "EY AH T");
    const report = checkContinuity([first, second], index);

    expect(report.repairs.map((r) => r.date)).toEqual(["2026-09-07", "2026-09-14"]);
    expect(report.freePlay).toEqual([]);
    expect(report.collisions).toContainEqual({ kind: "rhymeKey", value: "EY T", dates: ["2026-09-07", "2026-09-14"] });
  });

  it("swaps in a lead word that already holds another place, and reports the Seed Word", () => {
    const lost = day("2026-09-08", "eightish", "EY T");
    const elsewhere = day("2026-09-15", "ate", "AE T");
    const report = checkContinuity([lost, elsewhere], index);

    expect(report.days[0]).toMatchObject({ seed: "ate", rhymeKey: "EY T" });
    expect(report.collisions).toContainEqual({ kind: "seed", value: "ate", dates: ["2026-09-08", "2026-09-15"] });
  });

  it("takes a later candidate that collides with no other day over an earlier one that does", () => {
    // Step 1 would put `eight` on `EY T`, but another day holds `eight`; step 2's
    // lead word on the same key holds no other place, so the day takes that.
    const stale = day("2026-09-07", "eight", "EY AH T");
    const other = day("2026-09-14", "eight", "AE T");
    const report = checkContinuity([stale, other], index);

    expect(report.repairs[0]).toMatchObject({ date: "2026-09-07", step: 2, after: { seed: "ate", rhymeKey: "EY T" } });
  });

  it("does not count a spare in front of the lap as holding a place", () => {
    // As in the case above, but the other `eight` is a spare: step 1 is free to
    // take. The spare is listed after the stale day so that it is still `eight`
    // when the stale day is repaired (it does not pin, and is repaired in turn).
    const stale = day("2026-09-07", "eight", "EY AH T");
    const spare = day("2026-08-03", "eight", "AE T");
    const repairOf = (lapStart?: string) =>
      checkContinuity([stale, spare], index, { lapStart }).repairs.find((r) => r.date === "2026-09-07");

    expect(repairOf()).toMatchObject({ step: 2 });
    expect(repairOf("2026-08-04")).toMatchObject({ step: 1, after: { seed: "eight", rhymeKey: "EY T" } });
  });

  it("is Free Play only when nothing pins, whatever the other days hold", () => {
    const holder = day("2026-11-12", "cool", "UW L");
    const stale = day("2026-11-13", "cool", "UW UW L");
    const report = checkContinuity([holder, stale], index);

    expect(report.repairs).toEqual([]);
    expect(report.days[0]).toEqual(holder);
    expect(report.freePlay.map((d) => d.date)).toEqual(["2026-11-13"]);
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

  it("reports two days whose Puzzles hold the same Answers under two Rhyme Key spellings", () => {
    // Glide-r appends the other spelling to every word, so `AW ER` and `AW R`
    // file one family, and `flour`, transcribed with plain r, pins on `AW R`:
    // one Puzzle under two keys, as the appending rule made `purifier` and `expire`.
    const twice = makeTestIndex({
      pronunciations: [
        ["hour", [["AW1", "ER0"]]],
        ["flour", [["F", "L", "AW1", "R"]]],
        ["sour", [["S", "AW1", "ER0"]]],
      ],
      words: ["hour", "flour", "sour"],
      prevalence: [["hour", 2.5], ["flour", 2.4], ["sour", 2.4]],
    });
    const report = checkContinuity([day("2026-11-04", "hour", "AW ER"), day("2026-11-05", "flour", "AW R")], twice);

    expect(report.freePlay).toEqual([]);
    expect(report.collisions).toEqual([
      { kind: "answers", value: "AW ER / AW R", dates: ["2026-11-04", "2026-11-05"] },
    ]);
    expect(continuityLines(report).join("\n")).toMatch(
      /one-place: the same Answers, on AW ER \/ AW R, hold 2 places: 2026-11-04 \(hour\), 2026-11-05 \(flour\)/,
    );
  });

  it("counts no place for a spare in front of the lap, which never plays again (#265)", () => {
    // `lopsided` was the spare on 2026-08-03 and fills a place in the loop.
    const spare = day("2026-08-03", "ate", "EY T");
    const placed = day("2027-03-29", "ate", "EY T");
    const loop = day("2026-08-04", "hat", "AE T");
    const days = [spare, loop, placed];

    expect(checkContinuity(days, index).collisions).not.toEqual([]);
    expect(checkContinuity(days, index, { lapStart: "2026-08-04" }).collisions).toEqual([]);
  });

  it("still reports two places held inside the lap when a lap start is given", () => {
    const days = [day("2026-08-04", "ate", "EY T"), day("2026-08-11", "ate", "EY T")];
    expect(checkContinuity(days, index, { lapStart: "2026-08-04" }).collisions).toEqual([
      { kind: "seed", value: "ate", dates: ["2026-08-04", "2026-08-11"] },
      { kind: "rhymeKey", value: "EY T", dates: ["2026-08-04", "2026-08-11"] },
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
