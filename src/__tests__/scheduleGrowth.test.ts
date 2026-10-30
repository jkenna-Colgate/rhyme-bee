/**
 * Growing the Schedule by whole weeks (#271, ADR-0012 amended 2026-10-11): new
 * weeks go in after the week in progress, the lap's start moves so that no
 * earlier date changes, and a place already given keeps its weekday and comes
 * round no sooner than before.
 */

import { describe, expect, it } from "vitest";
import { addDays, nextDateOf, parseSchedule, seedForDate, type Schedule, type ScheduleDay, type Weekday } from "../schedule.ts";
import { growSchedule, placeWeeks, weekAfter } from "../scheduleGrowth.ts";
import type { BatchEntry, BatchRecord } from "../batch.ts";
import { makeTestIndex } from "../__fixtures__/index.ts";

const WEEKDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weekdayOfDate(date: string): Weekday {
  return WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]!;
}

function day(date: string, seed: string, startDate = "2026-08-03"): ScheduleDay {
  const offset = daysFrom(startDate, date);
  return { date, weekday: weekdayOfDate(date), week: Math.floor(offset / 7) + 1, seed, rhymeKey: `K ${seed}`, answerCount: 30, difficulty: 0 };
}

/**
 * A Schedule shaped like the committed one: a spare on Monday 2026-08-03, then
 * a lap of three weeks from Tuesday 2026-08-04 to Monday 2026-08-24.
 */
function schedule(): Schedule {
  const days = [day("2026-08-03", "spare")];
  for (let i = 0; i < 21; i++) days.push(day(addDays("2026-08-04", i), `old${i}`));
  return { startDate: "2026-08-03", lapStart: "2026-08-04", days };
}

/** One new week dealt from a Monday, as the deal hands it over. */
function newWeek(monday: string, prefix = "new"): ScheduleDay[] {
  return Array.from({ length: 7 }, (_, i) => day(addDays(monday, i), `${prefix}${i}`));
}

function seedsFrom(s: Schedule, from: string, to: string): (string | undefined)[] {
  const seeds: (string | undefined)[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) seeds.push(seedForDate(s, date)?.word);
  return seeds;
}

describe("the week in progress", () => {
  it("ends on the Sunday of today's week, so the new weeks start the Monday after", () => {
    expect(weekAfter("2026-08-13")).toBe("2026-08-17"); // a Thursday
    expect(weekAfter("2026-08-16")).toBe("2026-08-17"); // the Sunday itself
    expect(weekAfter("2026-08-17")).toBe("2026-08-24"); // a Monday is in progress
  });
});

describe("placing new weeks", () => {
  it("leaves every date to the end of the week in progress alone, and the new week follows", () => {
    const before = schedule();
    const at = weekAfter("2026-08-13");
    const after = placeWeeks(before, newWeek(at));

    expect(seedsFrom(after, "2026-08-03", "2026-08-16")).toEqual(seedsFrom(before, "2026-08-03", "2026-08-16"));
    expect(seedsFrom(after, "2026-08-17", "2026-08-23")).toEqual(["new0", "new1", "new2", "new3", "new4", "new5", "new6"]);
    // The rest of the lap follows a week later than it did.
    expect(seedsFrom(after, "2026-08-24", "2026-08-31")).toEqual(seedsFrom(before, "2026-08-17", "2026-08-24"));
    expect(after.lapStart).toBe("2026-08-04");
    expect(parseSchedule(after)).toEqual(after);
  });
});

