/**
 * Slice: buildPuzzle. Tested on shape and stability, not exact membership —
 * asserting a full answer list would fail on every re-pin for no defect. So:
 * known members present, known non-members absent, Answers and Bonus Words
 * disjoint, each Answer carries length and knownness, and the Puzzle is
 * identical across runs.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";

const index = makeTestIndex();
const puzzle = index.buildPuzzle(index.pinSeed("ate"));

const answerWords = puzzle.answers.map((a) => a.word);
const bonusWords = puzzle.bonusWords.map((b) => b.word);

describe("buildPuzzle shape", () => {
  it("includes known Answers", () => {
    for (const word of ["late", "eight", "collate", "impregnate", "adjudicate", "defenestrate", "gate"]) {
      expect(answerWords).toContain(word);
    }
  });

  it("lists Bonus Words separately from Answers", () => {
    expect(bonusWords).toContain("objurgate");
    expect(bonusWords).toContain("sate");
    expect(answerWords).not.toContain("objurgate");
  });

  it("excludes known non-members and the Seed Word itself", () => {
    const all = [...answerWords, ...bonusWords];
    for (const word of ["hat", "chocolate", "commensurate", "kate", "ate"]) {
      expect(all).not.toContain(word);
    }
  });

  it("keeps Answers and Bonus Words disjoint", () => {
    expect(answerWords.filter((w) => bonusWords.includes(w))).toEqual([]);
  });

  it("carries length and knownness on every Answer", () => {
    for (const answer of puzzle.answers) {
      expect(answer.length).toBe(answer.word.length);
      expect(typeof answer.knownness).toBe("number");
    }
  });

  it("respells the Seed Word in its pinned reading", () => {
    // `ate` is EY1 T -> "AY-t"; the stressed syllable is upper-cased.
    expect(puzzle.seedRespelling).toBe("AY-t");
  });
});

describe("buildPuzzle stability", () => {
  it("is deterministic — the same Seed Word yields an identical Puzzle", () => {
    const again = index.buildPuzzle(index.pinSeed("ate"));
    expect(again).toEqual(puzzle);
  });

  it("builds the oversized `ate` tutorial Puzzle without complaint", () => {
    expect(puzzle.answers.length).toBeGreaterThan(0);
  });
});
