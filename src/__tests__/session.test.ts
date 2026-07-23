/**
 * The session suite. The primary test is one ordered play-through against the
 * fixture `ate` Puzzle: a single table whose state carries from row to row, each
 * row a Submission asserting the full player-visible tuple after it — verdict,
 * scoreDelta, cumulative Score, resolved Rank, and the presence/absence of a
 * Rank change — plus progress. It exercises `startSession -> applySubmission ->
 * score/rank/progress -> toResult` as one flow, catching composition bugs that
 * isolated unit tests cannot. Immutability of the input state rides along on
 * every row. Supporting tables use a synthetic, hand-built context to reach the
 * ladder boundaries and the `maxScore === 0` guard with controlled numbers.
 *
 * Everything is asserted through the module's public surface only — never its
 * internal representation — in the data-table style of `verdict-table.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import type { PuzzleEntry, RhymeIndex, SeedWord } from "../rhymeIndex.ts";
import type { RejectionReason, Tier } from "../verdict.ts";
import {
  applySubmission,
  DEFAULT_SCORING_CONFIG,
  emptyPlayState,
  progress,
  rank,
  score,
  startSession,
  toResult,
  type PlayState,
  type PuzzleContext,
  type RankTier,
  type ScoringConfig,
} from "../session.ts";

// --- Primary suite: one ordered play-through of the fixture `ate` Puzzle -------

// The `ate` Puzzle's 7 Answers (from the fixture): adjudicate(10,1.7),
// collate(7,1.8), defenestrate(12,1.5), eight(5,2.5), gate(4,2.4),
// impregnate(10,1.6), late(4,2.5); Bonus: objurgate, sate. The default rare
// cutoff (0.7) is tuned for the shipped 0-1 dataset and marks nothing rare on
// the fixture's z-scale, so we pin a fixture-appropriate cutoff of 1.55 — only
// `defenestrate` (1.5) is rare, giving a legible maxScore of 54:
//   late 4 + defenestrate 12+2 + eight 5 + collate 7 + gate 4 + impregnate 10 + adjudicate 10
const PLAYTHROUGH_CONFIG: ScoringConfig = {
  ...DEFAULT_SCORING_CONFIG,
  rareKnownnessCutoff: 1.55,
};
const EXPECTED_MAX_SCORE = 54;

type ExpectedVerdict =
  | { outcome: Tier }
  | { outcome: "rejected"; reason: RejectionReason };

interface PlayRow {
  submission: string;
  verdict: ExpectedVerdict;
  scoreDelta: number;
  /** Cumulative Score after this Submission. */
  score: number;
  /** Resolved Rank tier (rung index) after this Submission. */
  rankTier: number;
  /** Rank change this Submission triggered, by rung index, if any. */
  rankChange?: { from: number; to: number };
  /** Answers found and Bonus Words collected after this Submission. */
  found: number;
  foundBonus: number;
  note: string;
}

// Default ladder rung indices used below: 0 Beginner(0%), 2 Moving Up(5%),
// 5 Nice(25%), 6 Great(40%), 7 Amazing(50%), 8 Genius(70%), 9 All Answers(100%).
const script: PlayRow[] = [
  { submission: "late", verdict: { outcome: "answer" }, scoreDelta: 4, score: 4, rankTier: 2, rankChange: { from: 0, to: 2 }, found: 1, foundBonus: 0, note: "accept an Answer" },
  { submission: "hat", verdict: { outcome: "rejected", reason: "does-not-rhyme" }, scoreDelta: 0, score: 4, rankTier: 2, found: 1, foundBonus: 0, note: "non-rhyme rejection, state unchanged" },
  { submission: "defenestrate", verdict: { outcome: "answer" }, scoreDelta: 14, score: 18, rankTier: 5, rankChange: { from: 2, to: 5 }, found: 2, foundBonus: 0, note: "rare Answer: length 12 + rare bonus 2" },
  { submission: "late", verdict: { outcome: "rejected", reason: "already-submitted" }, scoreDelta: 0, score: 18, rankTier: 5, found: 2, foundBonus: 0, note: "repeat of a found Answer" },
  { submission: "objurgate", verdict: { outcome: "bonus" }, scoreDelta: 0, score: 18, rankTier: 5, found: 2, foundBonus: 1, note: "Bonus Word: zero Score, foundBonus grows" },
  { submission: "kate", verdict: { outcome: "rejected", reason: "proper-noun" }, scoreDelta: 0, score: 18, rankTier: 5, found: 2, foundBonus: 1, note: "proper-noun rejection" },
  { submission: "eight", verdict: { outcome: "answer" }, scoreDelta: 5, score: 23, rankTier: 6, rankChange: { from: 5, to: 6 }, found: 3, foundBonus: 1, note: "crosses a Rank threshold" },
  { submission: "collate", verdict: { outcome: "answer" }, scoreDelta: 7, score: 30, rankTier: 7, rankChange: { from: 6, to: 7 }, found: 4, foundBonus: 1, note: "crosses another threshold" },
  { submission: "gate", verdict: { outcome: "answer" }, scoreDelta: 4, score: 34, rankTier: 7, found: 5, foundBonus: 1, note: "Score rises within the same rung" },
  { submission: "impregnate", verdict: { outcome: "answer" }, scoreDelta: 10, score: 44, rankTier: 8, rankChange: { from: 7, to: 8 }, found: 6, foundBonus: 1, note: "reaches the top named tier (Genius, 70%)" },
  { submission: "adjudicate", verdict: { outcome: "answer" }, scoreDelta: 10, score: 54, rankTier: 9, rankChange: { from: 8, to: 9 }, found: 7, foundBonus: 1, note: "every Answer found -> all-Answers tier (100%)" },
];