describe("placing new weeks in a later lap", () => {
  it("writes the laps already played out in full and starts the lap in progress where it began", () => {
    const before = schedule();
    const at = weekAfter("2026-09-02"); // a Wednesday in the second lap
    const after = placeWeeks(before, newWeek(at));

    expect(after.lapStart).toBe("2026-08-25");
    expect(seedsFrom(after, "2026-08-03", "2026-09-06")).toEqual(seedsFrom(before, "2026-08-03", "2026-09-06"));
    expect(seedsFrom(after, "2026-09-07", "2026-09-13")).toEqual(["new0", "new1", "new2", "new3", "new4", "new5", "new6"]);
    expect(seedsFrom(after, "2026-09-14", "2026-09-21")).toEqual(seedsFrom(before, "2026-09-07", "2026-09-14"));
    expect(parseSchedule(after)).toEqual(after);
  });

  it("starts the new lap inside the week in progress when the old one ends there", () => {
    const before = schedule();
    // Monday 2026-08-24 is the last day of the first lap; Tuesday begins the second.
    const after = placeWeeks(before, newWeek(weekAfter("2026-08-24")));

    expect(after.lapStart).toBe("2026-08-25");
    expect(seedsFrom(after, "2026-08-03", "2026-08-30")).toEqual(seedsFrom(before, "2026-08-03", "2026-08-30"));
    expect(seedsFrom(after, "2026-08-31", "2026-09-06")).toEqual(["new0", "new1", "new2", "new3", "new4", "new5", "new6"]);
    expect(parseSchedule(after)).toEqual(after);
  });
});

describe("a place already given", () => {
  /** The first two dates on or after `from` that play `seed`. */
  function nextTwo(s: Schedule, seed: string, from: string): string[] {
    const found: string[] = [];
    for (let date = from; found.length < 2; date = addDays(date, 1)) {
      if (seedForDate(s, date)?.word === seed) found.push(date);
    }
    return found;
  }

  it("keeps its weekday and comes round no sooner than before", () => {
    const before = schedule();
    const at = weekAfter("2026-08-13");
    const after = placeWeeks(before, [...newWeek(at, "a"), ...newWeek(addDays(at, 7), "b")]);

    for (let i = 0; i < 21; i++) {
      const [was, wasAgain] = nextTwo(before, `old${i}`, at);
      const [is, isAgain] = nextTwo(after, `old${i}`, at);
      expect(weekdayOfDate(is!)).toBe(weekdayOfDate(was!));
      expect(is! >= was!).toBe(true);
      expect(daysFrom(was!, wasAgain!)).toBe(21);
      expect(daysFrom(is!, isAgain!)).toBe(35);
    }
  });

  it("is next played on the date the lap now brings it round", () => {
    const after = placeWeeks(schedule(), newWeek(weekAfter("2026-08-13")));
    const old0 = after.days.find((d) => d.seed === "old0")!;
    // Tuesday 2026-08-04 plus a lap of four weeks.
    expect(nextDateOf(after, old0, "2026-08-17")).toBe("2026-09-01");
  });
});

describe("what placing refuses", () => {
  it("refuses part of a week, a week not starting on a Monday, and a Schedule that does not loop", () => {
    const at = weekAfter("2026-08-13");
    expect(() => placeWeeks(schedule(), newWeek(at).slice(0, 6))).toThrow(/whole/);
    expect(() => placeWeeks(schedule(), newWeek(addDays(at, 1)))).toThrow(/Monday/);
    const { lapStart: _, ...noLoop } = schedule();
    expect(() => placeWeeks(noLoop, newWeek(at))).toThrow(/does not loop/);
  });
});

// ---- growing: which Seed Words may join, and the deal ------------------------

/** Nine small families on keys the mini fixture does not use, every word an Answer. */
const FAMILIES: [string, string[], string[]][] = [
  ["IH NG", ["ring", "sing", "king"], ["R", "S", "K"]],
  ["AA P", ["shop", "stop", "drop"], ["SH", "S T", "D R"]],
  ["UH K", ["book", "cook", "look"], ["B", "K", "L"]],
  ["EH N", ["ten", "pen", "hen"], ["T", "P", "HH"]],
  ["OW T", ["boat", "coat", "goat"], ["B", "K", "G"]],
  ["IH P", ["ship", "lip", "dip"], ["SH", "L", "D"]],
  ["AH N", ["sun", "fun", "run"], ["S", "F", "R"]],
  ["AY T", ["kite", "bite", "white"], ["K", "B", "W"]],
  ["EH G", ["egg", "leg", "peg"], ["", "L", "P"]],
];

