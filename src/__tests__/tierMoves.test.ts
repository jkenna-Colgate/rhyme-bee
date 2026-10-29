/**
 * The Tier move from Session Records (#270, ADR-0015 amended): the confidence
 * test, the pooling, the guards, and the run report's Reachability lines. The
 * precedence the build merges the moves under is `tierOverride.test.ts`'s.
 */

import { describe, expect, it } from "vitest";
import {
  daysUnderFloor,
  decideMoves,
  findShareLowerBound,
  parseTierMoves,
  poolFinds,
  serialiseTierMove,
  TIER_MOVES_HEADER,
  type MoveInput,
  type PlayedSession,
} from "../tierMoves.ts";

describe("the one-sided 95% lower bound on a find share", () => {
  it("is zero when nobody found the word", () => {
    expect(findShareLowerBound(0, 40)).toBe(0);
  });

  it("is 0.05^(1/n) when every Session found it", () => {
    // The exact bound at k = n solves p^n = 0.05.
    expect(findShareLowerBound(1, 1)).toBeCloseTo(0.05, 6);
    expect(findShareLowerBound(3, 3)).toBeCloseTo(0.368403, 5);
  });

  it("matches the published Clopper-Pearson bound for 5 of 10", () => {
    // The lower end of the two-sided 90% interval, (0.2224, 0.7776).
    expect(findShareLowerBound(5, 10)).toBeCloseTo(0.2224, 4);
  });

  it("is zero on no Sessions at all: no evidence, no bound", () => {
    expect(findShareLowerBound(0, 0)).toBe(0);
  });
});

/** A replayed Session, as the pooling reads one. */
function played(id: string, held: string[], found: string[]): PlayedSession {
  return { id, held, found };
}

describe("pooling finds per word", () => {
  it("counts every Session whose Puzzle holds the word, and the ones that found it", () => {
    const pooled = poolFinds([
      played("a", ["booze", "excuse", "ooze"], ["booze", "excuse"]),
      played("b", ["booze", "excuse", "ooze"], ["ooze"]),
    ]);
    expect(pooled.get("excuse")).toEqual({ finds: 1, sessions: 2 });
    expect(pooled.get("ooze")).toEqual({ finds: 1, sessions: 2 });
  });

  it("pools one word over every day it is in, so a word on two Rhyme Keys gets one verdict", () => {
    // `excuse` on a `booze` day and on a `juice` day.
    const pooled = poolFinds([
      played("a", ["booze", "excuse"], ["excuse"]),
      played("b", ["juice", "excuse"], []),
      played("c", ["juice", "excuse"], ["excuse"]),
    ]);
    expect(pooled.get("excuse")).toEqual({ finds: 2, sessions: 3 });
  });

  it("counts a find however the word was tiered when it was found", () => {
    // `found` is every word the Session accepted, Answer and Bonus Word alike.
    const pooled = poolFinds([played("a", ["booze", "excuse"], ["excuse"])]);
    expect(pooled.get("excuse")).toEqual({ finds: 1, sessions: 1 });
  });

  it("does not count an accepted word the Puzzle does not hold", () => {
    // A Weak Rhyme or an Unconfirmed Rhyme is accepted and holds no Tier.
    const pooled = poolFinds([played("a", ["trick"], ["magic"])]);
    expect(pooled.has("magic")).toBe(false);
  });

  it("keeps one copy of a Session sent more than once, the last", () => {
    const pooled = poolFinds([
      played("a", ["booze", "excuse"], []),
      played("a", ["booze", "excuse"], ["excuse"]),
    ]);
    expect(pooled.get("excuse")).toEqual({ finds: 1, sessions: 1 });
  });
});

