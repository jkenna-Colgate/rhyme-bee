/**
 * Slice: rejection reasons that need no data beyond CMUdict, plus input hygiene.
 * Every rejection carries a machine-readable reason from the closed set, and
 * formatting is never the reason a Submission is wrong.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";

const index = makeTestIndex();
const ate = index.pinSeed("ate");

describe("rejection reasons (CMUdict-only)", () => {
  it("rejects the Seed Word itself so it cannot be farmed", () => {
    expect(index.adjudicate(ate, "ate")).toMatchObject({
      outcome: "rejected",
      reason: "is-the-seed-word",
    });
  });

  it("rejects a word already submitted this Puzzle", () => {
    const already = new Set(["late"]);
    expect(index.adjudicate(ate, "late", already)).toMatchObject({
      outcome: "rejected",
      reason: "already-submitted",
    });
  });

  it("accepts the same word on the first attempt", () => {
    expect(index.adjudicate(ate, "late").outcome).toBe("answer");
  });
});

describe("input hygiene", () => {
  it("matches case-insensitively and ignores surrounding whitespace", () => {
    const messy = index.adjudicate(ate, "  LATE  ");
    const clean = index.adjudicate(ate, "late");
    expect(messy.outcome).toBe("answer");
    expect(messy).toEqual(clean);
  });

  it.each(["la8te", "la-te", "la te", "gates!", ""])(
    "rejects malformed input %j",
    (submission) => {
      expect(index.adjudicate(ate, submission)).toMatchObject({
        outcome: "rejected",
        reason: "malformed",
      });
    },
  );

  it("distinguishes malformed input from a well-formed non-rhyme", () => {
    const malformed = index.adjudicate(ate, "la8te");
    const nonRhyme = index.adjudicate(ate, "hat");
    expect(malformed).toMatchObject({ reason: "malformed" });
    expect(nonRhyme).toMatchObject({ reason: "does-not-rhyme" });
  });
});