const STRESSED: Record<string, string[]> = {
  "IH NG": ["IH1", "NG"], "AA P": ["AA1", "P"], "UH K": ["UH1", "K"], "EH N": ["EH1", "N"],
  "OW T": ["OW1", "T"], "IH P": ["IH1", "P"], "AH N": ["AH1", "N"], "AY T": ["AY1", "T"], "EH G": ["EH1", "G"],
};

const grownIndex = makeTestIndex({
  pronunciations: FAMILIES.flatMap(([key, words, onsets]) =>
    words.map((w, i) => [w, [[...onsets[i]!.split(" ").filter(Boolean), ...STRESSED[key]!]]] as [string, string[][]]),
  ),
  words: FAMILIES.flatMap(([, words]) => words),
  prevalence: FAMILIES.flatMap(([, words]) => words.map((w) => [w, 2.5] as [string, number])),
});

function batch(
  rhymeKey: string,
  trust: "pass" | "fail" | "untested" = "pass",
  date = "2026-10-20",
  noFalseAccepts: "pass" | "fail" | null = "pass",
): BatchEntry {
  return {
    date, rhymeKey, trust, failuresPerLook: [2, 0], gate: { k: 1, n: 3 }, playerModel: "p", judgeModel: "j", report: "r",
    ...(noFalseAccepts ? { noFalseAccepts: { result: noFalseAccepts, hunted: 1, listed: 0, unruled: [], stillScored: [] } } : {}),
  };
}

/** Every family's lead word, passed on its key. */
function passedAll(): BatchRecord {
  return { seeds: Object.fromEntries(FAMILIES.map(([key, [lead]]) => [lead!, [batch(key)]])) };
}

const LEADS = FAMILIES.map(([, [lead]]) => lead!);
const BAND = { min: 1, max: 120 };

describe("growing the Schedule", () => {
  it("deals whole weeks after the week in progress and leaves the rest waiting as spares", () => {
    const growth = growSchedule(schedule(), grownIndex, passedAll(), LEADS, { today: "2026-08-13", band: BAND });

    expect(growth.refused).toEqual([]);
    expect(growth.added.map((d) => d.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays("2026-08-17", i)));
    expect(growth.added.map((d) => d.weekday)).toEqual(WEEKDAYS);
    expect(growth.spares).toHaveLength(2);
    expect(new Set([...growth.added.map((d) => d.seed), ...growth.spares])).toEqual(new Set(LEADS));
    expect(growth.added.find((d) => d.seed === "ring")).toMatchObject({ rhymeKey: "IH NG", answerCount: 2 });
    expect(growth.grown).not.toBeNull();
    expect(seedsFrom(growth.grown!, "2026-08-17", "2026-08-23")).toEqual(growth.added.map((d) => d.seed));
  });

  it("finds the spares waiting in the Batch record without their being named again", () => {
    const growth = growSchedule(schedule(), grownIndex, passedAll(), [], { today: "2026-08-13", band: BAND });
    expect(growth.added).toHaveLength(7);
    expect(growth.spares).toHaveLength(2);
  });

  it("grows nothing from fewer than seven, and says they wait", () => {
    const few: BatchRecord = { seeds: { ring: [batch("IH NG")], shop: [batch("AA P")] } };
    const small = growSchedule(schedule(), grownIndex, few, ["ring", "shop"], { today: "2026-08-13", band: BAND });
    expect(small.added).toEqual([]);
    expect(small.spares.sort()).toEqual(["ring", "shop"]);
    expect(small.grown).toBeNull();
  });
});