describe("session play-through (fixture `ate` Puzzle)", () => {
  const index = makeTestIndex();
  const context = startSession(index, "ate", PLAYTHROUGH_CONFIG);

  it("precomputes maxScore as the sum of every Answer's points", () => {
    expect(context.maxScore).toBe(EXPECTED_MAX_SCORE);
  });

  it("starts empty: nothing found, bottom Rank, zero Score", () => {
    expect(score(context, emptyPlayState)).toBe(0);
    expect(rank(context, emptyPlayState).tier).toBe(0);
    expect(progress(context, emptyPlayState)).toEqual({ found: 0, totalAnswers: 7, foundBonus: 0 });
  });

  it("plays the whole script, asserting the tuple after each Submission", () => {
    let state: PlayState = emptyPlayState;

    for (const row of script) {
      const before = structuredClone(state);
      const { state: next, result } = applySubmission(context, state, row.submission);

      // The input state is never mutated (immutability rides along every row).
      expect(state).toEqual(before);

      // Verdict.
      expect(result.verdict.outcome).toBe(row.verdict.outcome);
      if (row.verdict.outcome === "rejected" && result.verdict.outcome === "rejected") {
        expect(result.verdict.reason).toBe(row.verdict.reason);
      }

      // Points, Score, progress.
      expect(result.scoreDelta).toBe(row.scoreDelta);
      expect(score(context, next)).toBe(row.score);
      expect(progress(context, next)).toEqual({
        found: row.found,
        totalAnswers: 7,
        foundBonus: row.foundBonus,
      });

      // Resolved Rank and the Rank-change event.
      expect(rank(context, next).tier).toBe(row.rankTier);
      if (row.rankChange) {
        expect(result.rankChange).toBeDefined();
        expect(result.rankChange?.from.tier).toBe(row.rankChange.from);
        expect(result.rankChange?.to.tier).toBe(row.rankChange.to);
      } else {
        expect(result.rankChange).toBeUndefined();
      }

      state = next;
    }

    // The finished game snapshots into a durable result.
    const result = toResult(context, state, { date: "2026-07-23" });
    expect(result).toEqual({
      date: "2026-07-23",
      seed: "ate",
      finalScore: 54,
      finalRank: { tier: 9, label: "All Answers", threshold: 100 },
      found: 7,
      totalAnswers: 7,
    });
  });

  it("surfaces every rejection reason unchanged from adjudicate", () => {
    // The play-through covers does-not-rhyme, proper-noun and already-submitted;
    // these are the remaining reasons, passed through verbatim with zero delta.
    const cases: { submission: string; reason: RejectionReason }[] = [
      { submission: "ate", reason: "is-the-seed-word" },
      { submission: "GA7!", reason: "malformed" },
      { submission: "zzz", reason: "not-a-known-word" },
    ];
    for (const { submission, reason } of cases) {
      const { state, result } = applySubmission(context, emptyPlayState, submission);
      expect(result.verdict.outcome).toBe("rejected");
      if (result.verdict.outcome === "rejected") expect(result.verdict.reason).toBe(reason);
      expect(result.scoreDelta).toBe(0);
      expect(result.rankChange).toBeUndefined();
      // A rejection leaves state untouched — the same object comes back.
      expect(state).toBe(emptyPlayState);
    }
  });

  it("accepts a pre-pinned SeedWord, skipping the raw-word pinning branch", () => {
    const pinned: SeedWord = index.pinSeed("ate");
    const fromSeedWord = startSession(index, pinned, PLAYTHROUGH_CONFIG);
    expect(fromSeedWord.seed).toEqual(context.seed);
    expect(fromSeedWord.maxScore).toBe(EXPECTED_MAX_SCORE);
  });

  it("re-adjudicates a previously rejected word rather than masking it as a repeat", () => {
    // `hat` was rejected (never stored), so re-typing it is judged afresh, not
    // reported as already-submitted.
    const first = applySubmission(context, emptyPlayState, "hat");
    const second = applySubmission(context, first.state, "hat");
    expect(second.result.verdict.outcome).toBe("rejected");
    if (second.result.verdict.outcome === "rejected") {
      expect(second.result.verdict.reason).toBe("does-not-rhyme");
    }
  });

  it("snapshots are values: a later retune does not rewrite a taken result", () => {
    const played = applySubmission(context, emptyPlayState, "defenestrate").state;
    const snapshot = toResult(context, played, { date: "2026-07-23" });
    const before = structuredClone(snapshot);

    // Re-score the same finds under a stingier config (no rare bonus): the live
    // Score differs, but the already-taken snapshot is unchanged.
    const retuned = startSession(context.index, "ate", {
      ...PLAYTHROUGH_CONFIG,
      rareBonus: 0,
    });
    expect(score(retuned, played)).not.toBe(snapshot.finalScore);
    expect(snapshot).toEqual(before);
  });
});

