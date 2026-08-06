/**
 * Slice: reading the committed schedule artifact and resolving a calendar date
 * to that day's Puzzle. The deal (`schedule.test.ts`) writes the artifact; this
 * is the other end of it — what a player's browser does with the file on the
 * morning they open the game.
 *
 * The artifact under test is the real `data/schedule.json`, not a fixture. It is
 * a reviewed artifact (ADR-0012) and the thing that actually ships, so a test
 * that parsed a hand-written stand-in would pass on a file nobody plays.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localCalendarDate, parseSchedule, seedForDate } from "../schedule.ts";

const artifact: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../data/schedule.json", import.meta.url)), "utf8"),
);

describe("the committed schedule artifact parses", () => {
  const schedule = parseSchedule(artifact);

  it("reads the artifact's flattened day shape", () => {
    expect(schedule).not.toBeNull();
    expect(schedule?.days).toHaveLength(260);
    expect(schedule?.days[0]).toEqual({
      date: "2026-08-03",
      weekday: "Mon",
      week: 1,
      seed: "lopsided",
      rhymeKey: "AY D IH D",
      answerCount: 21,
      difficulty: 0,
    });
  });

  it("refuses anything that is not a schedule, rather than half-reading it", () => {
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule("2026-08-10")).toBeNull();
    expect(parseSchedule({ startDate: "2026-08-10" })).toBeNull();
    expect(parseSchedule({ days: [{ date: "2026-08-10" }] })).toBeNull();
  });
});

describe("a date resolves to that day's Seed Word, pinned to its Rhyme Key", () => {
  const schedule = parseSchedule(artifact);
  const days = schedule?.days ?? [];
  const first = days[0]!;
  const last = days[days.length - 1]!;

  it("resolves the first scheduled date — the range is inclusive at the start", () => {
    expect(seedForDate(schedule, first.date)).toEqual({
      word: first.seed,
      rhymeKey: first.rhymeKey,
    });
  });

  it("resolves the last scheduled date — the range is inclusive at the end", () => {
    expect(seedForDate(schedule, last.date)).toEqual({
      word: last.seed,
      rhymeKey: last.rhymeKey,
    });
  });

  it("resolves a date in the middle to that day's Puzzle and no other", () => {
    expect(seedForDate(schedule, "2026-08-04")).toEqual({ word: "boulder", rhymeKey: "OW L D ER" });
    expect(seedForDate(schedule, "2026-12-11")).toEqual({ word: "unisex", rhymeKey: "EH K S" });
  });

  it("pins the Seed Word to the schedule's Rhyme Key rather than leaving it raw", () => {
    // A bare word would let an ambiguous Seed be read the other way; the pin is
    // what makes the Puzzle the one the reviewer signed off.
    const seed = seedForDate(schedule, first.date);
    expect(seed?.rhymeKey).toBe(first.rhymeKey);
  });
});

describe("a date outside the schedule resolves to nothing", () => {
  const schedule = parseSchedule(artifact);
  const days = schedule?.days ?? [];

  it.each([
    ["the day before the run starts", "2026-08-02"],
    ["long before the run starts", "2020-01-01"],
    ["the day after the run ends", "2027-04-20"],
    ["long after the run ends", "2099-12-31"],
    ["a malformed date", "not-a-date"],
    ["an empty date", ""],
    ["a date that looks ISO but is not one", "2026-13-45"],
  ])("%s", (_case, date) => {
    expect(seedForDate(schedule, date)).toBeNull();
  });

  it("resolves to nothing when there is no schedule to consult at all", () => {
    expect(seedForDate(null, days[0]!.date)).toBeNull();
  });
});

describe("today is the player's local calendar date", () => {
  // Every hour of one local day must read as that day. Under any timezone other
  // than UTC some of these hours fall on a different *UTC* date, so a
  // resolution built on `toISOString` fails here — which is the whole point:
  // the rollover is local midnight, not London's.
  it.each(Array.from({ length: 24 }, (_, hour) => hour))(
    "reads %i:00 local on 10 August 2026 as 2026-08-10",
    (hour) => {
      expect(localCalendarDate(new Date(2026, 7, 10, hour, 0, 0))).toBe("2026-08-10");
    },
  );

  it("rolls over at local midnight, not at any other instant", () => {
    expect(localCalendarDate(new Date(2026, 7, 10, 23, 59, 59))).toBe("2026-08-10");
    expect(localCalendarDate(new Date(2026, 7, 11, 0, 0, 0))).toBe("2026-08-11");
  });

  it("pads month and day, so the string sorts and matches the artifact", () => {
    expect(localCalendarDate(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });
});
