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
import { localCalendarDate, nextDateOf, parseSchedule, seedForDate } from "../schedule.ts";

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
      rhymeKey: "AY D AH D",
      answerCount: 22,
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
    expect(seedForDate(schedule, "2026-12-11")).toEqual({ word: "flex", rhymeKey: "EH K S" });
  });

  it("pins the Seed Word to the schedule's Rhyme Key rather than leaving it raw", () => {
    // A bare word would let an ambiguous Seed be read the other way; the pin is
    // what makes the Puzzle the one the reviewer signed off.
    const seed = seedForDate(schedule, first.date);
    expect(seed?.rhymeKey).toBe(first.rhymeKey);
  });

  it("shows kennel on 2026-11-11 (#239), and sentimental on no day (#264)", () => {
    // sentimental sits in both the t-said and t-dropped families; leading the
    // second as well showed and spoke the same word twice (ADR-0012). It is
    // not heard one way either, so its first day went to incidental.
    expect(seedForDate(schedule, "2026-11-11")).toEqual({ word: "kennel", rhymeKey: "EH N AH L" });
    expect(seedForDate(schedule, "2026-08-17")).toEqual({ word: "incidental", rhymeKey: "EH N T AH L" });
    expect(days.filter((day) => day.seed === "sentimental")).toEqual([]);
  });
});

describe("the Schedule loops: a date past the last listed day repeats a lap earlier (#257)", () => {
  // ADR-0012 (amended 2026-10-11): the first loop is the last 259 days, 37
  // whole weeks from Tuesday 2026-08-04 to Monday 2027-04-19. `lopsided`, on
  // 2026-08-03, falls outside it and is a spare.
  const schedule = parseSchedule(artifact);
  const boulder = { word: "boulder", rhymeKey: "OW L D ER" };
  const smile = { word: "smile", rhymeKey: "AY L" };

  it("records the date the lap in progress began", () => {
    expect(schedule?.lapStart).toBe("2026-08-04");
  });

  it("resolves the lap's first day and its last day as listed", () => {
    expect(seedForDate(schedule, "2026-08-04")).toEqual(boulder);
    expect(seedForDate(schedule, "2027-04-19")).toEqual(smile);
  });

  it("shows on Tuesday 2027-04-20 the Seed Word of Tuesday 2026-08-04", () => {
    expect(seedForDate(schedule, "2027-04-20")).toEqual(boulder);
  });

  it("wraps again two laps on, on the same weekday", () => {
    expect(seedForDate(schedule, "2028-01-04")).toEqual(boulder);
    expect(seedForDate(schedule, "2028-05-12")).toEqual({ word: "flex", rhymeKey: "EH K S" });
    expect(seedForDate(schedule, "2028-09-18")).toEqual(smile);
  });

  it("leaves the spare before the lap out of every later lap", () => {
    expect(seedForDate(schedule, "2026-08-03")).toEqual({ word: "lopsided", rhymeKey: "AY D AH D" });
    expect(seedForDate(schedule, "2027-04-19")).not.toEqual({ word: "lopsided", rhymeKey: "AY D AH D" });
  });

  it("has no end", () => {
    expect(seedForDate(schedule, "2099-12-31")).not.toBeNull();
  });

  it("refuses a lap start that does not mark out whole weeks", () => {
    // Eight days, Monday 2026-08-03 to Monday 2026-08-10. A lap from the
    // Tuesday is one week; a lap from the Monday would be eight days, and would
    // carry each Seed Word one weekday later on every lap.
    const eight = Array.from({ length: 8 }, (_, i) => ({
      date: `2026-08-${String(3 + i).padStart(2, "0")}`,
      weekday: (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const)[i % 7],
      week: 1 + Math.floor(i / 7),
      seed: `seed${i}`,
      rhymeKey: "AY T",
      answerCount: 20,
      difficulty: 0,
    }));
    expect(parseSchedule({ startDate: "2026-08-03", lapStart: "2026-08-04", days: eight })).not.toBeNull();
    expect(parseSchedule({ startDate: "2026-08-03", lapStart: "2026-08-03", days: eight })).toBeNull();
    expect(parseSchedule({ startDate: "2026-08-03", lapStart: "2026-09-01", days: eight })).toBeNull();
  });
});

describe("a listed day's next date on or after today (#257)", () => {
  // What the Editor's Pass names for a Rhyme Key: once the first lap has gone,
  // a listed date is in the past, and the day the editor can still act on is the
  // next time the lap brings it round.
  const schedule = parseSchedule(artifact)!;
  const day = (seed: string) => schedule.days.find((d) => d.seed === seed)!;

  it("is the listed date while that is still ahead, or is today", () => {
    expect(nextDateOf(schedule, day("boulder"), "2026-08-01")).toBe("2026-08-04");
    expect(nextDateOf(schedule, day("boulder"), "2026-08-04")).toBe("2026-08-04");
  });

  it("is a lap or more on once the listed date has gone", () => {
    expect(nextDateOf(schedule, day("boulder"), "2026-08-05")).toBe("2027-04-20");
    expect(nextDateOf(schedule, day("smile"), "2027-04-20")).toBe("2028-01-03");
    expect(nextDateOf(schedule, day("boulder"), "2028-01-04")).toBe("2028-01-04");
  });

  it("is none for the spare before the lap once its date has gone", () => {
    expect(nextDateOf(schedule, day("lopsided"), "2026-08-03")).toBe("2026-08-03");
    expect(nextDateOf(schedule, day("lopsided"), "2026-08-04")).toBeNull();
  });

  it("is none for a past day of a Schedule that does not loop", () => {
    const { lapStart: _, ...once } = schedule;
    expect(nextDateOf(once, day("boulder"), "2026-08-05")).toBeNull();
  });
});

describe("a date outside the schedule resolves to nothing", () => {
  const schedule = parseSchedule(artifact);
  const days = schedule?.days ?? [];

  it.each([
    ["the day before the run starts", "2026-08-02"],
    ["long before the run starts", "2020-01-01"],
    ["a malformed date", "not-a-date"],
    ["an empty date", ""],
    ["a date that looks ISO but is not one", "2026-13-45"],
    ["a date past the run that is not a calendar date", "2027-02-30"],
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