describe("deciding the moves", () => {
  /** Three of three clears a share of 0.2 (bound 0.368); one of one does not (0.05). */
  function input(over: Partial<MoveInput>): MoveInput {
    return {
      pooled: new Map([
        ["excuse", { finds: 3, sessions: 3 }],
        ["recluse", { finds: 1, sessions: 1 }],
      ]),
      share: 0.2,
      isBonusWord: () => true,
      hasPrevalence: () => true,
      isName: () => false,
      standing: new Map(),
      moved: new Set(),
      ...over,
    };
  }

  it("moves a Bonus Word once the lower bound on its find share clears the share", () => {
    const decided = decideMoves(input({}));
    expect(decided.moves.map((m) => m.word)).toEqual(["excuse"]);
    expect(decided.moves[0]).toMatchObject({ finds: 3, sessions: 3 });
    expect(decided.moves[0]!.lowerBound).toBeCloseTo(0.3684, 4);
  });

  it("does not move a word whose bound sits under the share, however high its raw share", () => {
    // One of one is a find share of 100%, and says almost nothing.
    const decided = decideMoves(input({}));
    expect(decided.moves.some((m) => m.word === "recluse")).toBe(false);
  });

  it("moves nothing to Bonus Word: an Answer nobody finds stays an Answer", () => {
    const decided = decideMoves(
      input({
        pooled: new Map([["juice", { finds: 0, sessions: 500 }]]),
        isBonusWord: () => false,
      }),
    );
    expect(decided.moves).toEqual([]);
  });

  it("does not move an Answer, which has nowhere higher to go", () => {
    const decided = decideMoves(input({ isBonusWord: (w) => w !== "excuse" }));
    expect(decided.moves).toEqual([]);
  });

  it("does not move a word already moved", () => {
    const decided = decideMoves(input({ moved: new Set(["excuse"]) }));
    expect(decided.moves).toEqual([]);
  });

  it("holds back a word with no prevalence row, and says so", () => {
    const decided = decideMoves(input({ hasPrevalence: (w) => w !== "excuse" }));
    expect(decided.moves).toEqual([]);
    expect(decided.heldBack).toEqual([
      expect.objectContaining({ word: "excuse", reason: "no-prevalence" }),
    ]);
  });

  it("holds back a word in the names data, and says so", () => {
    const decided = decideMoves(input({ isName: (w) => w === "excuse" }));
    expect(decided.moves).toEqual([]);
    expect(decided.heldBack).toEqual([expect.objectContaining({ word: "excuse", reason: "name" })]);
  });

  it("holds back a word whose editor verdict is locked", () => {
    const decided = decideMoves(
      input({ standing: new Map([["excuse", { verdict: "bonus", locked: true }]]) }),
    );
    expect(decided.moves).toEqual([]);
    expect(decided.heldBack).toEqual([expect.objectContaining({ word: "excuse", reason: "locked" })]);
  });

  it("names the unlocked editor verdict a move overrides", () => {
    const decided = decideMoves(
      input({ standing: new Map([["excuse", { verdict: "bonus", locked: false }]]) }),
    );
    expect(decided.moves.map((m) => m.word)).toEqual(["excuse"]);
    expect(decided.overridden).toEqual([{ word: "excuse", verdict: "bonus" }]);
  });

  it("names a verdict a standing move overrides, though the editor wrote it after the move", () => {
    const decided = decideMoves(
      input({
        moved: new Set(["excuse"]),
        standing: new Map([["excuse", { verdict: "bonus", locked: false }]]),
      }),
    );
    expect(decided.overridden).toEqual([{ word: "excuse", verdict: "bonus" }]);
  });

  it("names no verdict a move leaves standing: a locked one, or one that already makes an Answer", () => {
    const decided = decideMoves(
      input({
        moved: new Set(["excuse", "obtuse"]),
        standing: new Map([
          ["excuse", { verdict: "bonus", locked: true }],
          ["obtuse", { verdict: "answer-rare", locked: false }],
        ]),
      }),
    );
    expect(decided.overridden).toEqual([]);
  });
});

describe("the moves file", () => {
  const move = { word: "excuse", finds: 3, sessions: 3, lowerBound: 0.368403 };

  it("reads back every word a row moves", () => {
    const text =
      TIER_MOVES_HEADER +
      "\n" +
      serialiseTierMove(move, "2026-11-01T00:00:00.000Z") +
      serialiseTierMove({ ...move, word: "obtuse" }, "2026-12-01T00:00:00.000Z");
    expect(parseTierMoves(text)).toEqual(new Set(["excuse", "obtuse"]));
  });

  it("writes the evidence beside the word, as an audit trail", () => {
    expect(serialiseTierMove(move, "2026-11-01T00:00:00.000Z")).toBe(
      "excuse,2026-11-01T00:00:00.000Z,3,3,0.3684\n",
    );
  });

  it("skips comments and blank lines, and treats empty text as no moves", () => {
    expect(parseTierMoves("# a note\n\n")).toEqual(new Set());
    expect(parseTierMoves("")).toEqual(new Set());
  });

  it("refuses a row it cannot read, rather than leaving a move unmade", () => {
    expect(() => parseTierMoves("excuse,2026-11-01\n")).toThrow(/columns/);
  });
});

describe("days under the Reachability floor", () => {
  function sessions(date: string, reached: number, total: number) {
    return Array.from({ length: total }, (_, i) => ({
      id: `${date}-${i}`,
      date,
      reachedLaureate: i < reached,
    }));
  }

  it("lists a day with enough Sessions whose share reaching Laureate is under the floor", () => {
    const under = daysUnderFloor([...sessions("2026-11-02", 1, 20)], { floor: 0.1, fewestSessions: 20 });
    expect(under).toEqual([{ date: "2026-11-02", sessions: 20, reached: 1, share: 0.05 }]);
  });

  it("does not list a day at or over the floor", () => {
    const under = daysUnderFloor([...sessions("2026-11-02", 2, 20)], { floor: 0.1, fewestSessions: 20 });
    expect(under).toEqual([]);
  });

  it("does not list a day with too few Sessions to say anything", () => {
    const under = daysUnderFloor([...sessions("2026-11-02", 0, 19)], { floor: 0.1, fewestSessions: 20 });
    expect(under).toEqual([]);
  });

  it("measures each day apart, in date order, counting a resent Session once", () => {
    const under = daysUnderFloor(
      [
        ...sessions("2026-11-03", 0, 20),
        ...sessions("2026-11-02", 0, 20),
        { id: "2026-11-02-0", date: "2026-11-02", reachedLaureate: false },
      ],
      { floor: 0.1, fewestSessions: 20 },
    );
    expect(under.map((d) => [d.date, d.sessions])).toEqual([
      ["2026-11-02", 20],
      ["2026-11-03", 20],
    ]);
  });
});