describe("a Seed Word refused", () => {
  const grow = (record: BatchRecord, named: string[], s = schedule(), band = BAND) =>
    growSchedule(s, grownIndex, record, named, { today: "2026-08-13", band });

  it("with no Batch record, because it has not been checked", () => {
    const growth = grow(passedAll(), [...LEADS, "hat"]);
    expect(growth.refused).toEqual([
      { seed: "hat", named: true, reasons: ["hat has been through no Batch, so it has not been checked."] },
    ]);
    // A word the maintainer named is refused, so nothing is written until they look.
    expect(growth.grown).toBeNull();
  });

  it("whose last Batch did not pass", () => {
    const record = passedAll();
    record.seeds.ten = [batch("EH N", "pass", "2026-10-01"), batch("EH N", "fail", "2026-10-20")];
    const growth = grow(record, ["ten"]);
    expect(growth.refused).toEqual([
      { seed: "ten", named: true, reasons: ["ten's last Batch (2026-10-20, on EH N) was fail on Trust, not a pass."] },
    ]);
  });

  it("whose last Batch passed Trust and not No False Accepts, or has no No False Accepts result", () => {
    const record = passedAll();
    record.seeds.ten = [batch("EH N", "pass", "2026-10-20", "fail")];
    record.seeds.ring = [batch("IH NG", "pass", "2026-10-20", null)];
    const growth = grow(record, ["ten", "ring"]);
    expect(growth.refused).toEqual([
      { seed: "ten", named: true, reasons: ["ten's last Batch (2026-10-20, on EH N) was fail on No False Accepts, not a pass."] },
      {
        seed: "ring",
        named: true,
        reasons: ["ring's last Batch (2026-10-20, on IH NG) has no No False Accepts result, so it has not been checked for false accepts."],
      },
    ]);
  });

  it("waiting in the record with a Batch that passed Trust only, so it is passed over and said", () => {
    const record = passedAll();
    record.seeds.ring = [batch("IH NG", "pass", "2026-10-20", null)];
    const growth = grow(record, []);
    expect(growth.refused).toEqual([expect.objectContaining({ seed: "ring", named: false })]);
    expect([...growth.added.map((d) => d.seed), ...growth.spares]).not.toContain("ring");
  });

  it("failing the Seed Word test, with the test's own sentence", () => {
    const record = { seeds: { ...passedAll().seeds, tear: [batch("IH R")] } };
    const growth = grow(record, ["tear"]);
    expect(growth.refused).toHaveLength(1);
    expect(growth.refused[0]!.reasons[0]).toMatch(/^tear is not heard one way: on EH R it rhymes with/);
  });

  it("outside the size band", () => {
    const growth = grow(passedAll(), [], schedule(), { min: 3, max: 120 });
    expect(growth.refused.map((r) => r.seed).sort()).toEqual([...LEADS].sort());
    expect(growth.refused[0]!.reasons).toEqual([
      expect.stringMatching(/holds 2 Answers, outside the size band \[3, 120\]\.$/),
    ]);
    // Found in the record and not named, so they are passed over rather than blocking.
    expect(growth.refused.every((r) => !r.named)).toBe(true);
  });

  it("whose Rhyme Key or Seed Word already holds a place", () => {
    const s = schedule();
    s.days[5] = { ...s.days[5]!, seed: "sing", rhymeKey: "IH NG" };
    const growth = grow(passedAll(), [], s);
    expect(growth.refused).toEqual([
      {
        seed: "ring",
        named: false,
        reasons: [`ring on IH NG: Rhyme Key IH NG already holds a place, on ${s.days[5]!.date} (sing).`],
      },
    ]);

    // A Seed Word already scheduled, named again: it holds its own key's place too.
    const again = schedule();
    again.days[9] = { ...again.days[9]!, seed: "boat", rhymeKey: "OW T" };
    const named = grow(passedAll(), ["boat"], again);
    expect(named.refused).toEqual([
      {
        seed: "boat",
        named: true,
        reasons: [
          `boat on OW T: Seed Word boat already holds a place, on ${again.days[9]!.date} (boat).`,
          `boat on OW T: Rhyme Key OW T already holds a place, on ${again.days[9]!.date} (boat).`,
        ],
      },
    ]);
    expect(named.grown).toBeNull();

    // Between two words joining, the one named keeps its claim.
    const twice = grow({ seeds: { ...passedAll().seeds, sing: [batch("IH NG")] } }, ["sing"]);
    expect(twice.refused).toEqual([
      { seed: "ring", named: false, reasons: ["ring on IH NG: Rhyme Key IH NG is sing's too, and sing comes first."] },
    ]);
    expect(twice.grown).not.toBeNull();
  });
});

function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
