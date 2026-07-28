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
 *
 * A Reveal suite then covers the end-of-game derivations and the ended Session:
 * both missed lists at their boundaries (nothing found, everything found) and as
 * exact complements of the finds, and what ending freezes — Score, Rank and the
 * refusal to adjudicate another word at all.
 *
 * A final suite covers the `Session` facade: it asserts each method matches the
 * free function it delegates to and that `submit` threads state immutably (a new
 * Session forward, `this` on a rejection) — the deep behaviour is already pinned
 * above, so the facade suite only checks delegation and value semantics.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import type { PuzzleEntry, RhymeIndex, SeedWord } from "../rhymeIndex.ts";
import type { RejectionReason, Tier } from "../verdict.ts";
import {
  applySubmission,
  DEFAULT_SCORING_CONFIG,
  emptyPlayState,
  endSession,
  missedAnswers,
  missedBonusWords,
  progress,
  rank,
  score,
  Session,
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

      // A live Session always judges the word; only an ended one declines (null).
      if (result === null) throw new Error(`declined a live Submission: ${row.submission}`);

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
      if (result === null) throw new Error(`declined a live Submission: ${submission}`);
      expect(result.verdict.outcome).toBe("rejected");
      if (result.verdict.outcome === "rejected") expect(result.verdict.reason).toBe(reason);
      expect(result.scoreDelta).toBe(0);
      expect(result.rankChange).toBeUndefined();
      // A rejection leaves state untouched — the same object comes back.
      expect(state).toBe(emptyPlayState);
    }
  });

  it("reports the Answers not yet found, in the Puzzle's order", () => {
    // Empty state misses every Answer; the reveal is the full Answer list.
    const allWords = context.puzzle.answers.map((a) => a.word);
    expect(missedAnswers(context, emptyPlayState).map((a) => a.word)).toEqual(allWords);

    // After finding two, the reveal is exactly the remaining Answers.
    const afterLate = applySubmission(context, emptyPlayState, "late").state;
    const afterGate = applySubmission(context, afterLate, "gate").state;
    expect(missedAnswers(context, afterGate).map((a) => a.word)).toEqual(
      allWords.filter((w) => w !== "late" && w !== "gate"),
    );
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
    expect(second.result?.verdict.outcome).toBe("rejected");
    if (second.result?.verdict.outcome === "rejected") {
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

// --- The Reveal: the two missed lists, and the ended Session -------------------

describe("the Reveal (fixture `ate` Puzzle)", () => {
  const index = makeTestIndex();
  const context = startSession(index, "ate", PLAYTHROUGH_CONFIG);
  const allAnswers = context.puzzle.answers.map((a) => a.word);
  const allBonus = context.puzzle.bonusWords.map((b) => b.word);

  /** Play a line of Submissions from empty, returning the state they reach. */
  function play(...submissions: string[]): PlayState {
    let state: PlayState = emptyPlayState;
    for (const word of submissions) state = applySubmission(context, state, word).state;
    return state;
  }

  it("misses no Answer once every one has been found", () => {
    // The far boundary of `missedAnswers`; the empty-state one is asserted above.
    const state = play(...allAnswers);
    expect(state.foundAnswers).toEqual(allAnswers);
    expect(missedAnswers(context, state)).toEqual([]);
  });

  it("misses every Bonus Word when none has been collected", () => {
    // The boundary the Reveal opens on for a player who found no Bonus Word.
    expect(missedBonusWords(context, emptyPlayState)).toEqual(context.puzzle.bonusWords);
  });

  it("misses no Bonus Word once every one has been collected", () => {
    const state = play(...allBonus);
    expect(state.foundBonus).toEqual(allBonus);
    expect(missedBonusWords(context, state)).toEqual([]);
  });

  it("returns the Puzzle's own entries, in the Puzzle's order", () => {
    const state = play("objurgate");
    expect(missedBonusWords(context, state)).toEqual(
      context.puzzle.bonusWords.filter((b) => b.word !== "objurgate"),
    );
  });

  it("partitions the Answers: each is a find or a miss, never both, never neither", () => {
    const state = play("late", "gate", "objurgate");
    const missed = missedAnswers(context, state).map((a) => a.word);
    expect([...state.foundAnswers, ...missed].sort()).toEqual([...allAnswers].sort());
    expect(missed.filter((word) => state.foundAnswers.includes(word))).toEqual([]);
  });

  it("partitions the Bonus Words: each is a find or a miss, never both, never neither", () => {
    const state = play("late", "objurgate");
    const missed = missedBonusWords(context, state).map((b) => b.word);
    expect([...state.foundBonus, ...missed].sort()).toEqual([...allBonus].sort());
    expect(missed.filter((word) => state.foundBonus.includes(word))).toEqual([]);
  });

  it("ends the Session, freezing Score and Rank and keeping the finds", () => {
    const played = play("late", "defenestrate");
    const ended = endSession(played);
    expect(ended.ended).toBe(true);
    expect(score(context, ended)).toBe(score(context, played));
    expect(rank(context, ended)).toEqual(rank(context, played));
    // The finds survive: a Reveal shows the misses *beside* them.
    expect(ended.foundAnswers).toEqual(played.foundAnswers);
    expect(progress(context, ended)).toEqual(progress(context, played));
  });

  it("leaves the pre-Reveal state untouched — ending is a value transition", () => {
    const played = play("late");
    const before = structuredClone(played);
    endSession(played);
    expect(played).toEqual(before);
  });

  it("declines a Submission once ended, without reaching adjudication", () => {
    // Poison the index: if an ended Session adjudicated, "the game is over" would
    // have to become a rejection reason, and that set is closed by design.
    const poisoned: PuzzleContext = {
      ...context,
      index: {
        adjudicate() {
          throw new Error("an ended Session must not adjudicate");
        },
      } as unknown as RhymeIndex,
    };
    const ended = endSession(play("late"));

    const { state, result } = applySubmission(poisoned, ended, "gate");
    expect(result).toBeNull();
    expect(state).toBe(ended);
    expect(score(context, state)).toBe(score(context, ended));
    expect(rank(context, state)).toEqual(rank(context, ended));
  });

  it("is idempotent: ending an ended Session changes nothing", () => {
    const ended = endSession(play("late"));
    expect(endSession(ended)).toBe(ended);
  });

  it("snapshots an ended Session at the totals it froze", () => {
    const played = play("late", "defenestrate");
    const live = toResult(context, played, { date: "2026-07-28" });
    expect(toResult(context, endSession(played), { date: "2026-07-28" })).toEqual(live);
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
      const state: PlayState = { foundAnswers: row.found, foundBonus: [], ended: false };
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

// --- The Session facade: delegation and value semantics ------------------------

describe("Session facade over the core (fixture `ate` Puzzle)", () => {
  const index = makeTestIndex();
  // The reference context/state the facade must match, method for free function.
  const context = startSession(index, "ate", PLAYTHROUGH_CONFIG);

  it("Session.start builds an empty Session over a fresh context", () => {
    const session = Session.start(index, "ate", PLAYTHROUGH_CONFIG);
    expect(session.context).toEqual(context);
    expect(session.state).toEqual(emptyPlayState);
    expect(session.maxScore).toBe(context.maxScore);
    expect(session.puzzle).toBe(session.context.puzzle);
    expect(session.seed).toEqual(context.seed);
    expect(session.score()).toBe(0);
    expect(session.rank().tier).toBe(0);
  });

  it("submit returns a new Session carrying the found word, leaving the original intact", () => {
    const session = Session.start(index, "ate", PLAYTHROUGH_CONFIG);
    const { session: next, result } = session.submit("late");

    // The accepted Answer advances a brand-new Session...
    expect(next).not.toBe(session);
    expect(result?.verdict.outcome).toBe("answer");
    expect(next.foundAnswers).toEqual(["late"]);
    expect(next.score()).toBe(score(context, next.state));

    // ...while the original Session is untouched (a value, not a mutable cell).
    expect(session.foundAnswers).toEqual([]);
    expect(session.score()).toBe(0);
  });

  it("submit returns the very same Session instance on a rejection", () => {
    const session = Session.start(index, "ate", PLAYTHROUGH_CONFIG);
    const { session: next, result } = session.submit("hat");
    expect(result?.verdict.outcome).toBe("rejected");
    expect(next).toBe(session);
  });

  it("every accessor matches its underlying free function for the same finds", () => {
    // Play a short line through both the facade and the raw core, then compare.
    let session = Session.start(index, "ate", PLAYTHROUGH_CONFIG);
    let state: PlayState = emptyPlayState;
    for (const word of ["late", "defenestrate", "eight", "objurgate"]) {
      session = session.submit(word).session;
      state = applySubmission(context, state, word).state;
    }

    expect(session.state).toEqual(state);
    expect(session.score()).toBe(score(context, state));
    expect(session.rank()).toEqual(rank(context, state));
    expect(session.progress()).toEqual(progress(context, state));
    expect(session.missedAnswers()).toEqual(missedAnswers(context, state));
    expect(session.missedBonusWords()).toEqual(missedBonusWords(context, state));
    expect(session.pointsFor("defenestrate")).toBe(context.answerScores.get("defenestrate"));
    expect(session.toResult({ date: "2026-07-26" })).toEqual(
      toResult(context, state, { date: "2026-07-26" }),
    );
  });

  it("end() returns an ended Session that declines Submissions, leaving the original playable", () => {
    const session = Session.start(index, "ate", PLAYTHROUGH_CONFIG).submit("late").session;
    expect(session.ended).toBe(false);

    const over = session.end();
    expect(over).not.toBe(session);
    expect(over.ended).toBe(true);
    expect(over.state).toEqual(endSession(session.state));
    // The Session it came from is a value, and stays playable.
    expect(session.ended).toBe(false);
    expect(session.submit("gate").result).not.toBeNull();

    // Nothing more lands, and the frozen totals hold.
    const { session: after, result } = over.submit("gate");
    expect(result).toBeNull();
    expect(after).toBe(over);
    expect(over.score()).toBe(session.score());
    expect(over.rank()).toEqual(session.rank());
  });

  it("end() on an ended Session returns the same instance", () => {
    const over = Session.start(index, "ate", PLAYTHROUGH_CONFIG).end();
    expect(over.end()).toBe(over);
  });

  it("can be rehydrated from a context and a saved PlayState", () => {
    const saved: PlayState = {
      foundAnswers: ["late", "gate"],
      foundBonus: ["objurgate"],
      ended: false,
    };
    const session = new Session(context, saved);
    expect(session.foundAnswers).toEqual(["late", "gate"]);
    expect(session.foundBonus).toEqual(["objurgate"]);
    expect(session.score()).toBe(score(context, saved));
  });
});
