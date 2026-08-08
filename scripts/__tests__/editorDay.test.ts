/**
 * Slice: reading one scheduled day as a value. The readout has never been
 * testable — it measured and then made five print calls — so these are the first
 * assertions about what the Editor's Pass actually sees on a day.
 *
 * The payload is asserted on contents and on *sufficiency*: the lists are fed
 * back through `measureAnswers`, the same function the readout used, because a
 * browser moving a word between the two lists has to land on the figure the
 * engine would. Approximately right is the failure this test exists to catch.
 */

import { describe, expect, it, vi } from "vitest";
import { measureAnswers } from "../../src/curation.ts";
import type { Schedule, ScheduleDay } from "../../src/schedule.ts";
import { readScheduledDay } from "../editorDay.ts";
import { makeTestIndex } from "../../src/__fixtures__/index.ts";

const index = makeTestIndex();
const seed = index.pinSeed("ate");
const puzzle = index.buildPuzzle(seed);
const facts = measureAnswers(puzzle.answers);

/** A one-week run whose Tuesday is the `ate` Puzzle, dealt on its own figures. */
function scheduleWith(...overrides: Partial<ScheduleDay>[]): Schedule {
  const days: ScheduleDay[] = [
    { date: "2026-09-01", weekday: "Tue", week: 1, seed: "ate", rhymeKey: seed.rhymeKey, answerCount: facts.answerCount, difficulty: facts.difficulty },
    { date: "2026-09-02", weekday: "Wed", week: 1, seed: "ate", rhymeKey: seed.rhymeKey, answerCount: facts.answerCount, difficulty: facts.difficulty },
  ];
  return {
    startDate: "2026-09-01",
    band: { min: 1, max: 500 },
    days: days.map((day, i) => ({ ...day, ...overrides[i] })),
  };
}

describe("a scheduled day", () => {
  const readout = readScheduledDay(() => index, scheduleWith(), "2026-09-01");

  it("returns a value rather than printing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    readScheduledDay(() => index, scheduleWith(), "2026-09-01");
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });

  it("names the day it read", () => {
    expect(readout).toMatchObject({ outcome: "day", date: "2026-09-01", weekday: "Tue", week: 1 });
  });

  it("carries the Seed Word, its respelling and its Rhyme Key", () => {
    expect(readout).toMatchObject({
      seed: "ate",
      seedRespelling: puzzle.seedRespelling,
      rhymeKey: seed.rhymeKey,
    });
  });

  it("carries the three figures the day was dealt on", () => {
    expect(readout.outcome === "day" && readout.facts).toEqual(facts);
  });

  it("carries the size band and the drift verdict", () => {
    if (readout.outcome !== "day") throw new Error("expected a day");
    expect(readout.drift.sizeBand).toEqual({ min: 1, max: 500 });
    expect(readout.drift.drifted).toBe(false);
    expect(readout.drift.recorded).toEqual({
      answerCount: facts.answerCount,
      difficulty: facts.difficulty,
    });
  });

  it("carries the Answers and Bonus Words as two lists", () => {
    if (readout.outcome !== "day") throw new Error("expected a day");
    expect(readout.answers.map((a) => a.word)).toEqual(puzzle.answers.map((a) => a.word));
    expect(readout.bonusWords.map((b) => b.word)).toEqual(puzzle.bonusWords.map((b) => b.word));
    expect(readout.bonusWords.length).toBeGreaterThan(0);
  });

  it("gives every listed word its length and its knownness", () => {
    if (readout.outcome !== "day") throw new Error("expected a day");
    for (const word of [...readout.answers, ...readout.bonusWords]) {
      expect(word.length).toBe(word.word.length);
      expect(word.knownness === null || typeof word.knownness === "number").toBe(true);
    }
  });

  it("carries enough to recompute the day's figures exactly", () => {
    if (readout.outcome !== "day") throw new Error("expected a day");
    expect(measureAnswers(readout.answers)).toEqual(readout.facts);
  });

  it("recomputes exactly when a word moves between the lists", () => {
    if (readout.outcome !== "day") throw new Error("expected a day");
    const promoted = readout.bonusWords[0]!;
    const moved = measureAnswers([...readout.answers, promoted]);
    const authoritative = measureAnswers([
      ...puzzle.answers,
      puzzle.bonusWords.find((b) => b.word === promoted.word)!,
    ]);
    expect(moved).toEqual(authoritative);
  });

  it("reports drift without refusing to read the day", () => {
    const drifted = readScheduledDay(() => index, scheduleWith({ answerCount: 3, difficulty: 0.9 }), "2026-09-01");
    if (drifted.outcome !== "day") throw new Error("expected a day");
    expect(drifted.drift.drifted).toBe(true);
    expect(drifted.answers.length).toBe(facts.answerCount);
  });
});

describe("a date the run does not cover", () => {
  const readout = readScheduledDay(() => index, scheduleWith(), "2027-01-01");

  it("is a case in the value, naming the run's first and last dates", () => {
    expect(readout).toEqual({
      outcome: "not-scheduled",
      date: "2027-01-01",
      firstDate: "2026-09-01",
      lastDate: "2026-09-02",
    });
  });

  /**
   * The built index is fifteen megabytes and loading it can throw when no
   * artifact has been built, which the CLI does not catch — so a mistyped date
   * has to be answered without opening one. This is the regression that made
   * the index a function rather than an index.
   */
  it("never opens the index", () => {
    const openIndex = vi.fn(() => index);
    readScheduledDay(openIndex, scheduleWith(), "2027-01-01");
    expect(openIndex).not.toHaveBeenCalled();
  });

  it("opens the index once for a day it can read", () => {
    const openIndex = vi.fn(() => index);
    readScheduledDay(openIndex, scheduleWith(), "2026-09-01");
    expect(openIndex).toHaveBeenCalledTimes(1);
  });
});

describe("a day whose Seed cannot be pinned", () => {
  // `AA K T` is `docked`'s key: a real key in the fixture, and not one of the
  // Seed's — the shape a mistyped or stale schedule entry actually takes.
  const readout = readScheduledDay(() => index, scheduleWith({ rhymeKey: "AA K T" }), "2026-09-01");

  it("is a case in the value rather than an exit", () => {
    expect(readout.outcome).toBe("unpinnable");
  });

  it("names both the scheduled Rhyme Key and the keys the index holds", () => {
    if (readout.outcome !== "unpinnable") throw new Error("expected an unpinnable day");
    expect(readout.scheduledRhymeKey).toBe("AA K T");
    expect(readout.indexRhymeKeys).toEqual(index.rhymeKeysOf("ate"));
    expect(readout.indexRhymeKeys).toContain(seed.rhymeKey);
  });

  it("still names the day and its Seed Word, so the diagnosis stands alone", () => {
    expect(readout).toMatchObject({ date: "2026-09-01", weekday: "Tue", week: 1, seed: "ate" });
  });

  it("reports a Seed the index cannot read at all with no keys", () => {
    // `grates` has wordhood but no pronunciation anywhere in the fixture.
    const none = readScheduledDay(() => index, scheduleWith({ seed: "grates" }), "2026-09-01");
    if (none.outcome !== "unpinnable") throw new Error("expected an unpinnable day");
    expect(none.indexRhymeKeys).toEqual([]);
    expect(none.detail).not.toBe("");
  });
});