// --- Supporting suite: ladder boundaries against a synthetic context -----------

const LADDER: RankTier[] = [
  { threshold: 0, label: "bottom" },
  { threshold: 25, label: "quarter" },
  { threshold: 50, label: "half" },
  { threshold: 100, label: "all" },
];

/**
 * A hand-built context whose Answer points and maxScore are controlled exactly.
 * `PuzzleEntry.length` (not the word string) drives scoring, so lengths are
 * chosen to hit precise percentages. Selectors read only word/length/knownness,
 * so the index and pronunciations are inert placeholders.
 */
function synthContext(
  answers: { word: string; length: number; knownness: number }[],
  maxScore: number,
): PuzzleContext {
  const seed: SeedWord = { word: "seed", rhymeKey: "SEED" };
  const entries: PuzzleEntry[] = answers.map((a) => ({
    word: a.word,
    length: a.length,
    knownness: a.knownness,
    pronunciation: [],
    respelling: "",
  }));
  const config: ScoringConfig = { rareKnownnessCutoff: 0.7, rareBonus: 2, rankLadder: LADDER };
  // Not rare (knownness above the cutoff), so each Answer's points are its length.
  const answerScores = new Map(answers.map((a) => [a.word, a.length]));
  return {
    index: null as unknown as RhymeIndex,
    seed,
    puzzle: { seed, seedRespelling: "", answers: entries, bonusWords: [] },
    config,
    answerScores,
    maxScore,
  };
}

// Four Answers worth 24 / 1 / 25 / 50 points (knownness above the cutoff, so no
// rare bonus), maxScore 100 — chosen so found-subsets land on exact percentages.
const boundaryAnswers = [
  { word: "a", length: 24, knownness: 5 },
  { word: "b", length: 1, knownness: 5 },
  { word: "c", length: 25, knownness: 5 },
  { word: "d", length: 50, knownness: 5 },
];

interface RankRow {
  found: string[];
  pct: number;
  tier: number;
  label: string;
  note: string;
}

const rankRows: RankRow[] = [
  { found: [], pct: 0, tier: 0, label: "bottom", note: "0% resolves to the bottom rung" },
  { found: ["a"], pct: 24, tier: 0, label: "bottom", note: "just below a threshold does not trigger" },
  { found: ["a", "b"], pct: 25, tier: 1, label: "quarter", note: ">= threshold triggers exactly at the line" },
  { found: ["a", "b", "c"], pct: 50, tier: 2, label: "half", note: "next rung at its threshold" },
  { found: ["a", "b", "c", "d"], pct: 100, tier: 3, label: "all", note: "every Answer -> top rung" },
];

describe("rank ladder boundaries (synthetic context)", () => {
  const context = synthContext(boundaryAnswers, 100);

  for (const row of rankRows) {
    it(`${row.pct}% -> tier ${row.tier} (${row.note})`, () => {
      const state: PlayState = { foundAnswers: row.found, foundBonus: [] };
      const resolved = rank(context, state);
      expect(resolved.tier).toBe(row.tier);
      expect(resolved.label).toBe(row.label);
      expect(resolved.threshold).toBe(LADDER[row.tier]!.threshold);
    });
  }

  it("returns the bottom rung when maxScore is 0 (no divide-by-zero)", () => {
    const degenerate = synthContext([], 0);
    const resolved = rank(degenerate, emptyPlayState);
    expect(resolved).toEqual({ tier: 0, label: "bottom", threshold: 0 });
  });
});
