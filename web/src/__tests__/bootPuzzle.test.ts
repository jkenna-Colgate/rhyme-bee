/**
 * Boot policy: which Puzzle a player opens, and why. Extracted out of
 * `PuzzleView` (#124), which had grown the whole decision in place — the Daily
 * Puzzle for the player's own local date, falling back to Free Play when the
 * schedule has nothing for that date or disagrees with the built index. The
 * Tutorial that used to precede both is switched off for the playtest (#130),
 * so these assert the policy with it off *and* that it is still there to switch
 * back on.
 *
 * The fixture index (`makeTestIndex`) stands in for the built Rhyme Index; a
 * hand-built `Schedule` stands in for the committed artifact, so every branch
 * of the decision table is reachable without depending on which real dates
 * `data/schedule.json` happens to cover.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../../../src/__fixtures__/index.ts";
import { playableSeeds } from "../../../src/curation.ts";
import { parseSchedule, type Schedule } from "../../../src/schedule.ts";
import {
  dailyPuzzle,
  freePlayPuzzle,
  openingPuzzle,
  TUTORIAL_ENABLED,
  tutorialPuzzle,
} from "../bootPuzzle.ts";

const index = makeTestIndex();
const pool = playableSeeds(index, { min: 1, max: 100 });

const SCHEDULED_DATE = "2026-01-01";
const UNSCHEDULED_DATE = "2099-01-01";

/** A schedule whose one day is pinnable against the fixture index. */
const schedule = parseSchedule({
  startDate: SCHEDULED_DATE,
  days: [
    {
      date: SCHEDULED_DATE,
      weekday: "Thu",
      week: 1,
      seed: "ate",
      rhymeKey: "EY T",
      answerCount: 6,
      difficulty: 0,
    },
  ],
}) as Schedule;

/** A schedule whose one day names a Seed the fixture index does not carry —
 * the schedule/index disagreement `dailyPuzzle` must fall back from. */
const mismatchedSchedule = parseSchedule({
  startDate: SCHEDULED_DATE,
  days: [
    {
      date: SCHEDULED_DATE,
      weekday: "Thu",
      week: 1,
      seed: "nonexistent",
      rhymeKey: "XX X",
      answerCount: 6,
      difficulty: 0,
    },
  ],
}) as Schedule;

describe("tutorialPuzzle", () => {
  it("is always the Tutorial, seeded with ate, no date (CONTEXT.md)", () => {
    expect(tutorialPuzzle(index)).toEqual({
      kind: "tutorial",
      date: null,
      seed: { word: "ate", rhymeKey: "EY T" },
    });
  });
});

describe("dailyPuzzle", () => {
  it("resolves the Daily Puzzle for a scheduled date, pinned to its Rhyme Key", () => {
    expect(dailyPuzzle(index, schedule, SCHEDULED_DATE)).toEqual({
      kind: "daily",
      date: SCHEDULED_DATE,
      seed: { word: "ate", rhymeKey: "EY T" },
    });
  });

  it("is null when the schedule has no entry for the date", () => {
    expect(dailyPuzzle(index, schedule, UNSCHEDULED_DATE)).toBeNull();
  });

  it("is null when there is no schedule at all", () => {
    expect(dailyPuzzle(index, null, SCHEDULED_DATE)).toBeNull();
  });

  it("is null when the schedule names a Seed the index does not carry (schedule/index disagreement)", () => {
    expect(dailyPuzzle(index, mismatchedSchedule, SCHEDULED_DATE)).toBeNull();
  });
});

describe("freePlayPuzzle", () => {
  it("draws a Seed from the pool, dateless, never persisted", () => {
    const opening = freePlayPuzzle(index, pool);
    expect(opening.kind).toBe("free");
    expect(opening.date).toBeNull();
    expect(pool.map((f) => f.rhymeKey)).toContain(opening.seed.rhymeKey);
  });

  it("falls back to the Tutorial Seed when the pool is empty", () => {
    expect(freePlayPuzzle(index, [])).toEqual({
      kind: "free",
      date: null,
      seed: { word: "ate", rhymeKey: "EY T" },
    });
  });
});

describe("openingPuzzle: the boot decision table", () => {
  // `daily` is resolved once by the caller (mirroring `PuzzleView`, which
  // needs the same answer again for the "Today's Puzzle" control) and handed
  // in already computed — `dailyPuzzle`'s own tests above cover how it gets
  // resolved from a schedule and a date.
  const scheduledDaily = dailyPuzzle(index, schedule, SCHEDULED_DATE);

  // The Tutorial is switched off for the playtest (#130), so the first-visit
  // flag no longer changes which Puzzle opens — the four cases below are two
  // cases played twice. That is the assertion: `firstVisit` is inert.
  it("a first ever visit gets the Daily Puzzle, not the Tutorial", () => {
    expect(openingPuzzle(index, pool, scheduledDaily, true)).toEqual({
      kind: "daily",
      date: SCHEDULED_DATE,
      seed: { word: "ate", rhymeKey: "EY T" },
    });
  });

  it("a first ever visit gets Free Play when there is no Daily Puzzle to open", () => {
    const opening = openingPuzzle(index, pool, null, true);
    expect(opening.kind).toBe("free");
    expect(opening.date).toBeNull();
  });

  it("a returning player gets the resolved Daily Puzzle when there is one", () => {
    expect(openingPuzzle(index, pool, scheduledDaily, false)).toEqual({
      kind: "daily",
      date: SCHEDULED_DATE,
      seed: { word: "ate", rhymeKey: "EY T" },
    });
  });

  it("a returning player gets Free Play when there is no Daily Puzzle to open", () => {
    const opening = openingPuzzle(index, pool, null, false);
    expect(opening.kind).toBe("free");
    expect(opening.date).toBeNull();
  });

  it("never opens the Tutorial while it is switched off", () => {
    expect(TUTORIAL_ENABLED).toBe(false);
    for (const firstVisit of [true, false]) {
      for (const daily of [scheduledDaily, null]) {
        expect(openingPuzzle(index, pool, daily, firstVisit).kind).not.toBe("tutorial");
      }
    }
  });

  // The Tutorial is dormant, not deleted: it stays buildable so that flipping
  // the one constant back brings it home rather than starting a rewrite.
  it("keeps the Tutorial itself intact behind the constant", () => {
    expect(tutorialPuzzle(index).kind).toBe("tutorial");
  });
});
